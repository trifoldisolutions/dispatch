const User = require("../models/User");

// Every project runs on localhost, and browsers share cookies across ports on
// one host, so a plain "sid" would be overwritten by any other local project
// that logs people in under that name. The prefix keeps Dispatch's apart.
const SESSION_COOKIE = "dispatch.sid";

// Longer passwords are refused without hashing, so a huge one can't tie up
// argon2. Mirrors the login page's password maxlength (views/app/auth/login.ejs).
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

const UNAVAILABLE = "Can't reach the database right now, so nobody can log in. Check that MongoDB is running, then try again.";

const run = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

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

// A new session id at login, so an id planted in the browser beforehand is
// worthless (session fixation).
async function signIn(req, user) {
  await run((cb) => req.session.regenerate(cb));
  req.session.userId = String(user._id);
  await run((cb) => req.session.save(cb));
}

// Told of each logout once it's done, with { sessionId, userId }: /live
// (live.js) closes the sockets that login opened in any tab, which would
// otherwise keep their user online.
const logoutListeners = [];
function onLogout(listener) {
  logoutListeners.push(listener);
}

// Logging out ends being online at once, not ONLINE_MS later: they're last
// seen just far enough back not to count. Another browser of theirs that's
// still logged in is seen again with its next request.
async function signOut(req, res) {
  const login = req.user && req.session ? { sessionId: req.sessionID, userId: String(req.user._id) } : null;
  if (req.user) await User.updateOne({ _id: req.user._id }, { $set: { lastSeenAt: new Date(Date.now() - ONLINE_MS) } });
  if (req.session) await run((cb) => req.session.destroy(cb));
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
  if (login) {
    for (const listener of logoutListeners) {
      try {
        listener(login);
      } catch {
        // the logout itself is done
      }
    }
  }
}

module.exports = {
  SESSION_COOKIE,
  PASSWORD_MAX_LENGTH,
  COOKIE_OPTIONS,
  SEEN_WRITE_MS,
  UNAVAILABLE,
  isOnline,
  recentlySeenUserIds,
  touchUsers,
  signIn,
  onLogout,
  signOut,
};
