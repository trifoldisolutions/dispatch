const { WebSocketServer } = require("ws");

// /live: one WebSocket per open Dispatch page, for what changes while it's
// open. In place of every page polling every few seconds, the server checks
// once and tells them all when something actually changed:
//
//   { type: "ports", ports: { "3001": true, ... } }  what answers on each project's port
//   { type: "runs", runs: { name: { status, error, twError } } }  what Dispatch started
//   { type: "presence", online: [userId, ...] }  who has Dispatch open
//   { type: "registry" }  projects added, moved or removed: reload them
//   { type: "tasks" | "journal", project }  that project's tasks or journal changed
//
// Each page gets ports, runs and presence as soon as it connects. Only logged
// in users on a Dispatch page (same origin) can connect. The pages fall back
// to polling while the connection is down (public/js/app/live.js).

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
      every(checkPresence, PRESENCE_EVERY_MS),
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

    const res = { locals: {}, getHeader() {}, setHeader() {}, writeHead() {}, end() {}, on() {} };
    sessions(req, res, (err) => {
      if (err) return refuse(500, "Internal Server Error");
      loadUser(req, res, (err) => {
        if (err) return refuse(500, "Internal Server Error");
        if (!req.user) return refuse(401, "Unauthorized");
        wss.handleUpgrade(req, socket, head, (ws) => connected(ws, req.user));
      });
    });
  }

  async function connected(ws, user) {
    ws.userId = String(user._id);
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
    runsChanged() {
      checkRuns();
    },
  };
}

module.exports = { createLive };
