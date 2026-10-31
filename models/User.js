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
    isAdmin: { type: Boolean, default: false },
    status: { type: String, enum: USER_STATUSES, default: "invited" },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

UserSchema.statics.hashPassword = (password) => argon2.hash(password);

module.exports = mongoose.model("User", UserSchema);
