const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const ACTIVITY_DAYS = 14;
const COMMITS_CACHE_MS = 60 * 1000; // a project's recent commits, so a reload doesn't run git 20 times
const recentCommitsCache = new Map(); // name -> { at, commits }

async function recentCommits(name, dir) {
  const cached = recentCommitsCache.get(name);
  if (cached && Date.now() - cached.at < COMMITS_CACHE_MS) return cached.commits;
  let commits = [];
  try {
    const { stdout } = await execAsync(
      `git log --since="${ACTIVITY_DAYS} days ago" -n 10 --format=${GIT_LOG_FORMAT}`,
      { cwd: dir, maxBuffer: 1024 * 1024 }
    );
    commits = stdout.split("\n").filter((line) => line.trim()).map(parseGitLogLine);
  } catch {
    // not a git repo, or no commits yet
  }
  recentCommitsCache.set(name, { at: Date.now(), commits });
  return commits;
}

// One git status category per changed/untracked/ignored path, in the
// priority order used to pick a single color for a folder that contains a
// mix of them (e.g. a folder with both a modified and an untracked file
// shows as "modified" — first match wins).
const GIT_STATUS_PRIORITY = ["conflicted", "modified", "renamed", "added", "untracked", "deleted", "ignored"];

function classifyGitCode(x, y) {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflicted";
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "M" || y === "M") return "modified";
  return "modified";
}

// Parses `git status --porcelain=v1 -z` output: NUL-separated "XY path"
// records, except a rename/copy record is followed by one extra NUL-
// terminated token (its original path) that we skip — the tree only needs
// where the entry lives now.
function parseGitPorcelain(stdout) {
  const tokens = stdout.split("\0").filter((t) => t.length > 0);
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const x = token[0];
    const y = token[1];
    const filePath = token.slice(3).replace(/\/$/, "");
    entries.push({ path: filePath, status: classifyGitCode(x, y) });
    if (x === "R" || y === "R" || x === "C" || y === "C") i++;
  }
  return entries;
}

// The commit message waiting for a project's next push, kept up to date by
// its agents as they journal their work (the "Push Commit Message" rule in
// each project's AGENTS.md). The Push button commits with it and then
// deletes it; it's never committed itself. Forward slashes, since it's also
// matched against the paths git reports.
const COMMIT_MESSAGE_RELATIVE = "dev_resources/commit_message.txt";

// The pending commit message's text, or null when there isn't one (no file,
// or nothing but whitespace in it).
function readPendingCommitMessage(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, COMMIT_MESSAGE_RELATIVE), "utf8").replace(/\r\n/g, "\n").trim();
    return text || null;
  } catch {
    return null;
  }
}

// When the pending commit message was last written, or null without one.
function pendingCommitMessageMtime(dir) {
  try {
    return fs.statSync(path.join(dir, COMMIT_MESSAGE_RELATIVE)).mtimeMs;
  } catch {
    return null;
  }
}

// Fields pulled from `git log -1`, separated by \x1f (unit separator) since
// it won't collide with anything a commit message or author name contains.
const GIT_LOG_FORMAT = "%H\x1f%h\x1f%an\x1f%aI\x1f%s";

function parseGitLogLine(line) {
  const [hash, shortHash, author, date, ...rest] = line.split("\x1f");
  return { hash, shortHash, author, date, message: rest.join("\x1f") };
}

// Formats an auto-commit message's timestamp the same way this user's own
// manual "Auto-commit: 2026-07-18 01:04" commits already do.
function formatAutoCommitTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  ACTIVITY_DAYS,
  execAsync,
  recentCommits,
  parseGitPorcelain,
  COMMIT_MESSAGE_RELATIVE,
  readPendingCommitMessage,
  pendingCommitMessageMtime,
  GIT_LOG_FORMAT,
  parseGitLogLine,
  formatAutoCommitTimestamp,
};
