// A project's Staff: the header row, the Staff page and online dots.

// Same lazy-load/cache/dedupe pattern again, for the header's Staff and the
// Staff page.
function ensureStaffLoaded(project) {
  if (staffCache[project] || staffInFlight.has(project)) return;
  staffInFlight.add(project);
  fetchStaff(project)
    .then((result) => {
      staffCache[project] = result;
    })
    .catch((err) => {
      staffCache[project] = { error: err.message };
    })
    .finally(() => {
      staffInFlight.delete(project);
      render();
    });
}

// Who works on the project (see projectStaff), on one row that scrolls
// sideways once it's full. With no one to show, it says so instead, the
// way an empty panel does, as the Staff page does too (STAFF_EMPTY).
function buildProjectStaff(entry) {
  // Its title links to the Staff page, the way a panel's does to its own —
  // except on that page.
  const onStaffPage = currentProjectSection === STAFF_SECTION.slug;
  const title = onStaffPage ? "Staff" : buildTitleLink("Staff", projectPath(entry.name, STAFF_SECTION.slug));
  const section = buildActivitySection(title, null, null, buildStaffBody(entry.name, buildStaffRow));
  section.classList.add("project-staff");
  return section;
}

// Under the header's staff: who the project is for, a box per client with
// their avatar, name and how many projects they have with the studio. Each
// is as wide as its content, side by side on one row that scrolls sideways
// like the staff's when a project has more than fit. The row's place is
// always kept, so every project's header has the same shape: with no client
// it holds a hint, and while the staff loads (or failed
// to, which the staff above says) it stays blank.
function buildProjectClients(entry) {
  const state = staffCache[entry.name];
  const list = document.createElement("div");
  list.className = "project-clients";
  list.dataset.scrollKey = "clients"; // see renderProjectPage
  if (!state || state.error) return list;
  if (!state.clients || state.clients.length === 0) {
    list.appendChild(buildNoClientRow());
    return list;
  }
  scrollSidewaysOnWheel(list);
  for (const client of state.clients) list.appendChild(buildClientRow(client));
  return list;
}

// A client box's outline with no one in it, dashed like the staff's own empty
// state, around a one-line hint that reads the same on every project.
function buildNoClientRow() {
  const row = document.createElement("div");
  row.className = "client-row empty";
  const hint = document.createElement("span");
  hint.className = "client-hint";
  hint.textContent = "Clients linked to this project show here";
  row.appendChild(hint);
  return row;
}

function buildClientRow(client) {
  const row = document.createElement("div");
  row.className = "client-row";
  row.dataset.user = client.id; // see applyStaffPresence
  const text = document.createElement("div");
  text.className = "client-text";
  const name = document.createElement("span");
  name.className = "client-name";
  name.textContent = client.name;
  name.title = client.name;
  const figures = document.createElement("span");
  figures.className = "client-projects";
  figures.textContent =
    `${countLabel(client.projects.active, "active project")} • ${countLabel(client.projects.total, "all-time project")}`;
  text.append(name, figures);
  const avatar = buildAvatar(client);
  setStaffPresence(avatar, client.online);
  row.append(avatar, text);
  return row;
}

// Staff cards' names, once they're on the page: one that doesn't fit with
// its last-name initial ("Michael H.") shows the first name alone, cut short
// with an ellipsis (.staff-name) if even that doesn't fit.
function fitStaffNames(root) {
  root.querySelectorAll(".staff-name[data-first]").forEach((el) => {
    if (el.scrollWidth > el.clientWidth) el.textContent = el.dataset.first;
  });
}

// A person's round avatar: their picture when they have one (see
// services/people.js), otherwise the user icon.
function buildAvatar(person) {
  const avatar = document.createElement("span");
  avatar.className = "staff-avatar";
  if (person.avatar) {
    const img = document.createElement("img");
    img.src = person.avatar;
    img.alt = "";
    avatar.appendChild(img);
  } else {
    avatar.insertAdjacentHTML("beforeend", ICON_USER);
  }
  return avatar;
}

// What the header's Staff and the Staff page show: the project's cards, laid
// out by `buildCards`, or while there are none to show, why.
function buildStaffBody(name, buildCards) {
  ensureStaffLoaded(name);
  const state = staffCache[name];
  if (!state) return buildPanelLoading();
  if (state.error) return buildLoadErrorEmpty(name, "Couldn't load staff", state.error);
  const staff = projectStaff(name);
  return staff.length ? buildCards(staff) : buildPanelEmpty(STAFF_EMPTY);
}

const STAFF_ROLE_LABELS = { lead: "Project Lead", dev: "Developer" };

// The people on a project (its memberships, as the server sorts them: its
// Project Lead first, then everybody else), as cards take them:
// { id, name, role, lead, you, online }.
function projectStaff(name) {
  return staffCache[name].staff.map((member) => ({
    ...member,
    role: STAFF_ROLE_LABELS[member.role] || member.role,
    lead: member.role === "lead",
  }));
}

function buildStaffRow(staff) {
  const row = document.createElement("div");
  row.className = "staff-row";
  row.dataset.scrollKey = "staff"; // see renderProjectPage
  scrollSidewaysOnWheel(row);
  for (const member of staff) row.appendChild(buildStaffCard(member, "row"));
  return row;
}

// The header's rows that scroll sideways with no scrollbar showing (the
// staff's, the clients'): a mouse wheel scrolls them sideways — until one
// reaches an end, where the page gets the wheel back. A trackpad's or
// Shift+wheel's sideways scroll is left to the browser.
function scrollSidewaysOnWheel(row) {
  row.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = row.scrollWidth - row.clientWidth;
      const next = Math.min(Math.max(row.scrollLeft + e.deltaY * (e.deltaMode === 1 ? 16 : 1), 0), max);
      if (max <= 0 || next === row.scrollLeft) return;
      e.preventDefault();
      row.scrollLeft = next;
    },
    { passive: false }
  );
}

// The Staff page's cards: with room for them all, they wrap onto more rows
// instead of scrolling sideways.
function buildStaffGrid(staff) {
  const grid = document.createElement("div");
  grid.className = "staff-grid";
  for (const member of staff) grid.appendChild(buildStaffCard(member, "grid"));
  return grid;
}

// One person on the project (see projectStaff): their avatar, with a green
// dot when they're logged in, over their name and role, and in its corner a
// ⋮ menu of what can be done to them (see buildStaffMenu) — except on the
// card of whoever is looking, since nobody messages, suspends or removes
// themselves. The lead's role is set apart (see .staff-role.lead). `place`
// is which list the card is in ("row" or "grid").
function buildStaffCard(member, place) {
  const card = document.createElement("div");
  card.className = "staff-card";
  card.dataset.user = member.id; // see refreshStaffPresence
  const avatar = buildAvatar(member);
  setStaffPresence(avatar, member.online);
  const text = document.createElement("div");
  text.className = "staff-text";
  const name = document.createElement("span");
  name.className = "staff-name";
  // "Michael H." when it fits, else the first name alone (see fitStaffNames);
  // in full on hover.
  name.textContent = member.displayName || member.name;
  name.dataset.first = member.name.trim().split(/\s+/)[0];
  name.title = member.name;
  const roleEl = document.createElement("span");
  roleEl.className = "staff-role" + (member.lead ? " lead" : "");
  roleEl.textContent = member.role;
  text.append(name, roleEl);
  card.append(avatar, text);
  if (!member.you) card.appendChild(buildStaffMenu(`${place}:${member.id}`));
  return card;
}

// Puts the green "logged in" dot on a staff card's avatar, or takes it off.
function setStaffPresence(avatar, online) {
  const dot = avatar.querySelector(".staff-presence");
  if (!online) {
    if (dot) dot.remove();
    return;
  }
  if (dot) return;
  const presence = document.createElement("span");
  presence.className = "staff-presence";
  presence.title = "Logged in";
  presence.setAttribute("role", "img");
  presence.setAttribute("aria-label", "Logged in");
  avatar.appendChild(presence);
}

// Background polling for the online dots of the open project's staff: asks
// for its staff again and moves each card's dot directly, rather than a full
// render(), for the same reasons as refreshProjectRunStatus. Someone added or
// removed shows up with the next render.
async function refreshStaffPresence() {
  if (liveConnected()) return; // /live sends presence as it changes (see applyStaffPresence)
  const name = currentProjectName;
  if (name === null || !staffCache[name] || staffCache[name].error) return;
  let result;
  try {
    result = await fetchStaff(name);
  } catch {
    return; // the last known dots stay until a poll gets through
  }
  if (name !== currentProjectName) return;
  staffCache[name] = result;
  const online = new Map([...result.staff, ...(result.clients || [])].map((member) => [member.id, member.online]));
  projectViewEl.querySelectorAll(".staff-card[data-user], .client-row[data-user]").forEach((card) => {
    setStaffPresence(card.querySelector(".staff-avatar"), online.get(card.dataset.user));
  });
}

// The ⋮ in a staff card's corner and the menu it opens: Message, Suspend
// (keeps them from acting on the project until it's lifted) and Remove. The
// header's staff row scrolls sideways, which would clip a menu nested in it,
// so the menu is portaled to <body> like a tags dropdown's (see
// positionPortalMenu). None of them is built yet, so they're listed
// disabled, Remove still in red (see .staff-menu-list). `menuKey` tells this
// card's menu from the same person's on the other list, since the Staff page
// shows the header's cards too.
function buildStaffMenu(menuKey) {
  const isOpen = openStaffMenu === menuKey;
  const wrap = document.createElement("div");
  wrap.className = "dropdown staff-menu" + (isOpen ? " open" : "");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "staff-menu-toggle";
  toggleBtn.dataset.menuKey = menuKey;
  toggleBtn.title = "More actions";
  toggleBtn.setAttribute("aria-label", "More actions");
  toggleBtn.setAttribute("aria-haspopup", "menu");
  toggleBtn.setAttribute("aria-expanded", String(isOpen));
  toggleBtn.innerHTML = ICON_MORE;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openStaffMenu = isOpen ? null : menuKey;
    openTagsDropdownFor = null;
    portSwitchOpen = false;
    closeJournalCalendar();
    closeTaskCalendar();
    taskDueCalendarOpen = false;
    render();
  });
  wrap.appendChild(toggleBtn);

  if (isOpen) {
    const menu = document.createElement("div");
    menu.className = "dropdown-menu portal-menu staff-menu-list";
    menu.setAttribute("role", "menu");
    for (const [icon, label, danger] of [
      [ICON_CHAT_DOTS, "Message", false],
      [ICON_LOCK, "Suspend", false],
      [ICON_MINUS_CIRCLE, "Remove", true],
    ]) {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "dropdown-option" + (danger ? " danger" : "");
      opt.setAttribute("role", "menuitem");
      opt.disabled = true;
      opt.innerHTML = `<span class="dropdown-option-content">${icon}${label}</span>`;
      menu.appendChild(opt);
    }
    document.body.appendChild(menu);
    // Measured a frame later, once the card holding the toggle is on the page.
    requestAnimationFrame(() => positionPortalMenu(toggleBtn, menu));
  }
  return wrap;
}

// The header's Staff links to a page of its own too, laid out like a
// panel's, though it has no panel in the grid.
const STAFF_SECTION = { slug: "staff", area: "staff", title: "Staff", meta: staffMeta, build: buildStaffPanel };

// What the Staff page and the header's Staff show while a project has no
// one on it (see projectStaff).
const STAFF_EMPTY = {
  icon: ICON_USERS,
  title: "No staff profiles yet",
  text: "Staff profiles will show up here once they are assigned.",
};

function buildStaffPanel(entry) {
  return buildStaffBody(entry.name, buildStaffGrid);
}

// The Staff page's header figure: how many people are on the project.
function staffMeta(name) {
  ensureStaffLoaded(name);
  const state = staffCache[name];
  if (!state || state.error) return null;
  return { text: countLabel(state.staff.length, "person", "people") };
}

// /live's presence message: the ids of everyone online right now. Updates
// the open project's staff dots (and its cached staff) without a re-render.
function applyStaffPresence(onlineIds) {
  const online = new Set(onlineIds);
  for (const result of Object.values(staffCache)) {
    if (result && result.staff) result.staff.forEach((member) => (member.online = online.has(member.id)));
    if (result && result.clients) result.clients.forEach((client) => (client.online = online.has(client.id)));
  }
  projectViewEl.querySelectorAll(".staff-card[data-user], .client-row[data-user]").forEach((card) => {
    setStaffPresence(card.querySelector(".staff-avatar"), online.has(card.dataset.user));
  });
}
