const { WebSocketServer } = require("ws");
const Project = require("../models/Project");
const { SELF_PROJECT } = require("../config/projects");
const { sessions, loadUser } = require("../middleware/auth");
const { recentlySeenUserIds, touchUsers, onLogout } = require("./auth");
const { isPortServing, runsSnapshot } = require("./processes");

// /live: one WebSocket per open Dispatch page, for what changes while it's
// open. In place of every page polling every few seconds, the server checks
// once and tells them all when something actually changed:
//
//   { type: "ports", ports: { "3001": true, ... } }  what answers on each project's port
//   { type: "runs", runs: { name: { status, error, twError } } }  what Dispatch started
//   { type: "presence", online: [userId, ...] }  who has Dispatch open
//   { type: "registry" }  projects added, moved or removed: reload them
//   { type: "tasks" | "journal" | "staff", project }  that project's tasks, journal or staff changed
//   { type: "people" }  an account was added, changed or removed (accounts.js)
//   { type: "logged-out" }  this page's login is over: it goes to log in
//
// Each page gets ports, runs and presence as soon as it connects. Only logged
// in users on a Dispatch page (same origin) can connect, and a socket lasts
// only as long as the login that opened it: a logout (in any of its tabs), a
// suspended or deleted account, or an expired login closes it, so a page
// left open doesn't keep its user online. The pages fall back to polling
// while the connection is down (public/js/app/live.js).

const PORTS_EVERY_MS = 3000; // checking ports costs a connection attempt each, so not every second
const RUNS_EVERY_MS = 1000; // in-memory, so cheap
const PRESENCE_EVERY_MS = 30 * 1000; // recently-seen users drop off between connects and disconnects
const PING_EVERY_MS = 30 * 1000; // closes sockets whose page vanished without saying so

function createLive({ sessions, loadUser, watchedPorts, isPortServing, runsSnapshot, onlineUserIds, touchUsers }) {
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set();
  let ports = null; // last sent: { port: listening }
  let portsJson = "";
  let runsJson = "";
  let presenceJson = "";
  let timers = [];

  const send = (ws, message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  // A socket joins broadcasts once its first snapshot is sent (see
  // connected), so a check that runs for it doesn't send it the same twice.
  const broadcast = (message) => {
    const text = JSON.stringify(message);
    for (const ws of sockets) if (ws.ready && ws.readyState === ws.OPEN) ws.send(text);
  };

  async function checkPorts() {
    const list = await watchedPorts();
    const results = await Promise.all(list.map(async (port) => [String(port), await isPortServing(port)]));
    const next = Object.fromEntries(results);
    const json = JSON.stringify(next);
    ports = next;
    if (json !== portsJson) {
      portsJson = json;
      broadcast({ type: "ports", ports: next });
    }
  }

  function checkRuns() {
    const runs = runsSnapshot();
    const json = JSON.stringify(runs);
    if (json !== runsJson) {
      runsJson = json;
      broadcast({ type: "runs", runs });
    }
  }

  function connectedUserIds() {
    return [...new Set([...sockets].map((ws) => ws.userId))];
  }

  // Who a request's login is: { known, user }. known is false when that
  // can't be told (the database is down), which isn't the same as no login.
  function authenticate(req) {
    const res = { locals: {}, getHeader() {}, setHeader() {}, writeHead() {}, end() {}, on() {} };
    return new Promise((resolve, reject) => {
      sessions(req, res, (err) => {
        if (err) return reject(err);
        loadUser(req, res, (err) => (err ? reject(err) : resolve({ known: !!req.session, user: req.user })));
      });
    });
  }

  // Tells these pages their login is over and closes their sockets. They
  // stop counting at once, not when the close completes, and presence is
  // sent again without them.
  function endSockets(ended) {
    if (ended.length === 0) return;
    for (const ws of ended) {
      sockets.delete(ws);
      send(ws, { type: "logged-out" });
      ws.close(4001, "Logged out");
    }
    if (sockets.size === 0) stop();
    else checkPresence().catch(() => {});
  }

  // Each login with a socket open, checked again with the cookie it
  // connected with: one that's over (expired, or its account suspended or
  // deleted) ends its sockets. When it can't be told, they stay.
  async function checkLogins() {
    const bySession = new Map();
    for (const ws of sockets) {
      if (!bySession.has(ws.sessionId)) bySession.set(ws.sessionId, []);
      bySession.get(ws.sessionId).push(ws);
    }
    for (const list of bySession.values()) {
      const { userId, loginHeaders } = list[0];
      try {
        const { known, user } = await authenticate({ headers: loginHeaders, url: "/live", method: "GET" });
        if (known && (!user || String(user._id) !== userId)) endSockets(list.filter((ws) => sockets.has(ws)));
      } catch {
        // the next round checks it again
      }
    }
  }

  async function checkPresence() {
    const connected = connectedUserIds();
    await touchUsers(connected).catch(() => {});
    const online = [...new Set([...connected, ...(await onlineUserIds().catch(() => []))])].sort();
    const json = JSON.stringify(online);
    if (json !== presenceJson) {
      presenceJson = json;
      broadcast({ type: "presence", online });
    }
    return online;
  }

  // The checks only run while someone's watching.
  function start() {
    if (timers.length) return;
    const every = (fn, ms) => setInterval(() => fn().catch?.(() => {}), ms);
    timers = [
      every(checkPorts, PORTS_EVERY_MS),
      every(async () => checkRuns(), RUNS_EVERY_MS),
      every(async () => {
        await checkLogins();
        await checkPresence();
      }, PRESENCE_EVERY_MS),
      setInterval(() => {
        for (const ws of sockets) {
          if (!ws.isAlive) {
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
      }, PING_EVERY_MS),
    ];
  }
  function stop() {
    timers.forEach(clearInterval);
    timers = [];
    ports = null;
    portsJson = runsJson = presenceJson = "";
  }

  // An upgrade request on the HTTP server: /live from a logged-in Dispatch
  // page becomes a socket; anything else is refused.
  function handleUpgrade(req, socket, head) {
    const refuse = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return refuse(400, "Bad Request");
    }
    if (url.pathname !== "/live") return refuse(404, "Not Found");
    // Browsers always send Origin on a WebSocket; another site's page could
    // otherwise open one with this user's cookie.
    let originHost = null;
    try {
      originHost = new URL(req.headers.origin).host;
    } catch {}
    if (originHost !== req.headers.host) return refuse(403, "Forbidden");

    authenticate(req).then(
      ({ user }) => {
        if (!user) return refuse(401, "Unauthorized");
        // ?user= is who the page was drawn for. A page left open while its
        // browser logged in as someone else would otherwise reconnect as
        // them; it's told to log in instead, which reloads it as them.
        const drawnFor = url.searchParams.get("user");
        if (drawnFor && drawnFor !== String(user._id)) {
          return wss.handleUpgrade(req, socket, head, (ws) => {
            send(ws, { type: "logged-out" });
            ws.close(4001, "Logged out");
          });
        }
        wss.handleUpgrade(req, socket, head, (ws) => connected(ws, user, req));
      },
      () => refuse(500, "Internal Server Error")
    );
  }

  async function connected(ws, user, req) {
    ws.userId = String(user._id);
    ws.sessionId = req.sessionID;
    ws.loginHeaders = { cookie: req.headers.cookie || "" }; // for checkLogins
    ws.isAlive = true;
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("close", () => {
      sockets.delete(ws);
      if (sockets.size === 0) stop();
      else checkPresence().catch(() => {});
    });
    ws.on("error", () => {});
    ws.ready = false;
    sockets.add(ws); // counted as online from here
    start();
    try {
      if (!ports) await checkPorts();
      send(ws, { type: "ports", ports });
      checkRuns();
      send(ws, { type: "runs", runs: JSON.parse(runsJson) });
      send(ws, { type: "presence", online: await checkPresence() });
    } catch {
      // the next round of checks sends it
    }
    ws.ready = true;
  }

  return {
    handleUpgrade,
    // Called by the routes that change these, so open pages update at once.
    registryChanged() {
      broadcast({ type: "registry" });
      if (sockets.size) checkPorts().catch(() => {});
    },
    projectChanged(project, kind) {
      broadcast({ type: kind, project });
    },
    peopleChanged() {
      broadcast({ type: "people" });
    },
    // A logout (auth.js): every page that login has open.
    loggedOut({ sessionId }) {
      endSockets([...sockets].filter((ws) => ws.sessionId === sessionId));
    },
    // A suspended or deleted account (routes/api.js): every page it has open.
    accountClosed(userId) {
      endSockets([...sockets].filter((ws) => ws.userId === String(userId)));
    },
    runsChanged() {
      checkRuns();
    },
  };
}

// What open pages hear about without polling.
const live = createLive({
  sessions,
  loadUser,
  isPortServing,
  async watchedPorts() {
    const projects = await Project.find({ port: { $ne: null }, name: { $ne: SELF_PROJECT } }, { port: 1 }).lean();
    return projects.map((project) => project.port);
  },
  runsSnapshot,
  onlineUserIds: recentlySeenUserIds,
  touchUsers,
});
onLogout((login) => live.loggedOut(login));

module.exports = live;
