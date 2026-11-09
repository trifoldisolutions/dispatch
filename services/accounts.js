const User = require("../models/User");
const Membership = require("../models/Membership");
const { isOnline } = require("./auth");
const { avatarUrl } = require("./people");
const live = require("./live");

// Accounts: what admins manage on the Users page (public/js/app/users.js)
// through /api/admin/users, and the one-time links they hand out. A link's
// page (/password/<token>) is where someone sets their password: the invite
// for a new account, or a reset for one that has a password. There's no
// sign-up: every account comes from an admin. Dispatch doesn't send email
// yet, so the admin is shown the link and passes it on.

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 10;
const NAME_MAX_LENGTH = 80; // models/User.js
const EMAIL_MAX_LENGTH = 254;
// Plain addresses only: pictures are files named after the email (people.js),
// so no slashes or other path characters can get in.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const ROLE_ORDER = ["lead", "dev", "client"];
const USER_FIELDS = { name: 1, email: 1, isAdmin: 1, status: 1, lastSeenAt: 1, createdAt: 1, passwordLinkExpiresAt: 1 };

// What the Users page shows of each account: who they are, each project
// they're on with their role there (leads first), and where the account
// stands. linkExpiresAt is its unused password link's, past or not, or null.
async function describeUsers(users) {
  const memberships = await Membership.find({ user: { $in: users.map((user) => user._id) } }, { user: 1, project: 1, role: 1 })
    .populate("project", { name: 1 })
    .lean();
  const projectsOf = new Map();
  for (const { user, project, role } of memberships) {
    if (!project) continue; // the project was removed since
    const key = String(user);
    if (!projectsOf.has(key)) projectsOf.set(key, []);
    projectsOf.get(key).push({ name: project.name, role });
  }
  return users.map((user) => ({
    id: String(user._id),
    name: user.name,
    email: user.email,
    avatar: avatarUrl(user),
    isAdmin: !!user.isAdmin,
    status: user.status,
    online: user.status === "active" && isOnline(user),
    lastSeenAt: user.lastSeenAt || null,
    createdAt: user.createdAt || null,
    linkExpiresAt: user.passwordLinkExpiresAt || null,
    projects: (projectsOf.get(String(user._id)) || []).sort(
      (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name)
    ),
  }));
}

// The name, email and admin flag from a request body, cleaned. An edit
// leaves out what it doesn't change; a new account needs a name and email.
// Returns { error } or { fields }.
function parseAccount(body, { creating }) {
  const fields = {};
  if (creating || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return { error: "a name is required" };
    if (name.length > NAME_MAX_LENGTH) return { error: `names are limited to ${NAME_MAX_LENGTH} characters` };
    fields.name = name;
  }
  if (creating || body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) return { error: "that isn't an email address Dispatch accepts" };
    fields.email = email;
  }
  if (body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean") return { error: "isAdmin must be true or false" };
    fields.isAdmin = body.isAdmin;
  }
  return { fields };
}

// The link's address on whichever Dispatch the admin is using. Once live
// behind a proxy, Express has to trust it for req.protocol to say https.
function passwordLink(req, user, token) {
  return {
    url: `${req.protocol}://${req.get("host")}/password/${token}`,
    expiresAt: user.passwordLinkExpiresAt,
    kind: user.status === "invited" ? "invite" : "reset",
  };
}

// The account a link opens while the link is good: not used yet, not past
// its time, and the account not suspended.
function accountForToken(token) {
  if (typeof token !== "string" || token.length > 100) return null;
  return User.findOne(
    { passwordLinkHash: User.hashLinkToken(token), passwordLinkExpiresAt: { $gt: new Date() }, status: { $in: ["invited", "active"] } },
    { name: 1, email: 1, status: 1 }
  ).lean();
}

// Open pages catch up: every People list and Users page, and the header's
// staff and clients on each of these projects.
function changed(projectNames = []) {
  for (const name of new Set(projectNames)) live.projectChanged(name, "staff");
  live.peopleChanged();
}

async function projectNamesOf(user) {
  const memberships = await Membership.find({ user: user._id }, { project: 1 }).populate("project", { name: 1 }).lean();
  return memberships.map(({ project }) => project && project.name).filter(Boolean);
}

module.exports = {
  INVITE_MS,
  RESET_MS,
  PASSWORD_MIN_LENGTH,
  USER_FIELDS,
  describeUsers,
  parseAccount,
  passwordLink,
  accountForToken,
  changed,
  projectNamesOf,
};
