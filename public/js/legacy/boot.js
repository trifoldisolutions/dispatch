// Element lookups, page-wide listeners, and the first load and polls. Loads last.

document.addEventListener("click", (e) => {
  if (
    openAssignDropdown === null &&
    !createCategoryDropdownOpen &&
    openTagsDropdownFor === null &&
    !journalCalendarOpen &&
    !taskCalendarOpen &&
    !taskDueCalendarOpen &&
    !portSwitchOpen &&
    openStaffMenu === null
  )
    return;
  // .portal-menu isn't a DOM descendant of .dropdown (see buildTagsDropdown)
  // even while its dropdown is open, so it needs its own check here.
  if (e.target.closest(".dropdown") || e.target.closest(".portal-menu")) return;
  openAssignDropdown = null;
  createCategoryDropdownOpen = false;
  openTagsDropdownFor = null;
  closeJournalCalendar();
  closeTaskCalendar();
  taskDueCalendarOpen = false;
  portSwitchOpen = false;
  openStaffMenu = null;
  render();
});

// Plain left clicks on in-app links (marked data-route: the left menu, the
// project list, ...) switch pages without a reload; Ctrl/Shift/middle
// clicks fall through to the browser, which opens the same address in a new
// tab or window the way any website link would.
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-route]");
  if (!link || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", applyRoute);

// A portaled menu (a tags dropdown, see buildTagsDropdown, or a staff card's
// ⋮, see buildStaffMenu) is position: fixed, so it doesn't follow its toggle
// when the page, a panel's list or the staff row scrolls — reposition it in
// place instead. Captured, since scroll events don't bubble; scrolling the
// menu's own option list is left alone. Opening either closes the other, so
// there's only ever one.
document.addEventListener(
  "scroll",
  (e) => {
    if (openTagsDropdownFor === null && openStaffMenu === null) return;
    if (e.target instanceof Element && e.target.closest(".portal-menu")) return;
    const menu = document.querySelector(".portal-menu");
    const toggle =
      openStaffMenu !== null
        ? document.querySelector(`.staff-menu-toggle[data-menu-key="${CSS.escape(openStaffMenu)}"]`)
        : findOpenTagsToggle();
    if (menu && toggle) positionPortalMenu(toggle, menu);
  },
  true
);

// Widening or narrowing the window past SIDE_FORM_QUERY moves the Add/Edit
// form between the side column and the drawer (or the project's header).
SIDE_FORM_QUERY.addEventListener("change", render);

// Clicking beside the Add/Edit drawer closes it, like its Cancel.
document.getElementById("create-drawer").addEventListener("click", (e) => {
  if (e.target.id === "create-drawer") closeCreateDrawer();
});

document.getElementById("new-folders-overlay").addEventListener("click", (e) => {
  if (e.target.id === "new-folders-overlay") closeNewFoldersModal();
});

// Clicking outside a confirm/prompt dialog always cancels it (never
// confirms) — the safe default for what's usually a destructive action.
document.getElementById("confirm-overlay").addEventListener("click", (e) => {
  if (e.target.id === "confirm-overlay") resolveDialog(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeDialog !== null) {
    resolveDialog(false);
    return;
  }
  if (e.key === "Escape" && newFoldersModalOpen) {
    closeNewFoldersModal();
    return;
  }
  if (
    e.key === "Escape" &&
    (openAssignDropdown !== null ||
      createCategoryDropdownOpen ||
      openTagsDropdownFor !== null ||
      journalCalendarOpen ||
      taskCalendarOpen ||
      taskDueCalendarOpen ||
      portSwitchOpen ||
      openStaffMenu !== null)
  ) {
    openAssignDropdown = null;
    createCategoryDropdownOpen = false;
    openTagsDropdownFor = null;
    closeJournalCalendar();
    closeTaskCalendar();
    taskDueCalendarOpen = false;
    portSwitchOpen = false;
    openStaffMenu = null;
    render();
    return;
  }
  if (e.key === "Escape" && drawerShowing()) {
    closeCreateDrawer();
    return;
  }
  // Escape on a section's page heads back to its project's — except while
  // typing, where it belongs to the field (clearing a search, abandoning a
  // task edit) rather than to the page, and while an edit is open, which it
  // abandons first. A project's own page has nowhere further out to go: the
  // other projects are in the list beside it.
  if (e.key === "Escape" && currentView === "project" && !e.target.closest("input, textarea, select")) {
    if (editingKey) {
      editingKey = null;
      createForm = { category: null, name: "", description: "", url: "" };
      render();
    } else if (editingTaskId !== null && editingTaskProject !== null) {
      cancelTaskEdit(editingTaskProject);
      render();
    } else if (currentProjectSection !== null) {
      navigate(projectPath(currentProjectName));
    }
  }
});
const statusEl = document.getElementById("status");
const projectViewEl = document.getElementById("project-view");
const toolbarEl = document.getElementById("toolbar");
const backLinkEl = document.getElementById("back-link");
const projectBarEl = document.getElementById("project-bar");
const appViewEl = document.getElementById("app-view");
const DEFAULT_TITLE = document.title;

const statusIconEl = statusEl.querySelector(".toast-icon");
const statusTextEl = statusEl.querySelector(".toast-text");
const statusCloseEl = statusEl.querySelector(".toast-close");

statusCloseEl.addEventListener("click", () => {
  clearTimeout(statusHideTimer);
  statusEl.classList.remove("show");
});

// Scroll positions are restored by applyRoute itself (each page opens at
// the top), not by the browser.
history.scrollRestoration = "manual";
({ view: currentView, project: currentProjectName, section: currentProjectSection } = routeFromPath(location.pathname));
// Pages show at once; a project page says "Loading…" until the registry arrives.
render();
load();
setInterval(refreshPortLiveStatus, 5000);
setInterval(refreshProjectRunStatus, 5000);
setInterval(refreshStaffPresence, 15000);

// What the newer parts of the page (public/js/app: the project list, the
// side column's tasks and people, the command palette) use from these
// scripts while both exist. They redraw on the "dispatch:render" event that
// every render() sends.
window.DispatchLegacy = {
  view: () => currentView,
  project: () => currentProjectName,
  navigate,
  openCreateDrawer,
  openNewFoldersModal,
  newFolders: () => newFolders.slice(),
  registry: () => ({ entries: entries.slice(), unassigned: unassigned.slice(), loaded: registryLoaded }),
  liveStatus: () => ({ ports: { ...portLiveStatus }, runs: { ...projectRunStatus } }),
  setStatus,
  confirm: customConfirm,
  prompt: customPrompt, // a confirm that takes typing a value, for deleting
  checkboxIcon,
  // Run state, after a start or stop made outside the project page's own button.
  refreshStatus() {
    refreshProjectRunStatus();
    refreshPortLiveStatus();
  },
  // A task changed elsewhere (the side column's Your tasks): the Tasks panel
  // refetches next time.
  forgetTasks(name) {
    delete taskCache[name];
  },
  // What /live (public/js/app/live.js) delivers.
  applyPortLiveStatus,
  applyProjectRunStatus,
  applyStaffPresence,
  reloadRegistry: load,
  projectDataChanged,
};
