const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const User = require("./models/User");

// Logins: an httpOnly cookie naming a server-side session in MongoDB
// (login_sessions) that holds only the user's id. loadUser turns it into
// req.user on every request, and res.locals.user for the pages.

// Every project runs on localhost, and browsers share cookies across ports on
// one host, so a plain "sid" would be overwritten by any other local project
// that logs people in under that name. The prefix keeps Dispatch's apart.
const SESSION_COOKIE = "dispatch.sid";
const LOGIN_COLLECTION = "login_sessions";
const LOGIN_DAYS = 14; // counted from the last request: each one starts it over
const LOGIN_MS = LOGIN_DAYS * 24 * 60 * 60 * 1000;
// Longer passwords are refused without hashing, so a huge one can't tie up
// argon2. Mirrors the login page's password maxlength (views/login.ejs).
const PASSWORD_MAX_LENGTH = 200;
// Only over HTTPS once live (which also needs Express to trust the proxy in
// front); locally Dispatch is plain http and the cookie must still be sent.
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };

// Someone counts as online (the staff cards' green dot) while Dispatch has
// heard from them in the last ONLINE_MS: an open dashboard asks the server
// something every 5 seconds, or about once a minute from a background tab.
// Their lastSeenAt is written at most once every SEEN_WRITE_MS, so those polls
// don't each cost a write.
const ONLINE_MS = 2 * 60 * 1000;
const SEEN_WRITE_MS = 30 * 1000;

const WRONG_LOGIN = "Wrong email or password.";
const SUSPENDED = "This account is suspended. Ask an admin to restore it.";
const UNAVAILABLE = "Can't reach the database right now, so nobody can log in. Check that MongoDB is running, then try again.";

const dbReady = () => mongoose.connection.readyState === 1;
const run = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

// A dropped connection (the computer waking from sleep, mongod restarting) is
// back within seconds. A request arriving meanwhile waits for it, up to
// DB_WAIT_MS, instead of being treated as logged out.
const DB_WAIT_MS = 3000;
async function waitForDb() {
  for (const end = Date.now() + DB_WAIT_MS; !dbReady() && Date.now() < end; ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  console.warn("SESSION_SECRET is not set (see .env.example): everyone is logged out on each restart.");
  return crypto.randomBytes(32).toString("hex");
}

// The store needs a connected client, so it's made on the first request after
// MongoDB connects. While the database is down there's no req.session: nobody
// is logged in, and the login page says why.
let sessionMiddleware = null;
function createSessionMiddleware() {
  return session({
    name: SESSION_COOKIE,
    secret: sessionSecret(),
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      dbName: mongoose.connection.name,
      collectionName: LOGIN_COLLECTION,
      ttl: LOGIN_MS / 1000,
      // Seconds: an unchanged session is written back (its expiry pushed) at
      // most once an hour, not on every one of the dashboard's polls.
      touchAfter: 60 * 60,
    }),
    resave: false,
    saveUninitialized: false, // no session, and no cookie, until someone logs in
    rolling: true,
    cookie: { ...COOKIE_OPTIONS, maxAge: LOGIN_MS },
  });
}

async function sessions(req, res, next) {
  if (!dbReady()) await waitForDb();
  if (!dbReady()) return next();
  try {
    sessionMiddleware ||= createSessionMiddleware();
  } catch (err) {
    return next(err);
  }
  sessionMiddleware(req, res, next);
}

// req.user for routes and res.locals.user for pages: { _id, name, email,
// isAdmin, lastSeenAt }, or null. Only active accounts count, so suspending
// or deleting someone logs them out on their next request. Each request also
// counts as being seen (see ONLINE_MS).
async function loadUser(req, res, next) {
  req.user = null;
  const id = req.session?.userId;
  if (id) {
    try {
      req.user = await User.findOne({ _id: id, status: "active" }, { name: 1, email: 1, isAdmin: 1, lastSeenAt: 1 }).lean();
      if (req.user && (!req.user.lastSeenAt || Date.now() - req.user.lastSeenAt >= SEEN_WRITE_MS)) {
        req.user.lastSeenAt = new Date();
        await User.updateOne({ _id: req.user._id }, { $set: { lastSeenAt: req.user.lastSeenAt } });
      }
    } catch (err) {
      return next(err);
    }
    if (!req.user) delete req.session.userId;
  }
  res.locals.user = req.user;
  next();
}

function isOnline(user) {
  return !!user.lastSeenAt && Date.now() - user.lastSeenAt < ONLINE_MS;
}

// For /live (live.js): the ids of active users seen within ONLINE_MS, and a
// way to count users with a page open as seen, since an open page there no
// longer polls the server.
async function recentlySeenUserIds() {
  const since = new Date(Date.now() - ONLINE_MS);
  const users = await User.find({ lastSeenAt: { $gt: since }, status: "active" }, { _id: 1 }).lean();
  return users.map((user) => String(user._id));
}

async function touchUsers(ids) {
  if (ids.length === 0) return;
  await User.updateMany({ _id: { $in: ids }, status: "active" }, { $set: { lastSeenAt: new Date() } });
}

// Pages only: a logged-out visitor is sent to the login page, which brings
// them back afterwards. The API doesn't check logins yet; that comes with the
// per-project permission checks, along with how agents post journal entries.
function requireLogin(req, res, next) {
  if (req.user) return next();
  res.redirect(req.originalUrl === "/" ? "/login" : `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// A new session id at login, so an id planted in the browser beforehand is
// worthless (session fixation).
async function signIn(req, user) {
  await run((cb) => req.session.regenerate(cb));
  req.session.userId = String(user._id);
  await run((cb) => req.session.save(cb));
}

// Logging out ends being online at once, not ONLINE_MS later. Another
// browser of theirs that's still logged in is seen again with its next
// request.
async function signOut(req, res) {
  if (req.user) await User.updateOne({ _id: req.user._id }, { $set: { lastSeenAt: null } });
  if (req.session) await run((cb) => req.session.destroy(cb));
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// Login and logout must be posted from Dispatch's own pages. Otherwise another
// site, or another local project on a different port, could log a visitor in
// to an account it controls (login CSRF) or log them out. Browsers send
// Sec-Fetch-Site, or at least Origin; a request with neither carries no
// visitor's cookies.
function sameOrigin(req, res, next) {
  const site = req.get("sec-fetch-site");
  const origin = req.get("origin");
  const ok = site ? site === "same-origin" || site === "none" : !origin || hostOf(origin) === req.get("host");
  if (!ok) return res.status(403).send("Cross-site request refused");
  next();
}

// Only paths on this site, so ?next= can't send someone to another one.
const safeNext = (next) => (typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/");

function renderLogin(res, locals = {}, status = 200) {
  res.status(status).render("login", { next: "/", email: "", error: "", passwordMaxLength: PASSWORD_MAX_LENGTH, ...locals });
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

module.exports = { sessions, loadUser, requireLogin, isOnline, recentlySeenUserIds, touchUsers, authRoutes };
