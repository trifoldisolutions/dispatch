const crypto = require("crypto");
const mongoose = require("mongoose");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const User = require("../models/User");
const { SESSION_COOKIE, COOKIE_OPTIONS, SEEN_WRITE_MS } = require("../services/auth");

// Logins: an httpOnly cookie naming a server-side session in MongoDB
// (login_sessions) that holds only the user's id. loadUser turns it into
// req.user on every request, and res.locals.user for the pages.

const LOGIN_COLLECTION = "login_sessions";
const LOGIN_DAYS = 14; // counted from the last request: each one starts it over
const LOGIN_MS = LOGIN_DAYS * 24 * 60 * 60 * 1000;

const dbReady = () => mongoose.connection.readyState === 1;

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

// Pages only: a logged-out visitor is sent to the login page, which brings
// them back afterwards. The API doesn't check logins yet; that comes with the
// per-project permission checks, along with how agents post journal entries.
function requireLogin(req, res, next) {
  if (req.user) return next();
  res.redirect(req.originalUrl === "/" ? "/login" : `/login?next=${encodeURIComponent(req.originalUrl)}`);
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

function requireApiLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "log in first" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "log in first" });
  if (!req.user.isAdmin) return res.status(403).json({ error: "only admins can manage accounts" });
  next();
}

module.exports = {
  sessions,
  loadUser,
  requireLogin,
  sameOrigin,
  requireApiLogin,
  requireAdmin,
};
