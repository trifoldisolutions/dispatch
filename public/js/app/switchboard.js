// The Switcher: every project in the registry by category and port,
// the way the board's three columns showed them. A project's category badge
// (on its card in the list, or its page's header) and its page's Switch open
// it with that project outlined and focused; the left menu's Switcher
// does too, outlining the page's project when there is one. Fire and Breeze
// show each of their ports; Cold its ports up to one past its last project. Dragging a project onto a port gives it
// that port: whoever held it, and the projects lined up right behind, slide
// one port over, into the next category past a category's last port. When
// that would move a running project and trading places wouldn't, the two
// swap ports instead. A port something listens on takes no drops. While
// dragging, the rows show the board as the drop would leave it, each project
// that moves marked with how. Unassigned
// projects get their first port the same way. The move itself is the older
// scripts' (dropProjectOnPort in public/js/legacy/registry.js), since the
// registry is still theirs. By keyboard: Enter or Space picks the focused
// project up, the arrow keys go from port to port with the same preview, and
// Enter or Space drops it; Escape puts it back.
import { signal } from "@preact/signals";
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import { Icon, LiveDot, Loading, CATEGORY_LABELS, CATEGORY_CLASSES } from "./ui.js";

const legacy = () => window.DispatchLegacy;

export const switchBoardOpen = signal(false);
const outlined = signal(null); // the project outlined in it, if any

// Opens it with `name` outlined, the page's project when not given.
export function openSwitchBoard(name = store.view.value === "project" ? store.project.value : null) {
  outlined.value = name;
  switchBoardOpen.value = true;
}

// The project page's header badge and Switch (buildCategoryBadge and
// buildSwitchButton in public/js/legacy/project-page.js) ask for it this way.
document.addEventListener("dispatch:switch-board", (e) => openSwitchBoard(e.detail.project));

// A category's ports in order, each with whoever holds it: every port of a
// capped one; the unlimited one's up to one past its last project, the port
// a project dropped after them would take (`next`).
function categorySlots(category, entries) {
  const range = legacy().portRange(category);
  const holders = new Map(entries.filter((e) => e.category === category).map((e) => [Number(e.port), e]));
  const capped = range.end !== Infinity;
  const last = capped ? range.end : holders.size ? Math.max(...holders.keys()) + 1 : range.start;
  const slots = [];
  for (let port = range.start; port <= last; port++) {
    slots.push({ port, holder: holders.get(port) || null, next: !capped && port === last });
  }
  return { range, capped, count: holders.size, slots };
}

// A port, or an unassigned project (no port). `project` is who holds it now,
// and the row's drag and keyboard handlers stay theirs. While a drop is
// previewed it shows who'd hold the port after it (`drag.landing`) instead,
// with the drop's mode before their name: ⇄ for a swap, or for a slide an
// arrow up or down, the way they'd go. The rows it leaves as they are look
// disabled meanwhile, so the ones it changes stand out. `drag` is the popup's:
// what's being dragged and where, and the handlers that make a row a drag
// source, a drop target and a stop for the keyboard.
function Row({ port, project, next, drag }) {
  const name = project && project.name;
  const target = port !== null && drag.over === port;
  const landed = port !== null ? drag.landing.get(port) : undefined;
  const shown = landed !== undefined ? drag.entryOf(landed) || { name: landed } : project && !(port !== null && drag.leaving.has(name)) ? project : null;
  const untouched = drag.landing.size > 0 && landed === undefined && !(name && drag.leaving.has(name));
  // Something listens on it, so a held project can't be dropped here.
  const blocked = drag.dragging && port !== null && drag.inUse(port) && landed === undefined && !(name && drag.leaving.has(name));
  const from = landed !== undefined && shown.port ? Number(shown.port) : null; // none for an unassigned one
  const mode = landed === undefined ? null : drag.swap ? "swap" : from === null ? "arrow" : from > port ? "arrowUp" : "arrowDown";
  const current = shown && shown.name === drag.current;
  const look = target
    ? "border-accent bg-accent/10"
    : shown
    ? `bg-bg ${current ? "border-accent" : "border-line"}` + (project && !drag.saving ? " cursor-grab active:cursor-grabbing" + (current ? "" : " hover:border-dim/60") : "")
    : "border-dashed border-line text-dim";

  let text = shown ? shown.name : next ? "Next port" : "Free";
  if (shown && target) text = html`<span class="font-medium text-accent">${shown.name}</span>`;

  const title =
    landed !== undefined
      ? `${landed} would move here from ${from === null ? "Unassigned" : from}` +
        (drag.swap ? ": a swap, since sliding the others along would move a running project" : "")
    : blocked ? `Something is listening on ${port}, so nothing can be dropped here`
    : project && !drag.dragging ? "Drag onto another port, or press Enter and pick one with the arrow keys"
    : undefined;
  return html`<li data-current=${(name && name === drag.current) || undefined} data-project=${name || undefined}
    ...${project ? drag.source(name) : {}} ...${port !== null ? drag.target(port) : {}} ...${drag.keys(port, name)}
    title=${title}
    class=${"flex h-9 select-none items-center gap-2.5 rounded-md border px-2.5 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60 " + look +
      (untouched || blocked || (shown && shown.name === drag.dragging && landed === undefined) ? " opacity-40" : "")}>
    <span class="w-9 shrink-0 font-mono text-[12px] text-dim">${port || "—"}</span>
    ${shown && html`<${LiveDot} on=${store.runState(shown, drag.status) === "running"} />`}
    <span class="flex min-w-0 flex-1 items-center gap-1.5">
      ${mode && html`<${Icon} name=${mode} size=${14} class="text-accent" />`}
      <span class="min-w-0 truncate">${text}</span>
    </span>
    ${name && name === drag.saving && html`<${Icon} name="spinner" size=${14} class="text-dim" />`}
  </li>`;
}

function Section({ label, cls, meta, aside, list, listClass = "flex flex-col gap-1.5", listStyle }) {
  return html`<section aria-label=${label} class="min-w-0">
    <header class="mb-2 flex items-center gap-2">
      <span class=${"whitespace-nowrap rounded border px-1.5 py-px text-[11px] " + cls}>${label}</span>
      <span class="text-[12px] text-dim">${meta}</span>
      <span class="ml-auto whitespace-nowrap text-[11.5px] text-dim">${aside}</span>
    </header>
    <ul class=${listClass} style=${listStyle}>${list}</ul>
  </section>`;
}

function CategorySection({ category, entries, drag }) {
  const { range, capped, count, slots } = categorySlots(category, entries);
  const limit = range.end - range.start + 1;
  const rows = slots.map((slot) => html`<${Row} key=${slot.port} port=${slot.port} project=${slot.holder} next=${slot.next} drag=${drag} />`);
  const wide = !capped; // Cold, the long one: two columns of ports from md up, read down then across
  return html`<${Section} label=${CATEGORY_LABELS[category]} cls=${CATEGORY_CLASSES[category]}
    meta=${capped ? `${count} of ${limit}` : `${count} project${count === 1 ? "" : "s"}`}
    aside=${`${range.start}–${capped ? range.end : "∞"}`} list=${rows}
    listClass=${wide ? "grid gap-1.5 md:grid-flow-col md:grid-cols-2 md:grid-rows-[repeat(var(--rows),auto)]" : undefined}
    listStyle=${wide ? { "--rows": Math.ceil(slots.length / 2) } : undefined} />`;
}

export function SwitchBoard() {
  const open = switchBoardOpen.value;
  const current = outlined.value;
  const [dragging, setDragging] = useState(null); // the dragged project's name
  const [over, setOver] = useState(null); // the port it's over, when it can be dropped there
  const [saving, setSaving] = useState(null); // the project a drop is moving, until that's saved
  const [carrying, setCarrying] = useState(false); // whether `dragging` was picked up by keyboard
  const dialogRef = useRef(null);
  const carryingRef = useRef(false); // for the Escape listener, set up once per opening
  carryingRef.current = carrying;
  const leaveTimer = useRef(null); // a drag's pending exit from a port's row (see onDragLeave)

  const putBack = () => {
    clearTimeout(leaveTimer.current);
    setDragging(null);
    setOver(null);
    setCarrying(false);
  };
  const close = () => {
    switchBoardOpen.value = false;
    putBack();
  };

  // Focus moves into it, onto the outlined project when there is one (so
  // Enter picks it up), and back to what opened it once it closes. Escape
  // puts a project picked up by keyboard back, or else closes it, ahead of
  // the page's own Escape (boot.js), which would leave a section's page.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const row = dialog.querySelector("[data-current]");
    (row || dialog).focus({ preventScroll: true });
    if (row) row.scrollIntoView({ block: "nearest" });
    const onKey = (e) => {
      // A confirm over it (a move touching a running project) answers Escape itself.
      if (e.key !== "Escape" || !document.getElementById("confirm-overlay").hidden) return;
      e.stopPropagation();
      if (carryingRef.current) putBack();
      else close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const registry = store.registry.value;
  const draggedEntry = dragging && registry.entries.find((e) => e.name === dragging);
  // A port something listens on (a running dev server) takes no drops: the
  // registry can't move what's running there.
  const inUse = (port) => !!store.status.value.ports[String(port)];
  const canDrop = (port) => dragging && !saving && !(draggedEntry && Number(draggedEntry.port) === port) && !inUse(port);

  // If the dragged project were dropped where it is: who'd hold each port
  // the drop changes (port → name), and whether it's a swap.
  const landing = new Map();
  let swap = false;
  if (dragging && over !== null) {
    const plan = legacy().portDrop(dragging, over);
    swap = plan.swap;
    landing.set(over, dragging);
    for (const m of plan.shifts) landing.set(m.port, m.name);
  }
  const byName = new Map([...registry.entries, ...registry.unassigned].map((e) => [e.name, e]));

  async function drop(port) {
    const name = dragging;
    const from = draggedEntry && draggedEntry.port;
    putBack();
    if (!name || !canDrop(port)) return;
    setSaving(name);
    const moved = await legacy().dropProjectOnPort(name, port);
    setSaving(null);
    if (moved && moved.swappedWith) {
      store.toast("saved", `Swapped ${name} (now ${port}) and ${moved.swappedWith} (now ${from}): sliding along would have moved a running project`);
    } else if (moved) {
      const { shifted } = moved;
      store.toast("saved", `Moved ${name} to ${port}` + (shifted ? `, and ${shifted} other${shifted === 1 ? "" : "s"} one port over` : ""));
    }
    // A confirm (a running project's port) took focus: back onto the
    // project, once the board has redrawn, so the keyboard carries on there.
    setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const row = [...dialog.querySelectorAll("li[data-project]")].find((li) => li.dataset.project === name);
      (row || dialog).focus({ preventScroll: true });
    });
  }

  const drag = {
    current,
    dragging,
    over,
    saving,
    landing,
    leaving: new Set(landing.values()), // the projects that'd leave their port
    swap,
    entryOf: (name) => byName.get(name),
    inUse,
    status: store.status.value,
    source: (name) =>
      saving
        ? {}
        : {
            draggable: true,
            onDragStart: (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
              setDragging(name);
              setCarrying(false);
            },
            onDragEnd: putBack,
          },
    target: (port) => ({
      onDragOver: (e) => {
        if (!canDrop(port)) return;
        clearTimeout(leaveTimer.current);
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== port) setOver(port);
      },
      // Not when it only crosses into the row's own text. A moment late, so
      // crossing the gap to the next row doesn't flash the whole board back
      // on; that row's dragover cancels it.
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        clearTimeout(leaveTimer.current);
        leaveTimer.current = setTimeout(() => setOver((now) => (now === port ? null : now)), 120);
      },
      onDrop: (e) => {
        e.preventDefault();
        drop(port);
      },
    }),
    // Every row is a stop for the arrow keys, in port order. Carrying a
    // project, a row it can go to shows the drop's preview while focused.
    keys: (port, name) => ({
      tabindex: 0,
      onFocus: () => carrying && setOver(port !== null && canDrop(port) ? port : null),
      onKeyDown: (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = [...dialogRef.current.querySelectorAll("li[tabindex]")];
          const next = rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
          if (next) next.focus();
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!carrying) {
          if (name && !saving) {
            setDragging(name);
            setCarrying(true);
          }
        } else if (name === dragging) {
          putBack();
        } else if (port !== null && canDrop(port)) {
          drop(port);
        }
      },
    }),
  };

  const unassigned = registry.unassigned;
  return html`<div class="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[4px] sm:p-6"
    onMouseDown=${(e) => e.target === e.currentTarget && close()}>
    <div ref=${dialogRef} tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="switch-board-title"
      class="flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl outline-none">
      <header class="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 id="switch-board-title" class="flex-1 whitespace-nowrap text-[15px] font-semibold">Switcher</h2>
        ${carrying &&
        html`<span class="min-w-0 truncate text-[12px] text-dim">Moving <span class="font-medium text-fg">${dragging}</span>: ↑ ↓ to a port, Enter to drop it there, Esc to put it back</span>`}
        ${saving && html`<span class="flex h-8 shrink-0 items-center gap-1.5 text-[12px] text-dim"><${Icon} name="spinner" size=${14} /> Moving…</span>`}
        <button type="button" aria-label="Close" title="Close" onClick=${close}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dim hover:bg-bg hover:text-fg"><${Icon} name="close" size=${16} /></button>
      </header>
      <div class="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
        ${!registry.loaded
          ? html`<${Loading} />`
          : html`<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div class="flex min-w-0 flex-col gap-5">
                <${CategorySection} category="fire" entries=${registry.entries} drag=${drag} />
                <${CategorySection} category="breeze" entries=${registry.entries} drag=${drag} />
                ${unassigned.length > 0 &&
                html`<${Section} label="📥 Unassigned" cls="border-line" meta=${String(unassigned.length)} aside="No port yet"
                  list=${unassigned.map((e) => html`<${Row} key=${e.name} port=${null} project=${e} drag=${drag} />`)} />`}
              </div>
              <${CategorySection} category="cold" entries=${registry.entries} drag=${drag} />
            </div>`}
      </div>
    </div>
  </div>`;
}
