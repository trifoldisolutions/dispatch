// The command palette (Ctrl+K): type to
// find a page, a project, one of its sections, or an action (run or stop it,
// open it in VS Code, add a project), then Enter.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import { Icon, LiveDot, projectPath } from "./ui.js";
import { firstProjectPath } from "./projects.js";

export const paletteOpen = signal(false);

const MAX_RESULTS = 12;
const SECTIONS = [
  ["tasks", "Tasks"],
  ["journal", "Journal"],
  ["explore", "Explorer"],
  ["history", "History"],
  ["staff", "Staff"],
];

// The project list: the user's own once loaded, else the registry the board
// already has, so the palette works before Projects has ever opened.
function paletteProjects() {
  const mine = store.myProjects.value;
  if (mine.loaded && !mine.error) return mine.list.filter((p) => p.hasFolder);
  if (store.isAdmin) return []; // an admin has none
  const { entries, unassigned } = window.DispatchLegacy.registry();
  return [
    ...entries.map((e) => ({ name: e.name, port: Number(e.port), category: e.category })),
    ...unassigned.map((e) => ({ name: e.name, port: null, category: null })),
  ];
}

// An admin's one page is Users: they oversee the projects without working on them.
function commands() {
  const go = (path) => () => store.navigate(path);
  const list = store.isAdmin
    ? [{ id: "users", label: "Users", hint: "Everyone's accounts", icon: "users", run: go("/users") }]
    : [
        { id: "projects", label: "Projects", hint: "Your first project", icon: "grid", run: () => store.navigate(firstProjectPath.value || "/projects") },
        { id: "self", label: "Dispatch", hint: "Dispatch's own page", icon: "sliders", run: go("/dispatch") },
        { id: "new", label: "New project", hint: "Action", icon: "plus", run: () => window.DispatchLegacy.openCreateDrawer() },
      ];
  const status = store.status.value;
  for (const p of paletteProjects()) {
    const state = store.runState(p, status);
    list.push({ id: `p:${p.name}`, label: p.name, hint: p.port ? `Project · ${p.port}` : "Project", project: p, live: state === "running", run: go(projectPath(p.name)) });
    for (const [slug, title] of SECTIONS) {
      list.push({ id: `s:${p.name}:${slug}`, label: `${p.name} › ${title}`, hint: "Section", icon: "arrow", run: go(projectPath(p.name, slug)), minor: true });
    }
    if (p.port && !p.self) {
      const running = state === "running";
      list.push({ id: `r:${p.name}`, label: `${running ? "Stop" : "Run"} ${p.name}`, hint: running ? "Action · frees its port" : `Action · localhost:${p.port}`, icon: running ? "stop" : "play", run: () => store.toggleRun(p), minor: true });
    }
    list.push({ id: `v:${p.name}`, label: `Open ${p.name} in VS Code`, hint: "Action", icon: "code", run: () => store.openInVSCode(p.name), minor: true });
  }
  return list;
}

// Every character of the query, in order, somewhere in the label: earlier,
// tighter and word-start matches score higher. null when it doesn't match.
function score(label, q) {
  const text = label.toLowerCase();
  let at = 0;
  let total = 0;
  let last = -1;
  for (const ch of q) {
    const i = text.indexOf(ch, at);
    if (i === -1) return null;
    total += i === last + 1 ? 3 : 1;
    if (i === 0 || " ›-_".includes(text[i - 1])) total += 2;
    last = i;
    at = i + 1;
  }
  if (text.startsWith(q)) total += 10;
  return total - text.length * 0.02;
}

function results(q) {
  const all = commands();
  if (!q) return all.filter((c) => !c.minor).slice(0, MAX_RESULTS);
  return all
    .map((c) => ({ c, s: score(c.label, q) }))
    .filter((r) => r.s !== null)
    .sort((a, b) => b.s - a.s || (a.c.minor ? 1 : 0) - (b.c.minor ? 1 : 0))
    .slice(0, MAX_RESULTS)
    .map((r) => r.c);
}

export function Palette() {
  const open = paletteOpen.value;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
      if (!store.myProjects.value.loaded) store.loadProjects();
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current && listRef.current.children[active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const items = results(query.trim().toLowerCase());
  const close = () => (paletteOpen.value = false);
  const choose = (item) => {
    close();
    item.run();
  };
  const onKeyDown = (e) => {
    e.stopPropagation(); // the page's own Escape and shortcuts stay out of it
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % Math.max(items.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((active - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  return html`<div class="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
    onMouseDown=${(e) => e.target === e.currentTarget && close()}>
    <div class="w-full max-w-[600px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" role="dialog" aria-label="Jump to">
      <div class="flex items-center gap-3 border-b border-line px-4">
        <${Icon} name="search" size=${16} class="text-dim" />
        <input ref=${inputRef} value=${query} onKeyDown=${onKeyDown}
          onInput=${(e) => { setQuery(e.currentTarget.value); setActive(0); }}
          placeholder="Jump to a page or project, or type an action…" aria-label="Search"
          class="h-12 flex-1 border-0 bg-transparent text-[14.5px] outline-none placeholder:text-dim" />
        <kbd class="rounded border border-line px-1.5 py-px text-[11px] text-dim">Esc</kbd>
      </div>
      <ul ref=${listRef} class="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
        ${items.length === 0
          ? html`<li class="px-3 py-6 text-center text-[13px] text-dim">Nothing matches "${query}"</li>`
          : items.map((item, i) => html`<li key=${item.id} role="option" aria-selected=${i === active}
              onMouseMove=${() => i !== active && setActive(i)} onClick=${() => choose(item)}
              class=${"flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 " + (i === active ? "bg-accent/15" : "")}>
              <span class="flex w-4 justify-center text-dim">
                ${item.project ? html`<${LiveDot} on=${item.live} />` : html`<${Icon} name=${item.icon} size=${15} />`}
              </span>
              <span class="min-w-0 flex-1 truncate text-[13.5px]">${item.label}</span>
              <span class="shrink-0 text-[11.5px] text-dim">${item.hint}</span>
            </li>`)}
      </ul>
    </div>
  </div>`;
}

// Ctrl+K (⌘K on a Mac) toggles it from anywhere.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  }
});
