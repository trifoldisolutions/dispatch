// Addresses: which page /, /<name> and /<name>/<section> show (and /projects, which stands for your first project), and render(), which draws it.

function render() {
  // Portaled dropdown menus (see buildTagsDropdown) live on <body>, outside
  // whatever gets torn down/rebuilt below — clear any leftover one here so
  // a still-open dropdown can create a fresh one, and a closed one doesn't
  // linger.
  document.querySelectorAll(".portal-menu").forEach((el) => el.remove());
  entries.sort((a, b) => Number(a.port) - Number(b.port));

  const onProjectPage = currentView === "project";
  projectViewEl.hidden = !onProjectPage;
  appViewEl.hidden = onProjectPage; // Home and /projects: drawn by public/js/app
  // The toolbar (the project list's button under 1280px and the back link)
  // only applies to project pages; Home starts at the top.
  toolbarEl.hidden = !onProjectPage;
  // Dispatch's own page is in the left menu; any other project belongs under Projects.
  const railKey = onProjectPage ? (currentProjectName === SELF_PROJECT.name ? "self" : "projects") : currentView;
  document.querySelectorAll("#rail [data-rail]").forEach((link) => {
    if (link.dataset.rail === railKey) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  // A section's page leads back to its project's page; the other projects
  // are in the list beside it.
  const section = onProjectPage ? findProjectSection(currentProjectSection) : null;
  backLinkEl.hidden = !section;
  backLinkEl.href = projectPath(currentProjectName || "");
  backLinkEl.title = section ? `Back to ${currentProjectName}` : "";
  backLinkEl.setAttribute("aria-label", backLinkEl.title);
  document.title = onProjectPage
    ? section
      ? `${section.title} · ${currentProjectName} — ${DEFAULT_TITLE}`
      : `${currentProjectName} — ${DEFAULT_TITLE}`
    : currentView === "home"
    ? DEFAULT_TITLE
    : `${VIEW_TITLES[currentView]} — ${DEFAULT_TITLE}`;
  if (onProjectPage) renderProjectPage();
  else clearProjectView();
  renderCreateForm();

  const newFoldersOverlay = document.getElementById("new-folders-overlay");
  const newFoldersPanel = document.getElementById("new-folders-panel");
  if (newFoldersModalOpen) {
    newFoldersOverlay.hidden = false;
    newFoldersPanel.innerHTML = "";
    newFoldersPanel.appendChild(buildNewFoldersPanel());
  } else {
    newFoldersOverlay.hidden = true;
  }

  updateBodyScrollLock();
  positionOpenDropdowns();
  // Home, the project list and the palette (public/js/app) redraw from this
  // too: the page changed, or something they read through window.DispatchLegacy did.
  document.dispatchEvent(new CustomEvent("dispatch:render", { detail: { view: currentView, project: currentProjectName } }));
}

const VIEW_TITLES = { home: "Home", projects: "Projects" };

// Home and /projects draw themselves (public/js/app); the project page is
// emptied meanwhile, so its hidden header doesn't answer lookups and is
// rebuilt fresh when a project opens again.
function clearProjectView() {
  projectViewEl.innerHTML = "";
  projectBarEl.replaceChildren();
  delete projectViewEl.dataset.project;
}

// --- Routing: Home lives at "/", and each project has its own page at
// /<name>, with a page for each of its panels at /<name>/<section> (see
// PROJECT_SECTIONS); the list of your projects sits beside them all. There's
// no page for the list itself: /projects (old links, or the left menu before
// the list has loaded) opens your first project, replacing itself in the
// history (see public/js/app/projects.js). Pages are keyed by folder name,
// not port — the name stays put while a project is switched to another port
// or category or (un)assigned, so its pages survive all of those. The server
// answers all of these addresses with this same file (and keeps project
// folders off the app's own names); navigate() switches between them without
// a reload, and popstate covers the browser's back/forward.
function projectPath(name, section = null) {
  return "/" + encodeURIComponent(name) + (section ? `/${section}` : "");
}

const APP_VIEWS = ["projects"];

// { view, project, section } for an address: a null project on the app's
// own pages, and a null section on a project's own page. Anything past the
// section is kept on it, so a mistyped address shows as a section that
// doesn't exist.
function routeFromPath(pathname) {
  const home = { view: "home", project: null, section: null };
  const [encoded, ...rest] = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (!encoded) return home;
  if (APP_VIEWS.includes(encoded) && rest.length === 0) return { view: encoded, project: null, section: null };
  try {
    return { view: "project", project: decodeURIComponent(encoded), section: rest.length > 0 ? rest.join("/") : null };
  } catch {
    return home;
  }
}

// The page a project page's section address names — a panel's, or Staff's —
// or null when it names none (see routeFromPath).
function findProjectSection(slug) {
  return [...PROJECT_SECTIONS, STAFF_SECTION].find((section) => section.slug === slug) || null;
}

// replace: true swaps the current history entry instead of adding one, for
// an address that only stands for another (/projects).
function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname) history[replace ? "replaceState" : "pushState"](null, "", path);
  applyRoute();
}

// Brings the page in line with the address bar — after navigate(), or the
// browser's back/forward — and renders whichever page that now is.
function applyRoute() {
  const next = routeFromPath(location.pathname);
  if (next.view === currentView && next.project === currentProjectName) {
    // Between a project's page and its sections' pages the panels' filters
    // and drafts carry over — it's the same panel, given more room.
    const sectionChanged = next.section !== currentProjectSection;
    currentProjectSection = next.section;
    render();
    if (sectionChanged) window.scrollTo(0, 0);
    return;
  }
  resetPageState();
  currentView = next.view;
  currentProjectName = next.project;
  currentProjectSection = next.section;
  if (currentProjectName !== null) {
    // Agents change files and rewrite the pending commit message while the
    // page is elsewhere — re-read git's side (and the file counts) on every
    // visit, so what shows beside Push is what a push would actually commit
    // with.
    delete historyCache[currentProjectName];
    delete gitStatusCache[currentProjectName];
    delete explorerCountsCache[currentProjectName];
  }
  render();
  window.scrollTo(0, 0);
}

// Everything that belongs to the page being left rather than to the app:
// open menus, the panels' filters, and any half-done edit — a task loaded into
// the composer, or a project's details loaded into the edit form — which
// would otherwise turn up stale on the next page as if freshly started.
function resetPageState() {
  if (editingTaskId !== null && editingTaskProject !== null) {
    cancelTaskEdit(editingTaskProject);
  }
  if (editingKey) {
    editingKey = null;
    createForm = { category: null, port: null, name: "", description: "", url: "" };
  }
  createDrawerOpen = false;
  taskFilter = emptyTaskFilter();
  taskStatusFilter = defaultTaskStatusFilter();
  journalFilter = emptyJournalFilter();
  explorerQuery = "";
  explorerSearchCollapsed = new Set();
  clearTimeout(explorerSearchTimer);
  closeJournalCalendar();
  closeTaskCalendar();
  taskDueCalendarOpen = false;
  portSwitchOpen = false;
  openTagsDropdownFor = null;
  openStaffMenu = null;
  openAssignDropdown = null;
  createCategoryDropdownOpen = false;
}

// Dispatch's own folder gets a project page too (list "self", linked
// from the left menu), for its files, tasks, journal and history.
// It isn't in the registry: it always runs on PORT 3000, which no project can
// have, and on its page it has no port to switch, details to edit or Delete,
// since deleting it would delete the dashboard itself.
const SELF_PROJECT = {
  name: "dispatch",
  port: "3000",
  description:
    "This dashboard: gives each project in the folder a port by category (Fire, Breeze, Cold), runs and stops them, and keeps their files, tasks, journal and git history in view.",
  url: "",
};

// Looks a project up by name in either list — by value, not a stale index,
// the same way editingKey is resolved — so its page keeps tracking it across
// renders, including a move between entries and unassigned.
function findProjectByName(name) {
  if (name === SELF_PROJECT.name) return { entry: SELF_PROJECT, index: -1, list: "self" };
  let index = entries.findIndex((e) => e.name === name);
  if (index !== -1) return { entry: entries[index], index, list: "entries" };
  index = unassigned.findIndex((e) => e.name === name);
  return index === -1 ? null : { entry: unassigned[index], index, list: "unassigned" };
}
