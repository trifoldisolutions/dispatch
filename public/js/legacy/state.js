// The page's state: what's loaded, what's open, and what's being typed, shared by every file below.

// Real folders that aren't actually assignable projects — leave them out of
// the folder-name suggestion list.
const SUGGESTION_EXCLUDED_FOLDERS = new Set(["new_project_sample", "dispatch", "scripts"]);
let entries = [];
let unassigned = [];
let openAssignDropdown = null;
let portSwitchOpen = false; // the project header's Switch port menu (see buildPortSwitchDropdown)
let projectPathInfo = {}; // project name -> { path, created, modified } | { error }, cached once fetched
const projectPathInfoInFlight = new Set(); // names with a stat fetch already in progress, to dedupe across renders
let createCategoryDropdownOpen = false;
let createForm = { category: null, port: null, name: "", description: "", url: "" };
let createDrawerOpen = false; // the Add/Edit project form's drawer, below the side column's width (see openCreateDrawer)
let editingKey = null; // { list: "entries", port } | { list: "unassigned", name } | null
let portLiveStatus = {}; // port (string) -> is something actually listening on it right now
let projectRunStatus = {}; // project name -> { status: "starting"|"running"|"crashed", error, twError } | undefined
let currentView = "home"; // "home" (/), "projects" (/projects, until it opens your first project), or "project" (/<name>): see routeFromPath
let currentProjectName = null; // whose page is showing (from /<name>), or null on the app's own pages
let currentProjectSection = null; // the panel showing on a page of its own (from /<name>/<section>), or null for the whole project page
let syncing = false; // the project header's Sync is reloading everything (see syncProjectPage)
let registryLoaded = false; // set by the first load(), so a project page opened directly says "Loading…" rather than "not found" until then
// Journal panel (per-project dev_resources/journal.md, grouped by day):
let journalCache = {}; // project name -> { days: [{ date, entries: [{ time, content }] }] } | { error } once fetched
const journalInFlight = new Set();
let journalDraft = {}; // project name -> in-progress composer text, so a render() mid-typing doesn't lose it
const journalSubmitting = new Set(); // project names with a note POST in flight
let journalFilter = emptyJournalFilter(); // the project page's Journal filter — reset whenever another page opens
let journalCalendarOpen = false; // the Journal filter field's calendar dropdown (see buildJournalCalendar)
let journalCalendarMonth = null; // { year, month } that open calendar is showing
let journalRangeAnchor = null; // the first day clicked, while the calendar waits for a second click to make it a range
// Tasks panel (per-project dev_resources/tasks.json):
let taskCache = {}; // project name -> { tasks: [{ id, title, description, done, doneAt, archived, archivedAt, dueDate, tags, createdAt, updatedAt }], tags: string[] } | { error } once fetched
const taskInFlight = new Set();
let taskTitleDraft = {}; // project name -> in-progress composer title
let taskDescriptionDraft = {}; // project name -> in-progress composer description
let taskDueDraft = {}; // project name -> in-progress composer due date ("YYYY-MM-DD" or "")
let taskTagsDraft = {}; // project name -> Set<string> of tags checked in the composer's tags dropdown
const taskSubmitting = new Set(); // project names with a create POST in flight
const taskUpdating = new Set(); // task ids with a done/archive/delete/edit request in flight
let editingTaskId = null; // id of the task currently loaded into the composer for editing, or null
let editingTaskProject = null; // project name that task belongs to (composer state is keyed by project name)
let openTagsDropdownFor = null; // "composer" | "filter" | task id | null — which tags dropdown (if any) is open
let taskFilter = emptyTaskFilter(); // the project page's Tasks filter — only one page shows at a time, reset whenever another opens
const TASK_STATUSES = ["open", "done", "archived"]; // the Tasks header's figures, in order (see taskStatus)
let taskStatusFilter = defaultTaskStatusFilter(); // which of TASK_STATUSES are checked in the Tasks header, i.e. listed; reset with taskFilter
let taskCalendarOpen = false; // the Tasks filter bar's calendar dropdown (see buildTaskCalendar)
let taskCalendarMonth = null; // { year, month } that open calendar is showing
let taskRangeAnchor = null; // like journalRangeAnchor, for that calendar
let taskDueCalendarOpen = false; // the Tasks composer's due date calendar (see buildTaskDueDropdown)
let taskDueCalendarMonth = null; // { year, month } that open calendar is showing
let activeDialog = null; // { resolve } | null — the custom confirm/prompt dialog's pending promise, while one is open
let newFolders = []; // on-disk project folders with no registry entry, from the most recent load()
let newFoldersModalOpen = false;
let newFoldersSelected = new Set(); // subset of newFolders currently checked in that modal
// Explorer panel (per-project file tree): each folder's children are fetched
// lazily, one level at a time, only once it's expanded.
let fileTreeCache = {}; // "project::relPath" -> [{ name, type }] | { error } once fetched
const fileTreeInFlight = new Set(); // "project::relPath" with a fetch already in progress
let fileTreeExpanded = new Set(); // "project::relPath" of folders currently expanded
let explorerQuery = ""; // the project page's Explorer search text — reset whenever another page opens
let explorerSearchCache = {}; // "project::query" -> { matches: [{ path, type, nameMatch, lines?, lineCount? }], truncated, terms } | { error } once fetched
const explorerSearchInFlight = new Set(); // "project::query" with a search already in progress
let explorerLastSearch = {}; // project -> the "project::query" whose results it last showed, kept on screen while the next search runs
let explorerSearchCollapsed = new Set(); // "project::relPath" of folders closed in the search results — reset whenever the search changes
let explorerSearchTimer = null; // the pause after a keystroke before searching
let explorerCountsCache = {}; // project -> { folders, files, skipped } | { error } once fetched, for the Explorer panel's header
const explorerCountsInFlight = new Set();
// project -> { isRepo, byPath: Map(relPath -> status) } once fetched, so the
// Explorer panel can color rows the way VS Code's git decorations do.
let gitStatusCache = {};
const gitStatusInFlight = new Set();
// History panel (per-project last commit + last push, from git itself):
// project -> { isRepo, branch, lastCommit, upstream, lastPush } | { error } once fetched.
let historyCache = {};
const historyInFlight = new Set();
const gitPushInFlight = new Set(); // project names with a git-push POST in flight
// The header's Staff and the Staff page, from the project's memberships:
// project -> { staff: [{ id, name, role, you, online }] } | { error } once fetched.
let staffCache = {};
const staffInFlight = new Set();
let openStaffMenu = null; // "<place>:<user id>" of the staff card whose ⋮ menu is open (see buildStaffMenu)

// --- Journal filter: the field above the entries. Its search keeps the
// entries whose note, or one of whose reported files, has every word in
// it; its date segment's calendar narrows them to one day or an inclusive
// range of days. Picking takes up to two clicks: the first day filters to
// just that day straight away; a second click turns it into the range
// between the two and closes the calendar.

// `start`–`end` are inclusive "YYYY-MM-DD" bounds, nulls when unset.
function emptyJournalFilter() {
  return { query: "", start: null, end: null };
}

// Open and done start checked in the Tasks header, archived doesn't: an
// archived task stays out of the list until it's asked for.
function defaultTaskStatusFilter() {
  return new Set(["open", "done"]);
}

// `dateField` is which of a task's dates the `start`–`end` range (inclusive
// "YYYY-MM-DD" bounds, nulls when unset) is matched against — the calendar's
// Due date/Date added toggle — and survives clearing, so it stays where the
// user left it.
function emptyTaskFilter(dateField = "due") {
  return { query: "", tags: new Set(), dateField, start: null, end: null };
}
