const mongoose = require("mongoose");

const { Schema } = mongoose;

const PROJECT_CATEGORIES = ["fire", "breeze", "cold"];
// Where the work stands for the client: still going, or delivered. Separate
// from the category, which is about our own scheduling (a Cold project can
// still be going for its client).
const PROJECT_STATUSES = ["active", "finished"];

// A project is keyed by its folder name, as the dashboard's /<name> pages are.
// Its category and port are its place in the dashboard's registry: with a
// port it's assigned to that category, without one it's Unassigned. Dispatch's
// own project has neither and stays out of the registry. Ports will move to
// each machine's workspaces later; until then a port is studio-wide.
const ProjectSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "", trim: true, maxlength: 230 }, // the registry's limit
    url: { type: String, default: "", trim: true }, // the live site, if there is one
    category: { type: String, enum: PROJECT_CATEGORIES, default: null },
    port: { type: Number, default: null },
    position: { type: Number, default: null }, // order within Unassigned, which has no ports to sort by
    status: { type: String, enum: PROJECT_STATUSES, default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", ProjectSchema);
