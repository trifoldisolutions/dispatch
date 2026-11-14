// The side column under the Add project form, beside project pages from a
// 2072px window (see sideShown in store.js), drawn into #side-root
// (views/app/index.ejs): Your tasks, the open tasks on your other projects;
// Ready to push, the commit messages your projects' next pushes will use; and
// People, for finding someone to ask, or for a lead someone to bring onto
// one of their projects. Its panels use the page's own panel styles
// (.project-panel in public/css/dispatch.css), like the form above them.
// People's title leads to the People page (/people, PeoplePage below): the
// same people, all of them, given the whole page.
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import * as api from "./api.js";
import { Icon, Avatar, agoText, seenText, dueLabel, projectPath } from "./ui.js";

const ROWS_SHOWN = 5; // Your tasks and Ready to push: then Show more, ROWS_MORE at a time
const ROWS_MORE = 10;
const SEARCH_DELAY_MS = 200;
const MENU_FILTER_FROM = 8; // Add to project gets a filter field from this many projects

// With an href, the title links to its own page, a chevron after it, like
// the project page's panels (.project-panel-title-link).
function SidePanel({ title, href, meta, class: cls, children }) {
  return html`<section class=${"project-panel mt-4 " + cls}>
    <div class="project-panel-header">
      <h2 class="project-panel-title">
        ${href
          ? html`<a class="project-panel-title-link" href=${href} data-route title=${`Open ${title} on its own page`}>
              <span>${title}</span><${Icon} name="chevronRight" />
            </a>`
          : title}
      </h2>
      ${meta && html`<span class="project-panel-meta" title=${meta}>${meta}</span>`}
    </div>
    ${children}
  </section>`;
}

// Like the older panels' empty state (buildPanelEmpty in public/js/legacy/ui.js).
// The Users page's panel uses it and SideLoading too.
export function SideEmpty({ icon, title, text, error = false }) {
  return html`<div class=${"panel-empty" + (error ? " error" : "")}>
    <span class="panel-empty-icon"><${Icon} name=${icon} /></span>
    <p class="panel-empty-title">${title}</p>
    ${text && html`<p class="panel-empty-text">${text}</p>`}
  </div>`;
}

export function SideLoading() {
  return html`<div class="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-dim"><${Icon} name="spinner" /> Loading…</div>`;
}

// With a section, it leads to that panel's own page. The folder emoji makes
// the chip stand out from the gray text beside it.
function ProjectChip({ name, section, title }) {
  return html`<a href=${projectPath(name, section)} data-route title=${title}
    class="max-w-[160px] shrink-0 truncate rounded bg-line/60 px-1.5 py-px text-[12px] font-medium text-dim hover:text-fg"><span aria-hidden="true">📁 </span>${name}</a>`;
}

// Under a list cut to `limit` rows: the next ROWS_MORE, or back to the first
// ROWS_SHOWN once they're all out.
function ShowMore({ left, limit, setLimit }) {
  if (left <= 0 && limit <= ROWS_SHOWN) return null;
  return html`<button type="button" onClick=${() => setLimit(left > 0 ? limit + ROWS_MORE : ROWS_SHOWN)}
    class="w-full border-t border-line px-4 py-2.5 text-left text-[12.5px] text-accent hover:bg-line/20">
    ${left > 0 ? `Show ${Math.min(left, ROWS_MORE)} more · ${left} left` : "Show fewer"}
  </button>`;
}

// ---- Your tasks -------------------------------------------------------------

function TaskRow({ task, today }) {
  const [done, setDone] = useState(false);
  const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
  const complete = () => {
    setDone(true);
    store.completeTask(task);
  };
  return html`<li class="flex items-start gap-3 px-4 py-2.5 hover:bg-line/20">
    <button type="button" onClick=${complete} disabled=${done} title="Mark as done" aria-label=${`Mark "${task.title}" as done`}
      class=${"mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border " +
        (done ? "border-accent bg-accent text-white" : "border-dim/60 text-transparent hover:border-accent hover:text-accent")}>
      <${Icon} name="check" size=${12} />
    </button>
    <div class="min-w-0 flex-1">
      <a href=${projectPath(task.project, "tasks")} data-route title=${task.title}
        class=${"block truncate text-[13px] hover:underline " + (done ? "text-dim line-through" : "")}>${task.title}</a>
      <div class="mt-1 flex items-center gap-2 text-[12px] text-dim">
        <${ProjectChip} name=${task.project} />
        ${due && html`<span class=${"truncate " + (due.overdue ? "font-medium text-danger" : due.soon ? "text-fg" : "")}>${due.text}</span>`}
      </div>
    </div>
  </li>`;
}

// Open tasks on your projects other than the one showing (its own are in its
// Tasks panel), overdue and soonest due first.
function YourTasks() {
  const { loaded, error, data } = store.myTasks.value;
  const current = store.view.value === "project" ? store.project.value : null;
  const [limit, setLimit] = useState(ROWS_SHOWN);
  useEffect(() => setLimit(ROWS_SHOWN), [current]);

  const tasks = data ? data.tasks.filter((task) => task.project !== current) : [];
  const overdue = data ? tasks.filter((task) => task.dueDate && task.dueDate < data.today).length : 0;
  const meta = data && tasks.length
    ? `${current ? "Other projects · " : ""}${tasks.length} open${overdue ? ` · ${overdue} overdue` : ""}`
    : null;
  const left = tasks.length - limit;

  let body;
  if (!loaded) body = html`<${SideLoading} />`;
  else if (error && !data) body = html`<${SideEmpty} icon="alert" title="Couldn't load your tasks" text=${error} error />`;
  else if (tasks.length === 0) {
    body = html`<${SideEmpty} icon="check" title="Nothing open"
      text=${current ? "No open tasks on your other projects." : "Tasks added on your projects show up here."} />`;
  } else {
    body = html`<ul class="divide-y divide-line/60 py-1">
        ${tasks.slice(0, limit).map((task) => html`<${TaskRow} key=${task.project + task.id} task=${task} today=${data.today} />`)}
      </ul>
      <${ShowMore} left=${left} limit=${limit} setLimit=${setLimit} />`;
  }
  return html`<${SidePanel} title="Your tasks" meta=${meta} class="side-tasks">${body}<//>`;
}

// ---- Ready to push ----------------------------------------------------------

// A commit message's body as its points, each joined back onto one line:
// agents wrap them at 72 characters for git, narrower than this column has.
// A line starting "- " (or "* ") or after a blank line starts the next point.
// Trailers, like a closing Co-Authored-By, aren't changes, so they're left out.
function messagePoints(body) {
  const paragraphs = body.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1].split("\n");
  if (last.every((line) => /^[A-Za-z][\w-]*: \S/.test(line.trim()))) paragraphs.pop();
  const points = [];
  let gap = true;
  for (const line of paragraphs.join("\n\n").split("\n")) {
    const text = line.trim();
    if (!text) {
      gap = true;
      continue;
    }
    const bullet = /^[-*] /.test(text);
    if (gap || bullet || points.length === 0) points.push(bullet ? text.slice(2) : text);
    else points[points.length - 1] += " " + text;
    gap = false;
  }
  return points;
}

// Its summary line, which opens the rest of the message under it, scrolling
// past 320px so one long message can't push People out of the column; the
// project's chip, leading to its History; and in a column of its own, its
// Push. That's the History panel's button (.git-push-btn, the size of every
// blue button) doing that panel's push: no confirm, and the same label and
// state on both while either runs. Centered on the row, or level with the
// summary while the message is open.
function PushRow({ push }) {
  const [open, setOpen] = useState(false);
  const points = messagePoints(push.body);
  const busy = store.pushing.value.has(push.project);
  return html`<li class="flex items-start gap-3 px-4 py-2.5">
    <div class="min-w-0 flex-1">
      <button type="button" onClick=${() => setOpen(!open)} disabled=${points.length === 0} aria-expanded=${open}
        title=${points.length === 0 ? push.summary : open ? "Hide the message" : "Show the whole message"}
        class="group flex w-full items-start gap-1.5 text-left disabled:cursor-default">
        <span class=${"mt-px shrink-0 text-dim transition-transform group-disabled:invisible " + (open ? "rotate-90" : "")}>
          <${Icon} name="chevronRight" size=${14} />
        </span>
        <span class=${"min-w-0 flex-1 text-[13px] group-enabled:group-hover:underline " + (open ? "" : "truncate")}>${push.summary}</span>
      </button>
      ${open &&
      html`<ul class="panel-scroll mt-1.5 max-h-[320px] space-y-1 pl-5 text-[12px] leading-[1.45] text-dim">
        ${points.map((point, i) => html`<li key=${i} class="flex gap-2"><span aria-hidden="true">•</span><span class="min-w-0">${point}</span></li>`)}
      </ul>`}
      <div class="mt-1 flex items-center gap-2 pl-5 text-[12px] text-dim">
        <${ProjectChip} name=${push.project} section="history" title=${`Open ${push.project}'s History`} />
        <span class="min-w-0 truncate" title=${new Date(push.updatedAt).toLocaleString()}>
          ${points.length > 0 && `${points.length} change${points.length === 1 ? "" : "s"} · `}Updated ${agoText(push.updatedAt)}
        </span>
      </div>
    </div>
    <button type="button" onClick=${() => store.pushProject(push.project)} disabled=${busy}
      title=${`Commit ${push.project}'s changes with this message and push them`}
      class=${"git-push-btn " + (open ? "" : "self-center")}>${busy ? "Pushing…" : "Push"}</button>
  </li>`;
}

// The commit messages waiting on your projects, the one written last first,
// each with its project's Push to commit and send it. They come and go as
// agents write them and pushes use them (/live's "pushes"), the project
// showing included, since its History panel is a scroll away.
function ReadyToPush() {
  const { loaded, error, data } = store.myPushes.value;
  const [limit, setLimit] = useState(ROWS_SHOWN);
  const pushes = data ? data.pushes : [];
  const meta = pushes.length ? `${pushes.length} project${pushes.length === 1 ? "" : "s"}` : null;

  let body;
  if (!loaded) body = html`<${SideLoading} />`;
  else if (error && !data) body = html`<${SideEmpty} icon="alert" title="Couldn't load commit messages" text=${error} error />`;
  else if (pushes.length === 0) {
    body = html`<${SideEmpty} icon="commit" title="Nothing to push"
      text="A project's commit message shows here once its agents write one, until its Push uses it." />`;
  } else {
    body = html`<ul class="divide-y divide-line/60 py-1">
        ${pushes.slice(0, limit).map((push) => html`<${PushRow} key=${push.project} push=${push} />`)}
      </ul>
      <${ShowMore} left=${pushes.length - limit} limit=${limit} setLimit=${setLimit} />`;
  }
  return html`<${SidePanel} title="Ready to push" meta=${meta} class="side-pushes">${body}<//>`;
}

// ---- People ---------------------------------------------------------------

const ROLE_TEXT = { lead: "Project Lead", dev: "Developer", admin: "Admin", client: "Client" };

// What the search field's role filter shows; a client gets no Clients.
const ROLE_FILTERS = [
  ["all", "Everyone"],
  ["lead", "Project Leads"],
  ["dev", "Developers"],
  ["client", "Clients"],
];
const ROLE_PLURALS = { lead: "project leads", dev: "developers", client: "clients" };

// The role filter, a segment at the search field's right end like the
// Tasks panel's Tags and Date (.panel-filter .dropdown in
// public/css/dispatch.css), its pick in the accent color unless it's
// Everyone. A click anywhere else or Escape closes it, Escape without
// reaching the page's own handler (public/js/legacy/boot.js).
function RoleFilter({ value, onChange, seesClients }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const options = ROLE_FILTERS.filter(([key]) => key !== "client" || seesClients);
  const label = (options.find(([key]) => key === value) || options[0])[1];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => !wrap.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (e) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
    wrap.current.querySelector("button").focus();
  };

  return html`<div ref=${wrap} class=${"dropdown" + (open ? " open" : "")} onKeyDown=${onKeyDown}>
    <button type="button" class=${"dropdown-toggle" + (value !== "all" ? " active" : "")}
      aria-haspopup="listbox" aria-expanded=${open} aria-label=${`Show: ${label}`} onClick=${() => setOpen(!open)}>
      <span>${label}</span>
      <svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    ${open &&
    html`<div class="dropdown-menu align-right" role="listbox" aria-label="Show">
      ${options.map(([key, text]) => html`<button key=${key} type="button" role="option" aria-selected=${key === value}
        class=${"dropdown-option" + (key === value ? " active" : "")}
        onClick=${() => (onChange(key), setOpen(false))}>
        <span>${text}</span>
        ${key === value && html`<span class="check"><${Icon} name="check" size=${14} /></span>`}
      </button>`)}
    </div>`}
  </div>`;
}

// The projects you share with them by name (two, then a count), and how
// many others they're on without naming those, which you can't see.
function projectsText(person) {
  const { shared, projects } = person;
  const others = projects - shared.length;
  if (shared.length === 0) return projects ? `${projects} project${projects === 1 ? "" : "s"}, none of yours` : "No projects yet";
  const named = shared.slice(0, 2).join(", ") + (shared.length > 2 ? ` +${shared.length - 2}` : "");
  return others > 0 ? `${named} · ${others} other${others === 1 ? "" : "s"}` : named;
}

const SMALL_BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-dim " +
  "enabled:hover:border-accent enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

// Add to project: a menu of the projects you lead, those they're already on
// shown but disabled (and the button itself when that's all of them). It's a popover, so the side column's own scrolling
// can't clip it, placed under the button (or over it, near the window's
// foot) when it opens, and closed when anything else scrolls.
function AddToProject({ person, leading }) {
  const menu = useRef(null);
  const button = useRef(null);
  const [filter, setFilter] = useState("");
  const id = `add-to-project-${person.id}`;
  const available = new Set(person.addTo);
  const q = filter.trim().toLowerCase();
  const shown = leading.filter((name) => !q || name.toLowerCase().includes(q));

  useEffect(() => {
    const el = menu.current;
    const onBeforeToggle = (e) => {
      if (e.newState !== "open") return;
      const box = button.current.getBoundingClientRect();
      const below = window.innerHeight - box.bottom - 12;
      const above = box.top - 12;
      const up = below < 240 && above > below;
      Object.assign(el.style, {
        left: `${Math.max(8, box.right - 248)}px`,
        top: up ? "auto" : `${box.bottom + 4}px`,
        bottom: up ? `${window.innerHeight - box.top + 4}px` : "auto",
        maxHeight: `${Math.min(360, up ? above : below)}px`,
      });
    };
    const close = (e) => !(e.target instanceof Node && el.contains(e.target)) && el.hidePopover(); // a resize's target is the window
    const onToggle = (e) => {
      if (e.newState === "open") {
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        const first = el.querySelector("input, button:not(:disabled)");
        if (first) first.focus({ preventScroll: true });
      } else {
        window.removeEventListener("scroll", close, true);
        window.removeEventListener("resize", close);
        setFilter("");
      }
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBeforeToggle);
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  // Escape closes the menu and nothing else: on a section's page the page's
  // own Escape (public/js/legacy/boot.js) would head back to the project.
  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    menu.current.hidePopover();
    button.current.focus({ preventScroll: true });
  };

  async function pick(name) {
    menu.current.hidePopover();
    const ok = await store.confirm(`Add ${person.name} to ${name} as a developer? They'll see its files, tasks and journal.`);
    if (ok) store.addToProject(person, name);
  }

  return html`<button ref=${button} type="button" popovertarget=${id} class=${SMALL_BUTTON} disabled=${available.size === 0}
      title=${available.size ? "Add them to one of the projects you lead" : "They're already on every project you lead"}>
      <${Icon} name="userPlus" size=${13} /> Add to project
    </button>
    <div ref=${menu} id=${id} popover onKeyDown=${onKeyDown}
      class="inset-auto m-0 w-[248px] overflow-y-auto rounded-lg border border-line bg-panel p-1 text-fg shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      <p class="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-dim">Add ${person.displayName} to</p>
      ${leading.length >= MENU_FILTER_FROM &&
      html`<div class="form-field mx-1 mb-1">
        <span class="form-field-icon"><${Icon} name="search" size=${14} /></span>
        <input class="form-field-input" type="text" placeholder="Your projects…" aria-label="Filter your projects"
          value=${filter} onInput=${(e) => setFilter(e.currentTarget.value)} />
      </div>`}
      ${shown.map((name) => {
        const on = !available.has(name);
        return html`<button key=${name} type="button" disabled=${on} onClick=${() => pick(name)}
          class="flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-[13px] outline-none enabled:hover:bg-bg enabled:focus-visible:bg-bg disabled:cursor-default">
          <span class=${"truncate " + (on ? "text-dim" : "")}>${name}</span>
          ${on && html`<span class="shrink-0 text-[11.5px] text-dim">Already on it</span>`}
        </button>`;
      })}
      ${shown.length === 0 && html`<p class="px-2.5 py-2 text-[12.5px] text-dim">None of your projects match.</p>`}
    </div>`;
}

// A lead's role is tinted like on the header's staff cards (.staff-role.lead).
// `class` adds to the row's own, for the People page's cards.
function PersonRow({ person, leading, class: cls = "" }) {
  const online = store.isOnline(person);
  return html`<li class=${"flex items-start gap-3 px-4 py-3 " + cls}>
    <${Avatar} person=${person} online=${online} />
    <div class="min-w-0 flex-1">
      <p class="flex items-baseline gap-2">
        <span class="truncate text-[13.5px] font-semibold" title=${person.name}>${person.displayName || person.name}</span>
        ${ROLE_TEXT[person.role] && html`<span class=${"shrink-0 text-[12px] " + (person.role === "lead" ? "text-[color-mix(in_srgb,var(--accent)_75%,var(--text))]" : "text-dim")}>${ROLE_TEXT[person.role]}</span>`}
      </p>
      <p class="mt-0.5 truncate text-[12px] text-dim" title=${person.shared.join(", ")}>
        <span class=${online ? "text-ok" : ""}>${online ? "Online" : seenText(person.lastSeenAt)}</span> · ${projectsText(person)}
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button type="button" disabled class=${SMALL_BUTTON} title="Chat is coming soon">
          <${Icon} name="message" size=${13} /> Message
        </button>
        ${leading.length > 0 && person.role !== "client" && person.role !== "admin" && html`<${AddToProject} person=${person} leading=${leading} />`}
      </div>
    </div>
  </li>`;
}

// What an empty filtered list says.
function noneFoundText(q, role) {
  const who = role === "all" ? "No one" : `No ${ROLE_PLURALS[role]}`;
  return q ? `${who} ${role === "all" ? "matches" : "match"} "${q}".` : `${who} on your projects.`;
}

// Up to 5 (PEOPLE_SHOWN in routes/api.js) of the people you work with (online
// first, then the most recently seen), and a search for anyone else, with a
// role filter at its end; its title leads to the People page, which has
// them all. The panel fills the side column below Your tasks
// and its list of people scrolls inside it (.side-people in
// public/css/dispatch.css), the search staying put. No counts: on a big
// studio they'd only be noise. A search or a role runs on the server (as
// you type, for a search), and again whenever the list itself reloads
// (someone was added), so what it shows stays current; until the new
// answer comes, the last one stays up.
function People() {
  const base = store.people.value;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [found, setFound] = useState(null); // { data } or { error } for the last search or role
  const q = query.trim();
  const filtered = q !== "" || role !== "all";

  useEffect(() => {
    if (!filtered) {
      setFound(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.getPeople(q, role === "all" ? "" : role);
        if (!stale) setFound({ data });
      } catch (err) {
        if (!stale) setFound({ error: err.message });
      }
    }, q ? SEARCH_DELAY_MS : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, role, base]);

  const result = filtered ? found : base.loaded ? base : null;
  const data = result && result.data;
  const leading = base.data ? base.data.leading : [];
  const seesClients = base.data ? base.data.seesClients : false;

  let body;
  if (!result) body = html`<${SideLoading} />`;
  else if (result.error && !data) body = html`<${SideEmpty} icon="alert" title="Couldn't load people" text=${result.error} error />`;
  else if (data.people.length === 0) {
    body = filtered
      ? html`<${SideEmpty} icon="search" title="No one found" text=${noneFoundText(q, role)} />`
      : html`<${SideEmpty} icon="users" title="Just you so far" text="People on your projects show up here. Search to find anyone else." />`;
  } else {
    body = html`<ul class="panel-scroll divide-y divide-line/60">
      ${data.people.map((person) => html`<${PersonRow} key=${person.id} person=${person} leading=${leading} />`)}
    </ul>`;
  }

  return html`<${SidePanel} title="People" href="/people" class="side-people">
    <div class="shrink-0 px-4 pt-3">
      <${PeopleSearch} query=${query} setQuery=${setQuery} role=${role} setRole=${setRole} seesClients=${seesClients} />
    </div>
    <div class="flex min-h-0 flex-1 flex-col pt-1">${body}</div>
  <//>`;
}

// The search field with the role filter at its end, the side column's and
// the People page's. Escape clears what was typed before anything else.
function PeopleSearch({ query, setQuery, role, setRole, seesClients }) {
  return html`<div class="panel-filter">
    <${Icon} name="search" size=${14} class="panel-filter-icon" />
    <input class="panel-filter-input" type="text" autocomplete="off" placeholder="Search people by name…" aria-label="Search people"
      value=${query} onInput=${(e) => setQuery(e.currentTarget.value)}
      onKeyDown=${(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))} />
    <${RoleFilter} value=${role} onChange=${setRole} seesClients=${seesClients} />
  </div>`;
}

// The People page (/people): everyone you work with, not just the side
// column's first few, as cards, with the same search and role filter. It
// fetches its own list (the server's ?all=1), and again whenever the side
// column's would reload (someone was added: see loadStale in store.js), the
// last answer staying up until the new one comes.
export function PeoplePage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [result, setResult] = useState(null); // { data } or { error }
  const reloaded = store.people.value;
  const q = query.trim();

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.getPeople(q, role === "all" ? "" : role, true);
        if (!stale) setResult({ data });
      } catch (err) {
        if (!stale) setResult({ error: err.message });
      }
    }, q ? SEARCH_DELAY_MS : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, role, reloaded]);

  const data = result && result.data;
  let body;
  if (!result) body = html`<${SideLoading} />`;
  else if (!data) body = html`<${SideEmpty} icon="alert" title="Couldn't load people" text=${result.error} error />`;
  else if (data.people.length === 0) {
    body = q || role !== "all"
      ? html`<${SideEmpty} icon="search" title="No one found" text=${noneFoundText(q, role)} />`
      : html`<${SideEmpty} icon="users" title="Just you so far" text="People on your projects show up here. Search to find anyone else." />`;
  } else {
    body = html`<ul class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 p-4">
      ${data.people.map((person) => html`<${PersonRow} key=${person.id} person=${person} leading=${data.leading} class="rounded-lg border border-line" />`)}
    </ul>`;
  }

  return html`<div class="people-page">
    <section class="project-panel">
      <div class="project-panel-header">
        <h1 class="project-panel-title">People</h1>
      </div>
      <div class="max-w-[480px] px-4 pt-3">
        <${PeopleSearch} query=${query} setQuery=${setQuery} role=${role} setRole=${setRole} seesClients=${data ? data.seesClients : false} />
      </div>
      <div class="flex min-h-0 flex-1 flex-col">${body}</div>
    </section>
  </div>`;
}

export function Side() {
  if (!store.sideShown.value) return null;
  return html`<${YourTasks} /><${ReadyToPush} /><${People} />`;
}
