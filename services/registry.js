const fs = require("fs");
const path = require("path");
const Project = require("../models/Project");
const Membership = require("../models/Membership");
const { PROJECTS_ROOT, SELF_PROJECT, RESERVED_NAMES, CATEGORIES, CATEGORY_LIMITS, PROJECT_DESCRIPTION_MAX_LENGTH, BASE_PORT, PROJECT_TEMPLATE_DIR, PROJECT_TEMPLATE_FILES } = require("../config/projects");

const PROJECT_STATUSES = Project.schema.path("status").enumValues;

// Ports belong to their category, not to a project: each category owns a
// contiguous block sized to its limit, in CATEGORIES order. Cold is last and
// unlimited, so its block just keeps growing.
function categoryPortRange(category) {
  let start = BASE_PORT;
  for (const cat of CATEGORIES) {
    const limit = CATEGORY_LIMITS[cat];
    const end = limit !== undefined ? start + limit - 1 : Infinity;
    if (cat === category) return { start, end };
    start = end + 1;
  }
}

// The registry is stored as the projects collection (see models/Project.js)
// and handed to the dashboard in the shape it has always used: each category
// maps ports to { name, description, url?, status? }, and unassigned is a
// list. A status is only there for a finished project.
async function readRegistry() {
  const registry = { fire: {}, breeze: {}, cold: {}, unassigned: [] };
  const projects = await Project.find({ name: { $ne: SELF_PROJECT } }).sort({ port: 1, position: 1 }).lean();
  for (const project of projects) {
    const entry = { name: project.name, description: project.description };
    if (project.url) entry.url = project.url;
    if (project.status === "finished") entry.status = "finished";
    if (project.port !== null && CATEGORIES.includes(project.category)) registry[project.category][project.port] = entry;
    else registry.unassigned.push(entry);
  }
  return registry;
}

// Saves a whole (already validated) registry: every entry's place is set from
// it, and a project that's no longer in it was deleted from the dashboard, so
// its record and memberships go too. A status is only changed when the entry
// has one (the Edit form always sends it), so a page that moves a project
// without carrying its status along can't reset it.
async function writeRegistry(data) {
  const placeProject = (entry, placement) => ({
    updateOne: {
      filter: { name: entry.name },
      update: {
        $set: { description: entry.description, url: entry.url || "", ...(entry.status ? { status: entry.status } : {}), ...placement },
      },
      upsert: true,
    },
  });
  const ops = [];
  for (const category of CATEGORIES) {
    for (const [port, entry] of Object.entries(data[category] || {})) {
      ops.push(placeProject(entry, { category, port: Number(port), position: null }));
    }
  }
  (data.unassigned || []).forEach((entry, position) => {
    ops.push(placeProject(entry, { category: null, port: null, position }));
  });
  if (ops.length) await Project.bulkWrite(ops);

  const kept = [...collectNames(data), SELF_PROJECT];
  const removed = (await Project.find({ name: { $nin: kept } }, "_id").lean()).map((p) => p._id);
  if (removed.length) {
    await Membership.deleteMany({ project: { $in: removed } });
    await Project.deleteMany({ _id: { $in: removed } });
  }
}

// Real, on-disk project folders — a name can only be newly added to the
// registry if a folder with that exact name actually exists here. Dot folders
// (.claude, .git, .vscode…) are tool metadata, never projects.
function listProjectFolders() {
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

function collectNames(data) {
  const names = new Set();
  for (const category of CATEGORIES) {
    for (const entry of Object.values(data[category] || {})) {
      if (entry && typeof entry.name === "string") names.add(entry.name);
    }
  }
  for (const entry of data.unassigned || []) {
    if (entry && typeof entry.name === "string") names.add(entry.name);
  }
  return names;
}

// A project's live site (`url`) is optional, but when it's there it has to be
// an http(s) address, since the project page links straight to it.
function isValidSiteUrl(url) {
  if (url === undefined) return true;
  if (typeof url !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// `existingNames` are the names the registry tracks before this change.
function validateRegistry(data, existingNames) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "registry must be an object";
  }
  for (const key of Object.keys(data)) {
    if (!CATEGORIES.includes(key) && key !== "unassigned") {
      return `unknown key "${key}"`;
    }
  }

  const seenPorts = new Set();
  const seenNames = new Map(); // lowercase name -> where it's already assigned, for a clear duplicate error
  for (const category of CATEGORIES) {
    if (!(category in data)) continue;
    const entries = data[category];
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      return `category "${category}" must be an object`;
    }
    const limit = CATEGORY_LIMITS[category];
    const count = Object.keys(entries).length;
    if (limit !== undefined && count > limit) {
      return `category "${category}" allows at most ${limit} project${limit === 1 ? "" : "s"} (got ${count})`;
    }
    const range = categoryPortRange(category);
    for (const [port, entry] of Object.entries(entries)) {
      if (!/^\d+$/.test(port)) {
        return `invalid port key "${port}"`;
      }
      const portNum = Number(port);
      if (portNum < range.start || portNum > range.end) {
        return `port ${port} is outside ${category}'s range (${range.start}–${range.end === Infinity ? "∞" : range.end})`;
      }
      if (seenPorts.has(port)) {
        return `duplicate port ${port}`;
      }
      seenPorts.add(port);
      if (typeof entry !== "object" || entry === null) {
        return `entry for port ${port} must be an object`;
      }
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        return `entry for port ${port} needs a non-empty "name"`;
      }
      if (typeof entry.description !== "string") {
        return `entry for port ${port} needs a "description" string`;
      }
      if (entry.description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
        return `description for port ${port} is limited to ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`;
      }
      if (!isValidSiteUrl(entry.url)) {
        return `live site for port ${port} must be an http(s) address`;
      }
      if (entry.status !== undefined && !PROJECT_STATUSES.includes(entry.status)) {
        return `status for port ${port} must be one of ${PROJECT_STATUSES.join(", ")}`;
      }
      const nameKey = entry.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) {
        return `"${entry.name}" is assigned more than once (also in ${seenNames.get(nameKey)})`;
      }
      seenNames.set(nameKey, `${category} (port ${port})`);
    }
  }

  if ("unassigned" in data) {
    const unassigned = data.unassigned;
    if (!Array.isArray(unassigned)) {
      return `"unassigned" must be an array`;
    }
    for (const entry of unassigned) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return `unassigned entry must be an object`;
      }
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        return `unassigned entry needs a non-empty "name"`;
      }
      if (typeof entry.description !== "string") {
        return `unassigned entry needs a "description" string`;
      }
      if (entry.description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
        return `description for "${entry.name}" is limited to ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`;
      }
      if (!isValidSiteUrl(entry.url)) {
        return `live site for "${entry.name}" must be an http(s) address`;
      }
      if (entry.status !== undefined && !PROJECT_STATUSES.includes(entry.status)) {
        return `status for "${entry.name}" must be one of ${PROJECT_STATUSES.join(", ")}`;
      }
      const nameKey = entry.name.trim().toLowerCase();
      if (seenNames.has(nameKey)) {
        return `"${entry.name}" is assigned more than once (also in ${seenNames.get(nameKey)})`;
      }
      seenNames.set(nameKey, "unassigned");
    }
  }

  // Only names that are newly appearing (not already tracked) have to match
  // a real folder — this doesn't retroactively break already-tracked names
  // whose folder was since renamed or removed.
  const newNames = [...collectNames(data)].filter((name) => !existingNames.has(name));
  if (newNames.length > 0) {
    const folders = new Set(listProjectFolders());
    for (const name of newNames) {
      if (RESERVED_NAMES.has(name.toLowerCase())) {
        return `"${name}" is one of Dispatch's own addresses, so its project page couldn't be reached; rename the folder`;
      }
      if (!folders.has(name)) {
        return `"${name}" has no matching folder in the projects directory — create the project folder first`;
      }
    }
  }

  return null;
}

// Throws if a starter file is missing: a project without them wouldn't know the
// standard it has to follow, so callers refuse before they change anything.
function checkProjectTemplate() {
  for (const { file } of PROJECT_TEMPLATE_FILES) {
    if (!fs.existsSync(path.join(PROJECT_TEMPLATE_DIR, file))) {
      throw new Error(`the project template is missing ${file} (expected in config/project_template/)`);
    }
  }
}

// Seeds a project folder with whichever starter files from config/project_template/
// it's missing — a fresh folder gets both, a folder that already had its own
// AGENTS.md/init_prompt.md (or picked one up some other way) keeps it as-is.
// Those files use a ":projectFolderName" placeholder (in paths, the Mongo
// dbName/URI, the .vbs launcher name, etc.) meant to be swapped for the real
// folder name before use, so that substitution happens here.
function seedProjectFolder(dir, name) {
  checkProjectTemplate();
  for (const { file, dest } of PROJECT_TEMPLATE_FILES) {
    const target = path.join(dir, dest);
    if (fs.existsSync(target)) continue;
    const content = fs.readFileSync(path.join(PROJECT_TEMPLATE_DIR, file), "utf8").split(":projectFolderName").join(name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

// Finds which category/port a project name is currently assigned to (not
// "unassigned" — those have no port to serve on).
async function findAssignedEntry(name) {
  const project = await Project.findOne({ name, port: { $ne: null } }).lean();
  return project ? { category: project.category, port: String(project.port) } : null;
}

// Mirrors scripts/inject-port.js so a manual port reassignment in the
// dashboard is reflected before we start the dev server, without requiring
// the project folder to be reopened in VS Code first.
function syncEnvPort(projectDir, port) {
  const envPath = path.join(projectDir, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^PORT=.*$/m.test(content)) {
    content = content.replace(/^PORT=.*$/m, `PORT=${port}`);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `PORT=${port}\n`;
  }
  fs.writeFileSync(envPath, content);
}

// Keeps every assigned project's .env PORT in step with the registry the
// moment it's saved (e.g. after a drag-and-drop move), so the new port holds
// however the project is launched — dashboard, VS Code tasks, or a terminal.
// Only touches .env files whose PORT actually differs, and only creates one
// for folders that look like Node projects.
function syncAllEnvPorts(registry) {
  for (const category of CATEGORIES) {
    for (const [port, entry] of Object.entries(registry[category] || {})) {
      const dir = resolveProjectDir(entry.name);
      if (!dir || !fs.existsSync(dir)) continue;
      const envPath = path.join(dir, ".env");
      try {
        if (fs.existsSync(envPath)) {
          const match = fs.readFileSync(envPath, "utf8").match(/^PORT=(.*)$/m);
          if (match && match[1].trim() === port) continue;
        } else if (!fs.existsSync(path.join(dir, "package.json"))) {
          continue;
        }
        syncEnvPort(dir, port);
      } catch (err) {
        console.error(`failed to sync .env PORT for "${entry.name}": ${err.message}`);
      }
    }
  }
}

// Resolves a project name to its folder, refusing anything that would
// resolve outside PROJECTS_ROOT (e.g. a name containing "..").
function resolveProjectDir(name) {
  const root = path.resolve(PROJECTS_ROOT) + path.sep;
  const dir = path.resolve(PROJECTS_ROOT, name);
  return dir.startsWith(root) ? dir : null;
}

module.exports = {
  PROJECT_STATUSES,
  readRegistry,
  writeRegistry,
  listProjectFolders,
  collectNames,
  validateRegistry,
  checkProjectTemplate,
  seedProjectFolder,
  findAssignedEntry,
  syncEnvPort,
  syncAllEnvPorts,
  resolveProjectDir,
};
