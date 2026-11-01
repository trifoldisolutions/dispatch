require("dotenv").config({ override: true, quiet: true });
const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const helmet = require("helmet");
const { connectDatabase } = require("./db");
const { sessions, loadUser, requireLogin, isOnline, recentlySeenUserIds, touchUsers, authRoutes } = require("./auth");
const { createLive } = require("./live");
const { avatarUrl, displayName, avatarRoutes } = require("./people");
const Project = require("./models/Project");
const Membership = require("./models/Membership");
const User = require("./models/User");
const execAsync = promisify(exec);

const PORT = 3000;
const PROJECTS_ROOT = path.join(__dirname, "..");
const SELF_PROJECT = path.basename(__dirname); // Dispatch's own project: in the database, never in the registry
// The app's own pages, beside each project's /<name>, and the other first
// path segments Dispatch answers on. A project folder can't take one of these
// names, or its page would be unreachable.
const APP_PAGES = ["projects", "people"];
const RESERVED_NAMES = new Set([...APP_PAGES, "ports", "inbox", "chat", "login", "logout", "api", "css", "js", "vendor", "live", "avatars"]);
const CATEGORIES = ["fire", "breeze", "cold"];
const CATEGORY_LIMITS = { fire: 2, breeze: 4 }; // cold is unlimited
const PROJECT_DESCRIPTION_MAX_LENGTH = 230; // mirrors the create form's description maxlength in views/index.ejs
const BASE_PORT = 3001;
const SAMPLE_PROJECT_DIR = path.join(PROJECTS_ROOT, "new_project_sample");
const SAMPLE_TEMPLATE_FILES = ["AGENTS.md", "init_prompt.md"];
// Skipped when scanning for a project's most recent edit — otherwise a stray
// `npm install` (node_modules) or IDE metadata write would outrank the code
// itself for "last edited". The Explorer's search doesn't look inside them
// either, for the same reason: their contents would bury the project's own.
const STAT_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "venv", "__pycache__"]);

// name -> { dev: ChildProcess, tw: ChildProcess|null }. In-memory only — if
// this server restarts, previously started dev/tw processes are orphaned and
// no longer trackable/stoppable from here.
const runningProjects = new Map();

// Ports belong to their category, not to a project: each category owns a
// contiguous block sized to its limit, in CATEGORIES order. Cold is last and
// unlimited, so its block just keeps growing.
function categoryPortRange(category) {
  let start = BASE_PORT;
  for (const cat of CATEGORIES) {
    const limit = CATEGORY_LIMITS[cat];
    const end = limit !== undefined ? start + limit - 1 : Infinity;
    if (cat === category) return { start, end };
    start = end + 1;
  }
}

// Whether some process is actually listening on a port right now, as opposed
// to just being reserved for a project in the registry.
function isPortServing(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

const app = express();

// What open pages hear about without polling (see live.js).
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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");

// helmet's security headers. Its CSP only runs scripts served from this
// origin, so each response gets a fresh nonce for the pages' inline <script>
// (cspNonce in the views). Locally Dispatch is plain http, where upgrading
// requests to https would break every one of them.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        "upgrade-insecure-requests": process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  })
);

// The pages' stylesheets and scripts (public/css, public/js). Served ahead of
// the login check: they hold no data, and the login page needs none of them.
// No directory redirects or index files, so /js or /css can't answer for a
// project page.
app.use(express.static(path.join(__dirname, "public"), { index: false, redirect: false }));

// Preact, htm and signals, served as-is from node_modules: the pages load
// them as ES modules through the import map in views/index.ejs, with no build
// step. Only these files, so /vendor can't reach anything else in there.
const VENDOR_FILES = {
  "preact.mjs": "preact/dist/preact.mjs",
  "preact-hooks.mjs": "preact/hooks/dist/hooks.mjs",
  "htm.mjs": "htm/dist/htm.module.js",
  "signals-core.mjs": "@preact/signals-core/dist/signals-core.module.js",
  "signals.mjs": "@preact/signals/dist/signals.module.js",
};
app.get("/vendor/:file", (req, res, next) => {
  const file = VENDOR_FILES[req.params.file];
  if (!file) return next();
  res.type("application/javascript").sendFile(path.join(__dirname, "node_modules", file));
});

app.use(express.json());
app.use(express.urlencoded({ extended: false })); // the login form
app.use(sessions, loadUser);
app.use(authRoutes);
app.use(avatarRoutes);
// The left menu's account button shows the user's picture when there is one.
app.locals.avatarUrl = avatarUrl;

// / opens the last project you had open, and /projects your first (old
// links, or the left menu before the page has your list), once the page has
// it. Like the project pages below, they're the same page: index.ejs reads
// the path and shows that one.
app.get(["/", ...APP_PAGES.map((page) => `/${page}`)], requireLogin, (req, res) => {
  res.render("index");
});

// The port board was folded into the project list, which shows each port.
app.get("/ports", (req, res) => res.redirect("/projects"));

// Each project has its own page at /<name>. It's the same page as the
// dashboard — index.ejs reads the path and renders that project — so a
// refresh, bookmark or new tab on a project's address lands back on it. A
// name with no folder (a typo, a removed project) still gets the page, with
// a 404 status, so it can say so beside the project list; a file name
// (favicon.ico) falls through to a plain 404. The login check comes first,
// so a logged-out visitor can't tell project names from typos.
function serveProjectPage(req, res, next) {
  if (listProjectFolders().includes(req.params.name)) return res.render("index");
  if (req.params.name.includes(".")) return next();
  res.status(404).render("index");
}

app.get("/:name", requireLogin, serveProjectPage);

// Each of a project page's panels also has a page of its own at
// /<name>/<section> (PROJECT_SECTIONS in index.ejs), served the same way,
// and so does the header's Staff (STAFF_SECTION there).
const PROJECT_SECTIONS = ["explore", "tasks", "history", "journal", "staff"];

// The section is checked before the login, since two-part API addresses
// (/api/registry) match this route too and must go on to their own.
function onlySectionPages(req, res, next) {
  next(PROJECT_SECTIONS.includes(req.params.section) ? undefined : "route");
}

app.get("/:name/:section", onlySectionPages, requireLogin, serveProjectPage);

// The registry is stored as the projects collection (see models/Project.js)
// and handed to the dashboard in the shape it has always used: each category
// maps ports to { name, description, url?, status? }, and unassigned is a
// list. A status is only there for a finished project.
async function readRegistry() {
  const registry = { fire: {}, breeze: {}, cold: {}, unassigned: [] };
  const projects = await Project.find({ name: { $ne: SELF_PROJECT } }).sort({ port: 1, position: 1 }).lean();
  for (const project of projects) {
    const entry = { name: project.name, description: project.description };
    if (project.url) entry.url = project.url;
    if (project.status === "finished") entry.status = "finished";
    if (project.port !== null && CATEGORIES.includes(project.category)) registry[project.category][project.port] = entry;
    else registry.unassigned.push(entry);
  }
  return registry;
}

// Saves a whole (already validated) registry: every entry's place is set from
// it, and a project that's no longer in it was deleted from the dashboard, so
// its record and memberships go too. A status is only changed when the entry
// has one (the Edit form always sends it), so a page that moves a project
// without carrying its status along can't reset it.
async function writeRegistry(data) {
  const placeProject = (entry, placement) => ({
    updateOne: {
      filter: { name: entry.name },
      update: {
        $set: { description: entry.description, url: entry.url || "", ...(entry.status ? { status: entry.status } : {}), ...placement },
      },
      upsert: true,
    },
  });
  const ops = [];
  for (const category of CATEGORIES) {
    for (const [port, entry] of Object.entries(data[category] || {})) {
      ops.push(placeProject(entry, { category, port: Number(port), position: null }));
    }
  }
  (data.unassigned || []).forEach((entry, position) => {
    ops.push(placeProject(entry, { category: null, port: null, position }));
  });
  if (ops.length) await Project.bulkWrite(ops);

  const kept = [...collectNames(data), SELF_PROJECT];
  const removed = (await Project.find({ name: { $nin: kept } }, "_id").lean()).map((p) => p._id);
  if (removed.length) {
    await Membership.deleteMany({ project: { $in: removed } });
    await Project.deleteMany({ _id: { $in: removed } });
  }
}

// Real, on-disk project folders — a name can only be newly added to the
// registry if a folder with that exact name actually exists here. Dot folders
// (.claude, .git, .vscode…) are tool metadata, never projects.
function listProjectFolders() {
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

function collectNames(data) {
  const names = new Set();
  for (const category of CATEGORIES) {
    for (const entry of Object.values(data[category] || {})) {
      if (entry && typeof entry.name === "string") names.add(entry.name);
    }
  }
  for (const entry of data.unassigned || []) {
    if (entry && typeof entry.name === "string") names.add(entry.name);
  }
  return names;
}

// A project's live site (`url`) is optional, but when it's there it has to be
// an http(s) address, since the project page links straight to it.
function isValidSiteUrl(url) {
  if (url === undefined) return true;
  if (typeof url !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// `existingNames` are the names the registry tracks before this change.
function validateRegistry(data, existingNames) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "registry must be an object";
  }
  for (const key of Object.keys(data)) {
    if (!CATEGORIES.includes(key) && key !== "unassigned") {
      return `unknown key "${key}"`;
    }
  }

  const seenPorts = new Set();
  const seenNames = new Map(); // lowercase name -> where it's already assigned, for a clear duplicate error
  for (const category of CATEGORIES) {
    if (!(category in data)) continue;
    const entries = data[category];
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      return `category "${category}" must be an object`;
    }
    const limit = CATEGORY_LIMITS[category];
    const count = Object.keys(entries).length;
    if (limit !== undefined && count > limit) {
      return `category "${category}" allows at most ${limit} project${limit === 1 ? "" : "s"} (got ${count})`;
    }
    const range = categoryPortRange(category);
    for (const [port, entry] of Object.entries(entries)) {
      if (!/^\d+$/.test(port)) {
        return `invalid port key "${port}"`;
      }
      const portNum = Number(port);
      if (portNum < range.start || portNum > range.end) {
        return `port ${port} is outside ${category}'s range (${range.start}–${range.end === Infinity ? "∞" : range.end})`;
      }
      if (seenPorts.has(port)) {
        return `duplicate port ${port}`;
      }
      seenPorts.add(port);
      if (typeof entry !== "object" || entry === null) {
        return `entry for port ${port} must be an object`;
      }
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        return `entry for port ${port} needs a non-empty "name"`;
      }
      if (typeof entry.description !== "string") {
        return `entry for port ${port} needs a "description" string`;
      }
      if (entry.description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
        return `description for port ${port} is limited to ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`;
      }
      if (!isValidSiteUrl(entry.url)) {
        return `live site for port ${port} must be an http(s) address`;
      }
      if (entry.status !== undefined && !PROJECT_STATUSES.includes(entry.status)) {
        return `status for port ${port} must be one of ${PROJECT_STATUSES.join(", ")}`;
      }
      const nameKey = entry.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) {
        return `"${entry.name}" is assigned more than once (also in ${seenNames.get(nameKey)})`;
      }
      seenNames.set(nameKey, `${category} (port ${port})`);
    }
  }

  if ("unassigned" in data) {
    const unassigned = data.unassigned;
    if (!Array.isArray(unassigned)) {
      return `"unassigned" must be an array`;
    }
    for (const entry of unassigned) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return `unassigned entry must be an object`;
      }
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        return `unassigned entry needs a non-empty "name"`;
      }
      if (typeof entry.description !== "string") {
        return `unassigned entry needs a "description" string`;
      }
      if (entry.description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
        return `description for "${entry.name}" is limited to ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`;
      }
      if (!isValidSiteUrl(entry.url)) {
        return `live site for "${entry.name}" must be an http(s) address`;
      }
      if (entry.status !== undefined && !PROJECT_STATUSES.includes(entry.status)) {
        return `status for "${entry.name}" must be one of ${PROJECT_STATUSES.join(", ")}`;
      }
      const nameKey = entry.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) {
        return `"${entry.name}" is assigned more than once (also in ${seenNames.get(nameKey)})`;
      }
      seenNames.set(nameKey, "unassigned");
    }
  }

  // Only names that are newly appearing (not already tracked) have to match
  // a real folder — this doesn't retroactively break already-tracked names
  // whose folder was since renamed or removed.
  const newNames = [...collectNames(data)].filter((name) => !existingNames.has(name));
  if (newNames.length > 0) {
    const folders = new Set(listProjectFolders());
    for (const name of newNames) {
      if (RESERVED_NAMES.has(name.toLowerCase())) {
        return `"${name}" is one of Dispatch's own addresses, so its project page couldn't be reached; rename the folder`;
      }
      if (!folders.has(name)) {
        return `"${name}" has no matching folder in the projects directory — create the project folder first`;
      }
    }
  }

  return null;
}

app.get("/api/registry", async (req, res) => {
  try {
    res.json(await readRegistry());
  } catch (err) {
    res.status(500).json({ error: `failed to read registry: ${err.message}` });
  }
});

// The roles that make someone staff, in the order they're listed. Clients are
// on a project too, but aren't staff.
const STAFF_ROLES = ["lead", "dev"];
const PROJECT_STATUSES = Project.schema.path("status").enumValues;

// The staff of each of these projects, from their memberships, as a Map of
// project id -> [{ id, name, displayName, avatar, role, you, online }]: leads
// first, then devs, each by name. `you` marks the viewer, `online` whoever
// has Dispatch open (see isOnline), `avatar` their picture's address or null
// (see people.js). A project with no one on it has no entry.
async function staffByProject(projectIds, viewer) {
  const memberships = await Membership.find({ project: { $in: projectIds }, role: { $in: STAFF_ROLES } })
    .populate("user", { name: 1, email: 1, lastSeenAt: 1 })
    .lean();
  const byProject = new Map();
  for (const { project, user, role } of memberships) {
    if (!user) continue; // its account was deleted
    const key = String(project);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push({
      id: String(user._id),
      name: user.name,
      displayName: displayName(user.name),
      avatar: avatarUrl(user),
      role,
      you: String(user._id) === String(viewer._id),
      online: isOnline(user),
    });
  }
  for (const staff of byProject.values()) {
    staff.sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.name.localeCompare(b.name));
  }
  return byProject;
}

// A project's staff (see staffByProject) and clients, for its header. These
// are people's details, so unlike the rest of the API (for now) it needs a
// login. A project with no record yet simply has no one on it.
app.get("/api/projects/:name/staff", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "log in to see a project's staff" });
  try {
    const project = await Project.findOne({ name: req.params.name }, { _id: 1 }).lean();
    if (!project) return res.json({ staff: [], clients: [] });
    const staff = (await staffByProject([project._id], req.user)).get(String(project._id)) || [];
    res.json({ staff, clients: await projectClients(project._id, req.user) });
  } catch (err) {
    res.status(500).json({ error: `failed to load staff: ${err.message}` });
  }
});

// Who a project is for (usually one client), each with how many projects
// they have with the studio: active (not finished) and all time.
async function projectClients(projectId, viewer) {
  const memberships = await Membership.find({ project: projectId, role: "client" }).populate("user", { name: 1, email: 1, lastSeenAt: 1 }).lean();
  const users = memberships.map((membership) => membership.user).filter(Boolean); // an account deleted since
  const theirs = await Membership.find({ user: { $in: users.map((user) => user._id) }, role: "client" })
    .populate("project", { status: 1 })
    .lean();
  return users
    .map((user) => {
      const projects = theirs.filter((membership) => String(membership.user) === String(user._id) && membership.project);
      return {
        id: String(user._id),
        name: user.name, // in full: a client is often a company
        avatar: avatarUrl(user),
        you: String(user._id) === String(viewer._id),
        online: isOnline(user),
        projects: { active: projects.filter((membership) => membership.project.status !== "finished").length, total: projects.length },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- The logged-in user's own views (the project list, the side column) ---
// These need a login and only ever show the user's own projects: those they
// hold a membership on, or every project for an admin. Agents don't use them,
// so unlike the rest of the API they can check permissions already.

const ACTIVITY_DAYS = 14;
const ACTIVITY_LIMIT = 40;
const COMMIT_LIMIT = 30;
const DUE_SOON_DAYS = 7;
const COMMITS_CACHE_MS = 60 * 1000; // a project's recent commits, so a reload doesn't run git 20 times
const PEOPLE_SHOWN = 5; // at most, in the side column's People and each search's results (fewer when they'd make it scroll)
const recentCommitsCache = new Map(); // name -> { at, commits }

function requireApiLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "log in first" });
  next();
}

// [{ project (lean), role }] for the user: "admin" where an admin has no
// membership of their own. Dispatch's own project is in the database too.
async function projectsForUser(user) {
  const memberships = await Membership.find({ user: user._id }).populate("project").lean();
  const byName = new Map();
  for (const { project, role } of memberships) {
    if (project) byName.set(project.name, { project, role });
  }
  if (user.isAdmin) {
    for (const project of await Project.find().lean()) {
      if (!byName.has(project.name)) byName.set(project.name, { project, role: "admin" });
    }
  }
  return [...byName.values()].sort((a, b) => a.project.name.localeCompare(b.project.name));
}

function todayDateOnly() {
  return localDateString(new Date());
}

function addDaysDateOnly(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateString(new Date(y, m - 1, d + days));
}

// A project's tasks and journal days, or empty ones when its folder or files
// are missing or unreadable: one broken project shouldn't blank the rest.
function readProjectTasksSafe(dir) {
  try {
    return readTasks(findTasksPath(dir)).tasks;
  } catch {
    return [];
  }
}

function readProjectJournalSafe(dir) {
  try {
    const journalPath = findJournalPath(dir);
    if (!fs.existsSync(journalPath)) return [];
    return withJournalAudit(parseJournal(fs.readFileSync(journalPath, "utf8")), journalPath);
  } catch {
    return [];
  }
}

function taskFigures(tasks, today) {
  const soon = addDaysDateOnly(today, DUE_SOON_DAYS);
  const figures = { open: 0, done: 0, overdue: 0, dueSoon: 0 };
  for (const task of tasks) {
    if (task.archived) continue;
    if (task.done) {
      figures.done++;
      continue;
    }
    figures.open++;
    if (task.dueDate && task.dueDate < today) figures.overdue++;
    else if (task.dueDate && task.dueDate <= soon) figures.dueSoon++;
  }
  return figures;
}

async function recentCommits(name, dir) {
  const cached = recentCommitsCache.get(name);
  if (cached && Date.now() - cached.at < COMMITS_CACHE_MS) return cached.commits;
  let commits = [];
  try {
    const { stdout } = await execAsync(
      `git log --since="${ACTIVITY_DAYS} days ago" -n 10 --format=${GIT_LOG_FORMAT}`,
      { cwd: dir, maxBuffer: 1024 * 1024 }
    );
    commits = stdout.split("\n").filter((line) => line.trim()).map(parseGitLogLine);
  } catch {
    // not a git repo, or no commits yet
  }
  recentCommitsCache.set(name, { at: Date.now(), commits });
  return commits;
}

// The Projects page's list: each project with the user's role on it, its
// staff, its place in the registry, and its task figures. Running/listening
// comes from /api/running-projects and /api/port-status (and /live) like
// everywhere else.
app.get("/api/me/projects", requireApiLogin, async (req, res) => {
  try {
    const today = todayDateOnly();
    const folders = new Set(listProjectFolders());
    const mine = await projectsForUser(req.user);
    const staff = await staffByProject(mine.map(({ project }) => project._id), req.user);
    const projects = mine.map(({ project, role }) => {
      const self = project.name === SELF_PROJECT;
      const hasFolder = folders.has(project.name);
      const dir = hasFolder ? resolveProjectDir(project.name) : null;
      const days = dir ? readProjectJournalSafe(dir) : [];
      const lastDay = days[0];
      const lastEntry = lastDay && lastDay.entries[lastDay.entries.length - 1];
      return {
        name: project.name,
        description: project.description || "",
        url: project.url || "",
        category: self ? null : project.category,
        port: self ? PORT : project.port,
        status: project.status || "active",
        self,
        role,
        staff: staff.get(String(project._id)) || [],
        hasFolder,
        tasks: taskFigures(dir ? readProjectTasksSafe(dir) : [], today),
        lastActivity: lastEntry ? { date: lastDay.date, time: lastEntry.time, content: lastEntry.content } : null,
      };
    });
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: `failed to load your projects: ${err.message}` });
  }
});

// The projects whose tasks and journals count as the user's: their staff
// ones (clients aren't staff), with a folder to read them from.
async function staffProjectDirs(user) {
  const folders = new Set(listProjectFolders());
  return (await projectsForUser(user))
    .filter(({ project, role }) => role !== "client" && folders.has(project.name))
    .map(({ project }) => ({ name: project.name, dir: resolveProjectDir(project.name) }));
}

// Open tasks across the user's projects, overdue and soonest due first, then
// undated ones newest first: the side column's Your tasks, which leaves out
// the project showing beside it. Tasks have no assignee yet, so "yours"
// means on your projects.
app.get("/api/me/tasks", requireApiLogin, async (req, res) => {
  try {
    const tasks = [];
    for (const { name, dir } of await staffProjectDirs(req.user)) {
      for (const task of readProjectTasksSafe(dir)) {
        if (task.done || task.archived) continue;
        tasks.push({
          project: name,
          id: task.id,
          title: task.title,
          dueDate: task.dueDate || null,
          tags: task.tags || [],
          createdAt: task.createdAt || null,
        });
      }
    }
    tasks.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    res.json({ today: todayDateOnly(), tasks });
  } catch (err) {
    res.status(500).json({ error: `failed to load your tasks: ${err.message}` });
  }
});

// What happened lately on the user's projects: journal entries and commits
// from the last ACTIVITY_DAYS, newest first. Nothing shows it since Home
// went; it's kept for the activity page to come.
app.get("/api/me/activity", requireApiLogin, async (req, res) => {
  try {
    const today = todayDateOnly();
    const since = addDaysDateOnly(today, -ACTIVITY_DAYS);
    const activity = [];
    const commitLists = [];
    for (const { name, dir } of await staffProjectDirs(req.user)) {
      for (const day of readProjectJournalSafe(dir)) {
        if (day.date < since) continue;
        for (const entry of day.entries) {
          activity.push({ project: name, date: day.date, time: entry.time, content: entry.content, insertedAt: entry.insertedAt || null });
        }
      }
      commitLists.push(recentCommits(name, dir).then((commits) => commits.map((c) => ({ project: name, ...c }))));
    }
    const sortKey = (item) => item.insertedAt || `${item.date}T${item.time}`;
    activity.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    const commits = (await Promise.all(commitLists)).flat().sort((a, b) => b.date.localeCompare(a.date));
    res.json({ today, activity: activity.slice(0, ACTIVITY_LIMIT), commits: commits.slice(0, COMMIT_LIMIT) });
  } catch (err) {
    res.status(500).json({ error: `failed to load activity: ${err.message}` });
  }
});

// "Léa Martin" -> "lea martin", so a search needn't get the accents right.
function searchable(text) {
  return String(text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const PEOPLE_ROLES = ["lead", "dev", "client"]; // what People's role filter (?role=) can pick

// The side column's People and the People page, for finding someone to ask
// or to bring onto a project. Without ?q= it's PEOPLE_SHOWN of the people the
// user shares a project with (all of them with ?all=1, for the page): online
// first, then the most recently seen. With ?q= it
// searches by name or email, best matches first: the whole studio's staff,
// so a dev who has just joined and is on no project yet turns up (that's who
// a lead most often looks for), but only the clients of the user's own
// projects. A client never sees other clients, only the staff on their own
// projects. ?role=lead|dev|client keeps one kind. The user never appears in
// their own list.
//
// Each person: { id, name, displayName, avatar, online, lastSeenAt, role,
// shared, projects, addTo }. role is "lead" for staff who lead any project,
// "dev" for the rest of the staff (projects or not), "admin" for an admin on
// none, or "client". shared names only the projects the user is on too; the
// rest are just counted in projects (theirs, staff or client ones). addTo is
// the user's own projects they could be added to, never any for a client.
// `leading` lists the projects the user leads that aren't finished, where
// Add to project can put someone: empty for anyone who isn't a lead, who
// then doesn't get the button. `seesClients` says whether the role filter
// offers Clients.
app.get("/api/me/people", requireApiLogin, async (req, res) => {
  try {
    const q = searchable(String(req.query.q || "").trim().slice(0, 80));
    const role = PEOPLE_ROLES.includes(req.query.role) ? req.query.role : null;
    const limit = req.query.all === "1" ? Infinity : PEOPLE_SHOWN;
    const mine = await projectsForUser(req.user);
    const myProjectIds = new Set(mine.map(({ project }) => String(project._id)));
    const viewerIsClient = mine.length > 0 && mine.every((membership) => membership.role === "client");
    const leading = mine.filter((membership) => membership.role === "lead" && membership.project.status !== "finished").map(({ project }) => project);

    const [users, memberships, projects] = await Promise.all([
      User.find({ status: "active", _id: { $ne: req.user._id } }, { name: 1, email: 1, lastSeenAt: 1, isAdmin: 1 }).lean(),
      Membership.find({}, { user: 1, project: 1, role: 1 }).lean(),
      Project.find({}, { name: 1 }).lean(),
    ]);
    const projectNames = new Map(projects.map((project) => [String(project._id), project.name]));
    const membershipsOf = new Map(); // user id -> [{ project id, role }]
    for (const { user, project, role } of memberships) {
      const key = String(user);
      if (!membershipsOf.has(key)) membershipsOf.set(key, []);
      membershipsOf.get(key).push({ project: String(project), role });
    }

    const candidates = [];
    for (const user of users) {
      const own = membershipsOf.get(String(user._id)) || [];
      const staffOn = own.filter((membership) => STAFF_ROLES.includes(membership.role));
      const isClient = staffOn.length === 0 && own.some((membership) => membership.role === "client");
      if (isClient && viewerIsClient) continue; // clients don't see each other
      const theirs = isClient ? own : staffOn;
      const shared = theirs.filter(({ project }) => myProjectIds.has(project));
      // Only search reaches beyond the user's projects, and only for staff.
      if ((viewerIsClient || isClient || !q) && shared.length === 0) continue;
      const kind = isClient ? "client"
        : staffOn.some((membership) => membership.role === "lead") ? "lead"
        : staffOn.length === 0 && user.isAdmin ? "admin"
        : "dev";
      if (role && kind !== role) continue;
      const name = searchable(user.name);
      const local = searchable(user.email.split("@")[0]);
      if (q && !name.includes(q) && !local.includes(q)) continue;
      const onProject = new Set(own.map(({ project }) => project));
      candidates.push({
        person: {
          id: String(user._id),
          name: user.name,
          displayName: isClient ? user.name : displayName(user.name), // in full for a client, often a company
          avatar: avatarUrl(user),
          online: isOnline(user),
          lastSeenAt: user.lastSeenAt || null,
          role: kind,
          shared: shared.map(({ project }) => projectNames.get(project)).filter(Boolean).sort(),
          projects: theirs.length,
          addTo: isClient ? [] : leading.filter((project) => !onProject.has(String(project._id))).map((project) => project.name),
        },
        // A search ranks names that start with what was typed first.
        prefix: q ? name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q)) : false,
      });
    }

    const seen = (person) => (person.lastSeenAt ? new Date(person.lastSeenAt).getTime() : 0);
    candidates.sort(
      (a, b) =>
        b.prefix - a.prefix ||
        b.person.online - a.person.online ||
        seen(b.person) - seen(a.person) ||
        a.person.name.localeCompare(b.person.name)
    );
    res.json({
      people: candidates.slice(0, limit).map(({ person }) => person),
      leading: leading.map((project) => project.name).sort((a, b) => a.localeCompare(b)),
      seesClients: !viewerIsClient,
    });
  } catch (err) {
    res.status(500).json({ error: `failed to load people: ${err.message}` });
  }
});

// People's Add to project: a lead brings someone onto one of their projects
// as a developer. Only that project's leads can, and only while it isn't
// finished. The person must be staff with no role on it yet: a membership is
// one role per person per project, and a client can't be made a developer.
app.post("/api/projects/:name/staff", requireApiLogin, async (req, res) => {
  try {
    const project = await Project.findOne({ name: req.params.name }, { name: 1, status: 1 }).lean();
    if (!project) return res.status(404).json({ error: `no project named "${req.params.name}"` });
    if (!(await Membership.exists({ user: req.user._id, project: project._id, role: "lead" }))) {
      return res.status(403).json({ error: `only ${project.name}'s leads can add people to it` });
    }
    if (project.status === "finished") return res.status(400).json({ error: `${project.name} is finished` });
    const userId = String((req.body && req.body.userId) || "");
    const user = /^[a-f0-9]{24}$/i.test(userId) ? await User.findOne({ _id: userId, status: "active" }, { name: 1 }).lean() : null;
    if (!user) return res.status(404).json({ error: "no active account with that id" });
    const own = await Membership.find({ user: user._id }, { project: 1, role: 1 }).lean();
    if (own.some((membership) => String(membership.project) === String(project._id))) {
      return res.status(409).json({ error: `${displayName(user.name)} is already on ${project.name}` });
    }
    if (own.length > 0 && own.every(({ role }) => role === "client")) {
      return res.status(400).json({ error: `${user.name} is a client, not a developer` });
    }
    await Membership.create({ user: user._id, project: project._id, role: "dev" });
    live.projectChanged(project.name, "staff");
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "they're already on that project" });
    res.status(500).json({ error: `failed to add them: ${err.message}` });
  }
});

app.get("/api/port-status", async (req, res) => {
  const raw = String(req.query.ports || "");
  const ports = [...new Set(raw.split(",").map((p) => p.trim()).filter(Boolean))];
  if (ports.some((p) => !/^\d+$/.test(p))) {
    return res.status(400).json({ error: "ports must be a comma-separated list of positive integers" });
  }
  const results = await Promise.all(ports.map(async (p) => [p, await isPortServing(Number(p))]));
  res.json(Object.fromEntries(results));
});

app.get("/api/project-folders", (req, res) => {
  try {
    res.json(listProjectFolders());
  } catch (err) {
    res.status(500).json({ error: `failed to list project folders: ${err.message}` });
  }
});

// Newest mtime of any file under dir, skipping STAT_EXCLUDED_DIRS — a plain
// stat() on the project folder itself only moves when a *direct* child is
// added/removed/renamed, not when a file nested inside it is edited.
function latestMtimeMs(dir) {
  let latest = 0;
  let children;
  try {
    children = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return latest;
  }
  for (const child of children) {
    const childPath = path.join(dir, child.name);
    if (child.isDirectory()) {
      if (STAT_EXCLUDED_DIRS.has(child.name)) continue;
      latest = Math.max(latest, latestMtimeMs(childPath));
    } else if (child.isFile()) {
      try {
        latest = Math.max(latest, fs.statSync(childPath).mtimeMs);
      } catch {}
    }
  }
  return latest;
}

app.get("/api/project-folders/:name/stat", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  try {
    const stat = fs.statSync(dir);
    const modifiedMs = Math.max(stat.mtimeMs, latestMtimeMs(dir));
    res.json({ path: dir, created: stat.birthtime.toISOString(), modified: new Date(modifiedMs).toISOString() });
  } catch (err) {
    res.status(500).json({ error: `failed to stat project folder: ${err.message}` });
  }
});

// Resolves `subpath` (a relative path from a project's Explorer tree) against
// that project's directory, refusing anything that would escape it (e.g. via
// "..") the same way resolveProjectDir refuses an escaping project name.
// Returns null if the subpath is unsafe.
function resolveTreeTarget(projectDir, subpath) {
  const target = path.resolve(projectDir, subpath || "");
  const dirWithSep = path.resolve(projectDir) + path.sep;
  if (target !== path.resolve(projectDir) && !target.startsWith(dirWithSep)) return null;
  return target;
}

// Lists the immediate children of a project folder (or a subfolder within
// it, via ?subpath=), one level at a time — the Explorer tab fetches deeper
// levels lazily as the user expands them, so this never walks the whole
// tree (which would be slow/pointless for something like node_modules).
app.get("/api/project-folders/:name/tree", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const subpath = typeof req.query.subpath === "string" ? req.query.subpath : "";
  const target = resolveTreeTarget(dir, subpath);
  if (!target) {
    return res.status(400).json({ error: "invalid subpath" });
  }
  try {
    const children = fs
      .readdirSync(target, { withFileTypes: true })
      .map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file" }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    res.json(children);
  } catch (err) {
    res.status(500).json({ error: `failed to read folder: ${err.message}` });
  }
});

const TREE_SEARCH_MAX_MATCHES = 500;
const TREE_SEARCH_MAX_FILE_BYTES = 1024 * 1024; // bigger files are only matched by name
const TREE_SEARCH_LINES_PER_FILE = 3; // matching lines sent back per file; the rest are only counted
const TREE_SEARCH_SNIPPET_LENGTH = 160; // longest a sent-back line gets before it's cut around the match

// `text` without its indentation, starting a few words before the match at
// `at` when it's further in than that — the Explorer only has room for the
// first 40 or so characters — and cut to TREE_SEARCH_SNIPPET_LENGTH (minified
// code can put a whole file on one line), with "…" wherever it was cut.
function searchSnippet(text, at) {
  const trimmed = text.trimStart();
  at -= text.length - trimmed.length;
  const line = trimmed.trimEnd();
  let start = 0;
  if (at > 30) {
    start = at - 20;
    const space = line.indexOf(" ", start); // begin on a whole word when one starts in time
    if (space !== -1 && space < at) start = space + 1;
  }
  const end = Math.min(line.length, start + TREE_SEARCH_SNIPPET_LENGTH);
  return (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : "");
}

// The lines of a file holding `phrase` (lowercased, any case in the file):
// { lines: the first TREE_SEARCH_LINES_PER_FILE as { line, text }, lineCount:
// how many there are in all }. Null when there are none, or when the file
// can't be searched — unreadable, over TREE_SEARCH_MAX_FILE_BYTES, or binary
// (a NUL byte early on, the same test git uses).
function searchFileContent(filePath, phrase) {
  let buffer;
  try {
    if (fs.statSync(filePath).size > TREE_SEARCH_MAX_FILE_BYTES) return null;
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (buffer.subarray(0, 8000).includes(0)) return null;
  const lines = [];
  let lineCount = 0;
  buffer
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      const at = text.toLowerCase().indexOf(phrase);
      if (at === -1) return;
      lineCount++;
      if (lines.length < TREE_SEARCH_LINES_PER_FILE) lines.push({ line: i + 1, text: searchSnippet(text, at) });
    });
  return lineCount > 0 ? { lines, lineCount } : null;
}

// The Explorer's search, as relative paths with forward slashes: every file
// and folder whose name holds all of ?q='s words (any case, any order —
// `nameMatch`), and every file whose contents hold ?q= itself (any case),
// with its first matching lines (see searchFileContent). Contents need the
// whole phrase, since nearly every word turns up somewhere in a big file.
// Walked breadth first, so when it stops at TREE_SEARCH_MAX_MATCHES
// (`truncated`) the shallower matches are the ones kept.
// STAT_EXCLUDED_DIRS can match by name but aren't looked inside, and
// symlinks are neither followed nor read, so a link loop can't trap the walk.
app.get("/api/project-folders/:name/tree/search", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const terms = (typeof req.query.q === "string" ? req.query.q : "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return res.status(400).json({ error: "q is required" });
  }
  const phrase = terms.join(" ");
  const matches = [];
  let truncated = false;
  const queue = [""];
  while (queue.length > 0 && !truncated) {
    const subpath = queue.shift();
    let children;
    try {
      children = fs.readdirSync(path.join(dir, subpath), { withFileTypes: true });
    } catch {
      continue; // unreadable folder: its siblings are still worth searching
    }
    for (const child of children) {
      const childPath = subpath ? `${subpath}/${child.name}` : child.name;
      const isDir = child.isDirectory();
      const name = child.name.toLowerCase();
      const nameMatch = terms.every((term) => name.includes(term));
      const content = child.isFile() ? searchFileContent(path.join(dir, childPath), phrase) : null;
      if (nameMatch || content) {
        if (matches.length === TREE_SEARCH_MAX_MATCHES) {
          truncated = true;
          break;
        }
        matches.push({ path: childPath, type: isDir ? "dir" : "file", nameMatch, ...content });
      }
      if (isDir && !STAT_EXCLUDED_DIRS.has(child.name)) queue.push(childPath);
    }
  }
  res.json({ matches, truncated });
});

// How many folders and files the project holds, for the Explorer panel's
// header. Walked the same way as the search: STAT_EXCLUDED_DIRS are neither
// counted nor looked inside — `skipped` names the ones it came across — and
// symlinks aren't followed.
app.get("/api/project-folders/:name/tree/counts", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  let folders = 0;
  let files = 0;
  const skipped = new Set();
  const queue = [dir];
  while (queue.length > 0) {
    const folder = queue.shift();
    let children;
    try {
      children = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue; // unreadable folder: counted, but what it holds can't be
    }
    for (const child of children) {
      if (child.isDirectory()) {
        if (STAT_EXCLUDED_DIRS.has(child.name)) {
          skipped.add(child.name);
          continue;
        }
        folders++;
        queue.push(path.join(folder, child.name));
      } else if (child.isFile()) {
        files++;
      }
    }
  }
  res.json({ folders, files, skipped: [...skipped].sort() });
});

// Deletes a single file or folder (recursively) from within a project's
// Explorer tree. Requires a non-empty subpath — deleting the project's own
// root here would just be a confusing side door to the dedicated
// DELETE /api/project-folders/:name endpoint (which also unassigns/untracks
// it from the registry), so that's rejected instead of silently doing it.
app.delete("/api/project-folders/:name/tree", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const subpath = typeof req.query.subpath === "string" ? req.query.subpath : "";
  if (!subpath) {
    return res.status(400).json({ error: "subpath is required" });
  }
  const target = resolveTreeTarget(dir, subpath);
  if (!target || target === path.resolve(dir)) {
    return res.status(400).json({ error: "invalid subpath" });
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: "file or folder not found" });
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `failed to delete: ${err.message}` });
  }
});

// One git status category per changed/untracked/ignored path, in the
// priority order used to pick a single color for a folder that contains a
// mix of them (e.g. a folder with both a modified and an untracked file
// shows as "modified" — first match wins).
const GIT_STATUS_PRIORITY = ["conflicted", "modified", "renamed", "added", "untracked", "deleted", "ignored"];

function classifyGitCode(x, y) {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflicted";
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "M" || y === "M") return "modified";
  return "modified";
}

// Parses `git status --porcelain=v1 -z` output: NUL-separated "XY path"
// records, except a rename/copy record is followed by one extra NUL-
// terminated token (its original path) that we skip — the tree only needs
// where the entry lives now.
function parseGitPorcelain(stdout) {
  const tokens = stdout.split("\0").filter((t) => t.length > 0);
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const x = token[0];
    const y = token[1];
    const filePath = token.slice(3).replace(/\/$/, "");
    entries.push({ path: filePath, status: classifyGitCode(x, y) });
    if (x === "R" || y === "R" || x === "C" || y === "C") i++;
  }
  return entries;
}

// The commit message waiting for a project's next push, kept up to date by
// its agents as they journal their work (the "Push Commit Message" rule in
// each project's AGENTS.md). The Push button commits with it and then
// deletes it; it's never committed itself. Forward slashes, since it's also
// matched against the paths git reports.
const COMMIT_MESSAGE_RELATIVE = "dev_resources/commit_message.txt";

// The pending commit message's text, or null when there isn't one (no file,
// or nothing but whitespace in it).
function readPendingCommitMessage(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, COMMIT_MESSAGE_RELATIVE), "utf8").replace(/\r\n/g, "\n").trim();
    return text || null;
  } catch {
    return null;
  }
}

// Every changed/untracked/ignored path in a project, so the Explorer can
// color-code rows the way VS Code's git decorations do — without VS Code, by
// just asking git directly. `--ignored` (without "=matching") reports a
// wholly-ignored/untracked directory as a single entry rather than walking
// its contents, so this stays cheap even with a huge ignored node_modules.
app.get("/api/project-folders/:name/git-status", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  exec("git status --porcelain=v1 --ignored -z", { cwd: dir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      if (/not a git repository/i.test(stderr || "")) return res.json({ isRepo: false, entries: [] });
      return res.status(500).json({ error: `git status failed: ${(stderr || err.message).trim()}` });
    }
    // The pending commit message never goes into a commit (see git-push), so
    // it isn't a change to report.
    const entries = parseGitPorcelain(stdout).filter((e) => e.path !== COMMIT_MESSAGE_RELATIVE);
    res.json({ isRepo: true, entries });
  });
});

// Fields pulled from `git log -1`, separated by \x1f (unit separator) since
// it won't collide with anything a commit message or author name contains.
const GIT_LOG_FORMAT = "%H\x1f%h\x1f%an\x1f%aI\x1f%s";

function parseGitLogLine(line) {
  const [hash, shortHash, author, date, ...rest] = line.split("\x1f");
  return { hash, shortHash, author, date, message: rest.join("\x1f") };
}

// The History panel's data: the latest commit, when it was last pushed, and
// the commit message waiting for the next push (null when there's none).
// "Last push" isn't something git tracks directly, so it's inferred from the
// upstream remote-tracking branch's reflog — a `git push` from this machine
// is the only thing that writes an "update by push" entry there, which is a
// more reliable signal than assuming push time == commit time (you can
// commit offline and push later). Any piece that doesn't apply (no commits
// yet, no upstream configured, no reflog history) just comes back null.
app.get("/api/project-folders/:name/git-history", async (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const git = (args) => execAsync(`git ${args}`, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });

  // symbolic-ref names the branch even before its first commit, when
  // rev-parse has no HEAD to resolve ("ambiguous argument 'HEAD'"). It only
  // fails on a detached HEAD, which rev-parse then reports as "HEAD".
  let branch;
  try {
    branch = (await git("symbolic-ref --short -q HEAD")).stdout.trim();
  } catch (err) {
    if (/not a git repository/i.test(err.stderr || "")) return res.json({ isRepo: false });
    try {
      branch = (await git("rev-parse --abbrev-ref HEAD")).stdout.trim();
    } catch (err) {
      return res.status(500).json({ error: `git rev-parse failed: ${(err.stderr || err.message).trim()}` });
    }
  }

  let lastCommit = null;
  let commitCount = 0;
  try {
    const { stdout } = await git(`log -1 --format=${GIT_LOG_FORMAT}`);
    if (stdout.trim()) lastCommit = parseGitLogLine(stdout.trim());
    commitCount = Number((await git("rev-list --count HEAD")).stdout.trim()) || 0;
  } catch {
    // no commits yet
  }

  let upstream = null;
  try {
    upstream = (await git("rev-parse --abbrev-ref --symbolic-full-name @{u}")).stdout.trim();
  } catch {
    // no upstream configured for the current branch
  }

  let lastPush = null;
  let unpushedCount = null; // commits on the branch its upstream doesn't have yet; null without an upstream
  if (upstream) {
    try {
      const { stdout } = await git(`reflog show --date=iso-strict "${upstream}"`);
      const pushLine = stdout.split("\n").find((line) => /: update by push$/.test(line.trim()));
      const match = pushLine && pushLine.match(/@\{(.+?)\}:/);
      if (match) lastPush = { date: match[1] };
    } catch {
      // no reflog for the upstream ref
    }
    try {
      unpushedCount = Number((await git(`rev-list --count "${upstream}..HEAD"`)).stdout.trim()) || 0;
    } catch {
      // no commits yet
    }
  }

  res.json({
    isRepo: true,
    branch,
    lastCommit,
    commitCount,
    upstream,
    lastPush,
    unpushedCount,
    commitMessage: readPendingCommitMessage(dir),
  });
});

// Formats an auto-commit message's timestamp the same way this user's own
// manual "Auto-commit: 2026-07-18 01:04" commits already do.
function formatAutoCommitTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The History panel's "Push" button: stages everything (except the pending
// commit message itself), commits if anything got staged, then pushes to the
// current branch's upstream. No commit-message prompt — the commit uses the
// message the project's agents keep in COMMIT_MESSAGE_RELATIVE, and only
// falls back to an auto-generated "Auto-commit: <timestamp>" when there
// isn't one. Once that message is in a commit the file is deleted, so the
// next journal entry starts the next push's message fresh.
app.post("/api/project-folders/:name/git-push", async (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const git = (args) => execAsync(`git ${args}`, { cwd: dir, maxBuffer: 10 * 1024 * 1024 });

  // A project that ignores dev_resources/ can't name the message in the
  // pathspec, even to exclude it: `git add` then exits 1 ("paths are
  // ignored"). Ignored, it can't be staged anyway, so the exclude is skipped.
  let messageIgnored = false;
  try {
    await git(`check-ignore -q -- "${COMMIT_MESSAGE_RELATIVE}"`);
    messageIgnored = true;
  } catch {
    // exit 1: not ignored (or not a repo, which `git add` reports below)
  }

  try {
    await git(messageIgnored ? "add -A -- ." : `add -A -- . ":(exclude)${COMMIT_MESSAGE_RELATIVE}"`);
  } catch (err) {
    if (/not a git repository/i.test(err.stderr || "")) return res.status(400).json({ error: "not a git repository" });
    return res.status(500).json({ error: `git add failed: ${(err.stderr || err.message).trim()}` });
  }

  let committed = false;
  let usedPendingMessage = false;
  try {
    // What's staged, not `status` — the pending message is still sitting
    // there unstaged, so `status` would always report something.
    const { stdout } = await git("diff --cached --name-only");
    if (stdout.trim()) {
      if (readPendingCommitMessage(dir)) {
        // git drops the file's \r line endings and surrounding blank lines itself.
        await git(`commit -F "${COMMIT_MESSAGE_RELATIVE}"`);
        usedPendingMessage = true;
      } else {
        await git(`commit -m "Auto-commit: ${formatAutoCommitTimestamp(new Date())}"`);
      }
      committed = true;
    }
  } catch (err) {
    return res.status(500).json({ error: `git commit failed: ${(err.stderr || err.message).trim()}` });
  }

  if (usedPendingMessage) {
    try {
      fs.rmSync(path.join(dir, COMMIT_MESSAGE_RELATIVE), { force: true });
    } catch {
      // Locked by something else holding it open. The commit itself is done;
      // the cost is the next push's message still carrying this one's lines.
    }
  }

  try {
    await git("push");
  } catch (err) {
    return res.status(500).json({ error: `git push failed: ${(err.stderr || err.message).trim()}`, committed });
  }

  res.json({ ok: true, committed });
});

// Where a project's journal is expected to live. jarumiri_studios predates
// the dev_resources/ convention and uses Plans/journal.md instead — checked
// first only if it already exists; anything newly created always goes to
// the standard dev_resources/ path.
const JOURNAL_DEFAULT_RELATIVE = path.join("dev_resources", "journal.md");
const JOURNAL_SEARCH_RELATIVE = [JOURNAL_DEFAULT_RELATIVE, path.join("Plans", "journal.md")];

function findJournalPath(projectDir) {
  for (const rel of JOURNAL_SEARCH_RELATIVE) {
    const candidate = path.join(projectDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(projectDir, JOURNAL_DEFAULT_RELATIVE);
}

const JOURNAL_NOTE_MAX_LENGTH = 150; // mirrors the composer textarea's maxlength in views/index.ejs
const JOURNAL_DAY_HEADING_RE = /^## (\d{4}-\d{2}-\d{2})\b.*$/gm;
const JOURNAL_ENTRY_TIME_RE = /^-\s+\*\*(\d{2}:\d{2})\*\*\s+—\s+(.*)$/;
// The files an entry's work created, modified or deleted, reported by the
// agent that wrote it (the "Journal File Reports" rule in each project's
// AGENTS.md) and kept as indented sub-bullets under the entry, one per kind:
//   - Created: `views/login.ejs`, `routes/auth.js`
const JOURNAL_FILE_KINDS = ["created", "modified", "deleted"];
const JOURNAL_FILE_LINE_RE = /^\s+-\s+(Created|Modified|Deleted):\s*(.*)$/i;
const JOURNAL_FILES_MAX = 200; // per kind, per entry

// Checks and tidies the optional `files` of a journal POST — { created?,
// modified?, deleted? }, each a list of paths relative to the project:
// forward slashes, no leading "./", no backticks (they delimit paths in the
// Markdown), no duplicates. Returns { files } (null when there's nothing to
// record) or { error }.
function normalizeJournalFiles(raw) {
  if (raw === undefined || raw === null) return { files: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "files must be an object of created/modified/deleted path lists" };
  }
  const files = {};
  for (const [kind, list] of Object.entries(raw)) {
    if (!JOURNAL_FILE_KINDS.includes(kind)) return { error: `unknown files key "${kind}" — use created, modified or deleted` };
    if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) return { error: `files.${kind} must be a list of paths` };
    const paths = [
      ...new Set(list.map((p) => p.replace(/`/g, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").trim()).filter(Boolean)),
    ];
    if (paths.length > JOURNAL_FILES_MAX) return { error: `files.${kind} is limited to ${JOURNAL_FILES_MAX} paths per entry` };
    if (paths.length > 0) files[kind] = paths;
  }
  return { files: Object.keys(files).length > 0 ? files : null };
}

// Parsed for display only — never re-serialized back to disk, so this can
// afford to be lossy about exotic formatting (nested sub-bullets etc.) in
// hand-written entries. Writing (appendJournalEntry) only ever inserts new
// text, it never rebuilds the file from this parsed shape. An entry's file
// sub-bullets come back as its `files` ({ created?, modified?, deleted? }),
// not as part of its text.
function parseJournal(text) {
  const days = [];
  let current = null;
  let currentEntry = null;

  const flushEntry = () => {
    if (currentEntry) {
      const entry = { time: currentEntry.time, content: currentEntry.lines.join("\n").trim() };
      if (Object.keys(currentEntry.files).length > 0) entry.files = currentEntry.files;
      current.entries.push(entry);
      currentEntry = null;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const headingMatch = /^## (\d{4}-\d{2}-\d{2})\b.*$/.exec(line);
    if (headingMatch) {
      flushEntry();
      current = { date: headingMatch[1], entries: [] };
      days.push(current);
      continue;
    }
    if (!current) continue; // intro text/comment before the first day heading
    const entryMatch = JOURNAL_ENTRY_TIME_RE.exec(line);
    if (entryMatch) {
      flushEntry();
      currentEntry = { time: entryMatch[1], lines: [entryMatch[2]], files: {} };
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushEntry();
      currentEntry = { time: null, lines: [line.replace(/^-\s+/, "")], files: {} };
      continue;
    }
    const filesMatch = currentEntry && JOURNAL_FILE_LINE_RE.exec(line);
    if (filesMatch) {
      // Backtick-quoted paths as written by appendJournalEntry; a
      // hand-written plain comma list works too.
      const quoted = [...filesMatch[2].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
      const paths = (quoted.length > 0 ? quoted : filesMatch[2].split(",")).map((p) => p.trim()).filter(Boolean);
      const kind = filesMatch[1].toLowerCase();
      currentEntry.files[kind] = [...new Set([...(currentEntry.files[kind] || []), ...paths])];
      continue;
    }
    if (currentEntry) {
      currentEntry.lines.push(line.replace(/^ {1,2}/, ""));
    }
  }
  flushEntry();
  // Sorted explicitly (newest day first) rather than trusting file order —
  // appendJournalEntry always prepends new days, but a hand-written or
  // pre-existing journal.md (e.g. one seeded as project documentation) can
  // just as easily list days oldest-first.
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTimeString(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const JOURNAL_FILE_TEMPLATE = "# Project Journal\n\n<!--\nEntry template:\n\n## YYYY-MM-DD\n- **HH:MM** — What changed\n-->\n\n";

// Beside each journal, an append-only log with one JSON line per entry that
// appendJournalEntry inserts: the exact moment it went in (`insertedAt`, ISO
// 8601 UTC), the date and time it was filed under, and its text and files.
// journal.md is hand-editable and rewritten whole on every insert, so its
// HH:MM alone can't show when an entry really arrived; this file is only ever
// appended to. Hand-written entries have no record in it.
function journalAuditPath(journalPath) {
  return path.join(path.dirname(journalPath), "journal.audit.jsonl");
}

// Gives each parsed entry its `insertedAt` from the audit log, matched on the
// date, time and text it was filed with (duplicates oldest first). An entry
// written by hand, or edited since it went in, matches no record and gets none.
function withJournalAudit(days, journalPath) {
  const auditPath = journalAuditPath(journalPath);
  if (!fs.existsSync(auditPath)) return days;
  const keyOf = (date, time, content) => JSON.stringify([date, time, content]);
  const insertedAtByKey = new Map();
  for (const line of fs.readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn or hand-mangled line shouldn't hide the rest
    }
    const key = keyOf(record.date, record.time, record.content);
    if (!insertedAtByKey.has(key)) insertedAtByKey.set(key, []);
    insertedAtByKey.get(key).push(record.insertedAt);
  }
  for (const day of days) {
    for (const entry of day.entries) {
      const queue = insertedAtByKey.get(keyOf(day.date, entry.time, entry.content));
      if (queue && queue.length > 0) entry.insertedAt = queue.shift();
    }
  }
  return days;
}

// Appends one note as a new bullet, grouped under today's `## YYYY-MM-DD`
// heading — creating that heading (newest at the top of the file) if today
// doesn't have one yet. Pure text surgery: existing content is never
// reparsed-and-rewritten, only ever a scoped insertion, so hand-written
// entries elsewhere in the file (including odd/nested formatting) survive
// byte-for-byte. `files` (see normalizeJournalFiles), when given, goes under
// the note as one sub-bullet per kind. Each insert is recorded in the audit
// log (journalAuditPath) first, so a failed audit write leaves the journal
// untouched and the request safe to retry.
function appendJournalEntry(journalPath, content, files = null) {
  let text = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf8") : JOURNAL_FILE_TEMPLATE;
  if (!text.endsWith("\n")) text += "\n";
  // One clock reading for both, so an entry posted at midnight can't be filed
  // under one day with the other day's time.
  const now = new Date();
  const date = localDateString(now);
  const time = localTimeString(now);
  const fileLines = JOURNAL_FILE_KINDS.filter((kind) => files && files[kind]).map(
    (kind) => `  - ${kind[0].toUpperCase()}${kind.slice(1)}: ${files[kind].map((p) => `\`${p}\``).join(", ")}`
  );
  const bulletText = [
    ...content.split("\n").map((line, i) => (i === 0 ? `- **${time}** — ${line}` : `  ${line}`)),
    ...fileLines,
  ].join("\n");

  const headings = [...text.matchAll(JOURNAL_DAY_HEADING_RE)];
  const todayHeading = headings.find((h) => h[1] === date);

  let updated;
  if (todayHeading) {
    const startIdx = todayHeading.index;
    const next = headings.find((h) => h.index > startIdx);
    const blockEnd = next ? next.index : text.length;
    let insertAt = blockEnd;
    while (insertAt > startIdx && text[insertAt - 1] === "\n") insertAt--;
    updated = `${text.slice(0, insertAt)}\n${bulletText}\n\n${text.slice(blockEnd)}`;
  } else {
    const newBlock = `## ${date}\n${bulletText}\n\n`;
    updated = headings.length > 0 ? text.slice(0, headings[0].index) + newBlock + text.slice(headings[0].index) : text + newBlock;
  }

  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const record = { insertedAt: now.toISOString(), date, time, content };
  if (files) record.files = files;
  fs.appendFileSync(journalAuditPath(journalPath), JSON.stringify(record) + "\n");
  fs.writeFileSync(journalPath, updated);
  return updated;
}

app.get("/api/project-folders/:name/journal", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const journalPath = findJournalPath(dir);
  if (!fs.existsSync(journalPath)) return res.json({ days: [] });
  try {
    res.json({ days: withJournalAudit(parseJournal(fs.readFileSync(journalPath, "utf8")), journalPath) });
  } catch (err) {
    res.status(500).json({ error: `failed to read journal: ${err.message}` });
  }
});

app.post("/api/project-folders/:name/journal", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
  if (!content) return res.status(400).json({ error: "note content is required" });
  if (content.length > JOURNAL_NOTE_MAX_LENGTH) {
    return res.status(400).json({ error: `note is limited to ${JOURNAL_NOTE_MAX_LENGTH} characters` });
  }
  const { files, error } = normalizeJournalFiles(req.body.files);
  if (error) return res.status(400).json({ error });
  try {
    const journalPath = findJournalPath(dir);
    const updated = appendJournalEntry(journalPath, content, files);
    res.json({ days: withJournalAudit(parseJournal(updated), journalPath) });
    live.projectChanged(req.params.name, "journal");
  } catch (err) {
    res.status(500).json({ error: `failed to update journal: ${err.message}` });
  }
});

// A project's task list: unlike the journal's hand-editable Markdown, tasks
// need a stable id per entry so done/archived/delete can target one of them,
// so this is a small JSON object instead — dev_resources/tasks.json — holding
// the tasks plus the project's own freely-user-defined tag list (tags persist
// here independently of which tasks currently use them, so one can exist
// with zero tasks tagged with it).
const TASKS_RELATIVE = path.join("dev_resources", "tasks.json");
const TASK_TITLE_MAX_LENGTH = 80; // mirrors the composer's title input maxlength in views/index.ejs
const TASK_DESCRIPTION_MAX_LENGTH = 500; // mirrors the composer's description textarea maxlength
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/; // matches <input type="date">'s value format
const TAG_MAX_LENGTH = 30;

function findTasksPath(projectDir) {
  return path.join(projectDir, TASKS_RELATIVE);
}

// Tasks from before titles existed carry a single `content` string — read
// that as the title with an empty description, same no-migration approach as
// the bare-array case below; the next write persists the new shape.
function normalizeLegacyTask(task) {
  if (typeof task.title === "string") return task;
  const { content, ...rest } = task;
  return { ...rest, title: typeof content === "string" ? content : "", description: "" };
}

// Old files (from before tags existed) are a bare task array — read that as
// an empty tag list rather than migrating the file on disk; the next write
// (any create/update) naturally upgrades it to the {tags, tasks} shape.
function readTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return { tags: [], tasks: [] };
  const text = fs.readFileSync(tasksPath, "utf8").trim();
  if (!text) return { tags: [], tasks: [] };
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return { tags: [], tasks: parsed.map(normalizeLegacyTask) };
  return {
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeLegacyTask) : [],
  };
}

// Validates an incoming title/description pair from a request body. Either
// may be absent (PATCH only sends what changed); `requireTitle` is for POST,
// where a task can't exist without one. Returns { error } or the trimmed
// values that were present.
function parseTaskText(body, { requireTitle }) {
  const result = {};
  if (typeof body.title === "string" || requireTitle) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "task title is required" };
    if (title.length > TASK_TITLE_MAX_LENGTH) return { error: `task title is limited to ${TASK_TITLE_MAX_LENGTH} characters` };
    result.title = title;
  }
  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (description.length > TASK_DESCRIPTION_MAX_LENGTH) {
      return { error: `task description is limited to ${TASK_DESCRIPTION_MAX_LENGTH} characters` };
    }
    result.description = description;
  }
  return result;
}

function writeTasks(tasksPath, data) {
  fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
  fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2) + "\n");
}

// Trims/dedupes (case-insensitively) a task's incoming tag list, dropping
// anything empty or absurdly long.
function normalizeTagList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag || tag.length > TAG_MAX_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

// Adds any of `taskTags` not already known (case-insensitively) onto the
// project's own tag list, in place — this is how a new tag typed in the
// Tasks tab's dropdown gets "created": it just becomes known the first time
// a task is saved with it.
function mergeKnownTags(knownTags, taskTags) {
  const known = new Set(knownTags.map((t) => t.toLowerCase()));
  for (const tag of taskTags) {
    if (!known.has(tag.toLowerCase())) {
      knownTags.push(tag);
      known.add(tag.toLowerCase());
    }
  }
}

// Short, human-referenceable id ("A3F9K2") instead of a UUID — a task list
// stays small enough per-project that a 6-char code has no real collision
// risk, and it's the one shown/typed by a person, not just passed in a URL.
const TASK_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TASK_CODE_LENGTH = 6;

function generateTaskCode(existingIds) {
  let code;
  do {
    code = Array.from({ length: TASK_CODE_LENGTH }, () => TASK_CODE_ALPHABET[crypto.randomInt(TASK_CODE_ALPHABET.length)]).join("");
  } while (existingIds.has(code));
  return code;
}

app.get("/api/project-folders/:name/tasks", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  try {
    const { tags, tasks } = readTasks(findTasksPath(dir));
    res.json({ tasks, tags });
  } catch (err) {
    res.status(500).json({ error: `failed to read tasks: ${err.message}` });
  }
});

app.post("/api/project-folders/:name/tasks", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  const text = parseTaskText(req.body, { requireTitle: true });
  if (text.error) return res.status(400).json({ error: text.error });
  const dueDateRaw = typeof req.body.dueDate === "string" ? req.body.dueDate.trim() : "";
  if (dueDateRaw && !DATE_ONLY_RE.test(dueDateRaw)) {
    return res.status(400).json({ error: "invalid due date" });
  }
  const taskTags = normalizeTagList(req.body.tags);
  try {
    const tasksPath = findTasksPath(dir);
    const data = readTasks(tasksPath);
    const now = new Date().toISOString();
    const id = generateTaskCode(new Set(data.tasks.map((t) => t.id)));
    mergeKnownTags(data.tags, taskTags);
    data.tasks.unshift({
      id,
      title: text.title,
      description: text.description || "",
      done: false,
      doneAt: null,
      archived: false,
      archivedAt: null,
      dueDate: dueDateRaw || null,
      tags: taskTags,
      createdAt: now,
      updatedAt: now,
    });
    writeTasks(tasksPath, data);
    res.json({ tasks: data.tasks, tags: data.tags });
    live.projectChanged(req.params.name, "tasks");
  } catch (err) {
    res.status(500).json({ error: `failed to update tasks: ${err.message}` });
  }
});

// Partial update: `done`/`archived` flip the checkbox/archive button,
// `title`/`description` rewrite the task's own text (a title can't be
// emptied, a description can), `dueDate` sets or clears (null or "") its due
// date, and `tags` replaces its tag list wholesale (any new tag name in it is
// merged onto the project's known tags) — any subset can be sent at once, as
// the composer does when saving an edit. Flipping `done`/`archived` on stamps
// `doneAt`/`archivedAt` with the time, and flipping it off clears it; sending
// the value a task already has leaves its stamp alone. Tasks done or archived
// before these stamps existed have none.
app.patch("/api/project-folders/:name/tasks/:id", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  try {
    const tasksPath = findTasksPath(dir);
    const data = readTasks(tasksPath);
    const id = req.params.id.toUpperCase(); // codes are always stored/shown uppercase; matching is case-insensitive
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "task not found" });
    const text = parseTaskText(req.body, { requireTitle: false });
    if (text.error) return res.status(400).json({ error: text.error });
    if (typeof text.title === "string") task.title = text.title;
    if (typeof text.description === "string") task.description = text.description;
    if (typeof req.body.dueDate !== "undefined") {
      if (req.body.dueDate === null || req.body.dueDate === "") {
        task.dueDate = null;
      } else if (typeof req.body.dueDate === "string" && DATE_ONLY_RE.test(req.body.dueDate)) {
        task.dueDate = req.body.dueDate;
      } else {
        return res.status(400).json({ error: "invalid due date" });
      }
    }
    if (Array.isArray(req.body.tags)) {
      const taskTags = normalizeTagList(req.body.tags);
      mergeKnownTags(data.tags, taskTags);
      task.tags = taskTags;
    }
    const now = new Date().toISOString();
    if (typeof req.body.done === "boolean" && req.body.done !== task.done) {
      task.done = req.body.done;
      task.doneAt = task.done ? now : null;
    }
    if (typeof req.body.archived === "boolean" && req.body.archived !== task.archived) {
      task.archived = req.body.archived;
      task.archivedAt = task.archived ? now : null;
    }
    task.updatedAt = now;
    writeTasks(tasksPath, data);
    res.json({ tasks: data.tasks, tags: data.tags });
    live.projectChanged(req.params.name, "tasks");
  } catch (err) {
    res.status(500).json({ error: `failed to update tasks: ${err.message}` });
  }
});

app.delete("/api/project-folders/:name/tasks/:id", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  try {
    const tasksPath = findTasksPath(dir);
    const data = readTasks(tasksPath);
    const id = req.params.id.toUpperCase();
    data.tasks = data.tasks.filter((t) => t.id !== id);
    writeTasks(tasksPath, data);
    res.json({ tasks: data.tasks, tags: data.tags });
    live.projectChanged(req.params.name, "tasks");
  } catch (err) {
    res.status(500).json({ error: `failed to update tasks: ${err.message}` });
  }
});

app.get("/api/projects-root", (req, res) => {
  res.json({ path: PROJECTS_ROOT });
});

// Seeds a project folder with whichever starter files from new_project_sample/
// it's missing — a fresh folder gets both, a folder that already had its own
// AGENTS.md/init_prompt.md (or picked one up some other way) keeps it as-is.
// Those files use a ":projectFolderName" placeholder (in paths, the Mongo
// dbName/URI, the .vbs launcher name, etc.) meant to be swapped for the real
// folder name before use, so that substitution happens here.
function seedProjectFolder(dir, name) {
  for (const file of SAMPLE_TEMPLATE_FILES) {
    const dest = path.join(dir, file);
    if (fs.existsSync(dest)) continue;
    const src = path.join(SAMPLE_PROJECT_DIR, file);
    if (!fs.existsSync(src)) continue;
    const content = fs.readFileSync(src, "utf8").split(":projectFolderName").join(name);
    fs.writeFileSync(dest, content);
  }
}

app.post("/api/project-folders/:name", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir) return res.status(400).json({ error: `invalid project name "${req.params.name}"` });
  if (RESERVED_NAMES.has(req.params.name.toLowerCase())) {
    return res.status(400).json({ error: `"${req.params.name}" is one of Dispatch's own addresses; pick another name` });
  }
  if (fs.existsSync(dir)) return res.status(409).json({ error: `"${req.params.name}" already exists` });
  try {
    fs.mkdirSync(dir);
    seedProjectFolder(dir, req.params.name);
    appendJournalEntry(findJournalPath(dir), "Project was created");
    res.json({ ok: true });
    live.registryChanged();
  } catch (err) {
    res.status(500).json({ error: `failed to create project folder: ${err.message}` });
  }
});

app.delete("/api/project-folders/:name", (req, res) => {
  const name = req.params.name;
  const dir = resolveProjectDir(name);
  if (!dir) return res.status(400).json({ error: `invalid project name "${name}"` });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: `project folder "${name}" not found` });
  const state = runningProjects.get(name);
  if (state && (state.status === "starting" || state.status === "running")) {
    return res.status(409).json({ error: `"${name}" is currently running — stop it before deleting` });
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
    live.registryChanged();
  } catch (err) {
    res.status(500).json({ error: `failed to delete project folder: ${err.message}` });
  }
});

app.put("/api/registry", async (req, res) => {
  let existingNames;
  try {
    existingNames = collectNames(await readRegistry());
  } catch (err) {
    return res.status(500).json({ error: `failed to read registry: ${err.message}` });
  }

  const error = validateRegistry(req.body, existingNames);
  if (error) {
    return res.status(400).json({ error });
  }
  try {
    await writeRegistry(req.body);
    // Any name that's newly tracked (not just newly assigned a port —
    // moving from unassigned to a category doesn't count) gets the starter
    // files it might be missing, whether its folder was just created or
    // already existed on disk.
    const newNames = [...collectNames(req.body)].filter((name) => !existingNames.has(name));
    for (const name of newNames) {
      const dir = resolveProjectDir(name);
      if (dir && fs.existsSync(dir)) seedProjectFolder(dir, name);
    }
    syncAllEnvPorts(req.body);
    res.json({ ok: true });
    live.registryChanged();
  } catch (err) {
    res.status(500).json({ error: `failed to write registry: ${err.message}` });
  }
});

// Finds which category/port a project name is currently assigned to (not
// "unassigned" — those have no port to serve on).
async function findAssignedEntry(name) {
  const project = await Project.findOne({ name, port: { $ne: null } }).lean();
  return project ? { category: project.category, port: String(project.port) } : null;
}

// Mirrors scripts/inject-port.js so a manual port reassignment in the
// dashboard is reflected before we start the dev server, without requiring
// the project folder to be reopened in VS Code first.
function syncEnvPort(projectDir, port) {
  const envPath = path.join(projectDir, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^PORT=.*$/m.test(content)) {
    content = content.replace(/^PORT=.*$/m, `PORT=${port}`);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `PORT=${port}\n`;
  }
  fs.writeFileSync(envPath, content);
}

// Keeps every assigned project's .env PORT in step with the registry the
// moment it's saved (e.g. after a drag-and-drop move), so the new port holds
// however the project is launched — dashboard, VS Code tasks, or a terminal.
// Only touches .env files whose PORT actually differs, and only creates one
// for folders that look like Node projects.
function syncAllEnvPorts(registry) {
  for (const category of CATEGORIES) {
    for (const [port, entry] of Object.entries(registry[category] || {})) {
      const dir = resolveProjectDir(entry.name);
      if (!dir || !fs.existsSync(dir)) continue;
      const envPath = path.join(dir, ".env");
      try {
        if (fs.existsSync(envPath)) {
          const match = fs.readFileSync(envPath, "utf8").match(/^PORT=(.*)$/m);
          if (match && match[1].trim() === port) continue;
        } else if (!fs.existsSync(path.join(dir, "package.json"))) {
          continue;
        }
        syncEnvPort(dir, port);
      } catch (err) {
        console.error(`failed to sync .env PORT for "${entry.name}": ${err.message}`);
      }
    }
  }
}

function hasScript(projectDir, scriptName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    return !!(pkg.scripts && pkg.scripts[scriptName]);
  } catch {
    return false;
  }
}

// Best-effort classification from exit code/signal plus the tail of stderr,
// so the client can show something more useful than "it stopped".
function classifyExitError(code, signal, stderrTail, port) {
  if (signal) return `process was terminated (${signal})`;
  if (/EADDRINUSE/i.test(stderrTail)) return `port ${port} is already in use by another process`;
  if (/ENOENT/i.test(stderrTail)) return "npm (or a required command) was not found on PATH";
  return `exited with code ${code}`;
}

// A shell-spawned npm process on Windows is really cmd.exe -> npm -> node
// (nodemon) -> node (the actual script). Only a recursive tree-kill reliably
// takes down the whole chain; proc.kill() alone only kills the shell.
function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.pid === undefined) return;
  if (process.platform === "win32") {
    exec(`taskkill /pid ${proc.pid} /t /f`);
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
}

// Tracks stderr (for error classification only — stdout is discarded, we're
// not building a log viewer) and reconciles `state`/`runningProjects` once
// the process exits, distinguishing a user-requested stop from a crash.
function attachExitWatcher(proc, name, kind, state) {
  let stderrTail = "";
  if (proc.stderr) {
    proc.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
  }
  proc.on("exit", (code, signal) => {
    if (state.stoppedByUser) {
      if (kind === "dev") state.dev = null;
      else state.tw = null;
      if (!state.dev && !state.tw) runningProjects.delete(name);
      return;
    }
    if (kind === "dev") {
      state.dev = null;
      if (code === 0 && !signal) {
        runningProjects.delete(name); // exited cleanly on its own — not a crash
        return;
      }
      state.status = "crashed";
      state.error = classifyExitError(code, signal, stderrTail, state.port);
      if (state.tw) killProcessTree(state.tw); // tailwind watching alone isn't useful without the server
    } else {
      state.tw = null;
      if (!(code === 0 && !signal)) {
        state.twError = classifyExitError(code, signal, stderrTail, state.port);
      }
    }
  });
}

app.post("/api/projects/:name/start", async (req, res) => {
  const name = req.params.name;
  let assigned;
  try {
    assigned = await findAssignedEntry(name);
  } catch (err) {
    return res.status(500).json({ error: `failed to read registry: ${err.message}` });
  }
  if (!assigned) {
    return res.status(400).json({ error: `"${name}" is not assigned to a port` });
  }
  const existing = runningProjects.get(name);
  if (existing && (existing.status === "starting" || existing.status === "running")) {
    return res.status(409).json({ error: `"${name}" is already running` });
  }

  const dir = path.join(PROJECTS_ROOT, name);
  if (!fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${name}" not found` });
  }

  try {
    syncEnvPort(dir, assigned.port);
  } catch (err) {
    return res.status(500).json({ error: `failed to sync .env: ${err.message}` });
  }

  const state = { status: "starting", dev: null, tw: null, port: assigned.port, error: null, twError: null, stoppedByUser: false };
  runningProjects.set(name, state);

  const spawnOpts = {
    cwd: dir,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  };
  if (process.platform !== "win32") spawnOpts.detached = true;

  const dev = spawn("npm", ["run", "dev"], spawnOpts);
  state.dev = dev;
  attachExitWatcher(dev, name, "dev", state);

  if (hasScript(dir, "tw")) {
    const tw = spawn("npm", ["run", "tw"], spawnOpts);
    state.tw = tw;
    attachExitWatcher(tw, name, "tw", state);
  }

  // Give it a moment to fail fast (missing deps, port already bound, syntax
  // error) so the client gets a real error instead of a false "started".
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const current = runningProjects.get(name);
  if (!current || current.status === "crashed") {
    const error = current ? current.error : "process exited immediately";
    runningProjects.delete(name);
    return res.status(500).json({ error: `Failed to start "${name}": ${error}` });
  }

  current.status = "running";
  res.json({ ok: true, port: assigned.port });
});

// Finds the PID(s) with an OS socket LISTENING on a port, for stopping a
// project we never spawned ourselves (started from a terminal outside this
// dashboard). Only the exact listening process is targeted — deliberately
// not walking up to its parent/shell, since that chain could lead to a
// terminal window or IDE process well outside this dev server's tree.
function findPidsListeningOnPort(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec("netstat -ano -p tcp", (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const pids = new Set();
        for (const line of stdout.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 5 || parts[3] !== "LISTENING") continue;
          const localPort = parts[1].split(":").pop();
          if (localPort !== String(port) || !/^\d+$/.test(parts[4])) continue;
          pids.add(Number(parts[4]));
        }
        resolve([...pids]);
      });
    } else {
      exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve([...new Set(stdout.split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).map(Number))]);
      });
    }
  });
}

app.post("/api/projects/:name/stop", async (req, res) => {
  const name = req.params.name;
  const state = runningProjects.get(name);
  if (state) {
    state.stoppedByUser = true;
    if (state.dev) killProcessTree(state.dev);
    if (state.tw) killProcessTree(state.tw);
    if (!state.dev && !state.tw) runningProjects.delete(name);
    return res.json({ ok: true });
  }

  // Not something we started — if the assigned port is still actually live,
  // fall back to killing whatever OS process is bound to it directly.
  let assigned;
  try {
    assigned = await findAssignedEntry(name);
  } catch (err) {
    return res.status(500).json({ error: `failed to read registry: ${err.message}` });
  }
  const pids = assigned ? await findPidsListeningOnPort(assigned.port) : [];
  if (pids.length === 0) {
    return res.json({ ok: true });
  }
  if (process.platform === "win32") {
    await Promise.all(pids.map((pid) => new Promise((resolve) => exec(`taskkill /pid ${pid} /f`, resolve))));
  } else {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
  res.json({ ok: true });
});

// name -> { status, error, twError } for each project Dispatch started.
function runsSnapshot() {
  const out = {};
  for (const [name, state] of runningProjects.entries()) {
    out[name] = { status: state.status, error: state.error || null, twError: state.twError || null };
  }
  return out;
}

app.get("/api/running-projects", (req, res) => {
  res.json(runsSnapshot());
});

// Resolves a project name to its folder, refusing anything that would
// resolve outside PROJECTS_ROOT (e.g. a name containing "..").
function resolveProjectDir(name) {
  const root = path.resolve(PROJECTS_ROOT) + path.sep;
  const dir = path.resolve(PROJECTS_ROOT, name);
  return dir.startsWith(root) ? dir : null;
}

app.post("/api/projects/:name/open-vscode", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  exec(`code "${dir}"`, (err) => {
    if (err) {
      return res.status(500).json({ error: `failed to launch VS Code — is "code" on PATH? (${err.message})` });
    }
    res.json({ ok: true });
  });
});

// explorer.exe opening a folder just messages the already-running shell
// process to create the window — that window belongs to the shell, not to
// this spawned child, so Windows' focus-stealing prevention tends to leave
// it in the background (the request came from this unfocused Node process,
// not from something the user was just interacting with). Nudging it to the
// front via AppActivate is best-effort: the folder name is passed through an
// env var rather than interpolated into the command string, so it can't
// break out of the PowerShell script regardless of what characters it has.
function bringExplorerToFront(folderName) {
  if (process.platform !== "win32") return;
  setTimeout(() => {
    spawn(
      "powershell",
      ["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).AppActivate($env:DISPATCH_FOCUS_TARGET)"],
      { env: { ...process.env, DISPATCH_FOCUS_TARGET: folderName }, windowsHide: true }
    ).on("error", () => {}); // best-effort — a failed nudge shouldn't surface anywhere
  }, 400);
}

// explorer.exe exits non-zero even when it opens successfully, so success is
// judged by whether the process spawned at all, not by its exit code.
app.post("/api/projects/:name/open-explorer", (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  let responded = false;
  const child = spawn("explorer", [dir]);
  child.on("error", (err) => {
    if (responded) return;
    responded = true;
    res.status(500).json({ error: `failed to open File Explorer (${err.message})` });
  });
  child.on("spawn", () => {
    if (responded) return;
    responded = true;
    res.json({ ok: true });
    bringExplorerToFront(req.params.name);
  });
});

// explorer.exe exits non-zero even when it opens successfully, so success is
// judged by whether the process spawned at all, not by its exit code.
app.post("/api/open-projects-root", (req, res) => {
  let responded = false;
  const child = spawn("explorer", [PROJECTS_ROOT]);
  child.on("error", (err) => {
    if (responded) return;
    responded = true;
    res.status(500).json({ error: `failed to open File Explorer (${err.message})` });
  });
  child.on("spawn", () => {
    if (responded) return;
    responded = true;
    res.json({ ok: true });
  });
});

const server = app.listen(PORT, () => {
  console.log(`Dispatch running on http://localhost:${PORT}`);
});
server.on("upgrade", live.handleUpgrade);

// Logins and the registry live in the database, so without it nobody can log
// in (the login page says so) and the dashboard can't list projects. The API
// for files, git, journal and tasks still works, and agents post journal
// entries through it, so the failure is logged rather than stopping the server.
connectDatabase()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(`MongoDB connection failed: ${err.message}`));
