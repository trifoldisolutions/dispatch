const fs = require("fs");
const path = require("path");

// Where a project's journal is expected to live. jarumiri_studios predates
// the dev_resources/ convention and uses Plans/journal.md instead — checked
// first only if it already exists; anything newly created always goes to
// the standard dev_resources/ path.
const JOURNAL_DEFAULT_RELATIVE = path.join("dev_resources", "journal.md");
const JOURNAL_SEARCH_RELATIVE = [JOURNAL_DEFAULT_RELATIVE, path.join("Plans", "journal.md")];

function findJournalPath(projectDir) {
  for (const rel of JOURNAL_SEARCH_RELATIVE) {
    const candidate = path.join(projectDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(projectDir, JOURNAL_DEFAULT_RELATIVE);
}

const JOURNAL_NOTE_MAX_LENGTH = 150; // mirrors the composer textarea's maxlength in views/app/index.ejs
const JOURNAL_DAY_HEADING_RE = /^## (\d{4}-\d{2}-\d{2})\b.*$/gm;
const JOURNAL_ENTRY_TIME_RE = /^-\s+\*\*(\d{2}:\d{2})\*\*\s+—\s+(.*)$/;
// The files an entry's work created, modified or deleted, reported by the
// agent that wrote it (the "Journal File Reports" rule in each project's
// AGENTS.md) and kept as indented sub-bullets under the entry, one per kind:
//   - Created: `views/app/auth/login.ejs`, `routes/app.js`
const JOURNAL_FILE_KINDS = ["created", "modified", "deleted"];
const JOURNAL_FILE_LINE_RE = /^\s+-\s+(Created|Modified|Deleted):\s*(.*)$/i;
const JOURNAL_FILES_MAX = 200; // per kind, per entry

// Checks and tidies the optional `files` of a journal POST — { created?,
// modified?, deleted? }, each a list of paths relative to the project:
// forward slashes, no leading "./", no backticks (they delimit paths in the
// Markdown), no duplicates. Returns { files } (null when there's nothing to
// record) or { error }.
function normalizeJournalFiles(raw) {
  if (raw === undefined || raw === null) return { files: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "files must be an object of created/modified/deleted path lists" };
  }
  const files = {};
  for (const [kind, list] of Object.entries(raw)) {
    if (!JOURNAL_FILE_KINDS.includes(kind)) return { error: `unknown files key "${kind}" — use created, modified or deleted` };
    if (!Array.isArray(list) || !list.every((p) => typeof p === "string")) return { error: `files.${kind} must be a list of paths` };
    const paths = [
      ...new Set(list.map((p) => p.replace(/`/g, "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").trim()).filter(Boolean)),
    ];
    if (paths.length > JOURNAL_FILES_MAX) return { error: `files.${kind} is limited to ${JOURNAL_FILES_MAX} paths per entry` };
    if (paths.length > 0) files[kind] = paths;
  }
  return { files: Object.keys(files).length > 0 ? files : null };
}

// Parsed for display only — never re-serialized back to disk, so this can
// afford to be lossy about exotic formatting (nested sub-bullets etc.) in
// hand-written entries. Writing (appendJournalEntry) only ever inserts new
// text, it never rebuilds the file from this parsed shape. An entry's file
// sub-bullets come back as its `files` ({ created?, modified?, deleted? }),
// not as part of its text.
function parseJournal(text) {
  const days = [];
  let current = null;
  let currentEntry = null;

  const flushEntry = () => {
    if (currentEntry) {
      const entry = { time: currentEntry.time, content: currentEntry.lines.join("\n").trim() };
      if (Object.keys(currentEntry.files).length > 0) entry.files = currentEntry.files;
      current.entries.push(entry);
      currentEntry = null;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const headingMatch = /^## (\d{4}-\d{2}-\d{2})\b.*$/.exec(line);
    if (headingMatch) {
      flushEntry();
      current = { date: headingMatch[1], entries: [] };
      days.push(current);
      continue;
    }
    if (!current) continue; // intro text/comment before the first day heading
    const entryMatch = JOURNAL_ENTRY_TIME_RE.exec(line);
    if (entryMatch) {
      flushEntry();
      currentEntry = { time: entryMatch[1], lines: [entryMatch[2]], files: {} };
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushEntry();
      currentEntry = { time: null, lines: [line.replace(/^-\s+/, "")], files: {} };
      continue;
    }
    const filesMatch = currentEntry && JOURNAL_FILE_LINE_RE.exec(line);
    if (filesMatch) {
      // Backtick-quoted paths as written by appendJournalEntry; a
      // hand-written plain comma list works too.
      const quoted = [...filesMatch[2].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
      const paths = (quoted.length > 0 ? quoted : filesMatch[2].split(",")).map((p) => p.trim()).filter(Boolean);
      const kind = filesMatch[1].toLowerCase();
      currentEntry.files[kind] = [...new Set([...(currentEntry.files[kind] || []), ...paths])];
      continue;
    }
    if (currentEntry) {
      currentEntry.lines.push(line.replace(/^ {1,2}/, ""));
    }
  }
  flushEntry();
  // Sorted explicitly (newest day first) rather than trusting file order —
  // appendJournalEntry always prepends new days, but a hand-written or
  // pre-existing journal.md (e.g. one seeded as project documentation) can
  // just as easily list days oldest-first.
  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTimeString(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayDateOnly() {
  return localDateString(new Date());
}

function addDaysDateOnly(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateString(new Date(y, m - 1, d + days));
}

const JOURNAL_FILE_TEMPLATE = "# Project Journal\n\n<!--\nEntry template:\n\n## YYYY-MM-DD\n- **HH:MM** — What changed\n-->\n\n";

// Beside each journal, an append-only log with one JSON line per entry that
// appendJournalEntry inserts: the exact moment it went in (`insertedAt`, ISO
// 8601 UTC), who put it there (`insertedBy`, see actorOf; none on records from
// before logins), the date and time it was filed under, and its text and files.
// journal.md is hand-editable and rewritten whole on every insert, so its
// HH:MM alone can't show when an entry really arrived; this file is only ever
// appended to. Hand-written entries have no record in it.
function journalAuditPath(journalPath) {
  return path.join(path.dirname(journalPath), "journal.audit.jsonl");
}

// Gives each parsed entry its `insertedAt` and `insertedBy` from the audit log,
// matched on the date, time and text it was filed with (duplicates oldest
// first). An entry written by hand, or edited since it went in, matches no
// record and gets neither.
function withJournalAudit(days, journalPath) {
  const auditPath = journalAuditPath(journalPath);
  if (!fs.existsSync(auditPath)) return days;
  const keyOf = (date, time, content) => JSON.stringify([date, time, content]);
  const recordsByKey = new Map();
  for (const line of fs.readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn or hand-mangled line shouldn't hide the rest
    }
    const key = keyOf(record.date, record.time, record.content);
    if (!recordsByKey.has(key)) recordsByKey.set(key, []);
    recordsByKey.get(key).push(record);
  }
  for (const day of days) {
    for (const entry of day.entries) {
      const record = recordsByKey.get(keyOf(day.date, entry.time, entry.content))?.shift();
      if (!record) continue;
      entry.insertedAt = record.insertedAt;
      if (record.insertedBy) entry.insertedBy = record.insertedBy;
    }
  }
  return days;
}

// Appends one note as a new bullet, grouped under today's `## YYYY-MM-DD`
// heading — creating that heading (newest at the top of the file) if today
// doesn't have one yet. Pure text surgery: existing content is never
// reparsed-and-rewritten, only ever a scoped insertion, so hand-written
// entries elsewhere in the file (including odd/nested formatting) survive
// byte-for-byte. `files` (see normalizeJournalFiles), when given, goes under
// the note as one sub-bullet per kind. Each insert is recorded in the audit
// log (journalAuditPath) first, with who made it (see actorOf), so a failed
// audit write leaves the journal untouched and the request safe to retry.
function appendJournalEntry(journalPath, content, insertedBy, files = null) {
  let text = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, "utf8") : JOURNAL_FILE_TEMPLATE;
  if (!text.endsWith("\n")) text += "\n";
  // One clock reading for both, so an entry posted at midnight can't be filed
  // under one day with the other day's time.
  const now = new Date();
  const date = localDateString(now);
  const time = localTimeString(now);
  const fileLines = JOURNAL_FILE_KINDS.filter((kind) => files && files[kind]).map(
    (kind) => `  - ${kind[0].toUpperCase()}${kind.slice(1)}: ${files[kind].map((p) => `\`${p}\``).join(", ")}`
  );
  const bulletText = [
    ...content.split("\n").map((line, i) => (i === 0 ? `- **${time}** — ${line}` : `  ${line}`)),
    ...fileLines,
  ].join("\n");

  const headings = [...text.matchAll(JOURNAL_DAY_HEADING_RE)];
  const todayHeading = headings.find((h) => h[1] === date);

  let updated;
  if (todayHeading) {
    const startIdx = todayHeading.index;
    const next = headings.find((h) => h.index > startIdx);
    const blockEnd = next ? next.index : text.length;
    let insertAt = blockEnd;
    while (insertAt > startIdx && text[insertAt - 1] === "\n") insertAt--;
    updated = `${text.slice(0, insertAt)}\n${bulletText}\n\n${text.slice(blockEnd)}`;
  } else {
    const newBlock = `## ${date}\n${bulletText}\n\n`;
    updated = headings.length > 0 ? text.slice(0, headings[0].index) + newBlock + text.slice(headings[0].index) : text + newBlock;
  }

  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const record = { insertedAt: now.toISOString(), insertedBy, date, time, content };
  if (files) record.files = files;
  fs.appendFileSync(journalAuditPath(journalPath), JSON.stringify(record) + "\n");
  fs.writeFileSync(journalPath, updated);
  return updated;
}

// A project's journal days, or none when its folder or files are missing or
// unreadable: one broken project shouldn't blank the rest.
function readProjectJournalSafe(dir) {
  try {
    const journalPath = findJournalPath(dir);
    if (!fs.existsSync(journalPath)) return [];
    return withJournalAudit(parseJournal(fs.readFileSync(journalPath, "utf8")), journalPath);
  } catch {
    return [];
  }
}

module.exports = {
  JOURNAL_NOTE_MAX_LENGTH,
  findJournalPath,
  normalizeJournalFiles,
  parseJournal,
  todayDateOnly,
  addDaysDateOnly,
  withJournalAudit,
  appendJournalEntry,
  readProjectJournalSafe,
};
