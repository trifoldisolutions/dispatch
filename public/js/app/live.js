// The page's end of /live (see live.js beside server.js): one WebSocket the
// server pushes changes down. While it's open, the older scripts' polls
// stand down (they check window.DispatchLive.connected); while it's down they
// run as before, and this keeps trying to reconnect, a little slower each time.
// Once the page's login is over (logged out, maybe in another tab, or the
// account suspended), the server says so and the page goes to log in.
import * as store from "./store.js";

const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

const live = (window.DispatchLive = { connected: false });
let attempt = 0;
let loggedOut = false;

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
      store.invalidate({ projects: true, tasks: true, people: true });
      break;
    case "tasks":
    case "journal":
    case "staff":
      legacy.projectDataChanged(message.project, message.type);
      // The cards' figures and last entry, Your tasks, and who's on what in People.
      store.invalidate({ projects: true, tasks: message.type === "tasks", people: message.type === "staff" });
      break;
    case "people":
      // An account was added, changed or removed: People, the cards' staff, and Users.
      store.invalidate({ projects: true, people: true });
      store.accountsChanged.value++;
      break;
    case "logged-out":
      // Logging back in returns here (as whoever's logged in by then).
      loggedOut = true;
      location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
      break;
  }
}

function connect() {
  const user = encodeURIComponent(document.body.dataset.user || "");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live?user=${user}`);
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
    if (loggedOut) return; // on its way to the login page
    // Catch up at once by polling, rather than waiting out the next tick.
    if (wasConnected) window.DispatchLegacy.refreshStatus();
    setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  });
}

connect();
