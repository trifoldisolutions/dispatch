// Home (/): the logged-in person's day. Open tasks across their projects,
// what's running on this machine, what happened lately (journal entries and
// commits), and the people they work with.
import { useState } from "preact/hooks";
import { html } from "./html.js";
import * as store from "./store.js";
import { Icon, LiveDot, Panel, Empty, Loading, RunButton, dueLabel, dayLabel, projectPath } from "./ui.js";

const TASKS_SHOWN = 10; // before "Show all"
const ACTIVITY_SHOWN = 24;

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ProjectChip({ name }) {
  return html`<a href=${projectPath(name)} data-route
    class="shrink-0 rounded bg-line/60 px-1.5 py-px text-[11px] font-medium text-dim hover:text-fg">${name}</a>`;
}

function TaskRow({ task, today }) {
  const [done, setDone] = useState(false);
  const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
  const complete = () => {
    setDone(true);
    store.completeTask(task);
  };
  return html`<li class="group flex items-start gap-3 px-4 py-2.5 hover:bg-line/20">
    <button type="button" onClick=${complete} disabled=${done} title="Mark as done"
      class=${"mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border " +
        (done ? "border-accent bg-accent text-white" : "border-dim/60 text-transparent hover:border-accent hover:text-accent")}>
      <${Icon} name="check" size=${12} />
    </button>
    <div class="min-w-0 flex-1">
      <a href=${projectPath(task.project, "tasks")} data-route
        class=${"block truncate text-[13.5px] hover:underline " + (done ? "text-dim line-through" : "")}>${task.title}</a>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
        <${ProjectChip} name=${task.project} />
        ${due && html`<span class=${due.overdue ? "font-medium text-danger" : due.soon ? "text-fg" : ""}>${due.text}</span>`}
        ${task.tags.slice(0, 3).map((tag) => html`<span class="text-accent">#${tag}</span>`)}
      </div>
    </div>
  </li>`;
}

function TasksPanel({ data }) {
  const [showAll, setShowAll] = useState(false);
  const { tasks, taskTotal, overdue, today } = data;
  const projects = new Set(tasks.map((t) => t.project)).size;
  const shown = showAll ? tasks : tasks.slice(0, TASKS_SHOWN);
  const meta = taskTotal
    ? `${taskTotal} open across ${projects} project${projects === 1 ? "" : "s"}${overdue ? ` · ${overdue} overdue` : ""}`
    : null;
  return html`<${Panel} title="Open tasks" icon="list" meta=${meta}>
    ${tasks.length === 0
      ? html`<${Empty} title="Nothing open" text="Tasks added on your projects show up here." />`
      : html`<ul class="divide-y divide-line/60">${shown.map((task) => html`<${TaskRow} key=${task.project + task.id} task=${task} today=${today} />`)}</ul>
          ${tasks.length > TASKS_SHOWN &&
          html`<button type="button" onClick=${() => setShowAll(!showAll)}
            class="w-full border-t border-line px-4 py-2.5 text-left text-[12.5px] text-accent hover:bg-line/20">
            ${showAll ? "Show fewer" : `Show all ${tasks.length}${taskTotal > tasks.length ? ` of ${taskTotal}` : ""}`}
          </button>`}`}
  <//>`;
}

// Journal entries and commits, newest first, under a heading per day.
function ActivityPanel({ data }) {
  const items = [
    ...data.activity.map((a) => ({ kind: "journal", project: a.project, date: a.date, time: a.time, text: a.content, at: a.insertedAt || `${a.date}T${a.time}` })),
    ...data.commits.map((c) => {
      const d = new Date(c.date);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      return { kind: "commit", project: c.project, date, time, text: c.subject, at: c.date, hash: c.short || "" };
    }),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, ACTIVITY_SHOWN);
  const days = [];
  for (const item of items) {
    if (!days.length || days[days.length - 1].date !== item.date) days.push({ date: item.date, items: [] });
    days[days.length - 1].items.push(item);
  }
  return html`<${Panel} title="Recent activity" icon="book" meta="Journal entries and commits, last 14 days">
    ${items.length === 0
      ? html`<${Empty} title="Quiet lately" text="Journal entries and commits from your projects show up here." />`
      : html`<div class="px-4 py-3">
          ${days.map((day) => html`<div key=${day.date} class="mb-3 last:mb-0">
            <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dim">${dayLabel(day.date, data.today)}</h3>
            <ul class="space-y-2">
              ${day.items.map((item) => html`<li class="flex items-start gap-2.5">
                <span class=${"mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full " + (item.kind === "commit" ? "bg-ok/15 text-ok" : "bg-accent/15 text-accent")}
                  title=${item.kind === "commit" ? "Commit" : "Journal entry"}>
                  <${Icon} name=${item.kind === "commit" ? "commit" : "book"} size=${11} />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] leading-snug">${item.text}</p>
                  <div class="mt-0.5 flex items-center gap-2 text-[11.5px] text-dim">
                    <${ProjectChip} name=${item.project} />
                    <span>${item.time}</span>
                    ${item.hash && html`<span class="font-mono">${item.hash}</span>`}
                  </div>
                </div>
              </li>`)}
            </ul>
          </div>`)}
        </div>`}
  <//>`;
}

function RunningPanel() {
  const running = store.runningProjects.value;
  const busy = store.busy.value;
  return html`<${Panel} title="Running on this machine" icon="ports" meta=${running.length ? `${running.length}` : null}>
    ${running.length === 0
      ? html`<${Empty} title="Nothing running" text="Start a project from Projects, or press Ctrl K and type its name." />`
      : html`<ul class="divide-y divide-line/60">${running.map((p) => html`<li key=${p.name} class="flex items-center gap-3 px-4 py-2.5">
          <${LiveDot} on=${true} />
          <div class="min-w-0 flex-1">
            <a href=${projectPath(p.name)} data-route class="block truncate text-[13.5px] font-medium hover:underline">${p.name}</a>
            <a href=${`http://localhost:${p.port}`} target="_blank" rel="noopener"
              class="inline-flex items-center gap-1 text-[12px] text-dim hover:text-accent">localhost:${p.port} <${Icon} name="external" size=${11} /></a>
          </div>
          <${RunButton} state="running" busy=${!!busy[p.name]} onClick=${() => store.toggleRun(p)} />
        </li>`)}</ul>`}
  <//>`;
}

function PeoplePanel({ data }) {
  const people = data.people;
  const online = people.filter((p) => p.online).length;
  return html`<${Panel} title="People" icon="users" meta=${people.length ? `${online} online` : null}>
    ${people.length === 0
      ? html`<${Empty} title="Just you so far" text="Leads and developers on your projects show up here." />`
      : html`<ul class="space-y-1 px-2 py-2">${people.map((person) => html`<li key=${person.id} class="flex items-center gap-3 rounded-md px-2 py-1.5">
          <span class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-line text-[13px] font-semibold">
            ${person.avatar
              ? html`<img src=${person.avatar} alt="" class="h-full w-full rounded-full object-cover" />`
              : person.name.charAt(0).toUpperCase()}
            <span class=${"absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-panel " + (person.online ? "bg-ok" : "bg-line")}></span>
          </span>
          <div class="min-w-0">
            <p class="truncate text-[13px] font-medium" title=${person.name}>${person.displayName || person.name}${person.you ? html` <span class="font-normal text-dim">(you)</span>` : null}</p>
            <p class="text-[11.5px] text-dim">${person.online ? "Online" : "Offline"} · ${person.projects} shared project${person.projects === 1 ? "" : "s"}</p>
          </div>
        </li>`)}</ul>`}
  <//>`;
}

// The projects with the latest journal entries, for jumping back in.
function RecentPanel() {
  const recent = store.myProjects.value.list
    .filter((p) => p.lastActivity && p.hasFolder)
    .sort((a, b) => `${b.lastActivity.date}${b.lastActivity.time}`.localeCompare(`${a.lastActivity.date}${a.lastActivity.time}`))
    .slice(0, 5);
  if (recent.length === 0) return null;
  const status = store.status.value;
  const today = store.home.value.data && store.home.value.data.today;
  return html`<${Panel} title="Recently active" icon="grid">
    <ul class="px-2 py-2">${recent.map((p) => html`<li key=${p.name}>
      <a href=${projectPath(p.name)} data-route class="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-line/30">
        <${LiveDot} on=${store.runState(p, status) === "running"} />
        <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">${p.name}</span>
        <span class="shrink-0 text-[11.5px] text-dim">${today ? dayLabel(p.lastActivity.date, today) : p.lastActivity.date}</span>
      </a>
    </li>`)}</ul>
  <//>`;
}

export function Home({ userName }) {
  const { loaded, error, data } = store.home.value;
  const running = store.runningProjects.value.length;
  const now = new Date();
  const summary = data
    ? [
        `${data.taskTotal} open task${data.taskTotal === 1 ? "" : "s"}`,
        data.overdue ? `${data.overdue} overdue` : null,
        `${running} running`,
      ].filter(Boolean)
    : [];
  return html`<div class="mx-auto max-w-[1800px] px-4 pb-12 pt-5 sm:px-8">
    <div class="mb-5 mt-1">
      <p class="text-[22px] font-semibold tracking-tight">${greeting(now)}, ${userName}</p>
      <p class="mt-0.5 text-[13px] text-dim">
        ${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${summary.length ? " · " + summary.join(" · ") : ""}
      </p>
    </div>
    ${error && html`<p class="mb-4 rounded-md border border-danger/50 bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
      Home couldn't load: ${error} <button type="button" class="ml-2 underline" onClick=${() => store.loadHome()}>Try again</button></p>`}
    <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="flex min-w-0 flex-col gap-5">
        ${!loaded ? html`<${Panel} title="Open tasks" icon="list"><${Loading} /><//>` : data && html`<${TasksPanel} data=${data} />`}
        ${data && html`<${ActivityPanel} data=${data} />`}
      </div>
      <div class="flex min-w-0 flex-col gap-5">
        <${RunningPanel} />
        <${RecentPanel} />
        ${data && html`<${PeoplePanel} data=${data} />`}
      </div>
    </div>
  </div>`;
}
