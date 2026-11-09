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
// The standard every new project starts from: each file here is copied to
// `dest` in the project's folder. A file named AGENTS.md here would be read by
// agents as instructions for this folder, so it only takes that name when copied.
const PROJECT_TEMPLATE_DIR = path.join(__dirname, "project_template");
const PROJECT_TEMPLATE_FILES = [
  { file: "AGENTS.template.md", dest: "AGENTS.md" },
  { file: "init_prompt.md", dest: path.join("dev_resources", "init_prompt.md") },
];
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
  PROJECT_TEMPLATE_DIR,
  PROJECT_TEMPLATE_FILES,
  STAT_EXCLUDED_DIRS,
};
