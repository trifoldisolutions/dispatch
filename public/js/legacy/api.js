// Calls to Dispatch's server API.

// The registry can only reference projects that actually exist as folders
// next to it — this is the list of real candidates.
async function fetchProjectFolders() {
  try {
    const res = await fetch("/api/project-folders");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// The root path never changes during a session, so cache the one lookup.
let projectsRootPromise = null;
function fetchProjectsRoot() {
  if (!projectsRootPromise) {
    projectsRootPromise = fetch("/api/projects-root")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => (body && body.path) || null)
      .catch(() => null);
  }
  return projectsRootPromise;
}

async function createProjectFolder(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to create project folder");
  return body;
}

async function deleteProjectFolder(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to delete project folder");
  return body;
}

async function fetchProjectPathInfo(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/stat`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load project info");
  return body;
}

async function fetchProjectTree(name, subpath) {
  const url =
    `/api/project-folders/${encodeURIComponent(name)}/tree` +
    (subpath ? `?subpath=${encodeURIComponent(subpath)}` : "");
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load folder contents");
  return body; // [{ name, type }]
}

async function fetchProjectTreeSearch(name, query) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tree/search?q=${encodeURIComponent(query)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Search failed");
  return body; // { matches: [{ path, type, nameMatch, lines?: [{ line, text }], lineCount? }], truncated }
}

async function fetchProjectTreeCounts(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tree/counts`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to count files");
  return body; // { folders, files, skipped: string[] }
}

async function deleteProjectTreeEntry(name, subpath) {
  const res = await fetch(
    `/api/project-folders/${encodeURIComponent(name)}/tree?subpath=${encodeURIComponent(subpath)}`,
    { method: "DELETE" }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to delete");
  return body;
}

async function fetchGitStatus(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/git-status`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load git status");
  return body; // { isRepo, entries: [{ path, status }] }
}

async function fetchGitHistory(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/git-history`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load git history");
  return body; // { isRepo, branch, lastCommit, commitCount, upstream, lastPush, unpushedCount, commitMessage }
}

async function requestGitPush(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/git-push`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to push");
  return body; // { ok, committed }
}

async function fetchJournal(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/journal`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load journal");
  return body; // { days: [{ date, entries: [{ time, content }] }] }
}

async function postJournalEntry(name, content) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/journal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to save note");
  return body; // { days: [...] }
}

async function fetchStaff(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/staff`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load staff");
  return body; // { staff: [{ id, name, displayName, avatar, role, you, online }], clients: [{ id, name, avatar, you, online, projects: { active, total } }] }
}

async function fetchTasks(name) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tasks`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to load tasks");
  return body; // { tasks: [{ id, title, description, done, doneAt, archived, archivedAt, dueDate, tags, createdAt, updatedAt }], tags: string[] }
}

async function postTask(name, title, description, dueDate, tags) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, dueDate, tags }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to add task");
  return body; // { tasks: [...], tags: [...] }
}

async function patchTask(name, id, changes) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to update task");
  return body; // { tasks: [...] }
}

async function deleteTask(name, id) {
  const res = await fetch(`/api/project-folders/${encodeURIComponent(name)}/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to delete task");
  return body; // { tasks: [...] }
}

// Registry state only tracks which port a project is *supposed* to use, not
// whether something is actually listening there right now.
async function fetchPortStatus(ports) {
  const unique = [...new Set(ports.filter((p) => p !== undefined && p !== null).map(String))];
  if (unique.length === 0) return {};
  try {
    const res = await fetch(`/api/port-status?ports=${unique.join(",")}`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function startProject(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/start`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to start");
  return body;
}

async function stopProject(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/stop`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to stop");
  return body;
}

async function openInVSCode(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/open-vscode`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to open in VS Code");
  return body;
}

async function openProjectsRoot() {
  const res = await fetch("/api/open-projects-root", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to open File Explorer");
  return body;
}

async function openProjectFolder(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}/open-explorer`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Failed to open File Explorer");
  return body;
}
