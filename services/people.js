// How people show up across Dispatch: a short display name, and a profile
// picture when one has been dropped into avatars/.
const fs = require("fs");
const path = require("path");
const User = require("../models/User");
const Membership = require("../models/Membership");
const { isOnline } = require("./auth");
const { listProjectFolders, resolveProjectDir } = require("./registry");

// Profile pictures live in avatars/ beside server.js, named after the
// account's email: michael@trifoldi.dev.jpg. The folder is git-ignored
// (people's photos stay off GitHub) and served only to logged-in users, by
// account id rather than email. No SVG: it can carry script.
const AVATARS_DIR = path.join(__dirname, "..", "avatars");
const AVATAR_TYPES = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
fs.mkdirSync(AVATARS_DIR, { recursive: true });

function avatarFile(email) {
  if (!email) return null;
  for (const ext of AVATAR_TYPES) {
    const file = path.join(AVATARS_DIR, email.toLowerCase() + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// An account's email changed: its picture is renamed to match, unless the
// new email already has one.
function moveAvatar(oldEmail, newEmail) {
  const file = avatarFile(oldEmail);
  if (!file || avatarFile(newEmail)) return;
  fs.renameSync(file, path.join(AVATARS_DIR, newEmail.toLowerCase() + path.extname(file)));
}

// The picture's address for a user ({ _id, email }), or null with none. Its
// ?v= changes with the file, so a replaced picture isn't served from cache.
function avatarUrl(user) {
  const file = user && avatarFile(user.email);
  if (!file) return null;
  return `/avatars/${user._id}?v=${Math.round(fs.statSync(file).mtimeMs)}`;
}

// "Michael Hart" -> "Michael H.": the first name and the last name's
// initial. A name of one word stays as it is.
function displayName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] || "";
  return `${words[0]} ${words[words.length - 1].charAt(0).toUpperCase()}.`;
}

// The roles that make someone staff, in the order they're listed. Clients are
// on a project too, but aren't staff.
const STAFF_ROLES = ["lead", "dev"];

// The staff of each of these projects, from their memberships, as a Map of
// project id -> [{ id, name, displayName, avatar, role, you, online }]: leads
// first, then devs, each by name. `you` marks the viewer, `online` whoever
// has Dispatch open (see isOnline), `avatar` their picture's address or null
// (see avatarUrl). A project with no one on it has no entry.
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

// Who a task or journal change is filed under: the logged-in user, named as
// they're shown across Dispatch and saved with the change, so it outlasts a
// deleted account. The older routes don't require a login yet, and the requests
// that come without one are agents', posting as each project's AGENTS.md says.
// Claude Code is the one agent with an account, and its X-Agent-Session header
// is saved, though not shown, to tell its sessions apart. Without that account
// (or with the database down, which these file-based routes otherwise don't
// need) they're just "Agent".
const AGENT_ACCOUNT_EMAIL = "claude@dispatch.test";
const AGENT_SESSION_RE = /^[\w-]{1,64}$/;

async function actorOf(req) {
  if (req.user) return { id: String(req.user._id), name: displayName(req.user.name) };
  const account = User.db.readyState === 1 ? await User.findOne({ email: AGENT_ACCOUNT_EMAIL }, { name: 1 }).lean() : null;
  const actor = account ? { id: String(account._id), name: displayName(account.name) } : { id: null, name: "Agent" };
  const session = req.get("x-agent-session");
  if (session && AGENT_SESSION_RE.test(session)) actor.session = session;
  return actor;
}

// [{ project (lean), role }] for the user: the projects they hold a
// membership on (Dispatch's own is in the database too). None for an admin,
// who oversees the projects rather than working on any, Dispatch's included.
async function projectsForUser(user) {
  if (user.isAdmin) return [];
  const memberships = await Membership.find({ user: user._id }).populate("project").lean();
  const byName = new Map();
  for (const { project, role } of memberships) {
    if (project) byName.set(project.name, { project, role });
  }
  return [...byName.values()].sort((a, b) => a.project.name.localeCompare(b.project.name));
}

// The projects whose tasks and journals count as the user's: their staff
// ones (clients aren't staff), with a folder to read them from.
async function staffProjectDirs(user) {
  const folders = new Set(listProjectFolders());
  return (await projectsForUser(user))
    .filter(({ project, role }) => role !== "client" && folders.has(project.name))
    .map(({ project }) => ({ name: project.name, dir: resolveProjectDir(project.name) }));
}

module.exports = {
  avatarUrl,
  moveAvatar,
  displayName,
  avatarFile,
  AVATARS_DIR,
  STAFF_ROLES,
  staffByProject,
  projectClients,
  actorOf,
  projectsForUser,
  staffProjectDirs,
};
