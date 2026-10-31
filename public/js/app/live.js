// The page's end of /live (see live.js beside server.js): one WebSocket the
// server pushes changes down. While it's open, the older scripts' polls
// stand down (they check window.DispatchLive.connected); while it's down they
// run as before, and this keeps trying to reconnect, a little slower each time.
import * as store from "./store.js";

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

const live = (window.DispatchLive = { connected: false });
let attempt = 0;

function handle(message) {
  const legacy = window.DispatchLegacy;
  switch (message.type) {
    case "ports":
      legacy.applyPortLiveStatus(message.ports);
      break;
    case "runs":
      legacy.applyProjectRunStatus(message.runs);
      break;
    case "presence":
      legacy.applyStaffPresence(message.online);
      store.setOnline(message.online);
      break;
    case "registry":
      legacy.reloadRegistry();
      store.invalidate({ projects: true, home: true });
      break;
    case "tasks":
    case "journal":
      legacy.projectDataChanged(message.project, message.type);
      store.invalidate({ projects: true, home: true });
      break;
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`);
  ws.addEventListener("open", () => {
    live.connected = true;
    attempt = 0;
  });
  ws.addEventListener("message", (e) => {
    try {
      handle(JSON.parse(e.data));
    } catch (err) {
      console.error("live message failed", err);
    }
  });
  ws.addEventListener("close", () => {
    const wasConnected = live.connected;
    live.connected = false;
    // Catch up at once by polling, rather than waiting out the next tick.
    if (wasConnected) window.DispatchLegacy.refreshStatus();
    setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  });
}

connect();
