const express = require("express");
const mongoose = require("mongoose");
const User = require("./models/User");
const Membership = require("./models/Membership");
const { isOnline, signIn, sameOrigin, PASSWORD_MAX_LENGTH, UNAVAILABLE } = require("./auth");
const { avatarUrl, moveAvatar } = require("./people");

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
const LINK_GONE = "This link has expired or has already been used. Ask an admin for a new one.";
const USER_FIELDS = { name: 1, email: 1, isAdmin: 1, status: 1, lastSeenAt: 1, createdAt: 1, passwordLinkExpiresAt: 1 };

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "log in first" });
  if (!req.user.isAdmin) return res.status(403).json({ error: "only admins can manage accounts" });
  next();
}

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

// The page shows the form for `account` ({ name, email, status }), or with
// none, `notice` alone: why there's nothing to set. No caching: the page is
// someone's way into their account.
function renderPassword(res, locals, status = 200) {
  res.set("Cache-Control", "no-store");
  res.status(status).render("password", {
    account: null,
    notice: LINK_GONE,
    error: "",
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    ...locals,
  });
}

function createAccountRoutes({ live }) {
  const router = express.Router();

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

  // The account an /api/admin/users/:id address names, or null once a 404
  // has been sent.
  async function findAccount(req, res) {
    const user = mongoose.isValidObjectId(req.params.id) ? await User.findById(req.params.id).select("+passwordHash") : null;
    if (!user) res.status(404).json({ error: "no account with that id" });
    return user;
  }

  // Every account, whatever its status. `you` is the admin asking.
  router.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await User.find({}, USER_FIELDS).lean();
      res.json({ users: await describeUsers(users), you: String(req.user._id) });
    } catch (err) {
      res.status(500).json({ error: `failed to load accounts: ${err.message}` });
    }
  });

  // A new account: invited, with no password until its link sets one.
  router.post("/api/admin/users", sameOrigin, requireAdmin, async (req, res) => {
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
  router.patch("/api/admin/users/:id", sameOrigin, requireAdmin, async (req, res) => {
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
  router.post("/api/admin/users/:id/password-link", sameOrigin, requireAdmin, async (req, res) => {
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
  router.delete("/api/admin/users/:id", sameOrigin, requireAdmin, async (req, res) => {
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

  router.get("/password/:token", async (req, res, next) => {
    if (!req.session) return renderPassword(res, { notice: UNAVAILABLE }, 503);
    try {
      const account = await accountForToken(req.params.token);
      renderPassword(res, { account }, account ? 200 : 404);
    } catch (err) {
      next(err);
    }
  });

  // Sets the password, uses the link up and logs them in. The update only
  // goes through while the link is still the one that was checked, so two
  // tabs can't both use it.
  router.post("/password/:token", sameOrigin, async (req, res, next) => {
    if (!req.session) return renderPassword(res, { notice: UNAVAILABLE }, 503);
    try {
      const account = await accountForToken(req.params.token);
      if (!account) return renderPassword(res, {}, 404);
      const body = req.body || {};
      const password = typeof body.password === "string" ? body.password : "";
      const repeat = typeof body.confirm === "string" ? body.confirm : "";
      let error = "";
      if (password.length < PASSWORD_MIN_LENGTH) error = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
      else if (password.length > PASSWORD_MAX_LENGTH) error = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
      else if (password !== repeat) error = "The two passwords don't match.";
      if (error) return renderPassword(res, { account, error }, 400);
      const user = await User.findOneAndUpdate(
        { _id: account._id, passwordLinkHash: User.hashLinkToken(req.params.token), status: account.status },
        { $set: { passwordHash: await User.hashPassword(password), status: "active", passwordLinkHash: null, passwordLinkExpiresAt: null } },
        { returnDocument: "after" }
      );
      if (!user) return renderPassword(res, {}, 404);
      await signIn(req, user);
      changed();
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAccountRoutes, PASSWORD_MIN_LENGTH };
