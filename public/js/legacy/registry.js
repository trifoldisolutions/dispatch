// Loading and saving the registry (ports and categories), new folders, and the live status polls.

// What the registry keeps of a project besides its port. Its live site
// (`url`) is only written when it has one, and its status when it's known
// (see writeRegistry in services/registry.js).
function toRegistryEntry(e) {
  const out = { name: e.name, description: e.description };
  if (e.url) out.url = e.url;
  if (e.status) out.status = e.status;
  return out;
}

function toRegistry(list) {
  const out = { fire: {}, breeze: {}, cold: {}, unassigned: [] };
  for (const e of list) {
    out[e.category][e.port] = toRegistryEntry(e);
  }
  out.unassigned = unassigned.map(toRegistryEntry);
  return out;
}

function fromRegistry(data) {
  const list = [];
  for (const category of CATEGORIES) {
    const bucket = data[category] || {};
    for (const [port, entry] of Object.entries(bucket)) {
      list.push({ port, category, name: entry.name, description: entry.description, url: entry.url || "", status: entry.status || "active" });
    }
  }
  return list;
}

async function load() {
  const res = await fetch("/api/registry");
  const data = await res.json();
  entries = fromRegistry(data);
  unassigned = (data.unassigned || []).map((e) => ({ name: e.name, description: e.description || "", url: e.url || "", status: e.status || "active" }));
  try {
    const runRes = await fetch("/api/running-projects");
    projectRunStatus = runRes.ok ? await runRes.json() : {};
  } catch {
    projectRunStatus = {};
  }
  registryLoaded = true;
  render();
  refreshPortLiveStatus();
  refreshNewFolders();
  refreshClientFigures();
}

// A client's figures (see buildProjectClients) count their projects by
// status, which the registry just brought in afresh: the open project's
// staff is fetched again behind the scenes, keeping what's shown until it
// lands, and the others' are dropped to be fetched when they next open.
function refreshClientFigures() {
  const name = currentProjectName;
  for (const cached of Object.keys(staffCache)) if (cached !== name) delete staffCache[cached];
  if (name === null || !staffCache[name] || staffCache[name].error) return;
  fetchStaff(name)
    .then((result) => {
      staffCache[name] = result;
      if (name === currentProjectName) render();
    })
    .catch(() => {}); // what's shown stays; the next change tries again
}

async function refreshNewFolders() {
  const folders = await fetchProjectFolders();
  const claimed = new Set([...entries.map((e) => e.name), ...unassigned.map((e) => e.name)]);
  newFolders = folders.filter((f) => !claimed.has(f) && !SUGGESTION_EXCLUDED_FOLDERS.has(f));
  newFoldersSelected = new Set(newFolders);
  // Found folders wait in a banner (see buildNewFoldersBanner) rather than
  // opening the dialog on every load; an open one stays while any are left.
  newFoldersModalOpen = newFoldersModalOpen && newFolders.length > 0;
  render();
}

function openNewFoldersModal() {
  if (newFolders.length === 0) return;
  newFoldersSelected = new Set(newFolders);
  newFoldersModalOpen = true;
  render();
}

function closeNewFoldersModal() {
  newFoldersModalOpen = false;
  render();
}

// Selected folders are simply dropped straight into "unassigned" — the
// existing bucket for tracked-but-not-yet-configured projects — rather than
// forcing a port/category pick per folder up front.
async function addSelectedNewFolders() {
  const names = newFolders.filter((n) => newFoldersSelected.has(n));
  if (names.length === 0) return;
  const panel = document.querySelector("#new-folders-panel .modal-panel-inner");
  panel.classList.add("busy");
  for (const name of names) unassigned.push({ name, description: "" });
  const ok = await persist();
  if (!ok) {
    unassigned.splice(unassigned.length - names.length, names.length);
    panel.classList.remove("busy");
    return;
  }
  newFolders = newFolders.filter((n) => !newFoldersSelected.has(n));
  newFoldersSelected.clear();
  newFoldersModalOpen = newFolders.length > 0;
  render();
}

async function deleteNewFolder(name) {
  const confirmed = await customPrompt(
    `This permanently deletes the "${name}" folder and everything in it. This can't be undone.`,
    name
  );
  if (!confirmed) return;
  const panel = document.querySelector("#new-folders-panel .modal-panel-inner");
  if (panel) panel.classList.add("busy");
  try {
    await deleteProjectFolder(name);
  } catch (err) {
    if (panel) panel.classList.remove("busy");
    setStatus("error", err.message);
    return;
  }
  newFolders = newFolders.filter((n) => n !== name);
  newFoldersSelected.delete(name);
  newFoldersModalOpen = newFolders.length > 0;
  render();
}

function buildNewFoldersPanel() {
  const panel = document.createElement("div");
  panel.className = "modal-panel-inner";

  const topRow = document.createElement("div");
  topRow.className = "modal-top-row";
  const heading = document.createElement("h2");
  heading.className = "modal-title";
  heading.textContent = "New folders found";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.title = "Close";
  closeBtn.innerHTML = ICON_DELETE;
  closeBtn.addEventListener("click", closeNewFoldersModal);
  topRow.appendChild(heading);
  topRow.appendChild(closeBtn);
  panel.appendChild(topRow);

  const subtitle = document.createElement("p");
  subtitle.className = "new-folders-subtitle";
  subtitle.textContent = "These folders exist on disk but aren't tracked yet. Select which ones to add as unassigned projects, or delete a folder you don't need.";
  panel.appendChild(subtitle);

  const list = document.createElement("div");
  list.className = "new-folders-list";
  if (newFolders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "new-folders-empty";
    empty.textContent = "Nothing left — all caught up.";
    list.appendChild(empty);
  }
  for (const name of newFolders) {
    const row = document.createElement("div");
    row.className = "new-folders-row";

    const label = document.createElement("label");
    label.className = "new-folders-row-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = newFoldersSelected.has(name);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) newFoldersSelected.add(name);
      else newFoldersSelected.delete(name);
      addBtn.disabled = newFoldersSelected.size === 0;
    });
    const nameSpan = document.createElement("span");
    nameSpan.className = "new-folders-row-name";
    nameSpan.textContent = name;
    label.appendChild(decorateCheckbox(checkbox));
    label.appendChild(nameSpan);
    row.appendChild(label);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "new-folders-row-delete";
    deleteBtn.setAttribute("aria-label", `Delete ${name}`);
    deleteBtn.title = `Delete "${name}" folder`;
    deleteBtn.innerHTML = ICON_DELETE;
    deleteBtn.addEventListener("click", () => deleteNewFolder(name));
    row.appendChild(deleteBtn);

    list.appendChild(row);
  }
  panel.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "add-form-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cancel-btn";
  cancelBtn.textContent = "Not now";
  cancelBtn.addEventListener("click", closeNewFoldersModal);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "create-btn";
  addBtn.textContent = "Add selected";
  addBtn.disabled = newFoldersSelected.size === 0;
  addBtn.addEventListener("click", addSelectedNewFolders);
  actions.appendChild(cancelBtn);
  actions.appendChild(addBtn);
  panel.appendChild(actions);

  return panel;
}

async function persist() {
  setStatus("saving");
  const registry = toRegistry(entries);
  try {
    const res = await fetch("/api/registry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registry),
    });
    const body = await res.json();
    if (!res.ok) {
      setStatus("error", body.error);
      return false;
    }
    setStatus("saved");
    return true;
  } catch (err) {
    setStatus("error", err.message);
    return false;
  }
}

// Background liveness polling for the green dots and clickable titles on
// card names — patches existing elements directly instead of a full
// render() so it never disrupts in-progress typing, open dropdowns, or
// drag state.
async function refreshPortLiveStatus() {
  if (liveConnected()) return; // /live sends it instead (see applyPortLiveStatus)
  const ports = entries.map((e) => e.port);
  if (ports.length === 0) return;
  applyPortLiveStatus(await fetchPortStatus(ports));
}

// Whether public/js/app/live.js has its connection open: while it does,
// the server pushes ports, runs and presence as they change, and the polls
// here stand down. They take over again whenever it drops.
function liveConnected() {
  return !!(window.DispatchLive && window.DispatchLive.connected);
}

// Tells the project list, the side column and the palette (public/js/app) the latest
// listening/running state, after either a poll or /live delivered it.
function announceStatus() {
  document.dispatchEvent(
    new CustomEvent("dispatch:status", { detail: { ports: { ...portLiveStatus }, runs: { ...projectRunStatus } } })
  );
}

function applyPortLiveStatus(status) {
  portLiveStatus = status;
  document.querySelectorAll(".live-dot[data-port]").forEach((dot) => {
    const live = !!portLiveStatus[dot.dataset.port];
    dot.classList.toggle("live", live);
    dot.title = live ? "Something is actively listening on this port" : "Nothing detected listening on this port";
  });
  document.querySelectorAll(".card-name-text[data-port]").forEach((link) => {
    applyNameLinkState(link, !!portLiveStatus[link.dataset.port]);
  });
  // Run buttons fall back to portLiveStatus for projects we didn't spawn
  // ourselves (see applyRunButtonState's "external" branch), so a change
  // here can flip them too.
  document.querySelectorAll(".run-btn[data-project]").forEach((btn) => {
    if (btn.dataset.busy) return;
    applyRunButtonState(btn, projectRunStatus[btn.dataset.project]);
  });
  announceStatus();
}

// Background polling for the Run/Stop button state — picks up crashes (e.g.
// nodemon exiting from a syntax error) that happen after the initial start
// request already returned. Patches existing buttons directly rather than a
// full render() so it doesn't disrupt in-progress typing or open dropdowns;
// skips a button that's mid-click so it doesn't clobber that click's own
// optimistic state.
async function refreshProjectRunStatus() {
  if (liveConnected()) return; // /live sends it instead (see applyProjectRunStatus)
  let status;
  try {
    const res = await fetch("/api/running-projects");
    status = res.ok ? await res.json() : {};
  } catch {
    status = {};
  }
  applyProjectRunStatus(status);
}

function applyProjectRunStatus(status) {
  projectRunStatus = status;
  document.querySelectorAll(".run-btn[data-project]").forEach((btn) => {
    if (btn.dataset.busy) return;
    applyRunButtonState(btn, projectRunStatus[btn.dataset.project]);
  });
  announceStatus();
}

// Warns (with a cancelable confirm) if any of the given ports currently have
// something actually listening on them, since the registry change alone
// won't stop or move a running dev server off its old port.
async function confirmPortsFree(ports) {
  const status = await fetchPortStatus(ports);
  const live = [...new Set(ports.map(String))].filter((p) => status[p]);
  if (live.length === 0) return true;
  const noun = live.length > 1 ? "Ports" : "Port";
  const verb = live.length > 1 ? "have" : "has";
  return customConfirm(
    `${noun} ${live.join(", ")} ${verb} something actively listening right now (a running dev server?). ` +
      `Changing the registry won't stop or move it — you'll need to restart that project on its new port yourself. Continue anyway?`
  );
}

// /live says a project's tasks, journal or staff changed (an agent's journal
// entry, another tab's task, someone added from People). If that data is
// loaded, refetch it, and redraw only when it differs, so this page's own
// change coming back is a no-op. Read through functions, since Refresh may
// reassign a cache meanwhile.
const LIVE_PROJECT_DATA = {
  tasks: { cache: () => taskCache, fetch: (name) => fetchTasks(name) },
  journal: { cache: () => journalCache, fetch: (name) => fetchJournal(name) },
  staff: { cache: () => staffCache, fetch: (name) => fetchStaff(name) },
};

async function projectDataChanged(name, kind) {
  const source = LIVE_PROJECT_DATA[kind];
  const cache = source && source.cache();
  if (!cache || !cache[name] || cache[name].error) return;
  let fresh;
  try {
    fresh = await source.fetch(name);
  } catch {
    return; // the panel keeps what it had
  }
  const current = source.cache();
  if (current[name] && JSON.stringify(current[name]) === JSON.stringify(fresh)) return;
  current[name] = fresh;
  if (currentProjectName === name) render();
}
