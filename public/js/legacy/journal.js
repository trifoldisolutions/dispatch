// A project's Journal panel: entries by day, the filter and calendar, and the composer.

// Lazily fetches and caches a project's journal (once per project, same
// dedupe pattern as ensureGitStatusLoaded) so opening a project's page
// re-reads dev_resources/journal.md fresh — picking up edits made directly
// to the file, not just ones made from this composer.
function ensureJournalLoaded(project) {
  if (journalCache[project] || journalInFlight.has(project)) return;
  journalInFlight.add(project);
  fetchJournal(project)
    .then((result) => {
      journalCache[project] = result;
    })
    .catch((err) => {
      journalCache[project] = { error: err.message };
    })
    .finally(() => {
      journalInFlight.delete(project);
      render();
    });
}

// Parsed as a local date (not UTC) so it never drifts a day depending on
// timezone. Builds the stacked month/day/year badge shown on a day's first
// entry only — month abbreviation on top, the day number (larger) in the
// middle, the year at the bottom; highlighted if it's today.
function buildJournalEntryDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const badge = document.createElement("div");
  badge.className = "journal-entry-date" + (date.toDateString() === new Date().toDateString() ? " is-today" : "");
  const month = document.createElement("div");
  month.className = "journal-entry-date-month";
  month.textContent = date.toLocaleDateString(undefined, { month: "short" });
  const day = document.createElement("div");
  day.className = "journal-entry-date-day";
  day.textContent = String(d).padStart(2, "0");
  const year = document.createElement("div");
  year.className = "journal-entry-date-year";
  year.textContent = String(y);
  badge.appendChild(month);
  badge.appendChild(day);
  badge.appendChild(year);
  return badge;
}

// The Journal panel's content: entries grouped into one block per calendar
// day (newest day first, per journal.md's own convention), a filter field
// above them, and a composer at the bottom to add a new note.
function buildJournalPanel(entry, panel) {
  ensureJournalLoaded(entry.name);
  const container = document.createElement("div");
  container.className = "journal-tab";

  const listEl = document.createElement("div");
  listEl.className = "journal-entries panel-scroll";
  listEl.dataset.scrollKey = "journal"; // see renderProjectPage
  const state = journalCache[entry.name];

  if (!state) {
    listEl.appendChild(buildPanelLoading());
  } else if (state.error) {
    // Nothing to add a note to until the journal can be read.
    container.appendChild(buildLoadErrorEmpty(entry.name, "Couldn't load the journal", state.error));
    return container;
  } else if (state.days.length === 0) {
    listEl.appendChild(
      buildPanelEmpty({
        icon: ICON_BOOK_OPEN,
        title: "No journal entries yet",
        text: "Notes added below, and the entries agents post, show here by day.",
      })
    );
  } else {
    // Typing re-fills just the list, from the top, the same way
    // buildTasksPanel does and for the same reason.
    const total = state.days.reduce((n, day) => n + day.entries.length, 0);
    const filterBar = buildJournalFilterBar(entry, () => {
      listEl.scrollTop = 0;
      fillList();
    });
    container.appendChild(filterBar.el);
    function fillList() {
      listEl.textContent = "";
      const terms = filterTerms(journalFilter.query);
      const days = filterJournalDays(state.days);
      if (days.length === 0) {
        listEl.appendChild(
          buildPanelEmpty({
            icon: ICON_SEARCH,
            title: "No matching entries",
            text:
              terms.length > 0
                ? "No entry's note or reported files match this filter."
                : `Nothing was logged ${journalFilter.start === journalFilter.end ? "on" : "from"} ${formatDateRange(journalFilter)}.`,
            action: { label: "Clear filter", onClick: filterBar.clear },
          })
        );
      }
      days.forEach((day, dayIndex) => {
        if (dayIndex > 0) {
          const divider = document.createElement("div");
          divider.className = "journal-day-divider";
          listEl.appendChild(divider);
        }
        listEl.appendChild(buildJournalDay(entry.name, day, terms));
      });
      filterBar.updateStatus(days.reduce((n, day) => n + day.entries.length, 0), total);
    }
    fillList();
  }

  container.appendChild(listEl);
  container.appendChild(buildJournalComposer(entry, panel));
  return container;
}

// One day's block: its entries, the first carrying the date badge, then the
// files they reported. `terms` are the filter's search words, marked
// wherever they turn up. Each entry's time sits under its text: for one the
// dashboard inserted, the exact insert time (`insertedAt`, from the audit log
// in server.js), to the second, and who inserted it (`insertedBy`); for a
// hand-written one, the HH:MM it was written with. Their tooltips say which
// it is.
function buildJournalDay(name, day, terms) {
  const dayEl = document.createElement("div");
  dayEl.className = "journal-day";
  day.entries.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "journal-entry";
    if (i === 0) {
      row.appendChild(buildJournalEntryDate(day.date));
    } else {
      const spacer = document.createElement("div");
      spacer.className = "journal-entry-date";
      row.appendChild(spacer);
    }
    const content = document.createElement("div");
    content.className = "journal-entry-content";
    const dash = document.createElement("span");
    dash.className = "journal-entry-dash";
    dash.textContent = "— ";
    content.appendChild(dash);
    appendHighlighted(content, item.content, terms);
    const time = buildJournalEntryTime(day.date, item);
    if (time) content.appendChild(time);
    row.appendChild(content);
    dayEl.appendChild(row);
  });
  const files = buildJournalDayFiles(name, day, terms);
  if (files) dayEl.appendChild(files);
  return dayEl;
}

// The time line under one journal entry (see buildJournalDay), or null for
// a hand-written entry with no time at all.
function buildJournalEntryTime(date, item) {
  const el = document.createElement("div");
  el.className = "journal-entry-time";
  if (item.insertedAt) {
    const inserted = new Date(item.insertedAt);
    el.textContent = withAuthor(inserted.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }), item.insertedBy);
    el.title = `Inserted ${inserted.toLocaleString()}`;
  } else if (item.time) {
    el.textContent = new Date(`${date}T${item.time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    el.title = "Time as written in journal.md; no insert record";
  } else {
    return null;
  }
  return el;
}

const JOURNAL_FILE_KIND_LABELS = { created: "Created", modified: "Modified", deleted: "Deleted" };

// For each journal day, the files known to exist when it began: reported
// created or modified on an earlier day, and not reported deleted since.
// Built from the whole journal rather than the filtered view, so a search
// can't hide the day a file first appeared. Cached per fetched journal.
const journalExistingFilesCache = new WeakMap();

function journalFilesExistingByDate(days) {
  let byDate = journalExistingFilesCache.get(days);
  if (byDate) return byDate;
  byDate = new Map();
  const existing = new Set();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byDate.has(day.date)) byDate.set(day.date, new Set(existing));
    // Oldest entry first, so a file deleted and then made again that day
    // ends it existing (untimed hand-written entries keep their order).
    const entries = [...day.entries].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    for (const item of entries) {
      for (const file of (item.files && item.files.created) || []) existing.add(file);
      for (const file of (item.files && item.files.modified) || []) existing.add(file);
      for (const file of (item.files && item.files.deleted) || []) existing.delete(file);
    }
  }
  journalExistingFilesCache.set(days, byDate);
  return byDate;
}

// Every file a day's entries reported (their `files`, see parseJournal in
// server.js), merged per kind and sorted. A file created that day and then
// edited again still counts as created. A file stays created only on the
// day it first appeared: one in `existing` (already there when the day
// began, see journalFilesExistingByDate) that an entry reports as created
// again counts as modified, unless the day also deleted it.
function journalDayFiles(day, existing) {
  const kinds = { created: new Set(), modified: new Set(), deleted: new Set() };
  for (const item of day.entries) {
    for (const kind of Object.keys(kinds)) {
      for (const file of (item.files && item.files[kind]) || []) kinds[kind].add(file);
    }
  }
  for (const file of [...kinds.created]) {
    if (existing.has(file) && !kinds.deleted.has(file)) {
      kinds.created.delete(file);
      kinds.modified.add(file);
    }
  }
  for (const file of kinds.created) kinds.modified.delete(file);
  return Object.fromEntries(Object.entries(kinds).map(([kind, set]) => [kind, [...set].sort()]));
}

// Under a day's entries: the files they reported, all on one wrapping row
// (created, then modified, then deleted), each shown like an Explorer file —
// its icon and name, colored by kind — with the full path on hover, and the
// filter's search words (`terms`) marked in it. Nothing at all for a day
// whose entries reported no files.
function buildJournalDayFiles(name, day, terms) {
  const existing = journalFilesExistingByDate(journalCache[name].days).get(day.date);
  const files = journalDayFiles(day, existing || new Set());
  const kinds = Object.keys(files).filter((kind) => files[kind].length > 0);
  if (kinds.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "journal-files";
  for (const kind of kinds) {
    for (const file of files[kind]) {
      const fileName = file.slice(file.lastIndexOf("/") + 1);
      const item = document.createElement("span");
      item.className = `journal-file ${kind}`;
      item.title = `${file} (${JOURNAL_FILE_KIND_LABELS[kind]})`;
      const icon = document.createElement("span");
      icon.className = "file-tree-icon";
      icon.innerHTML = iconForFileName(fileName);
      const label = document.createElement("span");
      label.className = "journal-file-name";
      appendHighlighted(label, fileName, terms);
      item.append(icon, label);
      wrap.appendChild(item);
    }
  }
  return wrap;
}

function isJournalFilterActive() {
  return journalFilter.query.trim() !== "" || journalFilter.start !== null;
}

function journalEntryMatches(item, terms) {
  if (terms.length === 0) return true;
  const files = item.files ? Object.values(item.files).flat() : [];
  const haystack = [item.content, ...files].join("\n").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

// The days the filter lets through, each with only its matching entries.
// `withDates: false` leaves the date range out, for the calendar's dots.
function filterJournalDays(days, { withDates = true } = {}) {
  const terms = filterTerms(journalFilter.query);
  const { start, end } = journalFilter;
  return days
    .filter((day) => !withDates || start === null || (day.date >= start && day.date <= end))
    .map((day) => ({ ...day, entries: day.entries.filter((item) => journalEntryMatches(item, terms)) }))
    .filter((day) => day.entries.length > 0);
}

function closeJournalCalendar() {
  journalCalendarOpen = false;
  journalRangeAnchor = null;
}

// Applies a date range (nulls clear it) and shows its entries from the top
// — the list's carried-over scroll (see renderProjectPage) belonged to
// whatever it showed before.
function setJournalDateRange(start, end) {
  journalFilter.start = start;
  journalFilter.end = end;
  render();
  const list = document.querySelector('[data-scroll-key="journal"]');
  if (list) list.scrollTop = 0;
}

function pickJournalDate(dateStr) {
  if (journalRangeAnchor === null) {
    journalRangeAnchor = dateStr;
    setJournalDateRange(dateStr, dateStr);
    return;
  }
  const [start, end] = [journalRangeAnchor, dateStr].sort();
  closeJournalCalendar();
  setJournalDateRange(start, end);
}

// The calendar opens on the month of the filter's last day, else the newest
// entry's month, else this month.
function initialJournalCalendarMonth(name) {
  const state = journalCache[name];
  const newest = state && !state.error && state.days.length > 0 ? state.days[0].date : null;
  const date = parseDateOnly(journalFilter.end || newest || toDateOnlyString(new Date()));
  return { year: date.getFullYear(), month: date.getMonth() };
}

// The bar above the journal: the search text, a "3 of 27" count of entries
// and a clear-all × (those two only while a filter is set), with the date
// button, which opens buildJournalCalendar, at its right end. Typing applies
// through `onChange` (re-filling just the list — see buildJournalPanel); the
// date button and × go through a full render().
function buildJournalFilterBar(entry, onChange) {
  const dated = journalFilter.start !== null;
  const dateDropdown = buildFilterDateDropdown({
    open: journalCalendarOpen,
    rangeLabel: dated ? formatShortDateRange(journalFilter.start, journalFilter.end) : null,
    title: dated ? `Entries from ${formatDateRange(journalFilter)}` : "Filter entries by date",
    onToggle: () => {
      if (journalCalendarOpen) {
        closeJournalCalendar();
      } else {
        journalCalendarOpen = true;
        journalCalendarMonth = initialJournalCalendarMonth(entry.name);
        openTagsDropdownFor = null;
        closeTaskCalendar();
        taskDueCalendarOpen = false;
        portSwitchOpen = false;
      }
    },
    buildCalendar: () => buildJournalCalendar(entry),
  });
  const filter = buildPanelFilter({
    key: "journal",
    value: journalFilter.query,
    placeholder: "Filter by note or file…",
    label: "Filter journal entries",
    onInput: (query) => {
      journalFilter.query = query;
      onChange();
    },
    onClear: () => {
      journalFilter = emptyJournalFilter();
      closeJournalCalendar();
    },
    segments: [dateDropdown],
  });
  return {
    el: filter.el,
    clear: filter.clear,
    updateStatus(shown, total) {
      const active = isJournalFilterActive();
      filter.updateStatus(active ? `${shown} of ${total}` : null, active);
    },
  };
}

/// The day a project's folder was created, once projectPathInfo has it.
function projectCreatedDate(name) {
  const info = projectPathInfo[name];
  return info && !info.error && info.created ? toDateOnlyString(new Date(info.created)) : null;
}

// The days the calendar offers: the project's lifetime, from the day it was
// created (its folder's creation date, or its oldest entry's if that's
// earlier) to today (or its newest entry's, if later). `first` is null until
// both of those are known.
function journalCalendarBounds(name) {
  const state = journalCache[name];
  const entryDates = state && !state.error ? state.days.map((d) => d.date) : [];
  const created = projectCreatedDate(name);
  const first = created ? [created, ...entryDates].sort()[0] : null;
  const last = [toDateOnlyString(new Date()), ...entryDates].sort().pop();
  return { first, last };
}

// The Journal filter field's calendar: days with entries carry a dot (of
// those its search lets through), and the months stop at the project's
// lifetime (see journalCalendarBounds).
function buildJournalCalendar(entry) {
  const state = journalCache[entry.name];
  const days = state && !state.error ? filterJournalDays(state.days, { withDates: false }) : [];
  return buildDateCalendar({
    month: journalCalendarMonth,
    range: journalFilter,
    anchor: journalRangeAnchor,
    bounds: journalCalendarBounds(entry.name),
    counts: new Map(days.map((d) => [d.date, d.entries.length])),
    describeCount: (n) => `${n} entr${n === 1 ? "y" : "ies"}`,
    presets: calendarPresets(),
    onMonth: (shown) => {
      journalCalendarMonth = shown;
      render();
    },
    onDay: pickJournalDate,
    onRange: (start, end) => {
      closeJournalCalendar();
      setJournalDateRange(start, end);
    },
  });
}

const JOURNAL_NOTE_MAX_LENGTH = 150;

// The Journal panel's bottom input: a textarea with the character counter and
// "Add note" button overlaid inside its own bottom padding (Ctrl/Cmd+Enter
// also submits), so the control reads as built into the box rather than a
// separate row below it. journalDraft holds the in-progress text at module
// level so a full render() triggered by something else never wipes what the
// user is mid-typing here.
function buildJournalComposer(entry, panel) {
  const composer = document.createElement("div");
  composer.className = "journal-composer";

  const wrap = document.createElement("div");
  wrap.className = "journal-input-wrap";

  const textarea = document.createElement("textarea");
  textarea.className = "journal-input";
  textarea.rows = 3;
  textarea.maxLength = JOURNAL_NOTE_MAX_LENGTH;
  textarea.placeholder = "Add a journal note… (Ctrl+Enter to save)";
  textarea.value = journalDraft[entry.name] || "";

  const footer = document.createElement("div");
  footer.className = "journal-input-footer";

  const counter = document.createElement("div");
  counter.className = "journal-counter";
  function updateCounter() {
    counter.textContent = `${textarea.value.length}/${JOURNAL_NOTE_MAX_LENGTH}`;
  }
  updateCounter();

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "journal-add-btn";
  addBtn.textContent = "Add note";
  addBtn.disabled = !textarea.value.trim();
  addBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    addBtn.disabled = true;
    await submitJournalNote(entry, panel);
    addBtn.disabled = !(journalDraft[entry.name] || "").trim();
  });

  textarea.addEventListener("click", (e) => e.stopPropagation());
  textarea.addEventListener("input", () => {
    journalDraft[entry.name] = textarea.value;
    addBtn.disabled = !textarea.value.trim();
    updateCounter();
  });
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitJournalNote(entry, panel);
    }
  });

  footer.appendChild(counter);
  footer.appendChild(addBtn);
  wrap.appendChild(textarea);
  wrap.appendChild(footer);
  composer.appendChild(wrap);
  return composer;
}

// Posts the current draft for `entry`, updates the journal cache, and
// re-renders; failures surface via showCardError at the foot of the Journal
// panel. Shared by the composer's Ctrl+Enter shortcut and its "Add note"
// button.
async function submitJournalNote(entry, panel) {
  const content = (journalDraft[entry.name] || "").trim();
  if (!content || journalSubmitting.has(entry.name)) return;
  journalSubmitting.add(entry.name);
  try {
    journalCache[entry.name] = await postJournalEntry(entry.name, content);
    journalDraft[entry.name] = "";
    render();
  } catch (err) {
    showCardError(panel, err.message);
  } finally {
    journalSubmitting.delete(entry.name);
  }
}

function journalCountsMeta(name) {
  const state = journalCache[name];
  if (!state || state.error) return null;
  const entryCount = state.days.reduce((n, day) => n + day.entries.length, 0);
  return { text: `${countLabel(entryCount, "entry", "entries")} · ${countLabel(state.days.length, "day")}`, title: null };
}
