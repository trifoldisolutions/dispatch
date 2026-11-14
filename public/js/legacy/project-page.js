// A project's page: the header (identity, activity, staff, actions) and the panel grid.

function buildPathInfoItem(label, value) {
  const item = document.createElement("span");
  const labelEl = document.createElement("span");
  labelEl.className = "project-path-label";
  labelEl.textContent = label + " ";
  item.appendChild(labelEl);
  item.appendChild(document.createTextNode(value));
  return item;
}

// Lazily fetches and caches a project's on-disk path/timestamps (per project
// name, so re-opening/re-rendering its page doesn't repeat the filesystem
// stat/recursive scan), re-rendering once the fetch resolves.
function ensurePathInfoLoaded(entry) {
  if (projectPathInfo[entry.name] || projectPathInfoInFlight.has(entry.name)) return;
  projectPathInfoInFlight.add(entry.name);
  fetchProjectPathInfo(entry.name)
    .then((result) => {
      projectPathInfo[entry.name] = result;
    })
    .catch((err) => {
      projectPathInfo[entry.name] = { error: err.message };
    })
    .finally(() => {
      projectPathInfoInFlight.delete(entry.name);
      render();
    });
}

// The on-disk path chip shown next to the category tag; click to reveal the
// folder in File Explorer.
function buildPathButton(entry) {
  ensurePathInfoLoaded(entry);
  const info = projectPathInfo[entry.name];

  const pathBtn = document.createElement("button");
  pathBtn.type = "button";
  pathBtn.className = "project-path-link project-folder-link";

  if (!info) {
    pathBtn.textContent = "📁 Loading…";
    pathBtn.disabled = true;
    return pathBtn;
  }
  if (info.error) {
    pathBtn.textContent = "📁 Unavailable";
    pathBtn.title = info.error;
    pathBtn.disabled = true;
    return pathBtn;
  }

  pathBtn.textContent = `📁 ${info.path}`;
  pathBtn.title = `Open ${info.path} in File Explorer`; // in full, since the chip may cut it short
  pathBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await openProjectFolder(entry.name);
    } catch (err) {
      setStatus("error", err.message);
    }
  });
  return pathBtn;
}

// The project's creation/last-edited timestamps, shown below the description.
// Renders nothing until buildPathButton's fetch (triggered earlier in the
// same render) has resolved.
function buildPathMeta(entry) {
  const info = projectPathInfo[entry.name];
  if (!info || info.error) return null;

  const meta = document.createElement("div");
  meta.className = "project-path-meta";
  meta.appendChild(buildPathInfoItem("Created", formatTimestamp(info.created)));
  const sep = document.createElement("span");
  sep.className = "project-path-sep";
  sep.textContent = "•";
  meta.appendChild(sep);
  meta.appendChild(buildPathInfoItem("Last edited", formatTimestamp(info.modified)));
  return meta;
}

// --- Project page (/<name>): everything about one project, rebuilt on every
// render(). A header holds who the project is plus every action on it
// (buildRunButton, unassignEntry, deleteProject, buildAssignDropdown,
// startEditEntry); a grid below holds its Explorer, Tasks, Journal and
// History panels. The project list beside it (public/js/app/projects.js)
// leads to the others.
function renderProjectPage() {
  // A full rebuild would snap every panel's list back to the top on any
  // click inside it (expanding a folder, ticking a task, ...). Carry each
  // one's scroll over, matched by data-scroll-key, while it's still the
  // same project's page.
  const scrolls = {}; // sideways too, for the header's staff row
  // Same for a focused filter field (matched by data-focus-key), caret and
  // all — the Explorer's search results land through a render() while
  // you're still typing in its search box.
  let focus = null;
  if (projectViewEl.dataset.project === currentProjectName) {
    projectViewEl.querySelectorAll("[data-scroll-key]").forEach((el) => {
      scrolls[el.dataset.scrollKey] = { top: el.scrollTop, left: el.scrollLeft };
    });
    const active = document.activeElement;
    if (active && active.dataset.focusKey && projectViewEl.contains(active)) {
      focus = { key: active.dataset.focusKey, start: active.selectionStart, end: active.selectionEnd };
    }
  }

  const { bar, content } = buildProjectPageContent();
  projectViewEl.replaceChildren(...content);
  projectBarEl.replaceChildren(...(bar ? [bar] : []));
  fitStaffNames(projectViewEl);
  projectViewEl.dataset.project = currentProjectName;

  projectViewEl.querySelectorAll("[data-scroll-key]").forEach((el) => {
    const scroll = scrolls[el.dataset.scrollKey];
    if (scroll) {
      el.scrollTop = scroll.top;
      el.scrollLeft = scroll.left;
    }
  });
  if (focus) {
    const el = projectViewEl.querySelector(`[data-focus-key="${focus.key}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (focus.start !== null) el.setSelectionRange(focus.start, focus.end); // null on a checkbox, which has no caret
    }
  }
}

// { bar, content }: the line over the header box (null when there's no
// project to show) and the page's column.
function buildProjectPageContent() {
  if (!registryLoaded) return { bar: null, content: [buildProjectMessage("Loading…")] };

  const found = findProjectByName(currentProjectName);
  if (!found) {
    const content = [
      buildPageEmpty({
        icon: ICON_SEARCH,
        title: `No project named “${currentProjectName}”`,
        text: "It may have been renamed or removed, or the address has a typo. Pick one of your projects, or add a new one.",
        action: { label: "New project", icon: ICON_PLUS, onClick: openCreateDrawer },
      }),
    ];
    return { bar: null, content };
  }

  const section = findProjectSection(currentProjectSection);
  if (currentProjectSection !== null && !section) {
    const content = [
      buildPageEmpty({
        icon: ICON_SEARCH,
        title: `${currentProjectName} has no “${currentProjectSection}” page`,
        text: `Its pages are ${[...PROJECT_SECTIONS, STAFF_SECTION].map((s) => s.title).join(", ")}.`,
        action: { label: `Back to ${currentProjectName}`, onClick: () => navigate(projectPath(currentProjectName)) },
      }),
    ];
    return { bar: null, content };
  }

  const { entry, index, list } = found;
  const header = buildProjectHeader(entry, index, list);
  const bar = buildProjectBar(entry, index, list, header);
  const content = [header];
  // Its edit form is the side column's when that's showing, and otherwise
  // sits under the header, never in the drawer: two forms would share the
  // folder name list's id (see drawerShowing).
  if (isEditingProject(entry, list) && !sideFormShown()) {
    const edit = document.createElement("div");
    edit.id = "project-edit";
    edit.className = "project-edit";
    edit.appendChild(buildCreateProjectForm());
    content.push(edit);
  }
  content.push(section ? buildProjectSectionPage(entry, section) : buildProjectPanels(entry));
  return { bar, content };
}

// The page's column with no project to show (see buildPanelEmpty), boxed in
// a dashed line down to the window's foot where the project would have been.
// /projects with none to open looks the same (public/js/app/projects.js).
function buildPageEmpty(options) {
  const box = document.createElement("div");
  box.className = "page-empty";
  box.appendChild(buildPanelEmpty(options));
  return box;
}

function buildProjectMessage(text) {
  const message = document.createElement("div");
  message.className = "project-message";
  message.textContent = text;
  return message;
}

// Whether the shared add/edit form (see startEditEntry) is editing this
// project right now.
function isEditingProject(entry, list) {
  if (!editingKey || editingKey.list !== list) return false;
  return list === "entries" ? editingKey.port === entry.port : editingKey.name === entry.name;
}

// The project's category, or Unassigned, as a button: it opens the
// Switcher (public/js/app/switchboard.js), where the project can be
// dragged to another port or category.
function buildCategoryBadge(entry, list) {
  const category = list === "entries" ? entry.category : "unassigned";
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "project-badge project-badge-btn" + (list === "entries" ? ` cat-${category}` : "");
  badge.title = "See every project by category, and drag one to another port";
  badge.textContent = `${CATEGORY_ICONS[category]} ${category}`;
  badge.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("dispatch:switch-board", { detail: { project: entry.name } }));
  });
  return badge;
}

// Who the project is — category, folder, description, when it was
// created/last edited — on the left, its changes and tasks in the middle
// (see buildProjectActivity), its staff on the right (see
// buildProjectStaff), and below those why its last run failed. Its name,
// port and actions are on the line above it (see buildProjectBar). Action errors land at the foot of this
// header (see showCardError).
function buildProjectHeader(entry, index, list) {
  const header = document.createElement("section");
  header.className = "project-header";
  header.dataset.project = entry.name;

  const top = document.createElement("div");
  top.className = "project-header-top";

  const identity = document.createElement("div");
  identity.className = "project-identity";

  const meta = document.createElement("div");
  meta.className = "project-meta";
  if (list === "self") meta.innerHTML = `<span class="project-badge">🎛️ Dashboard</span>`;
  else meta.appendChild(buildCategoryBadge(entry, list));
  meta.appendChild(buildPathButton(entry));
  if (list !== "unassigned") meta.appendChild(buildSiteLink(entry));
  if (entry.url) meta.appendChild(buildLiveSiteLink(entry));
  if (entry.status === "finished") {
    const finished = document.createElement("span");
    finished.className = "project-badge finished";
    finished.title = "Delivered: counts toward its client's all-time projects, not active ones";
    finished.innerHTML = `${ICON_CHECK_STATIC}Finished`;
    meta.appendChild(finished);
  }
  identity.appendChild(meta);


  const desc = document.createElement("p");
  desc.className = "project-description" + (entry.description ? "" : " empty");
  desc.textContent = entry.description || "No description";
  if (entry.description) desc.title = entry.description;
  identity.appendChild(desc);

  const pathMeta = buildPathMeta(entry);
  if (pathMeta) identity.appendChild(pathMeta);

  const side = document.createElement("div");
  side.className = "project-side";
  side.append(buildProjectStaff(entry), buildProjectClients(entry));

  top.appendChild(identity);
  top.appendChild(buildProjectActivity(entry));
  top.appendChild(side);
  header.appendChild(top);

  if (list === "entries") {
    const info = projectRunStatus[entry.name];
    if (info && info.status === "crashed" && info.error) {
      header.appendChild(buildProjectCallout("danger", `Last run failed: ${info.error}`));
    }
    if (info && info.twError) {
      header.appendChild(buildProjectCallout("warn", `Tailwind watcher failed: ${info.twError}`));
    }
  }

  return header;
}

// The line over the header box, in the toolbar's row (#project-bar): the
// live dot, name and port, then Switch, Eject and Sync, and at its right
// end the actions (Run, VS Code, Edit or Assign, Delete). Its errors and
// saving spinner still show in the header box (`header`).
function buildProjectBar(entry, index, list, header) {
  const bar = document.createElement("div");
  bar.className = "project-bar-content";
  const main = document.createElement("div");
  main.className = "project-bar-main";
  main.append(buildProjectTitleRow(entry, list), buildProjectBarTools(entry, index, list, header));
  bar.append(main, buildProjectActions(entry, index, list, header));
  return bar;
}

// The live dot, the name (a link to the site while it runs) and the port.
function buildProjectTitleRow(entry, list) {
  const titleRow = document.createElement("div");
  titleRow.className = "project-title-row";
  if (list === "entries") {
    const liveDot = document.createElement("span");
    liveDot.className = "live-dot" + (portLiveStatus[entry.port] ? " live" : "");
    liveDot.dataset.port = entry.port;
    titleRow.appendChild(liveDot);
  } else if (list === "self") {
    // Live by definition, since it's serving this page. No data-port, so the
    // live-status poll, which only checks the projects' ports, leaves it be.
    const liveDot = document.createElement("span");
    liveDot.className = "live-dot live";
    liveDot.title = "Running: it's serving this page";
    titleRow.appendChild(liveDot);
  }
  const title = document.createElement("h1");
  title.className = "project-title";
  if (list === "entries") {
    const titleLink = document.createElement("a");
    titleLink.className = "card-name-text";
    titleLink.dataset.port = entry.port;
    titleLink.textContent = entry.name;
    applyNameLinkState(titleLink, !!portLiveStatus[entry.port]);
    title.appendChild(titleLink);
  } else {
    title.textContent = entry.name;
  }
  const nameGroup = document.createElement("div");
  nameGroup.className = "project-name-group";
  nameGroup.appendChild(title);
  if (list !== "unassigned") {
    const portNumber = document.createElement("span");
    portNumber.className = "project-port-number";
    portNumber.textContent = entry.port;
    portNumber.title =
      list === "self"
        ? `Dispatch always runs on ${entry.port}; projects' ports start at ${BASE_PORT}`
        : `${entry.category}'s port range: ${formatPortRange(categoryPortRange(entry.category))}`;
    nameGroup.appendChild(portNumber);
  }
  titleRow.appendChild(nameGroup);
  return titleRow;
}

// After the port: an assigned project's Switch and Eject — moving it to
// another port, or giving this one back (it moves to Unassigned) — kept
// apart from the actions that aren't about the port, then Sync, on every
// project's page.
function buildProjectBarTools(entry, index, list, header) {
  const group = document.createElement("div");
  group.className = "project-bar-tools";
  if (list === "entries") {
    group.appendChild(buildSwitchButton(entry));
    const ejectBtn = buildProjectActionButton(ICON_EJECT, "Eject", `Eject project from port ${entry.port}`, () =>
      unassignEntry(entry, index, header)
    );
    ejectBtn.classList.add("danger");
    group.appendChild(ejectBtn);
  }
  const syncBtn = buildProjectActionButton(ICON_REFRESH, "Sync", "Reload this page's files, tasks, journal and history", syncProjectPage);
  syncBtn.disabled = syncing;
  syncBtn.classList.toggle("spinning", syncing);
  group.appendChild(syncBtn);
  return group;
}

// Sync: the panels each fetch once per project and then serve from cache,
// so changes made outside Dispatch (tasks.json edited on disk, files an
// agent wrote) wouldn't show. Dropping the caches makes the next render()
// refetch whatever is open; expanded folders and composer drafts are kept
// as they are.
async function syncProjectPage() {
  if (syncing) return;
  syncing = true;
  taskCache = {};
  journalCache = {};
  historyCache = {};
  gitStatusCache = {};
  fileTreeCache = {};
  explorerSearchCache = {};
  explorerCountsCache = {};
  projectPathInfo = {};
  render();
  try {
    await load();
  } catch (err) {
    setStatus("error", `Sync failed: ${err.message}`);
  } finally {
    syncing = false;
    render();
  }
}

// Switch: opens the Switcher (public/js/app/switchboard.js) with this
// project outlined and focused, so it can be dragged, or picked up with
// Enter, onto another port.
function buildSwitchButton(entry) {
  return buildProjectActionButton(ICON_SWITCH, "Switch", "Move this project to another port or category", () => {
    document.dispatchEvent(new CustomEvent("dispatch:switch-board", { detail: { project: entry.name } }));
  });
}

// The chip after the folder path that opens the project's local site in a
// new tab. Unlike the title (which only links while the port is live), it's
// always a link, so it can be opened straight after Run without waiting for
// the next live-status poll.
function buildSiteLink(entry) {
  const url = `http://localhost:${entry.port}`;
  const link = document.createElement("a");
  link.className = "project-path-link project-site-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = `Open ${url} in a new tab`;
  link.textContent = `💻 localhost:${entry.port}`;
  return link;
}

// The chip after the localhost one that opens the project's live site, for a
// project that has one (set in its Edit form). Like the localhost chip it
// names just where it goes — the address without its https:// — in full on
// hover.
function buildLiveSiteLink(entry) {
  const link = document.createElement("a");
  link.className = "project-path-link project-site-link";
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = `Open ${entry.url} in a new tab`;
  link.textContent = `🌐 ${entry.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return link;
}

// The project form's live site as the registry keeps it: "" when left blank,
// https:// added when no scheme was typed (so "example.com" works), without a
// lone trailing slash, and null when it isn't an http(s) address with a
// dotted host at all.
function normalizeSiteUrl(raw) {
  const value = raw.trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href;
}

function buildProjectCallout(kind, text) {
  const callout = document.createElement("div");
  callout.className = `project-callout ${kind}`;
  const icon = document.createElement("span");
  icon.innerHTML = ICON_WARNING;
  callout.appendChild(icon);
  callout.appendChild(document.createTextNode(text));
  return callout;
}

// The header's middle part: the project's last year of changes, then its
// tasks done against open. It loads the journal and tasks itself, since a
// section's own page doesn't have the panels that otherwise would.
function buildProjectActivity(entry) {
  ensureJournalLoaded(entry.name);
  ensureTasksLoaded(entry.name);
  const activity = document.createElement("div");
  activity.className = "project-activity";
  activity.append(buildChangesGraph(entry.name, activity), buildTaskProgress(entry.name));
  return activity;
}

const ACTIVITY_WEEKS = 53; // this week and the 52 before it — a year, the way GitHub shows one

// One square per day over the last ACTIVITY_WEEKS weeks, a column per week
// (Sunday at the top), shaded by how many changes — journal entries — that
// day had: each step a quarter of the busiest day's count.
// This week's column stops at today.
function buildChangesGraph(name, activity) {
  const state = journalCache[name];
  const counts = new Map();
  if (state && !state.error) {
    for (const day of state.days) counts.set(day.date, (counts.get(day.date) || 0) + day.entries.length);
  }

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - (ACTIVITY_WEEKS - 1) * 7);
  const days = [];
  for (let i = 0; ; i++) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    if (date > now) break;
    const key = toDateOnlyString(date);
    days.push({ date, key, count: counts.get(key) || 0, week: Math.floor(i / 7), weekday: i % 7 });
  }
  const total = days.reduce((n, day) => n + day.count, 0);
  const max = Math.max(...days.map((day) => day.count));

  const summaryText = !state
    ? "Loading…"
    : state.error
    ? "Couldn't load the journal"
    : `${countLabel(total, "change")} in the last year`;
  const scale = document.createElement("div");
  scale.className = "activity-legend-scale";
  scale.setAttribute("aria-hidden", "true");
  scale.innerHTML =
    "<span>Less</span>" +
    [0, 1, 2, 3, 4].map((level) => `<span class="activity-swatch activity-level-${level}"></span>`).join("") +
    "<span>More</span>";

  const weekdays = document.createElement("div");
  weekdays.className = "activity-weekdays";
  weekdays.setAttribute("aria-hidden", "true");
  for (const weekday of [1, 3, 5]) {
    const label = document.createElement("span");
    label.style.gridRow = weekday + 2;
    label.textContent = days[weekday].date.toLocaleDateString(undefined, { weekday: "short" });
    weekdays.appendChild(label);
  }

  const grid = document.createElement("div");
  grid.className = "activity-grid";
  grid.setAttribute("role", "img");
  grid.setAttribute("aria-label", `Changes: ${summaryText}`);
  // A month's name over the first week starting in it — and over the first
  // column too, unless the next name follows too closely to fit beside it.
  const monthStarts = [];
  for (let week = 0; week < ACTIVITY_WEEKS; week++) {
    const month = days[week * 7].date.getMonth();
    if (week === 0 || month !== days[(week - 1) * 7].date.getMonth()) monthStarts.push(week);
  }
  if (monthStarts[1] < 3) monthStarts.shift();
  for (const week of monthStarts) {
    const label = document.createElement("span");
    label.className = "activity-month";
    label.style.gridColumn = `${week + 1} / span 3`;
    label.textContent = days[week * 7].date.toLocaleDateString(undefined, { month: "short" });
    label.setAttribute("aria-hidden", "true");
    grid.appendChild(label);
  }
  for (const day of days) {
    const cell = document.createElement("span");
    cell.className = `activity-cell activity-level-${day.count === 0 ? 0 : Math.ceil((day.count / max) * 4)}`;
    cell.style.gridColumn = day.week + 1;
    cell.style.gridRow = day.weekday + 2;
    cell.dataset.date = day.key;
    cell.dataset.count = day.count;
    grid.appendChild(cell);
  }
  grid.addEventListener("mouseover", (e) => {
    const cell = e.target.closest(".activity-cell");
    if (cell) showChangesTooltip(activity, cell);
    else hideChangesTooltip(activity);
  });
  grid.addEventListener("mouseleave", () => hideChangesTooltip(activity));

  const scroll = document.createElement("div");
  scroll.className = "activity-scroll";
  scroll.appendChild(grid);
  const graph = document.createElement("div");
  graph.className = "activity-graph";
  graph.append(weekdays, scroll);

  return buildActivitySection("Changes", summaryText, scale, graph);
}

// "3 changes on Sun, Oct 25, 2026" over a hovered day, kept within the
// activity part's width so it can't push the page sideways on a phone.
function showChangesTooltip(activity, cell) {
  let tip = activity.querySelector(".activity-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "activity-tooltip";
    activity.appendChild(tip);
  }
  const count = Number(cell.dataset.count);
  const figure = document.createElement("strong");
  figure.textContent = count === 0 ? "No changes" : countLabel(count, "change");
  const date = parseDateOnly(cell.dataset.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  tip.replaceChildren(figure, ` on ${date}`);
  const box = activity.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  const center = rect.left + rect.width / 2 - box.left;
  tip.style.left = `${Math.min(Math.max(center, half), box.width - half)}px`;
  tip.style.top = `${rect.top - box.top - 6}px`;
}

function hideChangesTooltip(activity) {
  const tip = activity.querySelector(".activity-tooltip");
  if (tip) tip.remove();
}

// The project's done tasks against its open ones, which together make its
// total. Archived tasks have been put away, so they count as neither — the
// Tasks panel's header still counts them.
function buildTaskProgress(name) {
  const state = taskCache[name];
  const counts = { open: 0, done: 0, archived: 0 };
  if (state && !state.error) for (const task of state.tasks) counts[taskStatus(task)]++;
  const total = counts.open + counts.done;

  const summaryText = !state
    ? "Loading…"
    : state.error
    ? "Couldn't load tasks"
    : total > 0
    ? `${Math.floor((counts.done / total) * 100)}% done`
    : counts.archived > 0
    ? "No open or done tasks"
    : "No tasks yet";

  const legend = document.createElement("div");
  legend.className = "activity-legend";
  if (total > 0) {
    for (const status of ["done", "open"]) {
      const item = document.createElement("span");
      item.className = "activity-legend-item";
      const swatch = document.createElement("span");
      swatch.className = `activity-swatch task-progress-${status}`;
      const figure = document.createElement("span");
      figure.className = "task-progress-figure";
      figure.textContent = counts[status];
      item.append(swatch, figure, ` ${status}`);
      legend.appendChild(item);
    }
    const totalItem = document.createElement("span");
    const totalFigure = document.createElement("span");
    totalFigure.className = "task-progress-figure";
    totalFigure.textContent = total;
    totalItem.append(totalFigure, " total");
    legend.appendChild(totalItem);
  }

  const bar = document.createElement("div");
  bar.className = "task-progress-bar" + (total === 0 ? " empty" : "");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Tasks done");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(counts.done));
  for (const status of ["done", "open"]) {
    if (counts[status] === 0) continue;
    const segment = document.createElement("span");
    segment.className = `task-progress-${status}`;
    segment.style.flex = `${counts[status]} 1 0`;
    segment.title = `${counts[status]} ${status}`;
    bar.appendChild(segment);
  }

  return buildActivitySection("Tasks", summaryText, legend, bar);
}

// A title (text, or a link) and its figure, if any, on the left over `body`,
// with `aside` (a legend), if any, on the right of the title.
function buildActivitySection(titleContent, summaryText, aside, body) {
  const section = document.createElement("div");
  section.className = "activity-section";
  const head = document.createElement("div");
  head.className = "activity-head";
  const main = document.createElement("div");
  main.className = "activity-head-main";
  const title = document.createElement("span");
  title.className = "activity-title";
  title.append(titleContent);
  main.appendChild(title);
  if (summaryText) {
    const summary = document.createElement("span");
    summary.textContent = summaryText;
    main.appendChild(summary);
  }
  head.appendChild(main);
  if (aside) head.appendChild(aside);
  section.append(head, body);
  return section;
}

// Run (assigned projects only), VS Code, Edit, Assign (unassigned projects
// only) and Delete — labeled here, since unlike a card there's room for the
// words. They sit at the right end of the line over the header box (see
// buildProjectBar); an assigned project's Switch and Eject sit after its
// port there instead.
function buildProjectActions(entry, index, list, header) {
  const actions = document.createElement("div");
  actions.className = "card-actions project-actions";

  if (list === "entries") actions.appendChild(buildRunButton(entry));

  actions.appendChild(
    buildProjectActionButton(ICON_VSCODE, "VS Code", "Open in VS Code", async () => {
      try {
        await openInVSCode(entry.name);
      } catch (err) {
        showCardError(header, err.message);
      }
    })
  );

  // Dispatch's own page (see SELF_PROJECT) stops there: it has no
  // registry entry to edit or assign, and it mustn't delete itself.
  if (list === "self") return actions;

  const editBtn = buildProjectActionButton(ICON_EDIT, "Edit", "Edit details", () => startEditEntry(entry, list));
  editBtn.disabled = isEditingProject(entry, list);
  actions.appendChild(editBtn);

  if (list !== "entries") actions.appendChild(buildAssignDropdown(entry, index));

  const deleteBtn = buildProjectActionButton(ICON_TRASH, "Delete", "Delete project", async () => {
    await deleteProject(entry, list, index, header);
    // Once it's gone there's no page left to show — back to the dashboard.
    if (!findProjectByName(entry.name)) navigate("/");
  });
  deleteBtn.classList.add("danger", "danger-fill");
  actions.appendChild(deleteBtn);

  return actions;
}

function buildProjectActionButton(icon, label, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = title;
  btn.innerHTML = `${icon}<span>${label}</span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// The project page's panels, in reading order (History under Explorer), so
// Tab moves through them the way they're laid out. Each also has a page of
// its own at /<name>/<slug>, where it's the only panel and gets all the
// room; on the project page its title links there. `meta` gives the
// figures on the right of its header (see buildProjectPanel).
const PROJECT_SECTIONS = [
  { slug: "explore", area: "explorer", title: "Explorer", meta: explorerCountsMeta, build: (entry) => buildExplorerPanel(entry) },
  { slug: "history", area: "history", title: "History", meta: historyMeta, build: buildHistoryPanel },
  { slug: "tasks", area: "tasks", title: "Tasks", meta: taskCountsMeta, build: buildTasksPanel },
  { slug: "journal", area: "journal", title: "Journal", meta: journalCountsMeta, build: buildJournalPanel },
];

function buildProjectPanels(entry) {
  const grid = document.createElement("div");
  grid.className = "project-grid";
  for (const section of PROJECT_SECTIONS) grid.appendChild(buildSectionPanel(entry, section, true));
  return grid;
}

// A section's own page (/<name>/<slug>): just its panel, as wide and as tall
// as the grid on the project page is.
function buildProjectSectionPage(entry, section) {
  const page = document.createElement("div");
  page.className = "project-section-page";
  page.appendChild(buildSectionPanel(entry, section, false));
  return page;
}

function buildSectionPanel(entry, section, linked) {
  return buildProjectPanel({
    area: section.area,
    title: section.title,
    href: linked ? projectPath(entry.name, section.slug) : null,
    meta: section.meta(entry.name),
    buildBody: (panel) => section.build(entry, panel),
  });
}

// A title that links to its page: the label with a chevron after it.
function buildTitleLink(title, href) {
  const link = document.createElement("a");
  link.className = "project-panel-title-link";
  link.href = href;
  link.dataset.route = "";
  link.title = `Open ${title} on its own page`;
  const label = document.createElement("span");
  label.textContent = title;
  link.appendChild(label);
  link.insertAdjacentHTML("beforeend", ICON_CHEVRON_RIGHT);
  return link;
}

// One dashboard panel: a titled header — the title a link to `href` with a
// chevron after it, when there's one — with at-a-glance figures on its right
// (`meta`: { text, title }, { el } when they're controls of their own, or
// null), over a body filled by `buildBody`,
// which is handed the panel itself, where its errors get shown (see
// showCardError).
function buildProjectPanel({ area, title, href, meta, buildBody }) {
  const panel = document.createElement("section");
  panel.className = `project-panel project-panel-${area}`;

  const header = document.createElement("div");
  header.className = "project-panel-header";
  const heading = document.createElement("h2");
  heading.className = "project-panel-title";
  heading.append(href ? buildTitleLink(title, href) : title);
  header.appendChild(heading);
  if (meta && meta.el) {
    header.appendChild(meta.el);
  } else if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "project-panel-meta";
    metaEl.textContent = meta.text;
    if (meta.title) metaEl.title = meta.title;
    header.appendChild(metaEl);
  }
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "project-panel-body";
  body.appendChild(buildBody(panel));
  panel.appendChild(body);
  return panel;
}

// Drops every cached load of `name`'s that failed, so the render() after it
// fetches them again. What loaded fine is kept.
function retryFailedLoads(name) {
  for (const cache of [taskCache, journalCache, historyCache, gitStatusCache, explorerCountsCache, projectPathInfo, staffCache]) {
    if (cache[name] && cache[name].error) delete cache[name];
  }
  for (const cache of [fileTreeCache, explorerSearchCache]) {
    for (const key of Object.keys(cache)) {
      if (key.startsWith(`${name}::`) && cache[key].error) delete cache[key];
    }
  }
  render();
}

// --- The header's actions: Run/Stop, Eject, Assign, Delete, and the
// title's link to the running site.

// Marks a card as actively saving (dimmed + spinner overlay) right before a
// persist() call. Cleaned up for free by the render() that always follows.
function markCardSaving(cardEl) {
  if (!cardEl) return;
  cardEl.classList.add("busy");
  const spinner = document.createElement("div");
  spinner.className = "card-spinner";
  spinner.innerHTML = ICON_SPINNER;
  cardEl.appendChild(spinner);
}

// A project's title only links out to its localhost page while that port is
// actually live — no href at all otherwise, so it's inert, unstyled text.
function applyNameLinkState(link, live) {
  if (live) {
    link.href = `http://localhost:${link.dataset.port}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = `Open http://localhost:${link.dataset.port}`;
  } else {
    link.removeAttribute("href");
    link.removeAttribute("target");
    link.removeAttribute("rel");
    link.title = "";
  }
}

async function unassignEntry(entry, index, cardEl) {
  const status = await fetchPortStatus([entry.port]);
  const liveWarning = status[String(entry.port)]
    ? ` Port ${entry.port} currently has something actively listening on it (a running dev server?) — ejecting it here won't stop that.`
    : "";
  const confirmed = await customConfirm(
    `Eject "${entry.name}" from port ${entry.port}? The project moves to Unassigned and the port becomes available again.${liveWarning}`
  );
  if (!confirmed) return;

  const removed = entries.splice(index, 1)[0];
  unassigned.push({ name: removed.name, description: removed.description, url: removed.url, status: removed.status });
  markCardSaving(cardEl);
  const ok = await persist();
  if (!ok) {
    unassigned.pop();
    entries.splice(index, 0, removed);
  }
  render();
}

// Permanently deletes a project: removes it from the registry, then deletes
// its folder from disk. Requires typing the project's exact name to guard
// against a stray click, since — unlike Eject — this can't be undone
// from the UI once the folder is gone.
async function deleteProject(entry, source, index, cardEl) {
  if (source === "entries" && ["starting", "running"].includes((projectRunStatus[entry.name] || {}).status)) {
    if (cardEl) showCardError(cardEl, "Stop the project before deleting it");
    return;
  }

  const confirmed = await customPrompt(
    `This permanently deletes the "${entry.name}" folder and everything in it. This can't be undone.`,
    entry.name
  );
  if (!confirmed) return;

  const list = source === "entries" ? entries : unassigned;
  const removed = list.splice(index, 1)[0];
  markCardSaving(cardEl);
  const ok = await persist();
  if (!ok) {
    list.splice(index, 0, removed);
    render();
    return;
  }

  try {
    await deleteProjectFolder(entry.name);
  } catch (err) {
    setStatus("error", `Removed "${entry.name}" from the dashboard, but couldn't delete its folder: ${err.message}`);
  }
  render();
}

// Reflects a project's current run state onto its Run/Stop button: idle
// ("Run"), starting (spinner, disabled), running ("Stop", flagging a
// tailwind-watcher-only failure via .warn), or crashed (back to "Run" but
// marked so the last failure reason is visible on hover). "Running" covers
// both a process we spawned ourselves and one we didn't (e.g. started from a
// VS Code terminal) but that the live-status poll confirms is actually
// listening on the port — either way Stop is offered; for the latter, the
// server falls back to killing whatever OS process holds that port.
function applyRunButtonState(btn, info) {
  const status = info && info.status;
  const liveFallback = !status && !!portLiveStatus[btn.dataset.port];
  btn.classList.remove("running", "crashed", "starting", "warn");
  btn.disabled = false;

  if (status === "starting") {
    btn.classList.add("starting");
    btn.disabled = true;
    btn.innerHTML = `${ICON_SPINNER} <span class="btn-label">Starting…</span>`;
    btn.title = "Starting…";
    return;
  }

  if (status === "running" || liveFallback) {
    btn.classList.add("running");
    if (info && info.twError) {
      btn.classList.add("warn");
      btn.title = `Running — tailwind watcher failed: ${info.twError}`;
    } else if (liveFallback) {
      btn.title = `Stop ${btn.dataset.project} — started outside this dashboard, so this only frees the port; a lingering npm/nodemon shell may remain`;
    } else {
      btn.title = `Stop ${btn.dataset.project}`;
    }
    btn.innerHTML = `${ICON_STOP_SOLID} <span class="btn-label">Stop</span>`;
    return;
  }

  if (status === "crashed") {
    btn.classList.add("crashed");
    btn.innerHTML = `${ICON_WARNING} <span class="btn-label">Run</span>`;
    btn.title = `Last attempt failed: ${info.error || "unknown error"} — click to retry`;
    return;
  }

  btn.innerHTML = `${ICON_PLAY_SOLID} <span class="btn-label">Run</span>`;
  btn.title = `Run ${btn.dataset.project} (npm run dev, plus tw if present)`;
}

// Whether its Run button says Stop: Dispatch's run of it is running, or,
// with no run of Dispatch's, something answers on its port.
function isProjectRunning(entry) {
  const managed = projectRunStatus[entry.name];
  return (managed && managed.status === "running") || (!managed && !!portLiveStatus[String(entry.port)]);
}

// Starts/stops a project's dev (and tw, if present) processes on the port
// it's currently assigned to. Warns first if that port already looks live —
// starting anyway would likely fail to bind.
function buildRunButton(entry) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "run-btn";
  btn.dataset.project = entry.name;
  btn.dataset.port = entry.port;
  applyRunButtonState(btn, projectRunStatus[entry.name]);

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const isRunning = isProjectRunning(entry);
    const card = projectViewEl.querySelector(".project-header");

    if (!isRunning) {
      const status = await fetchPortStatus([entry.port]);
      if (status[String(entry.port)]) {
        const proceed = await customConfirm(
          `Port ${entry.port} already has something listening on it (maybe started outside this dashboard). ` +
            `Starting "${entry.name}" now may fail to bind. Continue anyway?`
        );
        if (!proceed) return;
      }
    }

    // A separate flag from `disabled` — "external" state also sets disabled
    // persistently, so polling can't use that alone to tell "mid-click" from
    // "locked because it's running elsewhere."
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.innerHTML = ICON_SPINNER;
    clearCardError(card);
    try {
      if (isRunning) {
        await stopProject(entry.name);
        await untilStatus(() => !isProjectRunning(entry));
      } else {
        await startProject(entry.name);
        projectRunStatus[entry.name] = { status: "running", error: null, twError: null };
      }
    } catch (err) {
      if (!isRunning) {
        projectRunStatus[entry.name] = { status: "crashed", error: err.message, twError: null };
      }
      showCardError(card, err.message);
    } finally {
      delete btn.dataset.busy;
      applyRunButtonState(btn, projectRunStatus[entry.name]);
    }
  });

  return btn;
}

function buildAssignDropdown(entry, index) {
  const wrap = document.createElement("div");
  const isOpen = openAssignDropdown === index;
  wrap.className = "dropdown" + (isOpen ? " open" : "");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "dropdown-toggle";
  toggleBtn.innerHTML =
    `<span>Assign category</span>` +
    `<svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">` +
    `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openAssignDropdown = isOpen ? null : index;
    render();
  });
  wrap.appendChild(toggleBtn);

  if (isOpen) {
    const menu = document.createElement("div");
    menu.className = "dropdown-menu";
    for (const cat of CATEGORIES) {
      const blocked = isCategoryFull(cat);
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "dropdown-option cat-" + cat;
      opt.disabled = blocked;
      opt.innerHTML =
        `<span class="label">${cat}</span>` +
        (blocked ? `<span class="hint">full (${categoryCount(cat)}/${CATEGORY_LIMITS[cat]})</span>` : "");
      opt.addEventListener("click", async (e) => {
        e.stopPropagation();
        openAssignDropdown = null;
        const newPort = nextFreePortInCategory(cat, -1);
        if (newPort === null) {
          render();
          return;
        }
        if (!(await confirmPortsFree([newPort]))) {
          render();
          return;
        }
        const removed = unassigned.splice(index, 1)[0];
        entries.push({ port: newPort, category: cat, name: removed.name, description: removed.description, url: removed.url, status: removed.status });
        markCardSaving(projectViewEl.querySelector(".project-header"));
        const ok = await persist();
        if (!ok) {
          entries.pop();
          unassigned.splice(index, 0, removed);
        }
        render();
      });
      menu.appendChild(opt);
    }
    wrap.appendChild(menu);
  }

  return wrap;
}

