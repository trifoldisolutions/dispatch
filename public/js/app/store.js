// State shared by the project list, the side column (Your tasks, Ready to
// push, People) and the palette, as signals: components that read one
// redraw when it changes.
//
// The older scripts (public/js/legacy) still own the registry and the
// listening/running state; they announce changes with the "dispatch:render"
// and "dispatch:status" events, read here through window.DispatchLegacy.
import { signal, computed } from "@preact/signals";
import * as api from "./api.js";

const legacy = () => window.DispatchLegacy;

// An admin's page (views/app/index.ejs marks it): they oversee the projects
// without working on them, so Users is their only page. The server decides
// what they can do; this only shapes the page.
export const isAdmin = document.body.hasAttribute("data-admin");

export const view = signal("projects"); // "projects" (/ or /projects, on the way to a project) | "project" | "people" | "users"
export const project = signal(null); // whose page is showing, on "project"
export const status = signal({ ports: {}, runs: {} }); // port -> listening, name -> { status, error, twError }
export const newFolders = signal([]);
export const registry = signal({ entries: [], unassigned: [], loaded: false }); // every project by port, as the older scripts hold it (DispatchLegacy.registry)
export const myProjects = signal({ loaded: false, error: null, list: [] });
export const myTasks = signal({ loaded: false, error: null, data: null }); // data: { today, tasks } (GET /api/me/tasks)
export const myPushes = signal({ loaded: false, error: null, data: null }); // data: { pushes } (GET /api/me/pushes)
export const people = signal({ loaded: false, error: null, data: null }); // data: { people, leading, seesClients } (GET /api/me/people)
export const online = signal(null); // /live's presence: a Set of user ids, null until it first arrives
export const accountsChanged = signal(0); // counts /live's "people": the Users page reloads on it
export const busy = signal({}); // name -> true while a start/stop it asked for is in flight
export const pushing = signal(new Set()); // projects with a push running, from either Push button

// The side column beside project pages and /projects, under the Add project
// form, from the same window width as that form's (SIDE_FORM_QUERY in
// public/js/legacy/project-form.js). Narrower, there's no room for it.
const SIDE_QUERY = window.matchMedia("(min-width: 2072px)");
const wideEnough = signal(SIDE_QUERY.matches);
export const sideShown = computed(() => wideEnough.value && (view.value === "project" || view.value === "projects"));
SIDE_QUERY.addEventListener("change", (e) => {
  wideEnough.value = e.matches;
  loadStale();
});

const STALE_MS = 30 * 1000; // how long a page's data counts as fresh when you come back to it
let projectsLoadedAt = 0;
let tasksLoadedAt = 0;
let pushesLoadedAt = 0;
let peopleLoadedAt = 0;

export async function loadProjects() {
  projectsLoadedAt = Date.now();
  try {
    const { projects } = await api.getMyProjects();
    myProjects.value = { loaded: true, error: null, list: projects };
  } catch (err) {
    myProjects.value = { ...myProjects.value, loaded: true, error: err.message };
  }
}

export async function loadTasks() {
  tasksLoadedAt = Date.now();
  try {
    myTasks.value = { loaded: true, error: null, data: await api.getMyTasks() };
  } catch (err) {
    myTasks.value = { ...myTasks.value, loaded: true, error: err.message };
  }
}

export async function loadPushes() {
  pushesLoadedAt = Date.now();
  try {
    myPushes.value = { loaded: true, error: null, data: await api.getMyPushes() };
  } catch (err) {
    myPushes.value = { ...myPushes.value, loaded: true, error: err.message };
  }
}

export async function loadPeople() {
  peopleLoadedAt = Date.now();
  try {
    people.value = { loaded: true, error: null, data: await api.getPeople() };
  } catch (err) {
    people.value = { ...people.value, loaded: true, error: err.message };
  }
}

// Fetches what's showing needs, unless it's still fresh. Every page needs the
// project list: the list beside project pages, and the left menu's Projects,
// which links to the first of them. The side column's tasks and commit
// messages only load while it shows, and people while it or the People page
// does (the page fetches its own list, everyone, again whenever these
// reload).
function loadStale() {
  const now = Date.now();
  if (now - projectsLoadedAt > STALE_MS) loadProjects();
  if (sideShown.value && now - tasksLoadedAt > STALE_MS) loadTasks();
  if (sideShown.value && now - pushesLoadedAt > STALE_MS) loadPushes();
  if ((sideShown.value || view.value === "people") && now - peopleLoadedAt > STALE_MS) loadPeople();
}

// Something changed on the server (/live says what): refetch what depends on
// it now if it's showing, or next time it is.
export function invalidate({ projects = false, tasks = false, pushes = false, people: peopleToo = false } = {}) {
  if (projects) projectsLoadedAt = 0;
  if (tasks) tasksLoadedAt = 0;
  if (pushes) pushesLoadedAt = 0;
  if (peopleToo) peopleLoadedAt = 0;
  loadStale();
}

document.addEventListener("dispatch:render", (e) => {
  const next = e.detail.view;
  project.value = e.detail.project;
  if (next !== view.value) {
    view.value = next;
    loadStale();
  }
  if (!legacy()) return;
  newFolders.value = legacy().newFolders();
  registry.value = legacy().registry();
});

document.addEventListener("dispatch:status", (e) => {
  status.value = e.detail;
});

document.addEventListener("dispatch:push", (e) => {
  pushing.value = new Set(e.detail.pushing);
});

// /live's presence: People's dots follow it.
export function setOnline(ids) {
  online.value = new Set(ids);
}

// Whether someone has Dispatch open: /live's word once it has spoken, the
// server's at load time until then.
export function isOnline(person) {
  return online.value ? online.value.has(person.id) : person.online;
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

export function toast(kind, message) {
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
    // The spinner stays until the status shows it (see untilStatus), so the
    // button doesn't show its old state again on the way.
    await legacy().untilStatus(() => {
      const state = runState(project, legacy().liveStatus());
      return running ? state !== "running" : state !== "stopped";
    });
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

// Ticks a task done from Your tasks, then refetches them and the counts.
export async function completeTask(task) {
  try {
    await api.patchTask(task.project, task.id, { done: true });
    legacy().forgetTasks(task.project);
    toast("saved", `Done: ${task.title}`);
  } catch (err) {
    toast("error", err.message);
  }
  invalidate({ projects: true, tasks: true });
}

// Ready to push's Push: the History panel's own (runGitPush in
// public/js/legacy/history.js), so either button shows the other's running.
// Without anything to commit, the message isn't used and stays listed.
export async function pushProject(name) {
  try {
    const result = await legacy().pushProject(name);
    if (!result) return; // already pushing
    toast("saved", result.committed ? `Pushed ${name}` : `Nothing to commit in ${name}: its message waits for the next push`);
  } catch (err) {
    toast("error", `Push ${name}: ${err.message}`);
  }
  invalidate({ pushes: true });
}

// People's Add to project, once confirmed: true when they were added.
// /live then tells every open page, so the project's Staff shows them.
export async function addToProject(person, projectName) {
  try {
    await api.addToProject(projectName, person.id);
    toast("saved", `Added ${person.displayName} to ${projectName}`);
    return true;
  } catch (err) {
    toast("error", err.message);
    return false;
  } finally {
    invalidate({ people: true });
  }
}

export function confirm(message) {
  return legacy().confirm(message);
}

// A confirm whose Delete only enables once `value` is typed.
export function confirmByTyping(message, value) {
  return legacy().prompt(message, value);
}

export function navigate(path, options) {
  legacy().navigate(path, options);
}

// The first state: the older scripts ran (and rendered once) before this
// module loaded, so its first "dispatch:render" came too early to hear.
export function init() {
  status.value = legacy().liveStatus();
  newFolders.value = legacy().newFolders();
  registry.value = legacy().registry();
  view.value = legacy().view();
  project.value = legacy().project();
  loadStale();
}
