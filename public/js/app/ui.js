// Small pieces the project list, the side column and the palette share:
// icons, the live dot, a project's category badge, panels, buttons, a
// dropdown and date wording.
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";

// Icons: 24px grid, stroked like the rest of Dispatch's (mynaui-style).
const paths = {
  play: html`<path d="M8 6.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 8 6.5z" fill="currentColor" stroke="none" />`,
  stop: html`<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />`,
  arrow: html`<path d="M5 12h14M13 6l6 6-6 6" />`,
  // A panel title's link (.project-panel-title-link), at the 1.5 stroke of the project page's own (ICON_CHEVRON_RIGHT).
  chevronRight: html`<path stroke-width="1.5" d="m9 18l6-6l-6-6" />`,
  external: html`<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />`,
  code: html`<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />`,
  check: html`<path d="M5 12.5l4.5 4.5L19 7.5" />`,
  book: html`<path d="M12 7v13M12 7c-1.5-1.5-4-2-8-2v12c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2V5c-4 0-6.5.5-8 2z" />`,
  commit: html`<circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" />`,
  plus: html`<path d="M12 5v14M5 12h14" />`,
  search: html`<circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />`,
  folder: html`<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />`,
  grid: html`<rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />`,
  ports: html`<rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" />`,
  list: html`<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />`,
  users: html`<circle cx="9" cy="8" r="3.5" /><path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5M16 4.5a3.5 3.5 0 0 1 0 7M18 14c1.7.6 2.8 2.4 3 5" />`,
  userPlus: html`<circle cx="10" cy="8" r="3.5" /><path d="M4 19c.5-3 3-5 6-5 1.4 0 2.7.4 3.7 1.2M18 13v6M15 16h6" />`,
  message: html`<path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5z" />`,
  // An avatar's stand-in when there's no picture, at its own 1.5 stroke since it's shown large.
  user: html`<path stroke-width="1.5" d="M15 7.5a3 3 0 1 1-6 0a3 3 0 0 1 6 0m4.5 13c-.475-9.333-14.525-9.333-15 0" />`,
  alert: html`<path d="M12 8.5V13m0 3.5v.01M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z" />`,
  spinner: html`<path d="M12 3a9 9 0 1 0 9 9" class="origin-center animate-spin" />`,
  sliders: html`<path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />`,
};

export function Icon({ name, size = 16, class: cls = "" }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class=${"shrink-0 " + cls}>${paths[name]}</svg>`;
}

export function LiveDot({ on, title }) {
  return html`<span title=${title || (on ? "Running" : "Not running")}
    class=${"inline-block h-2 w-2 shrink-0 rounded-full " + (on ? "bg-ok shadow-[0_0_0_3px] shadow-ok/20" : "bg-line")}></span>`;
}

export const CATEGORY_LABELS = { fire: "🔥 Fire", breeze: "🍃 Breeze", cold: "❄️ Cold" };
const CATEGORY_CLASSES = {
  fire: "bg-fire-bg border-fire",
  breeze: "bg-breeze-bg border-breeze",
  cold: "bg-cold-bg border-cold",
};

export function CategoryBadge({ project }) {
  if (project.self) {
    return html`<span class="rounded border border-line px-1.5 py-px text-[11px] text-dim">🎛️ Dashboard</span>`;
  }
  const cls = CATEGORY_CLASSES[project.category] || "border-line";
  const label = CATEGORY_LABELS[project.category] || "📥 Unassigned";
  return html`<span class="whitespace-nowrap rounded border px-1.5 py-px text-[11px] ${cls}">${label}</span>`;
}

export const ROLE_LABELS = { lead: "Lead", dev: "Developer", client: "Client", admin: "Admin" };

export function Panel({ title, icon, meta, children, class: cls = "" }) {
  return html`<section class=${"rounded-lg border border-line bg-panel " + cls}>
    <header class="flex items-center gap-2 border-b border-line px-4 py-3">
      ${icon && html`<${Icon} name=${icon} size=${15} class="text-dim" />`}
      <h2 class="text-[14px] font-semibold">${title}</h2>
      ${meta && html`<span class="ml-auto text-[12px] text-dim">${meta}</span>`}
    </header>
    <div>${children}</div>
  </section>`;
}

export function Empty({ title, text }) {
  return html`<div class="px-4 py-8 text-center">
    <p class="text-[13px] font-medium">${title}</p>
    ${text && html`<p class="mt-1 text-[12px] text-dim">${text}</p>`}
  </div>`;
}

export function Loading() {
  return html`<div class="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-dim">
    <${Icon} name="spinner" /> Loading…
  </div>`;
}

// A dropdown in place of a <select>, looking like the older pages' own
// (.dropdown in public/css/dispatch.css): the picked option in the accent
// color with a check. `options` are [value, label] pairs, and a
// { group: "Title" } entry starts a titled group. The toggle shows the
// picked label after `prefix`, or `text` when given. With `multiple`,
// `value` is a list of picked values and the menu stays open on a pick, the
// caller's onChange deciding what a pick adds or clears. Arrow keys, Home
// and End move through the options; Escape, Tab or a click anywhere else
// closes it. While it's open it marks itself data-dropdown-open, so the
// page's own Escape handlers leave that key to it.
export function Dropdown({ value, options, onChange, label, prefix = "", text, multiple = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const toggle = useRef(null);
  const isPicked = (key) => (multiple ? value.includes(key) : key === value);
  const picked = options.find((o) => Array.isArray(o) && isPicked(o[0]));
  const shown = text !== undefined ? text : `${prefix}${picked ? picked[1] : ""}`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => wrap.current && !wrap.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    // Into the picked option, so the arrow keys start from there.
    const current = wrap.current.querySelector('[aria-selected="true"]');
    if (current) current.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    toggle.current.focus({ preventScroll: true });
  };

  function onKeyDown(e) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab" && open) {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = [...wrap.current.querySelectorAll('[role="option"]')];
    const i = items.indexOf(document.activeElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1)
      : Math.max(i - 1, 0);
    items[next].focus();
  }

  return html`<div ref=${wrap} class="relative min-w-0 flex-1" data-dropdown-open=${open || undefined} onKeyDown=${onKeyDown}>
    <button ref=${toggle} type="button" aria-haspopup="listbox" aria-expanded=${open} aria-label=${`${label}: ${shown}`}
      onClick=${() => setOpen(!open)}
      class=${"flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-bg pl-2.5 pr-2 text-[12px] text-fg outline-none hover:border-accent focus-visible:border-accent " +
        (open ? "border-accent" : "border-line")}>
      <span class="truncate">${shown}</span>
      <svg class=${"shrink-0 text-dim transition-transform " + (open ? "rotate-180" : "")} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    ${open &&
    html`<div role="listbox" aria-label=${label} aria-multiselectable=${multiple || undefined}
      class="absolute inset-x-0 top-[calc(100%+4px)] z-30 rounded-md border border-line bg-panel p-1 shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      ${options.map((option, index) => {
        if (!Array.isArray(option)) {
          const divider = index > 0;
          return html`<div key=${"g:" + option.group} class=${"px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-dim" + (divider ? " mt-1 border-t border-line" : "")}>${option.group}</div>`;
        }
        const [key, optionText] = option;
        const selected = isPicked(key);
        return html`<button key=${key} type="button" role="option" aria-selected=${selected}
          onClick=${() => (onChange(key), multiple || close())}
          class=${"flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-bg focus-visible:bg-bg " +
            (selected ? "font-semibold text-accent" : "text-fg")}>
          <span class="truncate">${optionText}</span>
          ${selected && html`<${Icon} name="check" size=${14} />`}
        </button>`;
      })}
    </div>`}
  </div>`;
}

const RUN_BUTTON = {
  running: { label: "Stop", icon: "stop", cls: "border-danger/60 text-danger hover:bg-danger/10" },
  stopped: { label: "Run", icon: "play", cls: "border-accent bg-accent text-white hover:brightness-110" },
  crashed: { label: "Run", icon: "alert", cls: "border-danger/60 text-danger hover:bg-danger/10" },
  starting: { label: "Starting…", icon: "spinner", cls: "border-line text-dim" },
};

// Run/Stop, like the board's button: Stop while it runs, Run otherwise
// (marked when its last run crashed).
export function RunButton({ state, busy, onClick, compact = false }) {
  const look = RUN_BUTTON[busy ? "starting" : state] || RUN_BUTTON.stopped;
  return html`<button type="button" disabled=${busy || state === "starting"} onClick=${onClick}
    class=${`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium disabled:cursor-default ${compact ? "w-8" : "px-3"} ${look.cls}`}
    title=${busy ? "Working…" : look.label}>
    <${Icon} name=${busy ? "spinner" : look.icon} size=${13} />${compact ? null : html`<span>${busy ? "…" : look.label}</span>`}
  </button>`;
}

// ---- Dates ----------------------------------------------------------------

export function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayDiff(dateStr, today) {
  return Math.round((parseDateOnly(dateStr) - parseDateOnly(today)) / 86400000);
}

// "Today", "Yesterday", "Tuesday" within the week, else "Oct 21".
export function dayLabel(dateStr, today) {
  const diff = dayDiff(dateStr, today);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  const date = parseDateOnly(dateStr);
  if (diff > -7 && diff < 0) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A task's due date relative to today, and whether it's overdue.
export function dueLabel(dueDate, today) {
  const diff = dayDiff(dueDate, today);
  const date = parseDateOnly(dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (diff < 0) return { text: `Overdue · ${date}`, overdue: true };
  if (diff === 0) return { text: "Due today", soon: true };
  if (diff === 1) return { text: "Due tomorrow", soon: true };
  if (diff < 7) return { text: `Due ${parseDateOnly(dueDate).toLocaleDateString(undefined, { weekday: "long" })}`, soon: true };
  return { text: `Due ${date}` };
}

export function projectPath(name, section) {
  return "/" + encodeURIComponent(name) + (section ? `/${section}` : "");
}
