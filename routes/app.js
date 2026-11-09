const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const { APP_PAGES, ADMIN_PAGES } = require("../config/projects");
const { requireLogin, sameOrigin } = require("../middleware/auth");
const { skipOptions } = require("../middleware/options");
const { signIn, signOut, PASSWORD_MAX_LENGTH, UNAVAILABLE } = require("../services/auth");
const { PASSWORD_MIN_LENGTH, accountForToken, changed } = require("../services/accounts");
const { avatarFile } = require("../services/people");
const { listProjectFolders } = require("../services/registry");

// Dispatch's pages, mounted at /, and what they load. Each group has its own
// router, mounted at the end of this file in the order the groups answer in.

// ---- Vendor files: mounted apart, ahead of the body parsers and the login check

const vendorRoutes = express.Router();

// Preact, htm and signals, served as-is from node_modules: the pages load
// them as ES modules through the import map in views/app/index.ejs, with no build
// step. Only these files, so /vendor can't reach anything else in there.
const VENDOR_FILES = {
  "preact.mjs": "preact/dist/preact.mjs",
  "preact-hooks.mjs": "preact/hooks/dist/hooks.mjs",
  "htm.mjs": "htm/dist/htm.module.js",
  "signals-core.mjs": "@preact/signals-core/dist/signals-core.module.js",
  "signals.mjs": "@preact/signals/dist/signals.module.js",
};
vendorRoutes.get("/vendor/:file", (req, res, next) => {
  const file = VENDOR_FILES[req.params.file];
  if (!file) return next();
  res.type("application/javascript").sendFile(path.join(__dirname, "..", "node_modules", file));
});

// ---- Logging in and out

const WRONG_LOGIN = "Wrong email or password.";
const SUSPENDED = "This account is suspended. Ask an admin to restore it.";

// Only paths on this site, so ?next= can't send someone to another one.
const safeNext = (next) => (typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/");

function renderLogin(res, locals = {}, status = 200) {
  res.status(status).render("app/auth/login", { next: "/", email: "", error: "", passwordMaxLength: PASSWORD_MAX_LENGTH, ...locals });
}

const authRoutes = express.Router();

authRoutes.get("/login", (req, res) => {
  const next = safeNext(req.query.next);
  if (req.user) return res.redirect(next);
  renderLogin(res, { next });
});

// Only an email and a password: what someone can do comes from their account
// (admin) and memberships, never from anything they pick here.
authRoutes.post("/login", sameOrigin, async (req, res, next) => {
  const body = req.body || {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const locals = { next: safeNext(body.next), email };
  if (!req.session) return renderLogin(res, { ...locals, error: UNAVAILABLE }, 503);
  try {
    const usable = email && password && password.length <= PASSWORD_MAX_LENGTH;
    const user = usable ? await User.findOne({ email }).select("+passwordHash") : null;
    const ok = user ? await user.checkPassword(password) : await User.checkNobody(password);
    if (!ok) return renderLogin(res, { ...locals, error: WRONG_LOGIN }, 401);
    // Only someone with the right password learns the account is suspended.
    // (Invited accounts have no password yet, so they never get this far.)
    if (user.status !== "active") return renderLogin(res, { ...locals, error: SUSPENDED }, 403);
    await signIn(req, user);
    res.redirect(locals.next);
  } catch (err) {
    next(err);
  }
});

authRoutes.post("/logout", sameOrigin, async (req, res, next) => {
  try {
    await signOut(req, res);
    res.redirect("/login");
  } catch (err) {
    next(err);
  }
});

// ---- Password links

const LINK_GONE = "This link has expired or has already been used. Ask an admin for a new one.";

// The page shows the form for `account` ({ name, email, status }), or with
// none, `notice` alone: why there's nothing to set. No caching: the page is
// someone's way into their account.
function renderPassword(res, locals, status = 200) {
  res.set("Cache-Control", "no-store");
  res.status(status).render("app/auth/password", {
    account: null,
    notice: LINK_GONE,
    error: "",
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    ...locals,
  });
}

const passwordRoutes = express.Router();

passwordRoutes.get("/password/:token", async (req, res, next) => {
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
passwordRoutes.post("/password/:token", sameOrigin, async (req, res, next) => {
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

// ---- Profile pictures

const avatarRoutes = express.Router();

avatarRoutes.get("/avatars/:id", async (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  try {
    const user = await User.findById(req.params.id, { email: 1 }).lean();
    const file = user && avatarFile(user.email);
    if (!file) return res.sendStatus(404);
    res.sendFile(file, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    res.sendStatus(500);
  }
});

// ---- The pages themselves

const pageRoutes = express.Router();

// / opens the last project you had open, and /projects your first (old
// links, or the left menu before the page has your list), once the page has
// it. Like the project pages below, they're the same page: index.ejs reads
// the path and shows that one. An admin's only page is Users: they oversee
// the projects without working on them, so these and every project page send

// them there.
pageRoutes.get(["/", ...APP_PAGES.map((page) => `/${page}`)], requireLogin, (req, res) => {
  if (req.user.isAdmin) return res.redirect("/users");
  res.render("app/index");
});

// Admins' pages: /users, everyone's accounts (public/js/app/users.js).
pageRoutes.get(ADMIN_PAGES.map((page) => `/${page}`), requireLogin, (req, res) => {
  if (!req.user.isAdmin) return res.redirect("/");
  res.render("app/index");
});

// The port board was folded into the project list, which shows each port.
pageRoutes.get("/ports", (req, res) => res.redirect("/projects"));

// Each project has its own page at /<name>. It's the same page as the
// dashboard — index.ejs reads the path and renders that project — so a
// refresh, bookmark or new tab on a project's address lands back on it. A
// name with no folder (a typo, a removed project) still gets the page, with
// a 404 status, so it can say so beside the project list; a file name
// (favicon.ico) falls through to a plain 404. The login check comes first,
// so a logged-out visitor can't tell project names from typos.
function serveProjectPage(req, res, next) {
  const exists = listProjectFolders().includes(req.params.name);
  if (!exists && req.params.name.includes(".")) return next();
  if (req.user.isAdmin) return res.redirect("/users");
  if (exists) return res.render("app/index");
  res.status(404).render("app/index");
}

pageRoutes.get("/:name", requireLogin, serveProjectPage);

// Each of a project page's panels also has a page of its own at
// /<name>/<section> (PROJECT_SECTIONS in index.ejs), served the same way,
// and so does the header's Staff (STAFF_SECTION there).
const PROJECT_SECTIONS = ["explore", "tasks", "history", "journal", "staff"];

// The section is checked before the login, since two-part API addresses
// (/api/registry) match this route too and must go on to their own.
function onlySectionPages(req, res, next) {
  next(PROJECT_SECTIONS.includes(req.params.section) ? undefined : "route");
}

pageRoutes.get("/:name/:section", onlySectionPages, requireLogin, serveProjectPage);

const router = express.Router();
router.use(authRoutes);
router.use(passwordRoutes);
router.use(avatarRoutes);
router.use(skipOptions(pageRoutes));

vendorRoutes.routes = [{ method: "GET", path: "/vendor/:file", label: "Preact, htm and signals, from node_modules" }];
router.vendor = vendorRoutes;

router.routes = [
  { method: "GET", path: "/login", label: "Log in page" },
  { method: "POST", path: "/login", label: "Log in" },
  { method: "POST", path: "/logout", label: "Log out" },
  { method: "GET", path: "/password/:token", label: "A password link's page" },
  { method: "POST", path: "/password/:token", label: "Set the password and log in" },
  { method: "GET", path: "/avatars/:id", label: "A person's picture" },
  { method: "GET", path: "/", label: "Opens your last project" },
  { method: "GET", path: "/projects", label: "Opens your first project" },
  { method: "GET", path: "/people", label: "People" },
  { method: "GET", path: "/users", label: "Users, for admins" },
  { method: "GET", path: "/ports", label: "Old port board: goes to /projects" },
  { method: "GET", path: "/:name", label: "A project's page" },
  { method: "GET", path: "/:name/:section", label: "A project's panel: explore, tasks, history, journal or staff" },
];

module.exports = router;
