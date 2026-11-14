// Shared pieces: the status toast, dropdown placement, dialogs, calendars, panel filters and empty states.

let statusHideTimer = null;

// setStatus() is only ever called for a real state change (an actual
// save in progress, completed, or failed) — a plain page load never calls
// it, so the toast has no "first load" case to special-case and can always
// play its entrance/exit animations.
function setStatus(kind, message) {
  clearTimeout(statusHideTimer);
  const icons = { saving: ICON_SPINNER, saved: ICON_CHECK, error: ICON_WARNING };
  const labels = { saving: "Saving…", saved: message || "All changes saved", error: message || "Save failed" };
  statusIconEl.innerHTML = icons[kind] || "";
  statusTextEl.textContent = labels[kind] || "";
  statusEl.className = "toast " + kind;
  requestAnimationFrame(() => statusEl.classList.add("show"));
  // Errors get much longer on screen than a "saved" confirmation — the
  // message is often the whole reason the save failed (e.g. a specific
  // validation error), not just a checkmark to glance at. The close
  // button covers dismissing it sooner.
  const hideAfter = { saved: 2200, error: 8000 }[kind];
  if (hideAfter) {
    statusHideTimer = setTimeout(() => statusEl.classList.remove("show"), hideAfter);
  }
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "Nov 1, 2026, 3:28 PM by Michael H.": a stamp's time and who did it (see
// actorOf in services/people.js), or just the time for one from before logins.
function withAuthor(time, person) {
  return person ? `${time} by ${person.name}` : time;
}

// Every dropdown menu is built the same way regardless of which one it is
// (category switcher, kebab menu, filter, assign, ...): absolutely
// positioned below its toggle, anchored left. That default can crop against
// the viewport for a card near the bottom or right edge — a card in the
// last grid row, or one opened from inside a dialog. Rather than teach each
// build function about its own position, this
// runs once after every render() and flips whichever open menus actually
// don't fit, based on their real measured size.
function positionOpenDropdowns() {
  // Portaled menus (see buildTagsDropdown) position themselves via
  // positionPortalMenu instead — .parentElement here would be <body>, not
  // a meaningful anchor to measure against.
  document.querySelectorAll(".dropdown-menu:not(.portal-menu)").forEach((menu) => {
    menu.classList.remove("drop-up", "align-right");
    menu.style.maxHeight = "";
    menu.style.overflowY = "";
    const wrap = menu.parentElement;
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const place = placeDropdown(wrapRect, menuRect, dropdownBounds(wrap));
    if (place.above) menu.classList.add("drop-up");
    if (place.alignRight) menu.classList.add("align-right");
    if (place.maxHeight !== null) {
      menu.style.maxHeight = `${place.maxHeight}px`;
      menu.style.overflowY = "auto";
    }
  });
}

// The gap between a menu and its toggle (matches .dropdown-menu's
// `top: calc(100% + 4px)`), and how far a menu keeps from the edge of
// whatever box it has to stay inside.
const DROPDOWN_GAP = 4;
const DROPDOWN_EDGE_INSET = 8;
// Below this, a height-capped menu would be a sliver too small to use —
// better to let it poke out of its popup than shrink it further.
const DROPDOWN_MIN_HEIGHT = 120;

// The box an open menu has to stay inside: the dialog it was opened from
// (new folders, confirm, ...) or the side column's project form when there
// is one, clipped to the viewport
// either way. A menu inside a popup that only checked the viewport could
// hang past the popup's bottom edge (or, for a nested menu, stretch the
// popup's own scroll area) even with plenty of room left on screen.
// A menu opened inside a project panel (the Journal calendar, the Tasks
// tags menus) keeps within the panel's sides too, so it never hangs out over
// the page beside it — but not its top and bottom, which would squeeze a
// tall menu into a scrolling box in a short panel.
function dropdownBounds(anchorEl) {
  const bounds = {
    top: DROPDOWN_EDGE_INSET,
    left: DROPDOWN_EDGE_INSET,
    bottom: window.innerHeight - DROPDOWN_EDGE_INSET,
    right: window.innerWidth - DROPDOWN_EDGE_INSET,
  };
  // The side column's project form scrolls on its own too, so a menu
  // hanging past its foot (the form's category, in its last row) would be
  // clipped: there it opens upward instead.
  const popup = anchorEl.closest(".modal-panel-inner, .create-side");
  if (popup) {
    const r = popup.getBoundingClientRect();
    bounds.top = Math.max(bounds.top, r.top + DROPDOWN_EDGE_INSET);
    bounds.left = Math.max(bounds.left, r.left + DROPDOWN_EDGE_INSET);
    bounds.bottom = Math.min(bounds.bottom, r.bottom - DROPDOWN_EDGE_INSET);
    bounds.right = Math.min(bounds.right, r.right - DROPDOWN_EDGE_INSET);
  }
  const panel = anchorEl.closest(".project-panel");
  if (panel) {
    const r = panel.getBoundingClientRect();
    bounds.left = Math.max(bounds.left, r.left + DROPDOWN_EDGE_INSET);
    bounds.right = Math.min(bounds.right, r.right - DROPDOWN_EDGE_INSET);
  }
  return bounds;
}

// Shared placement decision for both nested and portaled menus: below the
// toggle if it fits, otherwise above if that fits, otherwise whichever side
// has more room with the menu's height capped to it (so it scrolls
// internally instead of spilling out). Horizontally it stays left-aligned
// with the toggle unless that would cross the right edge.
function placeDropdown(anchorRect, menuRect, bounds) {
  const spaceBelow = bounds.bottom - anchorRect.bottom - DROPDOWN_GAP;
  const spaceAbove = anchorRect.top - bounds.top - DROPDOWN_GAP;
  let above = false;
  let maxHeight = null;
  if (menuRect.height > spaceBelow) {
    if (menuRect.height <= spaceAbove) {
      above = true;
    } else {
      above = spaceAbove > spaceBelow;
      maxHeight = Math.max(DROPDOWN_MIN_HEIGHT, Math.floor(above ? spaceAbove : spaceBelow));
    }
  }
  const alignRight = anchorRect.left + menuRect.width > bounds.right;
  return { above, alignRight, maxHeight };
}

// The one look every checkbox in the app shares — the Filter and Tags menus'
// options draw it directly, real checkboxes get it through decorateCheckbox.
function checkboxIcon(checked) {
  return checked ? ICON_CHECKBOX_CHECKED : ICON_CHECKBOX;
}

// The same for a menu where only one option can be picked (the Tasks
// composer's priority).
function radioIcon(checked) {
  return checked ? ICON_RADIO_CHECKED : ICON_RADIO;
}

// Draws a real checkbox with checkboxIcon() instead of the browser's own box.
// The input itself stays, invisible but laid over the icon, so clicks, Space,
// change events and `disabled` all behave exactly as before; the icon is
// redrawn whenever it changes.
function decorateCheckbox(input) {
  const wrap = document.createElement("span");
  wrap.className = "icon-checkbox";
  const box = document.createElement("span");
  box.className = "icon-checkbox-box";
  box.innerHTML = checkboxIcon(input.checked);
  input.classList.add("icon-checkbox-input");
  input.addEventListener("change", () => {
    box.innerHTML = checkboxIcon(input.checked);
  });
  wrap.append(input, box);
  return wrap;
}

// Keeps the page from scrolling behind a dialog (confirm/prompt, or the new
// folders one) while either is open. Centralized here since a confirm can
// be opened from inside the new folders dialog, and closing it shouldn't
// unlock scrolling while that one is still up.
function updateBodyScrollLock() {
  document.body.style.overflow = activeDialog || newFoldersModalOpen || drawerShowing() ? "hidden" : "";
}

function resolveDialog(result) {
  if (!activeDialog) return;
  const { resolve } = activeDialog;
  activeDialog = null;
  document.getElementById("confirm-overlay").hidden = true;
  document.getElementById("confirm-panel").innerHTML = "";
  updateBodyScrollLock();
  resolve(result);
}

// Custom-styled stand-in for window.confirm() — resolves true/false. Every
// call site already awaits it inside an async function, so this drops in
// wherever confirm(...) used to sit.
function customConfirm(message) {
  return new Promise((resolve) => {
    activeDialog = { resolve };
    renderConfirmDialog({ message });
  });
}

// Custom-styled stand-in for the "type this exact value to confirm"
// pattern the app used window.prompt() for (only the delete-project flow).
// Resolves true/false, not the typed string — the confirm/delete button
// itself stays disabled until the input matches confirmValue exactly, so
// there's no separate "you typed it wrong" step for the caller to handle.
function customPrompt(message, confirmValue) {
  return new Promise((resolve) => {
    activeDialog = { resolve };
    renderConfirmDialog({ message, confirmValue });
  });
}

function renderConfirmDialog({ message, confirmValue }) {
  const overlay = document.getElementById("confirm-overlay");
  const panel = document.getElementById("confirm-panel");
  panel.innerHTML = "";
  overlay.hidden = false;
  updateBodyScrollLock();

  const msg = document.createElement("p");
  msg.className = "confirm-message";
  msg.textContent = message;
  panel.appendChild(msg);

  const isPrompt = confirmValue !== undefined;
  let input = null;
  let okBtn;

  if (isPrompt) {
    const hint = document.createElement("p");
    hint.className = "confirm-hint";
    hint.append("Type ", Object.assign(document.createElement("strong"), { textContent: confirmValue }), " to confirm.");
    panel.appendChild(hint);

    input = document.createElement("input");
    input.type = "text";
    input.className = "confirm-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => {
      okBtn.disabled = input.value !== confirmValue;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !okBtn.disabled) resolveDialog(true);
    });
    panel.appendChild(input);
  }

  const actions = document.createElement("div");
  actions.className = "confirm-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cancel-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => resolveDialog(false));
  actions.appendChild(cancelBtn);

  okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "confirm-btn" + (isPrompt ? " danger" : "");
  okBtn.textContent = isPrompt ? "Delete" : "OK";
  okBtn.disabled = isPrompt;
  okBtn.addEventListener("click", () => resolveDialog(true));
  actions.appendChild(okBtn);

  panel.appendChild(actions);
  requestAnimationFrame(() => (input || cancelBtn).focus());
}

// "Oct 22, 2026" for one day; "Oct 20 – Oct 24, 2026" for a range within a
// year, with both years spelled out when it spans two.
function formatDateRange({ start, end }) {
  const format = (dateStr, withYear) =>
    parseDateOnly(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear && { year: "numeric" }) });
  if (start === end) return format(start, true);
  return `${format(start, start.slice(0, 4) !== end.slice(0, 4))} – ${format(end, true)}`;
}

// Sunday first, like the page's other date pickers; two-letter day names in
// the browser's language (2026-01-04 is a Sunday).
const CALENDAR_WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 0, 4 + i).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)
);

// The quick picks under a calendar: today, the week up to it (or, with
// `lookAhead`, the week from it — for due dates), and this month.
function calendarPresets(lookAhead = false) {
  const now = new Date();
  const day = (offset) => toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const today = day(0);
  return [
    ["Today", today, today],
    lookAhead ? ["Next 7 days", today, day(6)] : ["Last 7 days", day(-6), today],
    [
      "This month",
      toDateOnlyString(new Date(now.getFullYear(), now.getMonth(), 1)),
      toDateOnlyString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    ],
  ];
}

// One month of a date-range picker, shared by the Journal and Tasks filter
// fields — and, picking a single day, by the Tasks composer's due date.
// Days in `counts` carry a dot (hover for
// describeCount's wording), today is outlined, and `range` — the applied
// filter, nulls when there's none — is shaded from its first day to its
// last. While a range is half-picked (`anchor` holds its first day),
// hovering previews it. The months stop at `bounds` and days outside them
// can't be picked; either end may be null for no limit. The line under the
// days explains picking a range, unless `hint` says otherwise (null leaves
// it out). The callers own all
// of this state: the shown month changes through onMonth, a clicked day goes
// to onDay, and a preset or Clear hands its range (nulls to clear) to onRange.
// The preset matching `range` shows as picked.
function buildDateCalendar({ month: shown, range, anchor, bounds, counts, describeCount, presets, hint, onMonth, onDay, onRange }) {
  const { year, month } = shown;
  const today = toDateOnlyString(new Date());
  const shownMonth = toDateOnlyString(new Date(year, month, 1)).slice(0, 7);

  const calendar = document.createElement("div");
  calendar.className = "dropdown-menu date-calendar";

  const head = document.createElement("div");
  head.className = "date-calendar-head";
  const navButton = (icon, label, delta, disabled) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-calendar-nav";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.innerHTML = icon;
    btn.disabled = disabled;
    btn.addEventListener("click", () => {
      const shifted = new Date(year, month + delta, 1);
      onMonth({ year: shifted.getFullYear(), month: shifted.getMonth() });
    });
    return btn;
  };
  const title = document.createElement("span");
  title.className = "date-calendar-title";
  title.textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  head.append(
    navButton(ICON_CHEVRON_LEFT, "Previous month", -1, bounds.first !== null && shownMonth <= bounds.first.slice(0, 7)),
    title,
    navButton(ICON_CHEVRON_RIGHT, "Next month", 1, bounds.last !== null && shownMonth >= bounds.last.slice(0, 7))
  );
  calendar.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "date-calendar-grid";
  for (const name of CALENDAR_WEEKDAYS) {
    const cell = document.createElement("span");
    cell.className = "date-calendar-weekday";
    cell.textContent = name;
    grid.appendChild(cell);
  }
  const leading = new Date(year, month, 1).getDay();
  const weeks = Math.ceil((leading + new Date(year, month + 1, 0).getDate()) / 7);
  const { start, end } = range;
  for (let i = 0; i < weeks * 7; i++) {
    const date = new Date(year, month, 1 - leading + i);
    const dateStr = toDateOnlyString(date);
    const count = counts.get(dateStr) || 0;
    const inRange = start !== null && dateStr >= start && dateStr <= end;
    const day = document.createElement("button");
    day.type = "button";
    day.className =
      "date-calendar-day" +
      (date.getMonth() !== month ? " outside" : "") +
      (dateStr === today ? " today" : "") +
      (count ? " has-items" : "") +
      (inRange ? " in-range" : "") +
      (dateStr === start ? " range-start" : "") +
      (dateStr === end ? " range-end" : "");
    day.dataset.date = dateStr;
    day.disabled = (bounds.first !== null && dateStr < bounds.first) || (bounds.last !== null && dateStr > bounds.last);
    day.setAttribute("aria-pressed", String(inRange));
    const fullDate = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    day.setAttribute("aria-label", count ? `${fullDate}, ${describeCount(count)}` : fullDate);
    if (count) day.title = describeCount(count);
    const num = document.createElement("span");
    num.className = "date-calendar-num";
    num.textContent = date.getDate();
    day.appendChild(num);
    day.addEventListener("click", () => onDay(dateStr));
    day.addEventListener("mouseenter", () => {
      if (anchor === null || day.disabled) return;
      const [from, to] = [anchor, dateStr].sort();
      grid.querySelectorAll(".date-calendar-day").forEach((el) => {
        el.classList.toggle("preview", el.dataset.date >= from && el.dataset.date <= to);
        el.classList.toggle("preview-start", el.dataset.date === from);
        el.classList.toggle("preview-end", el.dataset.date === to);
      });
    });
    grid.appendChild(day);
  }
  grid.addEventListener("mouseleave", () => {
    grid.querySelectorAll(".preview").forEach((el) => el.classList.remove("preview", "preview-start", "preview-end"));
  });
  calendar.appendChild(grid);

  const hintText =
    hint !== undefined ? hint : anchor === null ? "Pick a day — or two, for a range" : "Pick another day to make it a range";
  if (hintText) {
    const hintEl = document.createElement("div");
    hintEl.className = "date-calendar-hint";
    hintEl.textContent = hintText;
    calendar.appendChild(hintEl);
  }

  const foot = document.createElement("div");
  foot.className = "date-calendar-foot";
  for (const [label, from, to] of presets) {
    // The preset spanning exactly the applied range shows as picked.
    const picked = from === start && to === end;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-calendar-preset" + (picked ? " active" : "");
    btn.setAttribute("aria-pressed", String(picked));
    btn.textContent = label;
    btn.addEventListener("click", () => onRange(from, to));
    foot.appendChild(btn);
  }
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "date-calendar-preset clear";
  clearBtn.textContent = "Clear";
  clearBtn.disabled = start === null;
  clearBtn.addEventListener("click", () => onRange(null, null));
  foot.appendChild(clearBtn);
  calendar.appendChild(foot);

  return calendar;
}

// Parsed as a local date (not UTC), same reasoning as buildJournalEntryDate —
// a "YYYY-MM-DD" due date shouldn't drift a day depending on timezone.
function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// A Date as a local "YYYY-MM-DD" — the inverse of parseDateOnly, so a task's
// createdAt timestamp compares against the date filter's days by the day it
// was added here, not the UTC day.
function toDateOnlyString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// --- Panel filter fields: the Explorer, Tasks and Journal panels each have
// one above their list (see buildPanelFilter).

// A search's words, lowercased. Each has to turn up somewhere, in any
// order, for something to match.
function filterTerms(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// Appends `text` to `el` with every place one of `terms` turns up wrapped in
// a .filter-match mark, overlapping finds merged into one. Plain text when
// lowercasing changes its length (a few non-English letters), since the
// places found in the lowercased copy wouldn't line up with it.
function appendHighlighted(el, text, terms) {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) {
    el.append(text);
    return;
  }
  const ranges = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + term.length)) {
      ranges.push([i, i + term.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (let i = 0; i < ranges.length; i++) {
    let [start, end] = ranges[i];
    if (start < pos) continue;
    while (i + 1 < ranges.length && ranges[i + 1][0] <= end) end = Math.max(end, ranges[++i][1]);
    if (start > pos) el.append(text.slice(pos, start));
    const mark = document.createElement("mark");
    mark.className = "filter-match";
    mark.textContent = text.slice(start, end);
    el.appendChild(mark);
    pos = end;
  }
  if (pos < text.length) el.append(text.slice(pos));
}

// A panel's filter field: a search icon and box, then a status (a count)
// and a clear-all ×, each shown only when updateStatus says, then
// `segments` — dropdowns like Tasks' tags and date — at its right end.
// Typing hands the text to `onInput`, and Escape empties a non-empty box
// the same way (the document-level Escape handler leaves the page alone
// while focus is in a field). The × runs `onClear` to reset the panel's
// filter, then a full render() rebuilds the field from it and focus goes
// back to the box. `key` names the field for that, and for
// renderProjectPage, which keeps a focused box focused across a render().
function buildPanelFilter({ key, value, placeholder, label, onInput, onClear, segments = [] }) {
  const bar = document.createElement("div");
  bar.className = "panel-filter";
  bar.innerHTML =
    `<svg class="panel-filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;

  const focusKey = `${key}-filter`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "panel-filter-input";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.autocomplete = "off";
  input.value = value;
  input.dataset.focusKey = focusKey;
  bar.appendChild(input);

  const status = document.createElement("span");
  status.className = "panel-filter-status";
  status.hidden = true;
  bar.appendChild(status);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "panel-filter-clear";
  clearBtn.setAttribute("aria-label", "Clear all filters");
  clearBtn.title = "Clear all filters";
  clearBtn.hidden = true;
  clearBtn.innerHTML =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  bar.appendChild(clearBtn);

  for (const segment of segments) bar.appendChild(segment);

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.stopPropagation();
      input.value = "";
      onInput("");
    }
  });
  // Clears every filter and puts the cursor back in the box, for the × and
  // for an empty list's Clear filter (see buildPanelEmpty).
  function clear() {
    onClear();
    render();
    const box = document.querySelector(`[data-focus-key="${focusKey}"]`);
    if (box) box.focus();
  }
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clear();
  });

  return {
    el: bar,
    clear,
    // `text` (a count) shows when there is one, the × whenever `active`.
    updateStatus(text, active) {
      status.textContent = text || "";
      status.hidden = !text;
      clearBtn.hidden = !active;
    },
  };
}

// A filter field's date segment: a calendar icon and "Date", or
// `rangeLabel` once a range is picked, over the menu `buildCalendar` makes.
// The caller owns whether it's open — the toggle runs `onToggle`, then
// render(), the same way every other dropdown here opens (see
// positionOpenDropdowns).
function buildFilterDateDropdown({ open, rangeLabel, title, onToggle, buildCalendar }) {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown filter-date-dropdown" + (open ? " open" : "");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dropdown-toggle filter-date-toggle" + (rangeLabel ? " active" : "");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.title = title;
  toggle.innerHTML = ICON_CALENDAR;
  const label = document.createElement("span");
  label.className = "filter-date-label";
  label.textContent = rangeLabel || "Date";
  toggle.appendChild(label);
  toggle.insertAdjacentHTML(
    "beforeend",
    `<svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">` +
      `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle();
    render();
  });
  dropdown.appendChild(toggle);
  if (open) dropdown.appendChild(buildCalendar());
  return dropdown;
}

// Places a portaled dropdown menu (see buildTagsDropdown) next to its
// toggle, kept inside dropdownBounds() — the same placeDropdown()
// decision positionOpenDropdowns() applies to every other (non-portaled)
// dropdown via CSS classes, just turned into fixed coordinates here since
// this menu has no positioned ancestor to anchor to.
function positionPortalMenu(toggleEl, menu) {
  const toggleRect = toggleEl.getBoundingClientRect();
  menu.style.minWidth = `${toggleRect.width}px`;
  menu.style.maxHeight = ""; // measure its natural height, not a cap left over from the last placement
  const menuRect = menu.getBoundingClientRect();
  const bounds = dropdownBounds(toggleEl);

  const place = placeDropdown(toggleRect, menuRect, bounds);
  const height = place.maxHeight === null ? menuRect.height : Math.min(menuRect.height, place.maxHeight);
  if (place.maxHeight !== null) menu.style.maxHeight = `${place.maxHeight}px`;
  menu.style.top = place.above ? `${toggleRect.top - DROPDOWN_GAP - height}px` : `${toggleRect.bottom + DROPDOWN_GAP}px`;

  // Unlike a nested menu, this one can be nudged freely, so instead of just
  // right-aligning it's also clamped — a wide menu under a narrow toggle
  // near the window's left edge still lands fully inside.
  const preferredLeft = place.alignRight ? toggleRect.right - menuRect.width : toggleRect.left;
  const maxLeft = Math.max(bounds.left, bounds.right - menuRect.width);
  menu.style.left = `${Math.min(Math.max(preferredLeft, bounds.left), maxLeft)}px`;
}

// What a panel shows in its list's place when there's nothing to list: an
// icon in a circle over a title, a line on why and what to do about it, and
// at most one button (`action`: { label, icon, onClick }). `tone: "error"`
// tints the icon red, for a load that failed (see buildLoadErrorEmpty).
function buildPanelEmpty({ icon, title, text, action = null, tone = null }) {
  const empty = document.createElement("div");
  empty.className = "panel-empty" + (tone ? ` ${tone}` : "");
  const iconEl = document.createElement("span");
  iconEl.className = "panel-empty-icon";
  iconEl.innerHTML = icon;
  const titleEl = document.createElement("div");
  titleEl.className = "panel-empty-title";
  titleEl.textContent = title;
  empty.append(iconEl, titleEl);
  if (text) {
    const textEl = document.createElement("div");
    textEl.className = "panel-empty-text";
    textEl.textContent = text;
    empty.appendChild(textEl);
  }
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panel-empty-action";
    btn.innerHTML = action.icon || "";
    btn.append(action.label);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.onClick();
    });
    empty.appendChild(btn);
  }
  return empty;
}

// Where a panel's list goes while its data is on the way.
function buildPanelLoading() {
  const loading = document.createElement("div");
  loading.className = "panel-loading";
  loading.textContent = "Loading…";
  return loading;
}

// A panel whose data didn't load: what failed (`title`), why, and a Try
// again that asks for everything of the project's that failed, since one
// cause (the server being down) usually fails them all.
function buildLoadErrorEmpty(name, title, message) {
  return buildPanelEmpty({
    icon: ICON_WARNING,
    tone: "error",
    title,
    text: describeLoadError(message),
    action: { label: "Try again", icon: ICON_REFRESH, onClick: () => retryFailedLoads(name) },
  });
}

// fetch() rejects with a TypeError, worded by the browser ("NetworkError
// when attempting to fetch resource.", "Failed to fetch", "Load failed"),
// when nothing answers at all — this dashboard's own server is down or
// restarting. Anything else is the server's own message, shown as it is.
function describeLoadError(message) {
  return /NetworkError|Failed to fetch|Load failed/i.test(message)
    ? "The Dispatch server didn't answer. Make sure it's running, then try again."
    : message;
}

// "1 file", "3 files".
function countLabel(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Puts `message` just above the element's own action row when it has one
// (a card), or at its foot otherwise (the project header, a panel).
function showCardError(card, message) {
  clearCardError(card);
  const err = document.createElement("div");
  err.className = "card-error";
  err.textContent = message;
  card.insertBefore(err, card.querySelector(":scope > .card-actions"));
}

function clearCardError(card) {
  const existing = card.querySelector(".card-error");
  if (existing) existing.remove();
}
