// How people show up across Dispatch: a short display name, and a profile
// picture when one has been dropped into avatars/.
const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const User = require("./models/User");

// Profile pictures live in avatars/ beside server.js, named after the
// account's email: michael@trifoldi.dev.jpg. The folder is git-ignored
// (people's photos stay off GitHub) and served only to logged-in users, by
// account id rather than email. No SVG: it can carry script.
const AVATARS_DIR = path.join(__dirname, "avatars");
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

module.exports = { avatarUrl, moveAvatar, displayName, avatarRoutes, AVATARS_DIR };
