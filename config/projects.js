const path = require("path");

const PORT = 3000;
const PROJECTS_ROOT = path.join(__dirname, "..", "..");
const SELF_PROJECT = path.basename(path.join(__dirname, "..")); // Dispatch's own project: in the database, never in the registry
// The app's own pages, beside each project's /<name>, and the other first
// path segments Dispatch answers on. A project folder can't take one of these
// names, or its page would be unreachable.
const APP_PAGES = ["projects", "people"];
const ADMIN_PAGES = ["users"]; // only admins get these; anyone else is sent to /
const RESERVED_NAMES = new Set([
  ...APP_PAGES,
  ...ADMIN_PAGES,
  "ports", "inbox", "chat", "login", "logout", "password", "api", "css", "js", "vendor", "live", "avatars",
]);
const CATEGORIES = ["fire", "breeze", "cold"];
const CATEGORY_LIMITS = { fire: 2, breeze: 4 }; // cold is unlimited
const PROJECT_DESCRIPTION_MAX_LENGTH = 230; // mirrors the create form's description maxlength in views/app/index.ejs
const BASE_PORT = 3001;
const SAMPLE_PROJECT_DIR = path.join(PROJECTS_ROOT, "new_project_sample");
const SAMPLE_TEMPLATE_FILES = ["AGENTS.md", "init_prompt.md"];
// Skipped when scanning for a project's most recent edit — otherwise a stray
// `npm install` (node_modules) or IDE metadata write would outrank the code
// itself for "last edited". The Explorer's search doesn't look inside them
// either, for the same reason: their contents would bury the project's own.
const STAT_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "venv", "__pycache__"]);

module.exports = {
  PORT,
  PROJECTS_ROOT,
  SELF_PROJECT,
  APP_PAGES,
  ADMIN_PAGES,
  RESERVED_NAMES,
  CATEGORIES,
  CATEGORY_LIMITS,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  BASE_PORT,
  SAMPLE_PROJECT_DIR,
  SAMPLE_TEMPLATE_FILES,
  STAT_EXCLUDED_DIRS,
};
