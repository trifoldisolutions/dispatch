const crypto = require("crypto");
const mongoose = require("mongoose");
const argon2 = require("argon2");

const { Schema } = mongoose;

// invited: has an invite link but no password yet. suspended: can't log in.
const USER_STATUSES = ["invited", "active", "suspended"];

// A person's role on each project lives in their memberships. Admin is the
// one role that isn't per project, since an admin sees every project.
const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, default: null, select: false }, // argon2id; null until the invite link sets it
    // A one-time link to set a password (see newPasswordLink): only its
    // token's hash is kept, so the link itself can't be read back.
    passwordLinkHash: { type: String, default: null, select: false },
    passwordLinkExpiresAt: { type: Date, default: null },
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: USER_STATUSES, default: "invited" },
    lastSeenAt: { type: Date, default: null }, // their last request while logged in, kept to within SEEN_WRITE_MS (auth.js)
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.passwordLinkHash;
        return ret;
      },
    },
  }
);

UserSchema.index({ passwordLinkHash: 1 }); // a link's page finds its account by it

UserSchema.statics.hashPassword = (password) => argon2.hash(password);

UserSchema.statics.hashLinkToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

// A new one-time link for this account, valid for `ms`: the invite for an
// account with no password yet, else a reset. It replaces any earlier one.
// Returns the token for the link's address; the caller saves the user.
UserSchema.methods.newPasswordLink = function newPasswordLink(ms) {
  const token = crypto.randomBytes(32).toString("base64url");
  this.passwordLinkHash = this.constructor.hashLinkToken(token);
  this.passwordLinkExpiresAt = new Date(Date.now() + ms);
  return token;
};

// False for a wrong password, a hash argon2 can't read, and an account with
// no password yet (invited), which is still checked against the decoy so it
// takes as long as any other login.
UserSchema.methods.checkPassword = function checkPassword(password) {
  if (!this.passwordHash) return this.constructor.checkNobody(password);
  return argon2.verify(this.passwordHash, password).catch(() => false);
};

// A login with an email that has no account still verifies the password
// against a decoy hash, so the answer takes as long as for a real account and
// doesn't reveal which emails exist.
let decoyHash = null;
UserSchema.statics.checkNobody = async function checkNobody(password) {
  decoyHash ||= argon2.hash(crypto.randomBytes(16).toString("hex"));
  await argon2.verify(await decoyHash, password).catch(() => false);
  return false;
};

module.exports = mongoose.model("User", UserSchema);
