// A project's Tasks panel: the list, filters, tags, and the composer.

// Same lazy-load/cache/dedupe pattern as ensureJournalLoaded, for the Tasks
// tab's dev_resources/tasks.json.
function ensureTasksLoaded(project) {
  if (taskCache[project] || taskInFlight.has(project)) return;
  taskInFlight.add(project);
  fetchTasks(project)
    .then((result) => {
      taskCache[project] = result;
    })
    .catch((err) => {
      taskCache[project] = { error: err.message };
    })
    .finally(() => {
      taskInFlight.delete(project);
      render();
    });
}

// The Tasks panel's content: a flat to-do list (newest first) with a checkbox
// to mark each one done, plus per-row archive/delete actions, a filter bar
// above it, and a composer at the bottom to add a new one. Archived tasks
// stay in tasks.json and are left out of this list until the header's
// "archived" box is checked, where each has an Unarchive button instead —
// so of the two only Delete is something the tab itself can't undo.
function buildTasksPanel(entry, panel) {
  ensureTasksLoaded(entry.name);
  const container = document.createElement("div");
  container.className = "tasks-tab";

  const listEl = document.createElement("div");
  listEl.className = "task-list panel-scroll";
  listEl.dataset.scrollKey = "tasks"; // see renderProjectPage
  const state = taskCache[entry.name];

  if (!state) {
    listEl.appendChild(buildPanelLoading());
  } else if (state.error) {
    // Nothing to add a task to until the list can be read.
    container.appendChild(buildLoadErrorEmpty(entry.name, "Couldn't load tasks", state.error));
    return container;
  } else if (state.tasks.length === 0) {
    listEl.appendChild(
      buildPanelEmpty({ icon: ICON_LIST_CHECK, title: "No tasks yet", text: "Add one below to keep track of what's left to do." })
    );
  } else {
    const visible = tasksForStatusFilter(state.tasks);
    // Re-fills just the list, not the whole page — typing in the filter's
    // search box calls this on every keystroke, and a full render() would
    // rebuild (and so unfocus) that very input.
    const filterBar = buildTaskFilterBar(entry.name, visible, state.tags, fillList);
    container.appendChild(filterBar.el);
    function fillList() {
      listEl.textContent = "";
      const matching = visible.filter((task) => taskMatchesFilter(task, taskFilter));
      if (visible.length === 0) listEl.appendChild(buildPanelEmpty({ icon: ICON_LIST_CHECK, ...noTasksForStatusEmpty() }));
      else if (matching.length === 0) {
        listEl.appendChild(
          buildPanelEmpty({
            icon: ICON_SEARCH,
            title: "No matching tasks",
            text: "No task's ID, title, description, tags or dates match this filter.",
            action: { label: "Clear filter", onClick: filterBar.clear },
          })
        );
      } else matching.forEach((task) => listEl.appendChild(buildTaskRow(entry, task, panel)));
      filterBar.updateStatus(matching.length, visible.length);
    }
    fillList();
  }

  container.appendChild(listEl);
  container.appendChild(buildTaskComposer(entry, panel));
  return container;
}

// Which of the Tasks header's figures a task counts under.
function taskStatus(task) {
  return task.archived ? "archived" : task.done ? "done" : "open";
}

// The tasks the header's status boxes let through: those under a checked one.
function tasksForStatusFilter(tasks) {
  return tasks.filter((t) => taskStatusFilter.has(taskStatus(t)));
}

// "No archived tasks", "No open or done tasks": the title and line of the
// list's empty state (see buildPanelEmpty) when none of the project's tasks
// are under the checked statuses.
function noTasksForStatusEmpty() {
  if (taskStatusFilter.size === 0) return { title: "No status checked", text: "Check open, done or archived above to list those tasks." };
  const statuses = TASK_STATUSES.filter((s) => taskStatusFilter.has(s));
  return {
    title: `No ${new Intl.ListFormat("en", { type: "disjunction" }).format(statuses)} tasks`,
    text: "Check another status above to see the rest.",
  };
}

function formatDueDate(dateStr) {
  return parseDateOnly(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isTaskOverdue(task) {
  if (!task.dueDate || task.done) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateOnly(task.dueDate) < today;
}

function isTaskFilterActive(filter) {
  return filter.query.trim() !== "" || filter.tags.size > 0 || filter.start !== null;
}

// The day a task counts as for a date field: its due date (null when it has
// none), or the day it was added here.
function taskFilterDate(task, dateField) {
  return dateField === "due" ? task.dueDate || null : toDateOnlyString(new Date(task.createdAt));
}

// Every filter that's set must match (AND). The search text is split into
// words, each of which has to appear somewhere in the task's id, title,
// description or tag names, in any order; picked tags must all be on the
// task; a date range must take in its due date, or the day it was added.
function taskMatchesFilter(task, filter) {
  const terms = filterTerms(filter.query);
  if (terms.length > 0) {
    const haystack = [task.id, task.title, task.description || "", ...(task.tags || [])].join("\n").toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  if (filter.tags.size > 0) {
    const taskTags = new Set((task.tags || []).map((t) => t.toLowerCase()));
    for (const tag of filter.tags) {
      if (!taskTags.has(tag.toLowerCase())) return false;
    }
  }
  if (filter.start !== null) {
    const taskDate = taskFilterDate(task, filter.dateField);
    if (taskDate === null || taskDate < filter.start || taskDate > filter.end) return false;
  }
  return true;
}

// --- Tasks date filter: the filter field's date button opens the same
// calendar as the Journal's, picking one day or a range the same way.

function closeTaskCalendar() {
  taskCalendarOpen = false;
  taskRangeAnchor = null;
}

// Applies a date range (nulls clear it) and shows the matching tasks from
// the top, same as setJournalDateRange.
function setTaskDateRange(start, end) {
  taskFilter.start = start;
  taskFilter.end = end;
  render();
  const list = document.querySelector('[data-scroll-key="tasks"]');
  if (list) list.scrollTop = 0;
}

function pickTaskDate(dateStr) {
  if (taskRangeAnchor === null) {
    taskRangeAnchor = dateStr;
    setTaskDateRange(dateStr, dateStr);
    return;
  }
  const [start, end] = [taskRangeAnchor, dateStr].sort();
  closeTaskCalendar();
  setTaskDateRange(start, end);
}

// The calendar opens on this month while the range takes in today (so
// "Next 7 days" running into next month opens where it starts), else on
// the month of the range's last day, else this month.
function initialTaskCalendarMonth() {
  const today = toDateOnlyString(new Date());
  const { start, end } = taskFilter;
  const date = parseDateOnly(end !== null && !(start <= today && today <= end) ? end : today);
  return { year: date.getFullYear(), month: date.getMonth() };
}

// "Oct 22", "Oct 20 – 24", "Oct 28 – Nov 3": the date button's short label,
// with years only once the range leaves this year. formatDateRange's full
// version goes in the button's tooltip.
function formatShortDateRange(start, end) {
  const thisYear = String(new Date().getFullYear());
  const withYear = start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear;
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(withYear && { year: "numeric" }) });
  return format.formatRange(parseDateOnly(start), parseDateOnly(end));
}

// The Tasks calendar: a Due date / Date added toggle on top choosing which
// of a task's dates the picked days match, over a buildDateCalendar that
// dots each day with tasks on it (of those the search and tags let through).
// Due dates can fall on any day; added dates stay within the project's
// lifetime, the way the Journal's entries do (see journalCalendarBounds).
function buildTaskCalendar(name, tasks) {
  const field = taskFilter.dateField;
  const undated = { ...taskFilter, start: null, end: null };
  const counts = new Map();
  for (const task of tasks) {
    const date = taskFilterDate(task, field);
    if (date && taskMatchesFilter(task, undated)) counts.set(date, (counts.get(date) || 0) + 1);
  }
  let bounds = { first: null, last: null };
  if (field === "added") {
    const addedDates = tasks.map((task) => taskFilterDate(task, "added"));
    const created = projectCreatedDate(name);
    bounds = {
      first: created ? [created, ...addedDates].sort()[0] : null,
      last: [toDateOnlyString(new Date()), ...addedDates].sort().pop(),
    };
  }

  const calendar = buildDateCalendar({
    month: taskCalendarMonth,
    range: taskFilter,
    anchor: taskRangeAnchor,
    bounds,
    counts,
    describeCount: (n) => `${n} task${n === 1 ? "" : "s"} ${field === "due" ? "due" : "added"}`,
    presets: calendarPresets(field === "due"),
    onMonth: (shown) => {
      taskCalendarMonth = shown;
      render();
    },
    onDay: pickTaskDate,
    onRange: (start, end) => {
      closeTaskCalendar();
      setTaskDateRange(start, end);
    },
  });

  const seg = document.createElement("div");
  seg.className = "task-filter-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Date to filter by");
  for (const [value, label] of [
    ["due", "Due date"],
    ["added", "Date added"],
  ]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "task-filter-seg-btn" + (value === field ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(value === field));
    btn.addEventListener("click", () => {
      if (value === field) return;
      taskFilter.dateField = value;
      taskRangeAnchor = null;
      render();
    });
    seg.appendChild(btn);
  }
  calendar.prepend(seg);
  return calendar;
}

// The Tasks filter field's date segment: "Date", or the picked range
// ("Due Oct 20 – 24") once there is one.
function buildTaskDateDropdown(name, tasks) {
  const active = taskFilter.start !== null;
  const fieldLabel = taskFilter.dateField === "due" ? "Due" : "Added";
  return buildFilterDateDropdown({
    open: taskCalendarOpen,
    rangeLabel: active ? `${fieldLabel} ${formatShortDateRange(taskFilter.start, taskFilter.end)}` : null,
    title: active ? `Tasks ${fieldLabel.toLowerCase()} ${formatDateRange(taskFilter)}` : "Filter by due date or date added",
    onToggle: () => {
      if (taskCalendarOpen) {
        closeTaskCalendar();
      } else {
        taskCalendarOpen = true;
        taskCalendarMonth = initialTaskCalendarMonth();
        openTagsDropdownFor = null;
        closeJournalCalendar();
        taskDueCalendarOpen = false;
        portSwitchOpen = false;
      }
    },
    buildCalendar: () => buildTaskCalendar(name, tasks),
  });
}

// The bar above the task list: the search text, a "3 of 27" count and a
// clear-all × (those two only while a filter is set), with the tags
// dropdown and the date button as segments at its right end. Typing applies
// through `onChange` (re-filling just the list — see buildTasksPanel); the
// dropdowns and × go through a full render() like every other dropdown,
// which rebuilds this bar from taskFilter anyway.
function buildTaskFilterBar(name, tasks, knownTags, onChange) {
  const tagsDropdown = buildTagsDropdown(knownTags, taskFilter.tags, "filter", { allowNewTags: false });
  tagsDropdown.querySelector(".tags-toggle").classList.toggle("active", taskFilter.tags.size > 0);
  const filter = buildPanelFilter({
    key: "tasks",
    value: taskFilter.query,
    placeholder: "Filter by ID, title, description or tag…",
    label: "Filter tasks",
    onInput: (query) => {
      taskFilter.query = query;
      onChange();
    },
    onClear: () => {
      taskFilter = emptyTaskFilter(taskFilter.dateField);
      closeTaskCalendar();
      openTagsDropdownFor = null;
    },
    segments: [tagsDropdown, buildTaskDateDropdown(name, tasks)],
  });
  return {
    el: filter.el,
    clear: filter.clear,
    updateStatus(shown, total) {
      const active = isTaskFilterActive(taskFilter);
      filter.updateStatus(active ? `${shown} of ${total}` : null, active);
    },
  };
}

const TAG_MAX_LENGTH = 30;

function getTaskTagsDraft(name) {
  if (!taskTagsDraft[name]) taskTagsDraft[name] = new Set();
  return taskTagsDraft[name];
}

// Removes any member of `selected` that case-insensitively matches `tag` —
// selected tags are added under a dropdown option's exact (canonical) label,
// but this makes toggling off robust even if a caller ever passes a
// differently-cased variant of the same tag.
function removeTagCaseInsensitive(selected, tag) {
  const key = tag.toLowerCase();
  for (const t of selected) {
    if (t.toLowerCase() === key) selected.delete(t);
  }
}

// A custom checkbox-list dropdown for picking a task's tags, shared by the
// composer (creating a task) and the inline edit form (editing one) — same
// `.dropdown`/`.dropdown-menu`/checkboxIcon() shell the Filter dropdown uses.
// `knownTags` is the project's persisted tag list; `selected` is the Set
// being built up by this particular form. A tag typed into "New tag…" is
// just added straight to `selected` — it only becomes a real project tag
// once the task is actually saved (see mergeKnownTags on the server).
// `allowNewTags: false` drops the "New tag…" row, for the Tasks panel's filter
// bar — filtering by a tag no task has yet can only ever match nothing.
function buildTagsDropdown(knownTags, selected, dropdownKey, { allowNewTags = true } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "dropdown tags-dropdown" + (openTagsDropdownFor === dropdownKey ? " open" : "");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "dropdown-toggle tags-toggle";
  toggleBtn.dataset.dropdownKey = dropdownKey; // lets findOpenTagsToggle() locate this on scroll
  toggleBtn.innerHTML =
    `<span>Tags${selected.size ? ` (${selected.size})` : ""}</span>` +
    `<svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">` +
    `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openTagsDropdownFor = openTagsDropdownFor === dropdownKey ? null : dropdownKey;
    closeJournalCalendar();
    closeTaskCalendar();
    taskDueCalendarOpen = false;
    portSwitchOpen = false;
    openStaffMenu = null;
    render();
  });
  wrap.appendChild(toggleBtn);

  if (openTagsDropdownFor === dropdownKey) {
    const menu = document.createElement("div");
    // Portaled straight onto <body> instead of nested under `wrap`, and
    // placed with fixed coordinates by positionPortalMenu — so the Tasks
    // panel's fixed height and scrolling list can never clip it or stretch
    // around it, and it can be clamped to the window from any side.
    menu.className = "dropdown-menu portal-menu";

    // Known tags plus any not-yet-saved tag this form already has selected,
    // so a freshly-typed tag shows up checked immediately.
    const allTags = knownTags.slice();
    for (const tag of selected) {
      if (!allTags.some((k) => k.toLowerCase() === tag.toLowerCase())) allTags.push(tag);
    }

    const optionsEl = document.createElement("div");
    optionsEl.className = "dropdown-scroll";
    menu.appendChild(optionsEl);

    if (allTags.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dropdown-empty";
      empty.textContent = "No tags yet.";
      optionsEl.appendChild(empty);
    } else {
      for (const tag of allTags) {
        const on = [...selected].some((t) => t.toLowerCase() === tag.toLowerCase());
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "dropdown-option";
        opt.innerHTML = `<span class="dropdown-option-content">${checkboxIcon(on)}<span class="label">${tag}</span></span>`;
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          if (on) removeTagCaseInsensitive(selected, tag);
          else selected.add(tag);
          render();
        });
        optionsEl.appendChild(opt);
      }
    }

    if (allowNewTags) {
      menu.appendChild(Object.assign(document.createElement("div"), { className: "dropdown-divider" }));

      const newTagRow = document.createElement("div");
      newTagRow.className = "dropdown-new-tag";
      const newTagInput = document.createElement("input");
      newTagInput.type = "text";
      newTagInput.className = "dropdown-new-tag-input";
      newTagInput.maxLength = TAG_MAX_LENGTH;
      newTagInput.placeholder = "New tag…";
      const addTagBtn = document.createElement("button");
      addTagBtn.type = "button";
      addTagBtn.className = "dropdown-new-tag-btn";
      addTagBtn.textContent = "Add";
      function submitNewTag() {
        const tag = newTagInput.value.trim();
        if (!tag) return;
        selected.add(tag);
        newTagInput.value = "";
        render();
      }
      newTagInput.addEventListener("click", (e) => e.stopPropagation());
      newTagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitNewTag();
        }
      });
      addTagBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        submitNewTag();
      });
      newTagRow.appendChild(newTagInput);
      newTagRow.appendChild(addTagBtn);
      menu.appendChild(newTagRow);
    }

    document.body.appendChild(menu);
    // toggleBtn isn't connected/laid out yet at this point — buildTagsDropdown
    // only returns a detached subtree for its caller to insert — so the real
    // position has to be measured a frame later, once it actually is.
    requestAnimationFrame(() => positionPortalMenu(toggleBtn, menu));
  }

  return wrap;
}

// Finds the .tags-toggle button matching whichever dropdown is currently
// open (there's at most one, since openTagsDropdownFor is a single value) —
// used to reposition its portaled menu on scroll, when the caller doesn't
// already have a direct reference to that button.
function findOpenTagsToggle() {
  return [...document.querySelectorAll(".tags-toggle")].find((el) => el.dataset.dropdownKey === openTagsDropdownFor);
}

// The task's short id as a badge with a copy icon inside it after the code;
// clicking the badge copies the id. As feedback, "Copied" briefly replaces the
// code and the icon turns into a checkmark.
function buildTaskCodeBadge(task, panel) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "task-copy";
  btn.title = "Copy task ID";
  btn.setAttribute("aria-label", `Copy task ID ${task.id}`);
  const code = document.createElement("span");
  code.className = "task-code";
  code.textContent = task.id;
  const icon = document.createElement("span");
  icon.className = "task-copy-icon";
  icon.innerHTML = ICON_TASK_COPY;
  btn.append(code, icon);
  let resetTimer = null;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(task.id);
      clearTimeout(resetTimer);
      code.textContent = "Copied";
      icon.innerHTML = ICON_CHECK;
      btn.classList.add("copied");
      resetTimer = setTimeout(() => {
        code.textContent = task.id;
        icon.innerHTML = ICON_TASK_COPY;
        btn.classList.remove("copied");
      }, 1200);
    } catch (err) {
      showCardError(panel, `Copy failed: ${err.message}`);
    }
  });
  return btn;
}

function buildTaskRow(entry, task, panel) {
  const isEditingThis = editingTaskId === task.id;
  // Disabled either because a request against it is actually in flight, or
  // because its data is sitting unsaved in the composer below — checking
  // done/archiving/deleting it from here while that's true would race (or
  // silently conflict) with whatever Save changes/Cancel ends up doing.
  const isDisabled = taskUpdating.has(task.id) || isEditingThis;
  const row = document.createElement("div");
  row.className = "task-row" + (task.done ? " done" : "") + (isEditingThis ? " editing" : "") + (isDisabled ? " disabled" : "");
  row.dataset.taskId = task.id; // lets refreshTaskRowDisabled() find this row directly, without a full render()

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.disabled = isDisabled;
  checkbox.setAttribute("aria-label", task.done ? "Mark task not done" : "Mark task done");
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => updateTask(entry, task.id, { done: checkbox.checked }, panel));
  row.appendChild(decorateCheckbox(checkbox));

  const main = document.createElement("div");
  main.className = "task-main";

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  main.appendChild(title);

  if (task.description) {
    const description = document.createElement("div");
    description.className = "task-description";
    description.textContent = task.description;
    main.appendChild(description);
  }

  // Two meta rows: the task's dates on top — added, due, then when it was
  // archived or else marked done (left out for tasks finished before those
  // stamps existed) — and its ID badge and tags under them.
  const dates = document.createElement("div");
  dates.className = "task-meta task-dates";
  const addDate = (text, className) => {
    if (dates.childElementCount > 0) {
      const sep = document.createElement("span");
      sep.className = "task-meta-sep";
      sep.textContent = "•";
      dates.appendChild(sep);
    }
    const part = document.createElement("span");
    if (className) part.className = className;
    part.textContent = text;
    dates.appendChild(part);
  };
  addDate(`Added ${formatTimestamp(task.createdAt)}`);
  if (task.dueDate) addDate(`Due ${formatDueDate(task.dueDate)}`, "task-due" + (isTaskOverdue(task) ? " overdue" : ""));
  if (task.archived && task.archivedAt) addDate(`Archived ${formatTimestamp(task.archivedAt)}`);
  else if (task.done && task.doneAt) addDate(`Marked as done ${formatTimestamp(task.doneAt)}`);
  main.appendChild(dates);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  meta.appendChild(buildTaskCodeBadge(task, panel));
  (task.tags || []).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "task-tag";
    tagEl.textContent = `#${tag}`;
    meta.appendChild(tagEl);
  });
  main.appendChild(meta);

  row.appendChild(main);

  const end = document.createElement("div");
  end.className = "task-end";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "task-action-btn" + (isEditingThis ? " active" : "");
  editBtn.disabled = isDisabled;
  editBtn.setAttribute("aria-label", "Edit task");
  editBtn.title = "Edit task";
  editBtn.innerHTML = ICON_EDIT;
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // No inline editing — load this task's data into the composer at the
    // bottom of the tab instead, same fields, so editing and adding a task
    // share one form. Enter/Save-changes there PATCHes this task's id.
    editingTaskId = task.id;
    editingTaskProject = entry.name;
    taskTitleDraft[entry.name] = task.title;
    taskDescriptionDraft[entry.name] = task.description || "";
    taskDueDraft[entry.name] = task.dueDate || "";
    taskTagsDraft[entry.name] = new Set(task.tags || []);
    taskDueCalendarOpen = false;
    render();
    requestAnimationFrame(() => {
      const el = document.querySelector(".task-title-input");
      if (el) {
        el.focus();
        el.select();
        el.scrollIntoView({ block: "nearest" });
      }
    });
  });
  end.appendChild(editBtn);

  // An archived task (shown once the header's "archived" box is checked)
  // gets Unarchive here instead, putting it back among the open/done ones.
  const archiveLabel = task.archived ? "Unarchive task" : "Archive task";
  const archiveBtn = document.createElement("button");
  archiveBtn.type = "button";
  archiveBtn.className = "task-action-btn";
  archiveBtn.disabled = isDisabled;
  archiveBtn.setAttribute("aria-label", archiveLabel);
  archiveBtn.title = archiveLabel;
  archiveBtn.innerHTML = task.archived ? ICON_UNARCHIVE : ICON_ARCHIVE;
  archiveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    updateTask(entry, task.id, { archived: !task.archived }, panel);
  });
  end.appendChild(archiveBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "task-action-btn";
  deleteBtn.disabled = isDisabled;
  deleteBtn.setAttribute("aria-label", "Delete task");
  deleteBtn.title = "Delete task";
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeTask(entry, task.id, panel);
  });
  end.appendChild(deleteBtn);

  row.appendChild(end);
  return row;
}

const TASK_TITLE_MAX_LENGTH = 80;
const TASK_DESCRIPTION_MAX_LENGTH = 500;

// Clears the composer's draft state for `name` and exits edit mode — called
// when an edit is explicitly canceled, or abandoned by leaving the page.
// Doesn't render(); callers do that themselves alongside whatever else
// they're changing.
function cancelTaskEdit(name) {
  editingTaskId = null;
  editingTaskProject = null;
  taskTitleDraft[name] = "";
  taskDescriptionDraft[name] = "";
  taskDueDraft[name] = "";
  taskTagsDraft[name] = new Set();
  taskDueCalendarOpen = false;
}

// The Tasks panel's bottom composer: a one-line title input (required — Enter
// there moves on to the description) above a description textarea
// (optional) whose bottom strip holds the optional due date, the tags
// dropdown, and the Add/Save button; Ctrl+Enter in either field submits.
// taskTitleDraft/taskDescriptionDraft/taskDueDraft/taskTagsDraft hold the
// in-progress values at module level so a full render() triggered by
// something else never wipes what's mid-entry.
// Doubles as the edit form: clicking a task row's edit button loads that
// task's fields in here (see buildTaskRow) instead of editing inline, so
// there's exactly one place with this add/edit UI rather than two.
function buildTaskComposer(entry, panel) {
  const isEditing = editingTaskId !== null && editingTaskProject === entry.name;

  const composer = document.createElement("div");
  composer.className = "task-composer";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "task-input task-title-input";
  titleInput.maxLength = TASK_TITLE_MAX_LENGTH;
  titleInput.placeholder = isEditing ? "Task title" : "Add a task title…";
  titleInput.value = taskTitleDraft[entry.name] || "";
  composer.appendChild(titleInput);

  // Same box as the Journal panel's composer — a textarea with its controls
  // tucked into its own bottom padding — except Journal only ever has to
  // fit a counter and one button down there; this one also has the due
  // date picker and the tags dropdown, so that reserved strip is taller.
  const inputWrap = document.createElement("div");
  inputWrap.className = "task-composer-input-wrap";

  const input = document.createElement("textarea");
  input.className = "task-input task-composer-input";
  input.rows = 3;
  input.maxLength = TASK_DESCRIPTION_MAX_LENGTH;
  input.placeholder = isEditing ? "Description (optional)… (Ctrl+Enter to save)" : "Description (optional)… (Ctrl+Enter to add)";
  input.value = taskDescriptionDraft[entry.name] || "";
  inputWrap.appendChild(input);

  const footer = document.createElement("div");
  footer.className = "task-composer-footer";

  const counter = document.createElement("div");
  counter.className = "task-composer-counter";
  function updateCounter() {
    counter.textContent = `${input.value.length}/${TASK_DESCRIPTION_MAX_LENGTH}`;
  }
  updateCounter();
  footer.appendChild(counter);

  const footerRow = document.createElement("div");
  footerRow.className = "task-composer-footer-row";

  footerRow.appendChild(buildTaskDueDropdown(entry.name));

  const knownTags = (taskCache[entry.name] && taskCache[entry.name].tags) || [];
  const tagsDropdown = buildTagsDropdown(knownTags, getTaskTagsDraft(entry.name), "composer");
  tagsDropdown.classList.add("tags-dropdown-grow");
  footerRow.appendChild(tagsDropdown);

  if (isEditing) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelTaskEdit(entry.name);
      render();
    });
    footerRow.appendChild(cancelBtn);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "task-add-btn";
  addBtn.textContent = isEditing ? "Save changes" : "Add task";
  addBtn.disabled = !titleInput.value.trim();
  addBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    addBtn.disabled = true;
    await submitTask(entry, panel);
    addBtn.disabled = !(taskTitleDraft[entry.name] || "").trim();
  });
  footerRow.appendChild(addBtn);

  footer.appendChild(footerRow);
  inputWrap.appendChild(footer);
  composer.appendChild(inputWrap);

  // Shared by both fields: Ctrl+Enter submits, Escape abandons an edit.
  function handleSubmitOrCancelKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitTask(entry, panel);
      return true;
    }
    if (e.key === "Escape" && isEditing) {
      e.preventDefault();
      cancelTaskEdit(entry.name);
      render();
      return true;
    }
    return false;
  }

  titleInput.addEventListener("click", (e) => e.stopPropagation());
  titleInput.addEventListener("input", () => {
    taskTitleDraft[entry.name] = titleInput.value;
    addBtn.disabled = !titleInput.value.trim();
  });
  titleInput.addEventListener("keydown", (e) => {
    if (handleSubmitOrCancelKey(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      input.focus();
    }
  });

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => {
    taskDescriptionDraft[entry.name] = input.value;
    updateCounter();
  });
  input.addEventListener("keydown", handleSubmitOrCancelKey);

  return composer;
}

// The composer's due date: a calendar icon and "Due date", or the picked
// day, over the same calendar the filter fields open (buildDateCalendar) —
// picking a single day here, which closes it. Days other open tasks are due
// carry a dot, so it's easy to see what a day already holds. The day lives
// in taskDueDraft with the rest of the draft.
function buildTaskDueDropdown(name) {
  const due = taskDueDraft[name] || null;
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown task-due-dropdown" + (taskDueCalendarOpen ? " open" : "");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dropdown-toggle task-due-toggle" + (due ? " active" : "");
  toggle.setAttribute("aria-expanded", String(taskDueCalendarOpen));
  toggle.title = due ? `Due ${formatDueDate(due)}` : "Due date (optional)";
  toggle.innerHTML = ICON_CALENDAR;
  const label = document.createElement("span");
  label.className = "task-due-label";
  label.textContent = due ? `Due ${formatShortDateRange(due, due)}` : "Due date";
  toggle.appendChild(label);
  toggle.insertAdjacentHTML(
    "beforeend",
    `<svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">` +
      `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (taskDueCalendarOpen) {
      taskDueCalendarOpen = false;
    } else {
      taskDueCalendarOpen = true;
      const shown = parseDateOnly(due || toDateOnlyString(new Date()));
      taskDueCalendarMonth = { year: shown.getFullYear(), month: shown.getMonth() };
      openTagsDropdownFor = null;
      closeJournalCalendar();
      closeTaskCalendar();
      portSwitchOpen = false;
    }
    render();
  });
  dropdown.appendChild(toggle);
  if (taskDueCalendarOpen) dropdown.appendChild(buildTaskDueCalendar(name, due));
  return dropdown;
}

function buildTaskDueCalendar(name, due) {
  const state = taskCache[name];
  const counts = new Map();
  for (const task of state && !state.error ? state.tasks : []) {
    // The task being edited is the one this picks for, not another one due.
    if (!task.dueDate || task.done || task.archived || task.id === editingTaskId) continue;
    counts.set(task.dueDate, (counts.get(task.dueDate) || 0) + 1);
  }
  const now = new Date();
  const day = (offset) => toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const pick = (dateStr) => {
    taskDueDraft[name] = dateStr || "";
    taskDueCalendarOpen = false;
    render();
  };
  return buildDateCalendar({
    month: taskDueCalendarMonth,
    range: { start: due, end: due },
    anchor: null,
    bounds: { first: null, last: null },
    counts,
    describeCount: (n) => `${countLabel(n, "open task")} due`,
    presets: [
      ["Today", day(0), day(0)],
      ["Tomorrow", day(1), day(1)],
      ["In a week", day(7), day(7)],
    ],
    hint: null,
    onMonth: (shown) => {
      taskDueCalendarMonth = shown;
      render();
    },
    onDay: pick,
    onRange: pick, // a preset's one day, or null from Clear
  });
}

// Posts (or, mid-edit, PATCHes) the current draft for `entry`, updates the
// task cache, and re-renders; failures surface via showCardError, same as
// submitJournalNote.
async function submitTask(entry, panel) {
  const title = (taskTitleDraft[entry.name] || "").trim();
  const description = (taskDescriptionDraft[entry.name] || "").trim();
  if (!title || taskSubmitting.has(entry.name)) return;
  taskSubmitting.add(entry.name);
  // Editing an existing task is a PATCH against its own id — disable that
  // row for the duration, same as any other in-flight change to it. (It's
  // already showing disabled from being loaded in the composer at all —
  // see buildTaskRow — this only matters for the moment right after a
  // failed save, when editingTaskId is still set but taskUpdating no longer
  // is; refreshTaskRowDisabled re-checks both, so it stays disabled either way.)
  const editingId = editingTaskId !== null && editingTaskProject === entry.name ? editingTaskId : null;
  if (editingId) taskUpdating.add(editingId);
  try {
    const tags = Array.from(getTaskTagsDraft(entry.name));
    const dueDate = taskDueDraft[entry.name] || null;
    if (editingId) {
      taskCache[entry.name] = await patchTask(entry.name, editingId, { title, description, dueDate, tags });
      editingTaskId = null;
      editingTaskProject = null;
      taskUpdating.delete(editingId);
    } else {
      taskCache[entry.name] = await postTask(entry.name, title, description, dueDate, tags);
    }
    taskTitleDraft[entry.name] = "";
    taskDescriptionDraft[entry.name] = "";
    taskDueDraft[entry.name] = "";
    taskTagsDraft[entry.name] = new Set();
    taskDueCalendarOpen = false;
    render();
  } catch (err) {
    if (editingId) {
      taskUpdating.delete(editingId);
      refreshTaskRowDisabled(editingId);
    }
    showCardError(panel, err.message);
  } finally {
    taskSubmitting.delete(entry.name);
  }
}

// Re-applies one row's disabled/dimmed look from current state, without a
// full render() — used right when a request against `id` starts or ends.
// render() rebuilds the whole project page from scratch, which would erase
// the very error message showCardError is about to show; a full render()
// (on success, or from some unrelated action) still naturally reflects this
// correctly via buildTaskRow, this only covers the gap until that happens.
// Recomputes disabled fresh (taskUpdating.has(id) || editingTaskId === id)
// rather than trusting a boolean from the caller — a failed Save changes,
// for instance, clears taskUpdating but leaves editingTaskId set, and the
// row needs to stay disabled either way.
function refreshTaskRowDisabled(id) {
  const row = document.querySelector(`.task-row[data-task-id="${id}"]`);
  if (!row) return;
  const disabled = taskUpdating.has(id) || editingTaskId === id;
  row.classList.toggle("disabled", disabled);
  row.querySelectorAll("input, button").forEach((el) => {
    el.disabled = disabled;
  });
}

// Shared by the checkbox (done) and the archive button — both are a PATCH
// against one task id, just with a different field flipped.
async function updateTask(entry, id, changes, panel) {
  if (taskUpdating.has(id)) return;
  taskUpdating.add(id);
  refreshTaskRowDisabled(id);
  try {
    taskCache[entry.name] = await patchTask(entry.name, id, changes);
    taskUpdating.delete(id);
    render();
  } catch (err) {
    taskUpdating.delete(id);
    refreshTaskRowDisabled(id);
    showCardError(panel, err.message);
  }
}

// Unlike archiving, deleting a task can't be undone from the UI, so this
// confirms first — same customConfirm used for deleting a file/folder in the
// Explorer panel.
async function removeTask(entry, id, panel) {
  if (taskUpdating.has(id)) return;
  const confirmed = await customConfirm("Delete this task? This can't be undone.");
  if (!confirmed) return;
  taskUpdating.add(id);
  refreshTaskRowDisabled(id);
  try {
    taskCache[entry.name] = await deleteTask(entry.name, id);
    taskUpdating.delete(id);
    // Deleting the task currently loaded in the composer would otherwise
    // leave it showing "Save changes" for an id that no longer exists.
    if (editingTaskId === id) cancelTaskEdit(entry.name);
    render();
  } catch (err) {
    taskUpdating.delete(id);
    refreshTaskRowDisabled(id);
    showCardError(panel, err.message);
  }
}

function taskCountsMeta(name) {
  const state = taskCache[name];
  if (!state || state.error) return null;
  const counts = { open: 0, done: 0, archived: 0 };
  for (const task of state.tasks) counts[taskStatus(task)]++;
  return { el: buildTaskStatusFilter(counts) };
}

// The Tasks header's figures, each a checkbox button for whether its tasks
// are listed (see tasksForStatusFilter). Checking or unchecking one shows
// the list from the top, same as picking a date range. A status with no
// tasks is disabled; it keeps its checked state for when it has some again.
function buildTaskStatusFilter(counts) {
  const group = document.createElement("div");
  group.className = "task-status-filter";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Show tasks by status");
  for (const status of TASK_STATUSES) {
    const checked = taskStatusFilter.has(status);
    const empty = counts[status] === 0;
    const label = document.createElement("label");
    label.className = "task-status-btn" + (checked ? " active" : "") + (empty ? " disabled" : "");
    if (empty) label.title = `No ${status} tasks`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.disabled = empty;
    checkbox.dataset.focusKey = `task-status-${status}`; // keeps keyboard focus on it through the render() below
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) taskStatusFilter.add(status);
      else taskStatusFilter.delete(status);
      render();
      const list = document.querySelector('[data-scroll-key="tasks"]');
      if (list) list.scrollTop = 0;
    });
    const text = document.createElement("span");
    text.textContent = `${counts[status]} ${status}`;
    label.append(decorateCheckbox(checkbox), text);
    group.appendChild(label);
  }
  return group;
}
