// The list of your projects beside every project page (/<name>), as cards
// (the page's own outlined), filtered by text, run state or category and
// sorted the way you pick.
// From a 1280px window it's a column of its own; narrower, the toolbar's
// Projects opens it over the page. There's no page for the list itself:
// /projects, and the left menu's Projects, open the first project in it
// (see firstProjectPath), and / the last one you had open (landingPath).
import { signal, computed, effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import { Icon, LiveDot, CategoryBadge, RunButton, Dropdown, Empty, Loading, ROLE_LABELS, CATEGORY_LABELS, dayLabel, projectPath } from "./ui.js";

// What the list shows and its sort are remembered in this browser, so a
// refresh or the next visit opens it the same way. The search text isn't: a
// forgotten one would quietly hide projects.
const SAVED_KEY = "dispatch.projects.view";
const RUN_FILTERS = ["all", "running", "stopped"];
const CATEGORY_FILTERS = ["all", ...Object.keys(CATEGORY_LABELS), "unassigned"];

function savedView() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY)) || {};
  } catch {
    return {}; // storage blocked or the saved value unreadable: the defaults
  }
}

const saved = savedView();
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const query = signal(""); // kept while moving between pages, not across reloads
// Show: a category and a run state, each "all" when not picked.
const runFilter = signal(pick(saved.run, RUN_FILTERS, "all")); // "all" | "running" | "stopped"
const categoryFilter = signal(pick(saved.category, CATEGORY_FILTERS, "all")); // "all" | a category | "unassigned"

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  activity: (a, b) => activityKey(b).localeCompare(activityKey(a)) || a.name.localeCompare(b.name),
  tasks: (a, b) => b.tasks.overdue - a.tasks.overdue || b.tasks.open - a.tasks.open || a.name.localeCompare(b.name),
  port: (a, b) => (a.port || Infinity) - (b.port || Infinity) || a.name.localeCompare(b.name),
};

const sortBy = signal(pick(saved.sort, Object.keys(SORTS), "name")); // a key of SORTS

effect(() => {
  const view = { run: runFilter.value, category: categoryFilter.value, sort: sortBy.value };
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(view));
  } catch {
    // storage blocked: the choices just last until the page reloads
  }
});

function activityKey(p) {
  return p.lastActivity ? `${p.lastActivity.date} ${p.lastActivity.time}` : "";
}

function shown(project, state) {
  const run = runFilter.value;
  const category = categoryFilter.value;
  if (run === "running" && state !== "running") return false;
  if (run === "stopped" && state === "running") return false;
  if (category === "unassigned") return !project.self && !project.category;
  return category === "all" || project.category === category;
}

// The list as it shows: { project, state } in order.
const visible = computed(() => {
  const status = store.status.value;
  const q = query.value.trim().toLowerCase();
  return store.myProjects.value.list
    .map((project) => ({ project, state: store.runState(project, status) }))
    .filter(({ project }) => !q || project.name.toLowerCase().includes(q) || project.description.toLowerCase().includes(q))
    .filter(({ project, state }) => shown(project, state))
    .sort((a, b) => SORTS[sortBy.value](a.project, b.project));
});

// The project /projects and the left menu's Projects open: the first in the
// list that has a page, or the first of them all when the filters hide every
// one. null until the list loads, or when there's none.
export const firstProjectPath = computed(() => {
  const first = visible.value.find(({ project }) => project.hasFolder);
  if (first) return projectPath(first.project.name);
  const any = [...store.myProjects.value.list].sort(SORTS[sortBy.value]).find((p) => p.hasFolder);
  return any ? projectPath(any.name) : null;
});

// The last project you had open, remembered in this browser for / to open
// (there's no home page). Dispatch's own page doesn't count: it has its own
// place in the left menu.
const LAST_KEY = "dispatch.lastProject";
const lastProject = signal(readLastProject());

function readLastProject() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null; // storage blocked: / opens the first project
  }
}

effect(() => {
  const name = store.view.value === "project" ? store.project.value : null;
  const mine = store.myProjects.value.list.find((p) => p.name === name);
  if (!mine || mine.self || !mine.hasFolder || name === lastProject.peek()) return;
  lastProject.value = name;
  try {
    localStorage.setItem(LAST_KEY, name);
  } catch {
    // storage blocked: remembered until the page reloads
  }
});

// The project / opens: the last one you had open while it's still in your
// list with a page, else the first.
const landingPath = computed(() => {
  const last = store.myProjects.value.list.find((p) => p.name === lastProject.value && p.hasFolder && !p.self);
  return last ? projectPath(last.name) : firstProjectPath.value;
});

// / and /projects give way to their project as soon as the list has loaded,
// replacing themselves in the history so Back doesn't land on them again.
// Once the render that announced them is over, since that render is what got
// here.
effect(() => {
  if (store.view.value !== "projects") return;
  const path = location.pathname === "/" ? landingPath.value : firstProjectPath.value;
  if (path) queueMicrotask(() => store.view.value === "projects" && store.navigate(path, { replace: true }));
});

export const listOpen = signal(false); // the list over the page, under 1280px

// Opening another project closes it.
effect(() => {
  store.project.value;
  listOpen.value = false;
});

// What Show and Sort offer (see Dropdown in ui.js). Show takes one of each
// group: a category and a run state; All projects clears both.
const SHOW_OPTIONS = [
  ["all", "All projects"],
  { group: "Category" },
  ...Object.entries(CATEGORY_LABELS),
  ["unassigned", "📥 Unassigned"],
  { group: "Run state" },
  ["running", "Running"],
  ["stopped", "Stopped"],
];
const SORT_OPTIONS = [
  { group: "Sort by" },
  ["name", "Name"],
  ["activity", "Recent activity"],
  ["tasks", "Open tasks"],
  ["port", "Port"],
];

// A pick in Show: All projects clears both filters; a category or a run
// state takes its group's place, or gives it back when it's already
// picked, leaving the other group as it is.
function pickShow(key) {
  if (key === "all") {
    runFilter.value = "all";
    categoryFilter.value = "all";
  } else if (RUN_FILTERS.includes(key)) {
    runFilter.value = runFilter.value === key ? "all" : key;
  } else {
    categoryFilter.value = categoryFilter.value === key ? "all" : key;
  }
}

function ShowDropdown() {
  const picked = [categoryFilter.value, runFilter.value].filter((key) => key !== "all");
  const labels = new Map(SHOW_OPTIONS.filter(Array.isArray));
  return html`<${Dropdown} label="Show" multiple options=${SHOW_OPTIONS} onChange=${pickShow}
    value=${picked.length ? picked : ["all"]} text=${picked.length ? picked.map((key) => labels.get(key)).join(" · ") : "All projects"} />`;
}

function FoldersNotice() {
  const folders = store.newFolders.value;
  if (folders.length === 0) return null;
  const n = folders.length;
  return html`<div class="mt-3 flex shrink-0 items-center gap-2 rounded-md border border-accent/45 bg-accent/8 px-3 py-2 text-[12px]">
    <span class="min-w-0 flex-1" title=${folders.join(", ")}>${n} folder${n === 1 ? "" : "s"} not in Dispatch yet</span>
    <button type="button" onClick=${() => window.DispatchLegacy.openNewFoldersModal()}
      class="shrink-0 font-medium text-accent hover:underline">Review</button>
  </div>`;
}

// "today", "yesterday", "on Tuesday", "on Jul 17".
function lastEntryLabel(date, today) {
  const label = dayLabel(date, today);
  return label === "Today" || label === "Yesterday" ? label.toLowerCase() : `on ${label}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function TaskFigures({ tasks }) {
  if (!tasks.open && !tasks.done) return html`<span>No tasks</span>`;
  return html`<span>${tasks.open} open</span>
    ${tasks.overdue > 0 && html`<span class="font-medium text-danger">${tasks.overdue} overdue</span>`}
    ${tasks.dueSoon > 0 && html`<span class="text-fg">${tasks.dueSoon} due soon</span>`}`;
}

const STAFF_SHOWN = 5; // avatars on a card; the rest are counted after them

// "Michael Hart · Lead", on hover.
function staffLabel(person) {
  return `${person.name} · ${ROLE_LABELS[person.role] || person.role}`;
}

// Who else is on the project (you're on every card in the list, so not you):
// their avatars overlapping, leads first and on top, the first STAFF_SHOWN of
// them, then how many more there are. Each avatar gives the person and their
// role on hover; the count, everyone it stands for.
function StaffStack({ staff }) {
  const others = staff.filter((person) => !person.you);
  if (!others.length) {
    return html`<span class="text-[12px] italic text-dim/70">${staff.length ? "Only you" : "No staff yet"}</span>`;
  }
  const shown = others.slice(0, STAFF_SHOWN);
  const more = others.slice(STAFF_SHOWN);
  return html`<div class="flex min-w-0 items-center">
    <span class="flex">
      ${shown.map((person, i) => html`<span key=${person.id} role="img" aria-label=${staffLabel(person)} title=${staffLabel(person)}
        style=${{ zIndex: shown.length - i }}
        class="relative -ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-line text-dim ring-2 ring-panel first:ml-0">
        ${person.avatar
          ? html`<img src=${person.avatar} alt="" class="h-full w-full rounded-full object-cover" />`
          : html`<${Icon} name="user" size=${16} />`}
      </span>`)}
    </span>
    ${more.length > 0 &&
    html`<span title=${more.map(staffLabel).join("\n")} class="ml-2 whitespace-nowrap text-[12px] text-dim">+${more.length} more</span>`}
  </div>`;
}

// A project at a glance: run state, category and port (while it runs, a
// blue pill linking to the site), description, task figures and last journal entry, its
// staff, VS Code and Run/Stop. The whole card opens its page; the page's own
// project is outlined.
function ProjectCard({ project, state, busy, current, day }) {
  const running = state === "running";
  const linkable = project.hasFolder;
  const Title = linkable ? "a" : "span";
  const look = current ? "border-accent" : linkable ? "border-line hover:border-dim/60" : "border-line opacity-70";
  return html`<article class=${"relative flex shrink-0 flex-col rounded-lg border bg-panel p-4 transition-colors " + look}>
    <div class="flex items-center gap-2.5">
      <${LiveDot} on=${running} title=${running ? "Running" : state === "crashed" ? "Last run failed" : "Not running"} />
      <${Title} href=${linkable ? projectPath(project.name) : undefined} data-route=${linkable || undefined}
        aria-current=${current ? "page" : undefined} onClick=${linkable ? () => (listOpen.value = false) : undefined}
        class="min-w-0 flex-1 truncate text-[15px] font-semibold after:absolute after:inset-0 after:rounded-lg">${project.name}<//>
      <${CategoryBadge} project=${project} />
      ${project.port &&
      (running && !project.self
        ? html`<a href=${`http://localhost:${project.port}`} target="_blank" rel="noopener" title=${`Open localhost:${project.port}`}
            class="relative z-10 rounded border border-transparent bg-accent/85 px-1.5 py-px font-mono text-[12px] leading-[16.5px] text-white hover:bg-accent dark:bg-accent/40 dark:hover:bg-accent/60">${project.port}</a>`
        : html`<span class="font-mono text-[12px] text-dim">${project.port}</span>`)}
    </div>
    <p class=${"mt-2 line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] " + (project.description ? "text-dim" : "italic text-dim/70")}>
      ${project.description || (project.hasFolder ? "No description" : "Its folder is missing from the projects directory")}
    </p>
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
      <${TaskFigures} tasks=${project.tasks} />
      ${project.lastActivity && html`<span title=${project.lastActivity.content}>Last entry ${lastEntryLabel(project.lastActivity.date, day)}</span>`}
    </div>
    <div class="relative z-10 mt-3 flex items-center gap-2 border-t border-line/70 pt-3">
      <${StaffStack} staff=${project.staff} />
      <span class="flex-1"></span>
      ${project.hasFolder && html`<button type="button" title="Open in VS Code" onClick=${() => store.openInVSCode(project.name)}
        class="flex h-8 w-8 items-center justify-center rounded-md border border-line text-dim hover:text-fg"><${Icon} name="code" size=${15} /></button>`}
      ${!project.self && project.hasFolder && project.port &&
      html`<${RunButton} state=${state} busy=${busy} onClick=${() => store.toggleRun(project)} />`}
    </div>
  </article>`;
}

// How far down the column's cards are scrolled, 0 to 1; null when they all
// fit. ScrollRail's handle stands there.
const cardsAt = signal(null);

function scrollPosition(box) {
  const max = box ? box.scrollHeight - box.clientHeight : 0;
  return max > 0 ? box.scrollTop / max : null;
}

const HANDLE = 40; // the handle's height, px

// The line between the column's cards and the page, level with them (from
// the first card down, not beside the totals, search box and filters), in the
// column's 32px on that side, 16px either side of it. A handle on it while
// there are more cards than fit: dragged up or down it scrolls them as far,
// to the top or the bottom at the line's ends. Focused, it takes the arrow
// keys, Page Up/Down, Home and End.
function ScrollRail({ boxRef }) {
  const railRef = useRef(null);
  const at = cardsAt.value;

  useEffect(() => {
    const follow = () => {
      cardsAt.value = scrollPosition(boxRef.current);
    };
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, []);

  const drag = (e) => {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const handle = e.currentTarget;
    handle.focus();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startTop = box.scrollTop;
    const travel = railRef.current.clientHeight - HANDLE; // the line's length the handle moves along
    const max = box.scrollHeight - box.clientHeight;
    const move = (e) => (box.scrollTop = startTop + ((e.clientY - startY) / travel) * max);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", () => handle.removeEventListener("pointermove", move), { once: true });
  };

  const onKey = (e) => {
    const box = boxRef.current;
    const step = { ArrowUp: -40, ArrowDown: 40, PageUp: -box.clientHeight, PageDown: box.clientHeight, Home: -box.scrollHeight, End: box.scrollHeight }[e.key];
    if (!step) return;
    e.preventDefault();
    box.scrollTop += step;
  };

  return html`<div ref=${railRef} class="absolute inset-y-0 -right-8 w-8">
    <span class="absolute inset-y-0 left-4 w-px bg-line"></span>
    ${at !== null &&
    html`<button type="button" role="scrollbar" aria-controls="project-cards" aria-orientation="vertical" aria-label="Scroll your projects"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(at * 100)} onPointerDown=${drag} onKeyDown=${onKey}
      style=${{ top: `calc((100% - ${HANDLE}px) * ${at})`, height: `${HANDLE}px` }}
      class="group absolute left-0 w-8 cursor-grab touch-none outline-none active:cursor-grabbing">
      <span class="absolute inset-y-0 left-[13px] w-[7px] rounded-full bg-dim/45 transition-colors group-hover:bg-dim/80 group-focus-visible:bg-accent group-active:bg-accent"></span>
    </button>`}
  </div>`;
}

// How many projects you have, and how many of them are running, counted as the
// cards are (Dispatch's own is running by definition), whatever the search and
// filters leave showing. A dash until the list loads, not a false 0. The running
// figure is a checkbox, like the Tasks header's, for Show's Running: checking it
// picks that, so the two always agree. Disabled with nothing running, unless
// it's checked, or it couldn't be unchecked.
function ListTotals({ known, total, running }) {
  const only = runFilter.value === "running";
  const none = known && !running && !only;
  const off = !known || none;
  return html`<div class="flex h-[38px] shrink-0 items-center justify-between text-[13px] text-dim">
    <span><span class="font-semibold text-fg">${known ? total : "–"}</span> project${total === 1 ? "" : "s"}</span>
    <label class=${"check-chip" + (only ? " active" : "") + (off ? " disabled" : "")} title=${none ? "No projects running" : "Show only running projects"}>
      <span class="icon-checkbox">
        <input type="checkbox" class="icon-checkbox-input" checked=${only} disabled=${off} onChange=${() => pickShow("running")} />
        <span class="icon-checkbox-box" dangerouslySetInnerHTML=${{ __html: window.DispatchLegacy.checkboxIcon(only) }}></span>
      </span>
      <span>${known ? running : "–"} running</span>
    </label>
  </div>`;
}

// The totals, the search box, the filters, then the cards, which scroll on
// their own with no scrollbar showing. Shared by the column, which has
// ScrollRail (rail) along its right, and the list over the page.
function ListBody({ rail }) {
  const { loaded, error, list } = store.myProjects.value;
  const rows = visible.value;
  const busy = store.busy.value;
  const current = store.view.value === "project" ? store.project.value : null;
  const listRef = useRef(null);
  const day = today();

  // The rail's handle follows the cards as they scroll, and as they change.
  const follow = () => {
    if (rail) cardsAt.value = scrollPosition(listRef.current);
  };
  useEffect(follow);

  // The page's project stays in view: a card out of sight (opened from the
  // palette, or on load) comes to the top of the list; one in sight stays put.
  useEffect(() => {
    const box = listRef.current;
    const link = box && box.querySelector('[aria-current="page"]');
    if (!link) return;
    const card = link.closest("article").getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (card.top < view.top || card.bottom > view.bottom) box.scrollTop += card.top - view.top;
  }, [current, loaded]);

  const filtered = loaded && rows.length < list.length;
  const status = store.status.value;
  return html`
    <${ListTotals} known=${loaded && !(error && !list.length)} total=${list.length}
      running=${list.filter((project) => store.runState(project, status) === "running").length} />
    <label class="relative mt-[11px] flex h-[38px] shrink-0 items-center">
      <${Icon} name="search" size=${14} class="pointer-events-none absolute left-3 text-dim" />
      <input type="text" placeholder="Filter by name or description…" aria-label="Filter projects by name or description" value=${query.value}
        onInput=${(e) => (query.value = e.currentTarget.value)}
        class="h-full w-full rounded-md border border-line bg-bg pl-9 pr-3 text-[13px] outline-none focus:border-accent" />
    </label>
    <div class="mt-[11px] flex shrink-0 gap-2">
      <${ShowDropdown} />
      <${Dropdown} label="Sort" prefix="Sort: " value=${sortBy.value} onChange=${(v) => (sortBy.value = v)} options=${SORT_OPTIONS} />
    </div>
    ${filtered &&
    html`<div class="mt-2 flex shrink-0 items-center justify-between text-[12px] text-dim">
      ${rows.length} of ${list.length} shown
      <button type="button" class="font-medium text-accent hover:underline" onClick=${() => ((query.value = ""), pickShow("all"))}>Show all</button>
    </div>`}
    <${FoldersNotice} />
    ${error &&
    html`<p class="mt-3 shrink-0 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-[12px] text-danger">
      Couldn't load: ${error} <button type="button" class="ml-1 underline" onClick=${() => store.loadProjects()}>Try again</button></p>`}
    ${!loaded
      ? html`<${Loading} />`
      : rows.length === 0
      ? html`<div class="mt-3 rounded-lg border border-dashed border-line"><${Empty} title=${list.length ? "No projects match" : "No projects yet"}
          text=${list.length ? "Try another filter, or clear the search." : "Projects you're assigned to show up here."} /></div>`
      : html`<div class="relative mt-3 flex min-h-0 flex-1 flex-col">
          <div ref=${listRef} id=${rail ? "project-cards" : undefined} onScroll=${follow}
            class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:none]">
            ${rows.map(({ project, state }) => html`<${ProjectCard} key=${project.name} project=${project} state=${state}
              busy=${!!busy[project.name]} current=${project.name === current} day=${day} />`)}
          </div>
          ${rail && html`<${ScrollRail} boxRef=${listRef} />`}
        </div>`}`;
}

// Under 1280px: over the page from the left, closed by a click beside it,
// Escape, or opening a project.
function ListOverlay() {
  useEffect(() => {
    if (!listOpen.value) return;
    // Ahead of the page's own Escape (boot.js), which would leave a
    // section's page as well. An open dropdown in it takes Escape first.
    const onKey = (e) => {
      if (e.key !== "Escape" || e.target.closest("[data-dropdown-open]")) return;
      e.stopPropagation();
      listOpen.value = false;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listOpen.value]);

  if (!listOpen.value) return null;
  return html`<div class="fixed inset-0 z-[45] bg-black/45 xl:hidden" onClick=${(e) => e.target === e.currentTarget && (listOpen.value = false)}>
    <nav aria-label="Your projects" class="flex h-full w-[min(352px,100%)] flex-col border-r border-line bg-bg px-4 pb-4 pt-[11px] shadow-[16px_0_40px_rgba(0,0,0,0.25)]">
      <${ListBody} />
    </nav>
  </div>`;
}

// Beside project pages (and /projects): the column from 1280px, under it the
// list over the page. Level with the toolbar's row, its totals; with the top
// of the project's header, its search box. The column stays in view as the
// page scrolls; its cards scroll on their own. 320px of cards, as on the old
// card grid, 16px from the left menu, like the gaps between the project's
// panels, and 32px from the project with ScrollRail's line halfway: the
// page has no padding of its own on this side (see .app-content).
export function ProjectList() {
  const view = store.view.value;
  if (view !== "project" && view !== "projects") return null;
  return html`
    <nav aria-label="Your projects" class="sticky top-0 hidden h-screen w-[368px] shrink-0 flex-col pl-4 pr-8 pb-4 pt-[11px] xl:flex">
      <${ListBody} rail />
    </nav>
    <${ListOverlay} />`;
}

// The page's column with nothing in it: the project page's own empty state
// (buildPageEmpty in public/js/legacy/project-page.js), so both look alike.
function PageEmpty({ icon, title, text, action, tone }) {
  return html`<div class="page-empty"><div class=${"panel-empty" + (tone ? ` ${tone}` : "")}>
    <span class="panel-empty-icon"><${Icon} name=${icon} size=${26} /></span>
    <div class="panel-empty-title">${title}</div>
    ${text && html`<div class="panel-empty-text">${text}</div>`}
    ${action &&
    html`<button type="button" class="panel-empty-action" onClick=${action.onClick}>
      ${action.icon && html`<${Icon} name=${action.icon} size=${14} />`}${action.label}</button>`}
  </div></div>`;
}

const NEW_PROJECT = { label: "New project", icon: "plus", onClick: () => window.DispatchLegacy.openCreateDrawer() };

// /projects itself: only while the list loads, before its first project
// opens (see above), or when there isn't one to open.
export function ProjectsPage() {
  const { loaded, error, list } = store.myProjects.value;
  let content;
  if (error) {
    content = html`<${PageEmpty} icon="alert" tone="error" title="Projects couldn't load" text=${error}
      action=${{ label: "Try again", onClick: () => store.loadProjects() }} />`;
  } else if (!loaded || firstProjectPath.value) {
    content = html`<${Loading} />`;
  } else if (list.length) {
    content = html`<${PageEmpty} icon="folder" title="No project to open" action=${NEW_PROJECT}
      text="Your projects' folders are missing from the projects directory." />`;
  } else {
    content = html`<${PageEmpty} icon="folder" title="No projects yet" action=${NEW_PROJECT}
      text="Projects you're assigned to show up here. Add one to get started." />`;
  }
  return html`<div class="projects-empty">${content}</div>`;
}
