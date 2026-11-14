const fs = require("fs");
const path = require("path");
const { spawn, exec } = require("child_process");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Membership = require("../models/Membership");
const Project = require("../models/Project");
const { PORT, PROJECTS_ROOT, SELF_PROJECT, RESERVED_NAMES, STAT_EXCLUDED_DIRS } = require("../config/projects");
const { requireApiLogin, requireAdmin, sameOrigin } = require("../middleware/auth");
const { skipOptions } = require("../middleware/options");
const live = require("../services/live");
const { isOnline } = require("../services/auth");
const { INVITE_MS, RESET_MS, USER_FIELDS, describeUsers, parseAccount, passwordLink, changed, projectNamesOf } = require("../services/accounts");
const { avatarUrl, moveAvatar, displayName, STAFF_ROLES, staffByProject, projectClients, actorOf, projectsForUser, staffProjectDirs } = require("../services/people");
const { readRegistry, writeRegistry, listProjectFolders, collectNames, validateRegistry, checkProjectTemplate, seedProjectFolder, hasLayoutRules, findAssignedEntry, syncEnvPort, syncAllEnvPorts, resolveProjectDir } = require("../services/registry");
const { JOURNAL_NOTE_MAX_LENGTH, findJournalPath, normalizeJournalFiles, parseJournal, todayDateOnly, addDaysDateOnly, withJournalAudit, appendJournalEntry, readProjectJournalSafe } = require("../services/journal");
const { DATE_ONLY_RE, findTasksPath, readTasks, parseTaskText, parseTaskPriority, urgentLimitRefusal, writeTasks, normalizeTagList, mergeKnownTags, generateTaskCode, readProjectTasksSafe, taskFigures } = require("../services/tasks");
const { ACTIVITY_DAYS, execAsync, recentCommits, parseGitPorcelain, COMMIT_MESSAGE_RELATIVE, readPendingCommitMessage, pendingCommitMessageMtime, GIT_LOG_FORMAT, parseGitLogLine, formatAutoCommitTimestamp } = require("../services/git");
const { latestMtimeMs, resolveTreeTarget, TREE_SEARCH_MAX_MATCHES, searchFileContent } = require("../services/explorer");
const { runningProjects, isPortServing, hasScript, killProcessTree, attachExitWatcher, findPidsListeningOnPort, runsSnapshot, bringExplorerToFront } = require("../services/processes");

// The JSON API, mounted at /api. Each group has its own router, mounted at the
// end of this file: the Users page's accounts, then everything else.

// ---- Accounts, for admins

const adminRoutes = express.Router();

// The account an /api/admin/users/:id address names, or null once a 404
// has been sent.
async function findAccount(req, res) {
  const user = mongoose.isValidObjectId(req.params.id) ? await User.findById(req.params.id).select("+passwordHash") : null;
  if (!user) res.status(404).json({ error: "no account with that id" });
  return user;
}

// Every account, whatever its status. `you` is the admin asking.
adminRoutes.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({}, USER_FIELDS).lean();
    res.json({ users: await describeUsers(users), you: String(req.user._id) });
  } catch (err) {
    res.status(500).json({ error: `failed to load accounts: ${err.message}` });
  }
});

// A new account: invited, with no password until its link sets one.
adminRoutes.post("/admin/users", sameOrigin, requireAdmin, async (req, res) => {
  const { error, fields } = parseAccount(req.body || {}, { creating: true });
  if (error) return res.status(400).json({ error });
  try {
    if (await User.exists({ email: fields.email })) return res.status(409).json({ error: `${fields.email} already has an account` });
    const user = new User({ ...fields, status: "invited" });
    const token = user.newPasswordLink(INVITE_MS);
    await user.save();
    changed();
    res.status(201).json({ user: (await describeUsers([user]))[0], link: passwordLink(req, user, token) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: `${fields.email} already has an account` });
    res.status(500).json({ error: `failed to create the account: ${err.message}` });
  }
});

// An edit: name, email, admin or not, and { suspended } to suspend or
// restore. A restored account is active again, or still invited if it never
// set a password. An admin can't suspend themselves or drop their own admin
// rights, so there's always an admin left to undo anything.
adminRoutes.patch("/admin/users/:id", sameOrigin, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const { error, fields } = parseAccount(body, { creating: false });
  if (error) return res.status(400).json({ error });
  if (body.suspended !== undefined && typeof body.suspended !== "boolean") {
    return res.status(400).json({ error: "suspended must be true or false" });
  }
  try {
    const user = await findAccount(req, res);
    if (!user) return;
    const self = String(user._id) === String(req.user._id);
    if (self && fields.isAdmin === false) return res.status(400).json({ error: "you can't remove your own admin rights; another admin can" });
    if (self && body.suspended === true) return res.status(400).json({ error: "you can't suspend your own account" });
    const oldEmail = user.email;
    if (fields.email && fields.email !== oldEmail && (await User.exists({ email: fields.email }))) {
      return res.status(409).json({ error: `${fields.email} already has an account` });
    }
    Object.assign(user, fields);
    if (body.suspended === true) user.status = "suspended";
    else if (body.suspended === false && user.status === "suspended") user.status = user.passwordHash ? "active" : "invited";
    await user.save();
    if (user.status === "suspended") live.accountClosed(user._id);
    if (user.email !== oldEmail) {
      try {
        moveAvatar(oldEmail, user.email);
      } catch {
        // the picture stays under the old email; the account is saved
      }
    }
    changed(await projectNamesOf(user));
    res.json({ user: (await describeUsers([user]))[0] });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: `${fields.email} already has an account` });
    res.status(500).json({ error: `failed to save the account: ${err.message}` });
  }
});

// A fresh link in place of any earlier one: the invite again for an
// invited account, else a password reset. The old password keeps working
// until the new one is set.
adminRoutes.post("/admin/users/:id/password-link", sameOrigin, requireAdmin, async (req, res) => {
  try {
    const user = await findAccount(req, res);
    if (!user) return;
    if (user.status === "suspended") return res.status(400).json({ error: "restore the account first: a suspended account's links don't work" });
    const token = user.newPasswordLink(user.status === "invited" ? INVITE_MS : RESET_MS);
    await user.save();
    changed();
    res.json({ user: (await describeUsers([user]))[0], link: passwordLink(req, user, token) });
  } catch (err) {
    res.status(500).json({ error: `failed to make a link: ${err.message}` });
  }
});

// The account and every project membership it held. Not their own: an
// admin can't delete themselves.
adminRoutes.delete("/admin/users/:id", sameOrigin, requireAdmin, async (req, res) => {
  try {
    const user = await findAccount(req, res);
    if (!user) return;
    if (String(user._id) === String(req.user._id)) return res.status(400).json({ error: "you can't delete your own account" });
    const projects = await projectNamesOf(user);
    await Membership.deleteMany({ user: user._id });
    await User.deleteOne({ _id: user._id });
    live.accountClosed(user._id);
    changed(projects);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `failed to delete the account: ${err.message}` });
  }
});

// ---- Projects, their files and the logged-in user's views

const projectRoutes = express.Router();

const ACTIVITY_LIMIT = 40;
const COMMIT_LIMIT = 30;
const PEOPLE_SHOWN = 5; // at most, in the side column's People and each search's results (fewer when they'd make it scroll)

projectRoutes.get("/registry", async (req, res) => {
  try {
    res.json(await readRegistry());
  } catch (err) {
    res.status(500).json({ error: `failed to read registry: ${err.message}` });
  }
});

// A project's staff (see staffByProject) and clients, for its header. These
// are people's details, so unlike the rest of the API (for now) it needs a
// login. A project with no record yet simply has no one on it.
projectRoutes.get("/projects/:name/staff", async (req, res) => {
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

// ---- The logged-in user's own views (the project list, the side column) ---
// These need a login and only ever show the user's own projects: those they
// hold a membership on, and none for an admin. Agents don't use them,
// so unlike the rest of the API they can check permissions already.

// The Projects page's list: each project with the user's role on it, its
// staff, its place in the registry, and its task figures. Running/listening
// comes from /api/running-projects and /api/port-status (and /live) like
// everywhere else.
projectRoutes.get("/me/projects", requireApiLogin, async (req, res) => {
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
        hasLayoutRules: !dir || hasLayoutRules(dir),
        tasks: taskFigures(dir ? readProjectTasksSafe(dir) : [], today),
        lastActivity: lastEntry ? { date: lastDay.date, time: lastEntry.time, content: lastEntry.content } : null,
      };
    });
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: `failed to load your projects: ${err.message}` });
  }
});

// Open tasks across the user's projects, overdue and soonest due first, then
// undated ones newest first: the side column's Your tasks, which leaves out
// the project showing beside it. Tasks have no assignee yet, so "yours"
// means on your projects.
projectRoutes.get("/me/tasks", requireApiLogin, async (req, res) => {
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

// The commit messages waiting for a push on the user's projects, the one
// written last first: the side column's Ready to push. Each project's agents
// keep its message up to date as they journal, and its Push commits with it
// and deletes it (see git-push), so each one here is work not pushed yet.
projectRoutes.get("/me/pushes", requireApiLogin, async (req, res) => {
  try {
    const pushes = [];
    for (const { name, dir } of await staffProjectDirs(req.user)) {
      const message = readPendingCommitMessage(dir);
      const mtime = message && pendingCommitMessageMtime(dir);
      if (!mtime) continue;
      const [summary, ...body] = message.split("\n");
      pushes.push({ project: name, summary, body: body.join("\n").trim(), updatedAt: new Date(mtime).toISOString() });
    }
    pushes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ pushes });
  } catch (err) {
    res.status(500).json({ error: `failed to load commit messages: ${err.message}` });
  }
});

// What happened lately on the user's projects: journal entries and commits
// from the last ACTIVITY_DAYS, newest first. Nothing shows it since Home
// went; it's kept for the activity page to come.
projectRoutes.get("/me/activity", requireApiLogin, async (req, res) => {
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
// the user's own projects they could be added to, never any for a client or
// an admin.
// `leading` lists the projects the user leads that aren't finished, where
// Add to project can put someone: empty for anyone who isn't a lead, who
// then doesn't get the button. `seesClients` says whether the role filter
// offers Clients.
projectRoutes.get("/me/people", requireApiLogin, async (req, res) => {
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
          addTo: isClient || user.isAdmin ? [] : leading.filter((project) => !onProject.has(String(project._id))).map((project) => project.name),
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
// one role per person per project, a client can't be made a developer, and
// an admin oversees projects without joining them.
projectRoutes.post("/projects/:name/staff", requireApiLogin, async (req, res) => {
  try {
    const project = await Project.findOne({ name: req.params.name }, { name: 1, status: 1 }).lean();
    if (!project) return res.status(404).json({ error: `no project named "${req.params.name}"` });
    if (!(await Membership.exists({ user: req.user._id, project: project._id, role: "lead" }))) {
      return res.status(403).json({ error: `only ${project.name}'s leads can add people to it` });
    }
    if (project.status === "finished") return res.status(400).json({ error: `${project.name} is finished` });
    const userId = String((req.body && req.body.userId) || "");
    const user = /^[a-f0-9]{24}$/i.test(userId) ? await User.findOne({ _id: userId, status: "active" }, { name: 1, isAdmin: 1 }).lean() : null;
    if (!user) return res.status(404).json({ error: "no active account with that id" });
    if (user.isAdmin) return res.status(400).json({ error: `${user.name} is an admin: admins oversee projects rather than join them` });
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

projectRoutes.get("/port-status", async (req, res) => {
  const raw = String(req.query.ports || "");
  const ports = [...new Set(raw.split(",").map((p) => p.trim()).filter(Boolean))];
  if (ports.some((p) => !/^\d+$/.test(p))) {
    return res.status(400).json({ error: "ports must be a comma-separated list of positive integers" });
  }
  const results = await Promise.all(ports.map(async (p) => [p, await isPortServing(Number(p))]));
  res.json(Object.fromEntries(results));
});

projectRoutes.get("/project-folders", (req, res) => {
  try {
    res.json(listProjectFolders());
  } catch (err) {
    res.status(500).json({ error: `failed to list project folders: ${err.message}` });
  }
});

projectRoutes.get("/project-folders/:name/stat", (req, res) => {
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

// Lists the immediate children of a project folder (or a subfolder within
// it, via ?subpath=), one level at a time — the Explorer tab fetches deeper
// levels lazily as the user expands them, so this never walks the whole
// tree (which would be slow/pointless for something like node_modules).
projectRoutes.get("/project-folders/:name/tree", (req, res) => {
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

// The Explorer's search, as relative paths with forward slashes: every file
// and folder whose name holds all of ?q='s words (any case, any order —
// `nameMatch`), and every file whose contents hold ?q= itself (any case),
// with its first matching lines (see searchFileContent). Contents need the
// whole phrase, since nearly every word turns up somewhere in a big file.
// Walked breadth first, so when it stops at TREE_SEARCH_MAX_MATCHES
// (`truncated`) the shallower matches are the ones kept.
// STAT_EXCLUDED_DIRS can match by name but aren't looked inside, and
// symlinks are neither followed nor read, so a link loop can't trap the walk.
projectRoutes.get("/project-folders/:name/tree/search", (req, res) => {
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
projectRoutes.get("/project-folders/:name/tree/counts", (req, res) => {
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
projectRoutes.delete("/project-folders/:name/tree", (req, res) => {
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

// Every changed/untracked/ignored path in a project, so the Explorer can
// color-code rows the way VS Code's git decorations do — without VS Code, by
// just asking git directly. `--ignored` (without "=matching") reports a
// wholly-ignored/untracked directory as a single entry rather than walking
// its contents, so this stays cheap even with a huge ignored node_modules.
projectRoutes.get("/project-folders/:name/git-status", (req, res) => {
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

// The History panel's data: the latest commit, when it was last pushed, and
// the commit message waiting for the next push (null when there's none).
// "Last push" isn't something git tracks directly, so it's inferred from the
// upstream remote-tracking branch's reflog — a `git push` from this machine
// is the only thing that writes an "update by push" entry there, which is a
// more reliable signal than assuming push time == commit time (you can
// commit offline and push later). Any piece that doesn't apply (no commits
// yet, no upstream configured, no reflog history) just comes back null.
projectRoutes.get("/project-folders/:name/git-history", async (req, res) => {
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

// The History panel's "Push" button: stages everything (except the pending
// commit message itself), commits if anything got staged, then pushes to the
// current branch's upstream. No commit-message prompt — the commit uses the
// message the project's agents keep in COMMIT_MESSAGE_RELATIVE, and only
// falls back to an auto-generated "Auto-commit: <timestamp>" when there
// isn't one. Once that message is in a commit the file is deleted, so the
// next journal entry starts the next push's message fresh.
projectRoutes.post("/project-folders/:name/git-push", async (req, res) => {
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
    live.pushesChanged();
  }

  try {
    await git("push");
  } catch (err) {
    return res.status(500).json({ error: `git push failed: ${(err.stderr || err.message).trim()}`, committed });
  }

  res.json({ ok: true, committed });
});

projectRoutes.get("/project-folders/:name/journal", (req, res) => {
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

projectRoutes.post("/project-folders/:name/journal", async (req, res) => {
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
    const updated = appendJournalEntry(journalPath, content, await actorOf(req), files);
    res.json({ days: withJournalAudit(parseJournal(updated), journalPath) });
    live.projectChanged(req.params.name, "journal");
  } catch (err) {
    res.status(500).json({ error: `failed to update journal: ${err.message}` });
  }
});

projectRoutes.get("/project-folders/:name/tasks", (req, res) => {
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

projectRoutes.post("/project-folders/:name/tasks", async (req, res) => {
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
  const priority = parseTaskPriority(req.body);
  if (priority.error) return res.status(400).json({ error: priority.error });
  const taskTags = normalizeTagList(req.body.tags);
  try {
    const by = await actorOf(req); // before the read: a wait between it and the write could lose another request's change
    const tasksPath = findTasksPath(dir);
    const data = readTasks(tasksPath);
    const now = new Date().toISOString();
    const id = generateTaskCode(new Set(data.tasks.map((t) => t.id)));
    mergeKnownTags(data.tags, taskTags);
    const task = {
      id,
      title: text.title,
      description: text.description || "",
      done: false,
      doneAt: null,
      doneBy: null,
      archived: false,
      archivedAt: null,
      archivedBy: null,
      dueDate: dueDateRaw || null,
      priority: priority.priority || null,
      tags: taskTags,
      createdAt: now,
      createdBy: by,
      updatedAt: now,
      updatedBy: by,
    };
    const refusal = urgentLimitRefusal(data.tasks, task);
    if (refusal) return res.status(409).json(refusal);
    data.tasks.unshift(task);
    writeTasks(tasksPath, data);
    res.json({ tasks: data.tasks, tags: data.tags });
    live.projectChanged(req.params.name, "tasks");
  } catch (err) {
    res.status(500).json({ error: `failed to update tasks: ${err.message}` });
  }
});

// Partial update: `done`/`archived` flip the checkbox/archive button,
// `title`/`description` rewrite the task's own text (a title can't be
// emptied, a description can), `dueDate` and `priority` set or clear (null or
// "") its due date and priority, and `tags` replaces its tag list wholesale (any new tag name in it is
// merged onto the project's known tags) — any subset can be sent at once, as
// the composer does when saving an edit. Flipping `done`/`archived` on stamps
// `doneAt`/`archivedAt` with the time and `doneBy`/`archivedBy` with who did it
// (see actorOf), and flipping it off clears both; sending the value a task
// already has leaves its stamps alone. Tasks done or archived before these
// stamps existed have none, and tasks from before logins have no `createdBy`.
// A change that would leave the task open and urgent past the project's limit
// is refused with a 409 and nothing is saved (urgentLimitRefusal), as is
// adding such a task above.
projectRoutes.patch("/project-folders/:name/tasks/:id", async (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ error: `project folder "${req.params.name}" not found` });
  }
  try {
    const by = await actorOf(req); // before the read, as in the POST above
    const tasksPath = findTasksPath(dir);
    const data = readTasks(tasksPath);
    const id = req.params.id.toUpperCase(); // codes are always stored/shown uppercase; matching is case-insensitive
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return res.status(404).json({ error: "task not found" });
    const before = { ...task };
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
    const priority = parseTaskPriority(req.body);
    if (priority.error) return res.status(400).json({ error: priority.error });
    if ("priority" in priority) task.priority = priority.priority;
    if (Array.isArray(req.body.tags)) {
      const taskTags = normalizeTagList(req.body.tags);
      mergeKnownTags(data.tags, taskTags);
      task.tags = taskTags;
    }
    const now = new Date().toISOString();
    if (typeof req.body.done === "boolean" && req.body.done !== task.done) {
      task.done = req.body.done;
      task.doneAt = task.done ? now : null;
      task.doneBy = task.done ? by : null;
    }
    if (typeof req.body.archived === "boolean" && req.body.archived !== task.archived) {
      task.archived = req.body.archived;
      task.archivedAt = task.archived ? now : null;
      task.archivedBy = task.archived ? by : null;
    }
    const refusal = urgentLimitRefusal(data.tasks, task, before);
    if (refusal) return res.status(409).json(refusal);
    task.updatedAt = now;
    task.updatedBy = by;
    writeTasks(tasksPath, data);
    res.json({ tasks: data.tasks, tags: data.tags });
    live.projectChanged(req.params.name, "tasks");
  } catch (err) {
    res.status(500).json({ error: `failed to update tasks: ${err.message}` });
  }
});

projectRoutes.delete("/project-folders/:name/tasks/:id", (req, res) => {
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

projectRoutes.get("/projects-root", (req, res) => {
  res.json({ path: PROJECTS_ROOT });
});

projectRoutes.post("/project-folders/:name", async (req, res) => {
  const dir = resolveProjectDir(req.params.name);
  if (!dir) return res.status(400).json({ error: `invalid project name "${req.params.name}"` });
  if (RESERVED_NAMES.has(req.params.name.toLowerCase())) {
    return res.status(400).json({ error: `"${req.params.name}" is one of Dispatch's own addresses; pick another name` });
  }
  if (fs.existsSync(dir)) return res.status(409).json({ error: `"${req.params.name}" already exists` });
  try {
    const by = await actorOf(req);
    checkProjectTemplate(); // before the folder exists, so a refusal leaves nothing behind
    fs.mkdirSync(dir);
    seedProjectFolder(dir, req.params.name);
    appendJournalEntry(findJournalPath(dir), "Project was created", by);
    res.json({ ok: true });
    live.registryChanged();
  } catch (err) {
    res.status(500).json({ error: `failed to create project folder: ${err.message}` });
  }
});

projectRoutes.delete("/project-folders/:name", (req, res) => {
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

projectRoutes.put("/registry", async (req, res) => {
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
    // Any name that's newly tracked (not just newly assigned a port —
    // moving from unassigned to a category doesn't count) gets the starter
    // files it might be missing, whether its folder was just created or
    // already existed on disk. So the template is checked before saving, and
    // only then: without it a project can't be added, but the rest still can.
    const newNames = [...collectNames(req.body)].filter((name) => !existingNames.has(name));
    if (newNames.length > 0) checkProjectTemplate();
    await writeRegistry(req.body);
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

projectRoutes.post("/projects/:name/start", async (req, res) => {
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

projectRoutes.post("/projects/:name/stop", async (req, res) => {
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

projectRoutes.get("/running-projects", (req, res) => {
  res.json(runsSnapshot());
});

projectRoutes.post("/projects/:name/open-vscode", (req, res) => {
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

// explorer.exe exits non-zero even when it opens successfully, so success is
// judged by whether the process spawned at all, not by its exit code.
projectRoutes.post("/projects/:name/open-explorer", (req, res) => {
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
projectRoutes.post("/open-projects-root", (req, res) => {
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

const router = express.Router();
router.use(adminRoutes);
router.use(skipOptions(projectRoutes));

router.routes = [
  { method: "GET", path: "/admin/users", label: "Every account, for admins" },
  { method: "POST", path: "/admin/users", label: "New account and its invite link" },
  { method: "PATCH", path: "/admin/users/:id", label: "Edit, suspend or restore an account" },
  { method: "POST", path: "/admin/users/:id/password-link", label: "A fresh invite or reset link" },
  { method: "DELETE", path: "/admin/users/:id", label: "Delete an account" },
  { method: "GET", path: "/registry", label: "The registry: projects by category and port" },
  { method: "GET", path: "/projects/:name/staff", label: "A project's staff and clients" },
  { method: "GET", path: "/me/projects", label: "Your projects" },
  { method: "GET", path: "/me/tasks", label: "Your open tasks" },
  { method: "GET", path: "/me/pushes", label: "Commit messages waiting for a push" },
  { method: "GET", path: "/me/activity", label: "Recent journal entries and commits" },
  { method: "GET", path: "/me/people", label: "The people you work with, or a search" },
  { method: "POST", path: "/projects/:name/staff", label: "Add a developer to a project" },
  { method: "GET", path: "/port-status", label: "Which ports answer" },
  { method: "GET", path: "/project-folders", label: "Folders in the projects folder" },
  { method: "GET", path: "/project-folders/:name/stat", label: "A project folder's dates" },
  { method: "GET", path: "/project-folders/:name/tree", label: "One level of a project's files" },
  { method: "GET", path: "/project-folders/:name/tree/search", label: "Search a project's file names and contents" },
  { method: "GET", path: "/project-folders/:name/tree/counts", label: "How many folders and files" },
  { method: "DELETE", path: "/project-folders/:name/tree", label: "Delete a file or folder in a project" },
  { method: "GET", path: "/project-folders/:name/git-status", label: "Changed files, from git" },
  { method: "GET", path: "/project-folders/:name/git-history", label: "Last commit, last push, pending message" },
  { method: "POST", path: "/project-folders/:name/git-push", label: "Commit everything and push" },
  { method: "GET", path: "/project-folders/:name/journal", label: "A project's journal" },
  { method: "POST", path: "/project-folders/:name/journal", label: "Add a journal entry" },
  { method: "GET", path: "/project-folders/:name/tasks", label: "A project's tasks" },
  { method: "POST", path: "/project-folders/:name/tasks", label: "Add a task" },
  { method: "PATCH", path: "/project-folders/:name/tasks/:id", label: "Change a task" },
  { method: "DELETE", path: "/project-folders/:name/tasks/:id", label: "Delete a task" },
  { method: "GET", path: "/projects-root", label: "The projects folder's path" },
  { method: "POST", path: "/project-folders/:name", label: "Create a project folder" },
  { method: "DELETE", path: "/project-folders/:name", label: "Delete a project folder" },
  { method: "PUT", path: "/registry", label: "Save the registry" },
  { method: "POST", path: "/projects/:name/start", label: "Start a project" },
  { method: "POST", path: "/projects/:name/stop", label: "Stop a project" },
  { method: "GET", path: "/running-projects", label: "What Dispatch started" },
  { method: "POST", path: "/projects/:name/open-vscode", label: "Open a project in VS Code" },
  { method: "POST", path: "/projects/:name/open-explorer", label: "Open a project in File Explorer" },
  { method: "POST", path: "/open-projects-root", label: "Open the projects folder in File Explorer" },
];

module.exports = router;
