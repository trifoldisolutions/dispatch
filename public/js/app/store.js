// State shared by Home, the project list and the palette, as signals:
// components that read one redraw when it changes.
//
// The older scripts (public/js/legacy) still own the registry and the
// listening/running state; they announce changes with the "dispatch:render"
// and "dispatch:status" events, read here through window.DispatchLegacy.
import { signal, computed } from "@preact/signals";
import * as api from "./api.js";

const legacy = () => window.DispatchLegacy;

export const view = signal("home"); // "home" | "projects" | "project"
export const project = signal(null); // whose page is showing, on "project"
export const status = signal({ ports: {}, runs: {} }); // port -> listening, name -> { status, error, twError }
export const newFolders = signal([]);
export const myProjects = signal({ loaded: false, error: null, list: [] });
export const home = signal({ loaded: false, error: null, data: null });
export const busy = signal({}); // name -> true while a start/stop it asked for is in flight

const STALE_MS = 30 * 1000; // how long a page's data counts as fresh when you come back to it
let projectsLoadedAt = 0;
let homeLoadedAt = 0;

export async function loadProjects() {
  projectsLoadedAt = Date.now();
  try {
    const { projects } = await api.getMyProjects();
    myProjects.value = { loaded: true, error: null, list: projects };
  } catch (err) {
    myProjects.value = { ...myProjects.value, loaded: true, error: err.message };
  }
}

export async function loadHome() {
  homeLoadedAt = Date.now();
  try {
    home.value = { loaded: true, error: null, data: await api.getHome() };
  } catch (err) {
    home.value = { ...home.value, loaded: true, error: err.message };
  }
}

// Fetches what the page now showing needs, unless it's still fresh. Every
// page needs the project list: Home's, the list beside project pages, and the
// left menu's Projects, which links to the first of them.
function loadForView(name) {
  const now = Date.now();
  if (now - projectsLoadedAt > STALE_MS) loadProjects();
  if (name === "home" && now - homeLoadedAt > STALE_MS) loadHome();
}

// Something changed on the server (/live says what): refetch what depends on
// it now if it's showing, or next time it is.
export function invalidate({ projects = false, home: homeToo = false } = {}) {
  if (projects) projectsLoadedAt = 0;
  if (homeToo) homeLoadedAt = 0;
  loadForView(view.value);
}

document.addEventListener("dispatch:render", (e) => {
  const next = e.detail.view;
  project.value = e.detail.project;
  if (next !== view.value) {
    view.value = next;
    loadForView(next);
  }
  if (legacy()) newFolders.value = legacy().newFolders();
});

document.addEventListener("dispatch:status", (e) => {
  status.value = e.detail;
});

// /live's presence: Home's People dots follow it.
export function setOnline(ids) {
  const { data } = home.value;
  if (!data) return;
  const online = new Set(ids);
  home.value = { ...home.value, data: { ...data, people: data.people.map((p) => ({ ...p, online: online.has(p.id) })) } };
}

// ---- Derived state -------------------------------------------------------

// "running" (started here, or something answers on its port), "starting",
// "crashed" or "stopped". Dispatch's own page is running by definition.
export function runState(project, current = status.value) {
  if (project.self) return "running";
  const run = current.runs[project.name];
  if (run && run.status === "starting") return "starting";
  if (run && run.status === "running") return "running";
  if (project.port && current.ports[String(project.port)]) return "running";
  if (run && run.status === "crashed") return "crashed";
  return "stopped";
}

export const runningProjects = computed(() =>
  myProjects.value.list.filter((p) => !p.self && runState(p, status.value) === "running")
);

// ---- Actions ---------------------------------------------------------------

function toast(kind, message) {
  if (legacy()) legacy().setStatus(kind, message);
}

// Starts or stops a project, like its Run/Stop button on the board: a port
// something else already answers on gets a confirm before starting.
export async function toggleRun(project) {
  if (busy.value[project.name]) return;
  const running = runState(project) === "running";
  if (!running && project.port) {
    try {
      const ports = await api.getPortStatus([project.port]);
      if (ports[String(project.port)]) {
        const proceed = await legacy().confirm(
          `Port ${project.port} already has something listening on it (maybe started outside this dashboard). ` +
            `Starting "${project.name}" now may fail to bind. Continue anyway?`
        );
        if (!proceed) return;
      }
    } catch {
      // the start itself will say what's wrong
    }
  }
  busy.value = { ...busy.value, [project.name]: true };
  try {
    if (running) await api.stopProject(project.name);
    else await api.startProject(project.name);
  } catch (err) {
    toast("error", `${running ? "Stop" : "Start"} ${project.name}: ${err.message}`);
  } finally {
    const { [project.name]: _, ...rest } = busy.value;
    busy.value = rest;
    legacy().refreshStatus();
  }
}

export async function openInVSCode(name) {
  try {
    await api.openInVSCode(name);
  } catch (err) {
    toast("error", err.message);
  }
}

// Ticks a task done from Home, then refetches Home and the counts.
export async function completeTask(task) {
  try {
    await api.patchTask(task.project, task.id, { done: true });
    legacy().forgetTasks(task.project);
    toast("saved", `Done: ${task.title}`);
  } catch (err) {
    toast("error", err.message);
  }
  invalidate({ projects: true, home: true });
}

export function navigate(path, options) {
  legacy().navigate(path, options);
}

// The first state: the older scripts ran (and rendered once) before this
// module loaded, so its first "dispatch:render" came too early to hear.
export function init() {
  status.value = legacy().liveStatus();
  newFolders.value = legacy().newFolders();
  view.value = legacy().view();
  project.value = legacy().project();
  loadForView(view.value);
}
