const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { addDaysDateOnly } = require("./journal");

const DUE_SOON_DAYS = 7;

// A project's task list: unlike the journal's hand-editable Markdown, tasks
// need a stable id per entry so done/archived/delete can target one of them,
// so this is a small JSON object instead — dev_resources/tasks.json — holding
// the tasks plus the project's own freely-user-defined tag list (tags persist
// here independently of which tasks currently use them, so one can exist
// with zero tasks tagged with it).
const TASKS_RELATIVE = path.join("dev_resources", "tasks.json");
const TASK_TITLE_MAX_LENGTH = 80; // mirrors the composer's title input maxlength in views/app/index.ejs
const TASK_DESCRIPTION_MAX_LENGTH = 500; // mirrors the composer's description textarea maxlength
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/; // matches <input type="date">'s value format
const TAG_MAX_LENGTH = 30;
// Lowest to highest. The Tasks composer won't add a task without one, but the
// API leaves it optional (agents add tasks with just a title), and tasks from
// before priorities existed have none.
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"];
// At most this many tasks can be open (not done or archived) and urgent at
// once. Making another one urgent, or reopening one that is, waits until one
// of them is done or lowered.
const URGENT_TASK_LIMIT = 2;

function findTasksPath(projectDir) {
  return path.join(projectDir, TASKS_RELATIVE);
}

// Tasks from before titles existed carry a single `content` string — read
// that as the title with an empty description, same no-migration approach as
// the bare-array case below; the next write persists the new shape.
function normalizeLegacyTask(task) {
  if (typeof task.title === "string") return task;
  const { content, ...rest } = task;
  return { ...rest, title: typeof content === "string" ? content : "", description: "" };
}

// Old files (from before tags existed) are a bare task array — read that as
// an empty tag list rather than migrating the file on disk; the next write
// (any create/update) naturally upgrades it to the {tags, tasks} shape.
function readTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return { tags: [], tasks: [] };
  const text = fs.readFileSync(tasksPath, "utf8").trim();
  if (!text) return { tags: [], tasks: [] };
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return { tags: [], tasks: parsed.map(normalizeLegacyTask) };
  return {
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeLegacyTask) : [],
  };
}

// Validates an incoming title/description pair from a request body. Either
// may be absent (PATCH only sends what changed); `requireTitle` is for POST,
// where a task can't exist without one. Returns { error } or the trimmed
// values that were present.
function parseTaskText(body, { requireTitle }) {
  const result = {};
  if (typeof body.title === "string" || requireTitle) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "task title is required" };
    if (title.length > TASK_TITLE_MAX_LENGTH) return { error: `task title is limited to ${TASK_TITLE_MAX_LENGTH} characters` };
    result.title = title;
  }
  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (description.length > TASK_DESCRIPTION_MAX_LENGTH) {
      return { error: `task description is limited to ${TASK_DESCRIPTION_MAX_LENGTH} characters` };
    }
    result.description = description;
  }
  return result;
}

// Validates a request body's `priority`: absent leaves it out of the result
// (PATCH only sends what changed), null or "" clears it, otherwise it has to
// be one of TASK_PRIORITIES. Returns { error } or { priority? }.
function parseTaskPriority(body) {
  if (typeof body.priority === "undefined") return {};
  if (body.priority === null || body.priority === "") return { priority: null };
  if (!TASK_PRIORITIES.includes(body.priority)) return { error: `task priority must be one of ${TASK_PRIORITIES.join(", ")}` };
  return { priority: body.priority };
}

function isOpenUrgent(task) {
  return task.priority === "urgent" && !task.done && !task.archived;
}

// Checks a new or changed `task` against URGENT_TASK_LIMIT, with `before` as
// the changed task was saved. Returns null when it may be saved, or the 409
// body refusing it: the error, plus the urgent tasks in the way so the Tasks
// panel can offer to settle one. Only becoming open and urgent is refused, so
// a project already over the limit can still edit its urgent tasks.
function urgentLimitRefusal(tasks, task, before = null) {
  if (!isOpenUrgent(task) || (before && isOpenUrgent(before))) return null;
  const inTheWay = tasks.filter((t) => t.id !== task.id && isOpenUrgent(t));
  if (inTheWay.length < URGENT_TASK_LIMIT) return null;
  return {
    error:
      `this project already has ${inTheWay.length} urgent tasks (${inTheWay.map((t) => t.id).join(", ")}): ` +
      "the user has to mark one done or lower its priority before another task can be urgent",
    urgentTasks: inTheWay.map(({ id, title }) => ({ id, title })),
  };
}

function writeTasks(tasksPath, data) {
  fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
  fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2) + "\n");
}

// Trims/dedupes (case-insensitively) a task's incoming tag list, dropping
// anything empty or absurdly long.
function normalizeTagList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag || tag.length > TAG_MAX_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

// Adds any of `taskTags` not already known (case-insensitively) onto the
// project's own tag list, in place — this is how a new tag typed in the
// Tasks tab's dropdown gets "created": it just becomes known the first time
// a task is saved with it.
function mergeKnownTags(knownTags, taskTags) {
  const known = new Set(knownTags.map((t) => t.toLowerCase()));
  for (const tag of taskTags) {
    if (!known.has(tag.toLowerCase())) {
      knownTags.push(tag);
      known.add(tag.toLowerCase());
    }
  }
}

// Short, human-referenceable id ("A3F9K2") instead of a UUID — a task list
// stays small enough per-project that a 6-char code has no real collision
// risk, and it's the one shown/typed by a person, not just passed in a URL.
const TASK_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TASK_CODE_LENGTH = 6;

function generateTaskCode(existingIds) {
  let code;
  do {
    code = Array.from({ length: TASK_CODE_LENGTH }, () => TASK_CODE_ALPHABET[crypto.randomInt(TASK_CODE_ALPHABET.length)]).join("");
  } while (existingIds.has(code));
  return code;
}

// A project's tasks and journal days, or empty ones when its folder or files
// are missing or unreadable: one broken project shouldn't blank the rest.
function readProjectTasksSafe(dir) {
  try {
    return readTasks(findTasksPath(dir)).tasks;
  } catch {
    return [];
  }
}

function taskFigures(tasks, today) {
  const soon = addDaysDateOnly(today, DUE_SOON_DAYS);
  const figures = { open: 0, done: 0, overdue: 0, dueSoon: 0 };
  for (const task of tasks) {
    if (task.archived) continue;
    if (task.done) {
      figures.done++;
      continue;
    }
    figures.open++;
    if (task.dueDate && task.dueDate < today) figures.overdue++;
    else if (task.dueDate && task.dueDate <= soon) figures.dueSoon++;
  }
  return figures;
}

module.exports = {
  DATE_ONLY_RE,
  findTasksPath,
  readTasks,
  parseTaskText,
  parseTaskPriority,
  urgentLimitRefusal,
  writeTasks,
  normalizeTagList,
  mergeKnownTags,
  generateTaskCode,
  readProjectTasksSafe,
  taskFigures,
};
