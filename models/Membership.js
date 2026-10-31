const mongoose = require("mongoose");

const { Schema } = mongoose;

const MEMBERSHIP_ROLES = ["lead", "dev", "client"];

// A person's role on one project. There's one membership per person per
// project, so someone can lead one project and be a dev on another, but can't
// hold two roles on the same one.
const MembershipSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
  },
  { timestamps: true }
);

MembershipSchema.index({ user: 1, project: 1 }, { unique: true });
MembershipSchema.index({ project: 1 }); // a project's staff

module.exports = mongoose.model("Membership", MembershipSchema);
