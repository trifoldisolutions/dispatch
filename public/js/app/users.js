// The Users page (/users), an admin's: every account whatever its status,
// searched by name or email and filtered by status and role. Each row's
// menu edits the account (name, email, admin rights), hands out a new
// password link (the invite again, or a reset), suspends or restores it, or
// deletes it; New user adds an invited account. A link shows once, in a
// dialog, to be passed on by hand: Dispatch doesn't send email yet, and the
// server keeps only its hash. The server (accounts.js) checks every change;
// this page only leaves out what it would refuse, like suspending yourself.
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import * as api from "./api.js";
import { Icon, Avatar, Dropdown, seenText } from "./ui.js";
import { SideEmpty, SideLoading } from "./side.js";

const STATUS_FILTERS = [
  ["all", "Any status"],
  ["active", "Active"],
  ["invited", "Invited"],
  ["suspended", "Suspended"],
];
const ROLE_FILTERS = [
  ["all", "Any role"],
  ["admin", "Admins"],
  ["lead", "Project leads"],
  ["dev", "Developers"],
  ["client", "Clients"],
  ["none", "On no project"],
];
const ROLE_TEXT = { lead: "Lead", dev: "Developer", client: "Client" };
const NAME_MAX_LENGTH = 80; // accounts.js
const EMAIL_MAX_LENGTH = 254;

// From an 820px wide list, a row is a table's: the person, their projects,
// status, last seen and the menu. Narrower, the menu sits at the person's
// right and the rest stacks under their name.
const COLUMNS = "@min-[820px]:grid-cols-[minmax(0,2.3fr)_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_32px]";
const CELL = "col-span-2 min-w-0 pl-12 @min-[820px]:col-span-1 @min-[820px]:pl-0";

const BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = BUTTON + " border-accent bg-accent text-white enabled:hover:brightness-110";
const SECONDARY = BUTTON + " border-line text-dim enabled:hover:border-accent enabled:hover:text-fg";
const INPUT = "h-9 w-full rounded-md border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent";

// "Léa Martin" -> "lea martin", so a search needn't get the accents right.
function searchable(text) {
  return String(text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function shortDate(value, withTime = false) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", ...(withTime && { hour: "numeric", minute: "2-digit" }) });
}

const linkOpen = (user) => !!user.linkExpiresAt && new Date(user.linkExpiresAt) > Date.now();

function matches(user, q, status, role) {
  if (status !== "all" && user.status !== status) return false;
  if (role === "admin" && !user.isAdmin) return false;
  if (role === "none" && user.projects.length > 0) return false;
  if (ROLE_TEXT[role] && !user.projects.some((project) => project.role === role)) return false;
  return !q || searchable(user.name).includes(q) || searchable(user.email).includes(q);
}

const BADGE_TONES = { accent: "bg-accent/15 text-accent", danger: "bg-danger/15 text-danger" };

function Badge({ tone, children }) {
  return html`<span class=${"inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold " + BADGE_TONES[tone]}>${children}</span>`;
}

// One line per role they hold, leads first: "Lead · grabbn, theclio".
function ProjectsCell({ user }) {
  if (user.projects.length === 0) return html`<span class="text-[12.5px] text-dim">No projects</span>`;
  const lines = Object.keys(ROLE_TEXT)
    .map((role) => [role, user.projects.filter((project) => project.role === role).map((project) => project.name)])
    .filter(([, names]) => names.length > 0);
  return html`<div class="flex min-w-0 flex-col gap-0.5">
    ${lines.map(([role, names]) => html`<p key=${role} class="truncate text-[12.5px]" title=${`${ROLE_TEXT[role]} on ${names.join(", ")}`}>
      <span class="text-dim">${ROLE_TEXT[role]} · </span>${names.join(", ")}
    </p>`)}
  </div>`;
}

// Active, or a badge for Invited and Suspended; under it, an open link's
// last day (an invite's, or a reset's).
function StatusCell({ user }) {
  const open = linkOpen(user);
  let line = null;
  if (user.status === "invited") {
    line = open
      ? html`<span>Invite link until ${shortDate(user.linkExpiresAt)}</span>`
      : html`<span class="text-danger">Invite link expired</span>`;
  } else if (user.status === "active" && open) {
    line = html`<span>Reset link until ${shortDate(user.linkExpiresAt)}</span>`;
  }
  return html`<div class="flex min-w-0 flex-col items-start gap-0.5 text-[12.5px]">
    ${user.status === "invited" ? html`<${Badge} tone="accent">Invited<//>`
      : user.status === "suspended" ? html`<${Badge} tone="danger">Suspended<//>`
      : html`<span>Active</span>`}
    ${line && html`<span class="truncate text-[12px] text-dim">${line}</span>`}
  </div>`;
}

// A row's actions, in a menu that's a popover (so the page's own scrolling
// can't clip it), placed under its button, or over it near the window's
// foot, and closed by a click beside it, Escape or any scrolling.
function RowMenu({ user, items }) {
  const menu = useRef(null);
  const button = useRef(null);
  const id = `account-menu-${user.id}`;

  useEffect(() => {
    const el = menu.current;
    const onBeforeToggle = (e) => {
      if (e.newState !== "open") return;
      const box = button.current.getBoundingClientRect();
      const below = window.innerHeight - box.bottom - 12;
      const up = below < 220 && box.top > below;
      Object.assign(el.style, {
        left: `${Math.max(8, box.right - 224)}px`,
        top: up ? "auto" : `${box.bottom + 4}px`,
        bottom: up ? `${window.innerHeight - box.top + 4}px` : "auto",
      });
    };
    const close = (e) => !(e.target instanceof Node && el.contains(e.target)) && el.hidePopover(); // a resize's target is the window
    const onToggle = (e) => {
      if (e.newState === "open") {
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        const first = el.querySelector("button:not(:disabled)");
        if (first) first.focus({ preventScroll: true });
      } else {
        window.removeEventListener("scroll", close, true);
        window.removeEventListener("resize", close);
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

  const pick = (item) => {
    menu.current.hidePopover();
    item.run();
  };

  return html`<button ref=${button} type="button" popovertarget=${id} aria-label=${`Actions for ${user.name}`} title="Actions"
      class="flex h-8 w-8 items-center justify-center rounded-md text-dim hover:bg-line/50 hover:text-fg">
      <${Icon} name="more" />
    </button>
    <div ref=${menu} id=${id} popover
      class="inset-auto m-0 w-[224px] rounded-lg border border-line bg-panel p-1 text-fg shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      ${items.map((item) =>
        item.divider
          ? html`<div key=${item.key} class="mx-1 my-1 border-t border-line"></div>`
          : html`<button key=${item.label} type="button" disabled=${!!item.disabled} title=${item.title || undefined} onClick=${() => pick(item)}
              class=${"flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] outline-none enabled:hover:bg-bg enabled:focus-visible:bg-bg disabled:cursor-not-allowed disabled:opacity-45 " +
                (item.danger ? "text-danger" : "")}>
              <${Icon} name=${item.icon} size=${14} class=${item.danger ? "" : "text-dim"} />${item.label}
            </button>`
      )}
    </div>`;
}

function UserRow({ user, you, actions }) {
  const self = user.id === you;
  const suspended = user.status === "suspended";
  const online = user.status === "active" ? store.isOnline(user) : null;
  const items = [
    { label: "Edit details", icon: "pencil", run: () => actions.edit(user) },
    suspended
      ? { label: "Password link", icon: "link", disabled: true, title: "Restore the account first: a suspended account's links don't work" }
      : { label: user.status === "invited" ? "New invite link" : "Password reset link", icon: "link", run: () => actions.link(user) },
    suspended
      ? { label: "Restore", icon: "restore", run: () => actions.restore(user) }
      : { label: "Suspend", icon: "pause", disabled: self, title: self ? "You can't suspend your own account" : undefined, run: () => actions.suspend(user) },
    { divider: true, key: "divider" },
    { label: "Delete account", icon: "trash", danger: true, disabled: self, title: self ? "You can't delete your own account" : undefined, run: () => actions.remove(user) },
  ];
  return html`<li class=${"grid grid-cols-[minmax(0,1fr)_32px] items-center gap-x-4 gap-y-1.5 px-4 py-3 " + COLUMNS + (suspended ? " opacity-70" : "")}>
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
      <${Avatar} person=${user} online=${online} />
      <div class="min-w-0">
        <p class="flex min-w-0 items-center gap-2">
          <span class="truncate text-[13.5px] font-semibold" title=${user.name}>${user.name}</span>
          ${self && html`<span class="shrink-0 text-[12px] text-dim">(you)</span>`}
          ${user.isAdmin && html`<${Badge} tone="accent"><${Icon} name="shield" size=${11} />Admin<//>`}
        </p>
        <p class="truncate text-[12px] text-dim" title=${user.email}>${user.email}</p>
      </div>
    </div>
    <div class=${CELL}><${ProjectsCell} user=${user} /></div>
    <div class=${CELL}><${StatusCell} user=${user} /></div>
    <div class=${CELL + " truncate text-[12.5px] " + (online ? "text-ok" : "text-dim")}>
      ${online ? "Online" : user.status === "invited" && !user.lastSeenAt ? "Never logged in" : seenText(user.lastSeenAt)}
    </div>
    <div class="col-start-2 row-start-1 justify-self-end @min-[820px]:col-start-5"><${RowMenu} user=${user} items=${items} /></div>
  </li>`;
}

// A dialog in the browser's top layer, over the left menu whatever the
// page's stacking, the page itself inert meanwhile. It opens on its
// [autofocus] field or button; Escape or a click beside it closes it.
function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const first = el.querySelector("[autofocus]");
    if (first) first.focus();
    return () => el.open && el.close();
  }, []);
  return html`<dialog ref=${ref} aria-label=${title}
    onCancel=${(e) => (e.preventDefault(), onClose())}
    onMouseDown=${(e) => e.target === e.currentTarget && onClose()}
    class="m-auto mt-[12vh] w-[min(440px,calc(100vw-32px))] max-w-none rounded-xl border border-line bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/45">
    <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 class="truncate text-[15px] font-semibold">${title}</h2>
      <button type="button" onClick=${onClose} aria-label="Close"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-dim hover:bg-line/50 hover:text-fg"><${Icon} name="close" size=${14} /></button>
    </div>
    ${children}
  </dialog>`;
}

// New user (no `user`), or Edit details. Saving a new one makes it invited
// and hands back its first link, which onSaved shows.
function AccountDialog({ user, you, onClose, onSaved }) {
  const editing = !!user;
  const self = editing && user.id === you;
  const [name, setName] = useState(editing ? user.name : "");
  const [email, setEmail] = useState(editing ? user.email : "");
  const [admin, setAdmin] = useState(editing ? user.isAdmin : false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const keepsAdmin = self && user.isAdmin;

  async function submit(e) {
    e.preventDefault();
    const changes = editing
      ? Object.fromEntries(
          [
            ["name", name.trim(), user.name],
            ["email", email.trim().toLowerCase(), user.email],
            ["isAdmin", admin, user.isAdmin],
          ].filter(([, value, was]) => value !== was).map(([key, value]) => [key, value])
        )
      : { name, email, isAdmin: admin };
    if (editing && Object.keys(changes).length === 0) return onClose();
    setBusy(true);
    setError("");
    try {
      if (editing) {
        const { user: saved } = await api.updateAccount(user.id, changes);
        onSaved(saved, null);
      } else {
        const { user: saved, link } = await api.createAccount(changes);
        onSaved(saved, link);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return html`<${Dialog} title=${editing ? `Edit ${user.name}` : "New user"} onClose=${onClose}>
    <form onSubmit=${submit} class="flex flex-col gap-4 px-5 py-4">
      ${!editing && html`<p class="text-[12.5px] text-dim">They get an invite link to choose a password. Dispatch doesn't email it yet, so you'll copy it and send it yourself.</p>`}
      <label class="flex flex-col gap-1.5">
        <span class="text-[12.5px] font-semibold">Name</span>
        <input class=${INPUT} value=${name} onInput=${(e) => setName(e.currentTarget.value)} maxlength=${NAME_MAX_LENGTH} required autofocus autocomplete="off" />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-[12.5px] font-semibold">Email</span>
        <input class=${INPUT} type="email" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} maxlength=${EMAIL_MAX_LENGTH} required autocomplete="off" spellcheck=${false} />
        ${editing && html`<span class="text-[12px] text-dim">What they log in with.</span>`}
      </label>
      <label class=${"flex items-start gap-2.5 " + (keepsAdmin ? "cursor-not-allowed" : "cursor-pointer")}>
        <input type="checkbox" checked=${admin} disabled=${keepsAdmin} onChange=${(e) => setAdmin(e.currentTarget.checked)}
          class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
        <span class="flex flex-col gap-0.5">
          <span class="text-[13px] font-medium">Admin</span>
          <span class="text-[12px] text-dim">${keepsAdmin
            ? "You can't remove your own admin rights; another admin can."
            : "Manages everyone's accounts here. Oversees the projects without working on them: no project pages, tasks or journals."}</span>
        </span>
      </label>
      ${error && html`<p role="alert" class="rounded-md border border-danger/45 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">${error}</p>`}
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class=${SECONDARY + " h-9"} onClick=${onClose}>Cancel</button>
        <button type="submit" class=${PRIMARY + " h-9"} disabled=${busy}>
          ${busy && html`<${Icon} name="spinner" size=${13} />`}${editing ? "Save" : "Create and get link"}
        </button>
      </div>
    </form>
  <//>`;
}

// A link just made, shown this once: the server keeps only its hash.
function LinkDialog({ user, link, replaced, onClose }) {
  const input = useRef(null);
  const [copied, setCopied] = useState(false);
  const first = user.name.split(" ")[0];
  const invite = link.kind === "invite";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      input.current.select();
      store.toast("error", "Couldn't copy it: the link is selected, so Ctrl+C copies it");
    }
  }

  return html`<${Dialog} title=${invite ? `Invite link for ${user.name}` : `Password reset link for ${user.name}`} onClose=${onClose}>
    <div class="flex flex-col gap-3 px-5 py-4">
      <p class="text-[13px]">${invite
        ? `Send this to ${first} at ${user.email}: it lets them choose a password and log in.`
        : `Send this to ${first}: it lets them choose a new password. Their current one works until they do.`}</p>
      <div class="flex gap-2">
        <input ref=${input} readonly value=${link.url} aria-label="Link" onFocus=${(e) => e.currentTarget.select()}
          class=${INPUT + " min-w-0 font-mono text-[12px]"} />
        <button type="button" class=${PRIMARY + " h-9 shrink-0"} onClick=${copy} autofocus>
          <${Icon} name=${copied ? "check" : "copy"} size=${13} />${copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p class="text-[12px] text-dim">
        ${`It works once, until ${shortDate(link.expiresAt, true)}.${replaced ? " The earlier link no longer works." : ""} ` +
        "This is the only time Dispatch shows it; if it gets lost, make a new one from their menu."}
      </p>
      <div class="flex justify-end pt-1">
        <button type="button" class=${SECONDARY + " h-9"} onClick=${onClose}>Done</button>
      </div>
    </div>
  <//>`;
}

export function UsersPage() {
  const [result, setResult] = useState(null); // { data: { users, you } } or { error }
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [dialog, setDialog] = useState(null); // { kind: "account", user? } or { kind: "link", user, link, replaced }
  const changed = store.accountsChanged.value; // /live: someone's account changed, maybe on another admin's page

  useEffect(() => {
    let stale = false;
    api.getAccounts().then(
      (data) => !stale && setResult({ data }),
      (err) => {
        if (stale) return;
        // A failed reload keeps the list that's up.
        setResult((last) => (last && last.data ? last : { error: err.message }));
        if (result && result.data) store.toast("error", `Couldn't refresh the users: ${err.message}`);
      }
    );
    return () => {
      stale = true;
    };
  }, [changed]);

  // An account the server just sent back, in place of its old row.
  const put = (user) =>
    setResult((last) => ({ data: { ...last.data, users: [...last.data.users.filter((u) => u.id !== user.id), user] } }));
  const drop = (id) => setResult((last) => ({ data: { ...last.data, users: last.data.users.filter((u) => u.id !== id) } }));
  const close = () => setDialog(null);

  const actions = {
    edit: (user) => setDialog({ kind: "account", user }),
    async link(user) {
      try {
        const { user: saved, link } = await api.newPasswordLink(user.id);
        put(saved);
        setDialog({ kind: "link", user: saved, link, replaced: linkOpen(user) });
      } catch (err) {
        store.toast("error", err.message);
      }
    },
    async suspend(user) {
      const ok = await store.confirm(
        `Suspend ${user.name}? They're logged out and can't log in until an admin restores the account. Their projects stay as they are.`
      );
      if (!ok) return;
      try {
        put((await api.updateAccount(user.id, { suspended: true })).user);
        store.toast("saved", `Suspended ${user.name}`);
      } catch (err) {
        store.toast("error", err.message);
      }
    },
    async restore(user) {
      try {
        put((await api.updateAccount(user.id, { suspended: false })).user);
        store.toast("saved", `Restored ${user.name}`);
      } catch (err) {
        store.toast("error", err.message);
      }
    },
    async remove(user) {
      const count = user.projects.length;
      const ok = await store.confirmByTyping(
        `Delete ${user.name}'s account? ${count ? `They come off ${count === 1 ? "their project" : `all ${count} of their projects`}, and this` : "This"} can't be undone.`,
        user.email
      );
      if (!ok) return;
      try {
        await api.deleteAccount(user.id);
        drop(user.id);
        store.toast("saved", `Deleted ${user.name}'s account`);
      } catch (err) {
        store.toast("error", err.message);
      }
    },
  };

  function saved(user, link) {
    put(user);
    if (link) setDialog({ kind: "link", user, link, replaced: false });
    else {
      close();
      store.toast("saved", `Saved ${user.name}`);
    }
  }

  const data = result && result.data;
  const q = searchable(query.trim());
  const filtered = q !== "" || status !== "all" || role !== "all";
  const users = data
    ? data.users.filter((user) => matches(user, q, status, role)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const count = (key) => (data ? data.users.filter((user) => user.status === key).length : 0);
  const meta = data
    ? [`${data.users.length} account${data.users.length === 1 ? "" : "s"}`, count("invited") && `${count("invited")} invited`, count("suspended") && `${count("suspended")} suspended`]
        .filter(Boolean)
        .join(" · ")
    : null;

  let body;
  if (!result) body = html`<${SideLoading} />`;
  else if (!data) body = html`<${SideEmpty} icon="alert" title="Couldn't load the users" text=${result.error} error />`;
  else if (users.length === 0) body = html`<${SideEmpty} icon="search" title="No one found" text=${filtered ? "No account matches. Try another filter, or clear the search." : "There are no accounts yet."} />`;
  else {
    body = html`<div class="@container">
      <div aria-hidden="true" class=${"hidden gap-x-4 border-b border-line px-4 pb-2 pt-3 text-[11px] font-medium uppercase tracking-wide text-dim @min-[820px]:grid " + COLUMNS}>
        <span>User</span><span>Projects</span><span>Status</span><span>Last seen</span><span></span>
      </div>
      <ul class="divide-y divide-line/60">
        ${users.map((user) => html`<${UserRow} key=${user.id} user=${user} you=${data.you} actions=${actions} />`)}
      </ul>
    </div>`;
  }

  return html`<div class="users-page">
    <section class="project-panel">
      <div class="project-panel-header">
        <h1 class="project-panel-title">Users</h1>
        ${meta && html`<span class="project-panel-meta mr-auto" title=${meta}>${meta}</span>`}
        <button type="button" class=${PRIMARY + " h-8"} onClick=${() => setDialog({ kind: "account" })}>
          <${Icon} name="userPlus" size=${14} />New user
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2 px-4 pt-3">
        <label class="flex h-8 min-w-[200px] max-w-[360px] flex-1 items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-dim hover:border-accent/60 focus-within:border-accent">
          <${Icon} name="search" size=${14} />
          <input type="text" autocomplete="off" placeholder="Search by name or email…" aria-label="Search users" value=${query}
            onInput=${(e) => setQuery(e.currentTarget.value)}
            onKeyDown=${(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))}
            class="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-dim" />
        </label>
        <div class="flex w-[150px]"><${Dropdown} value=${status} options=${STATUS_FILTERS} onChange=${setStatus} label="Status" /></div>
        <div class="flex w-[160px]"><${Dropdown} value=${role} options=${ROLE_FILTERS} onChange=${setRole} label="Role" /></div>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">${body}</div>
    </section>
    ${dialog && dialog.kind === "account" &&
    html`<${AccountDialog} user=${dialog.user} you=${data && data.you} onClose=${close} onSaved=${saved} />`}
    ${dialog && dialog.kind === "link" &&
    html`<${LinkDialog} user=${dialog.user} link=${dialog.link} replaced=${dialog.replaced} onClose=${close} />`}
  </div>`;
}
