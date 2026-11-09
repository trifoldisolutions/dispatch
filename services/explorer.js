const fs = require("fs");
const path = require("path");
const { STAT_EXCLUDED_DIRS } = require("../config/projects");

// Newest mtime of any file under dir, skipping STAT_EXCLUDED_DIRS — a plain
// stat() on the project folder itself only moves when a *direct* child is
// added/removed/renamed, not when a file nested inside it is edited.
function latestMtimeMs(dir) {
  let latest = 0;
  let children;
  try {
    children = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return latest;
  }
  for (const child of children) {
    const childPath = path.join(dir, child.name);
    if (child.isDirectory()) {
      if (STAT_EXCLUDED_DIRS.has(child.name)) continue;
      latest = Math.max(latest, latestMtimeMs(childPath));
    } else if (child.isFile()) {
      try {
        latest = Math.max(latest, fs.statSync(childPath).mtimeMs);
      } catch {}
    }
  }
  return latest;
}

// Resolves `subpath` (a relative path from a project's Explorer tree) against
// that project's directory, refusing anything that would escape it (e.g. via
// "..") the same way resolveProjectDir refuses an escaping project name.
// Returns null if the subpath is unsafe.
function resolveTreeTarget(projectDir, subpath) {
  const target = path.resolve(projectDir, subpath || "");
  const dirWithSep = path.resolve(projectDir) + path.sep;
  if (target !== path.resolve(projectDir) && !target.startsWith(dirWithSep)) return null;
  return target;
}

const TREE_SEARCH_MAX_MATCHES = 500;
const TREE_SEARCH_MAX_FILE_BYTES = 1024 * 1024; // bigger files are only matched by name
const TREE_SEARCH_LINES_PER_FILE = 3; // matching lines sent back per file; the rest are only counted
const TREE_SEARCH_SNIPPET_LENGTH = 160; // longest a sent-back line gets before it's cut around the match

// `text` without its indentation, starting a few words before the match at
// `at` when it's further in than that — the Explorer only has room for the
// first 40 or so characters — and cut to TREE_SEARCH_SNIPPET_LENGTH (minified
// code can put a whole file on one line), with "…" wherever it was cut.
function searchSnippet(text, at) {
  const trimmed = text.trimStart();
  at -= text.length - trimmed.length;
  const line = trimmed.trimEnd();
  let start = 0;
  if (at > 30) {
    start = at - 20;
    const space = line.indexOf(" ", start); // begin on a whole word when one starts in time
    if (space !== -1 && space < at) start = space + 1;
  }
  const end = Math.min(line.length, start + TREE_SEARCH_SNIPPET_LENGTH);
  return (start > 0 ? "…" : "") + line.slice(start, end) + (end < line.length ? "…" : "");
}

// The lines of a file holding `phrase` (lowercased, any case in the file):
// { lines: the first TREE_SEARCH_LINES_PER_FILE as { line, text }, lineCount:
// how many there are in all }. Null when there are none, or when the file
// can't be searched — unreadable, over TREE_SEARCH_MAX_FILE_BYTES, or binary
// (a NUL byte early on, the same test git uses).
function searchFileContent(filePath, phrase) {
  let buffer;
  try {
    if (fs.statSync(filePath).size > TREE_SEARCH_MAX_FILE_BYTES) return null;
    buffer = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (buffer.subarray(0, 8000).includes(0)) return null;
  const lines = [];
  let lineCount = 0;
  buffer
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      const at = text.toLowerCase().indexOf(phrase);
      if (at === -1) return;
      lineCount++;
      if (lines.length < TREE_SEARCH_LINES_PER_FILE) lines.push({ line: i + 1, text: searchSnippet(text, at) });
    });
  return lineCount > 0 ? { lines, lineCount } : null;
}

module.exports = {
  latestMtimeMs,
  resolveTreeTarget,
  TREE_SEARCH_MAX_MATCHES,
  searchFileContent,
};
