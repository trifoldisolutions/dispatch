// The Add/Edit project form.

function startEditEntry(entry, source) {
  editingKey =
    source === "entries" ? { list: "entries", port: entry.port } : { list: "unassigned", name: entry.name };
  createForm = {
    category: source === "entries" ? entry.category : null,
    port: source === "entries" ? entry.port : null,
    name: entry.name,
    description: entry.description || "",
    url: entry.url || "",
    finished: entry.status === "finished",
  };
  createCategoryDropdownOpen = false;
  // The side column's form when it's there; otherwise a project page shows
  // it under its own header, and anywhere else it's the drawer.
  if (currentView !== "project" && !sideFormShown()) createDrawerOpen = true;
  render();
  const form = document.getElementById(
    sideFormShown() ? "create-project-side" : currentView === "project" ? "project-edit" : "create-project"
  );
  if (form) form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// From this width up, project pages keep the form open in a column on their
// right (#create-side), beside the project list and the project; narrower,
// it's behind the palette's New project (the drawer), and Edit opens under
// the project's header. 2072px leaves the project its three-panel layout
// (1200px, see .project-grid) beside the left menu (72), the list (368) and
// the form's column (432).
const SIDE_FORM_QUERY = window.matchMedia("(min-width: 2072px)");

function sideFormShown() {
  return (currentView === "project" || currentView === "projects") && SIDE_FORM_QUERY.matches;
}

// Not while a project page has its edit form open under its header: two
// forms would share the folder name list's id.
function drawerShowing() {
  return createDrawerOpen && !sideFormShown() && !(currentView === "project" && editingKey);
}

// New project (the palette, or an empty page's button): the side column's form
// when it's there, else the drawer (#create-drawer). Either way, into the
// name, leaving any edit that was open.
function openCreateDrawer() {
  if (editingKey) {
    editingKey = null;
    createForm = { category: null, port: null, name: "", description: "", url: "" };
  }
  if (!sideFormShown()) createDrawerOpen = true;
  render();
  const nameInput = document.querySelector(sideFormShown() ? "#create-project-side input[list]" : "#create-project input[list]");
  if (nameInput) nameInput.focus();
}

// Closing it abandons whatever it held, like the form's Cancel.
function closeCreateDrawer() {
  editingKey = null;
  createForm = { category: null, port: null, name: "", description: "", url: "" };
  createDrawerOpen = false;
  render();
}

// Called by every render(): the form goes in the side column or the drawer,
// never both, and neither while a project page has its edit form under the
// header (two forms would share the folder name list's id). A rebuild keeps
// the field being typed in focused, caret and all.
function renderCreateForm() {
  const side = sideFormShown();
  const drawerOpen = drawerShowing();
  const sideSlot = document.getElementById("create-project-side");
  const drawerSlot = document.getElementById("create-project");
  const active = document.activeElement;
  let focus = null;
  for (const slot of [sideSlot, drawerSlot]) {
    if (active && slot.contains(active)) {
      const fields = [...slot.querySelectorAll("input, textarea")];
      focus = { index: fields.indexOf(active), start: active.selectionStart, end: active.selectionEnd };
    }
  }
  document.getElementById("create-side").hidden = !side;
  document.getElementById("create-drawer").hidden = !drawerOpen;
  sideSlot.innerHTML = "";
  drawerSlot.innerHTML = "";
  const slot = side ? sideSlot : drawerOpen ? drawerSlot : null;
  // Its category and port default to the first free ones, which it can only
  // tell once the registry is in (load() renders again then).
  if (!slot || !registryLoaded) return;
  slot.appendChild(buildCreateProjectForm());
  const field = focus && focus.index !== -1 ? slot.querySelectorAll("input, textarea")[focus.index] : null;
  if (field) {
    field.focus({ preventScroll: true });
    if (focus.start !== null && field.setSelectionRange) field.setSelectionRange(focus.start, focus.end);
  }
}

// The Edit form's status: Finished once the client's work is delivered, so
// it counts toward their all-time projects but not their active ones. A new
// project starts out active, so the Add form leaves it out.
function buildFinishedField() {
  const label = document.createElement("label");
  label.className = "add-form-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!createForm.finished;
  checkbox.addEventListener("change", () => {
    createForm.finished = checkbox.checked;
  });
  const text = document.createElement("span");
  text.innerHTML = `Finished <span class="add-form-check-hint">delivered to the client</span>`;
  label.append(decorateCheckbox(checkbox), text);
  return label;
}

function formStatus() {
  return createForm.finished ? "finished" : "active";
}

function buildCreateCategoryDropdown(includeUnassigned) {
  const wrap = document.createElement("div");
  wrap.className = "dropdown" + (createCategoryDropdownOpen ? " open" : "");

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "dropdown-toggle";
  toggleBtn.innerHTML =
    `<span>${CATEGORY_ICONS[createForm.category]} ${createForm.category}</span>` +
    `<svg class="dropdown-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">` +
    `<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    createCategoryDropdownOpen = !createCategoryDropdownOpen;
    render();
  });
  wrap.appendChild(toggleBtn);

  if (createCategoryDropdownOpen) {
    const menu = document.createElement("div");
    menu.className = "dropdown-menu";
    const options = includeUnassigned ? [...CATEGORIES, "unassigned"] : CATEGORIES;
    for (const cat of options) {
      const active = cat === createForm.category;
      const excludePort = editingKey && editingKey.list === "entries" ? editingKey.port : null;
      const blocked = !active && isCategoryFullExcluding(cat, excludePort);
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "dropdown-option cat-" + cat + (active ? " active" : "");
      opt.disabled = blocked;
      opt.innerHTML =
        `<span class="label">${CATEGORY_ICONS[cat]} ${cat}</span>` +
        (blocked
          ? `<span class="hint">full (${categoryCount(cat)}/${CATEGORY_LIMITS[cat]})</span>`
          : active
          ? `<span class="check">✓</span>`
          : "");
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        createCategoryDropdownOpen = false;
        if (createForm.category !== cat) {
          createForm.category = cat;
          createForm.port = cat === "unassigned" ? "" : nextFreePortInCategory(cat, -1) || "";
        }
        render();
      });
      menu.appendChild(opt);
    }
    wrap.appendChild(menu);
  }

  return wrap;
}

const MAX_PORT = 65535;
// What fits in 3 lines of the project header's description at a 1920px
// window, where its column is 480px wide.
const PROJECT_DESCRIPTION_MAX_LENGTH = 230;

// The add/edit form's port field. Digits only, and every way of changing it
// (typing, arrow keys, the step buttons) stays inside `range`: a typed value
// outside it is pulled back to the nearest edge when the field is committed
// (blur/Enter), and a cleared field gets its last good value back.
function buildPortStepper(range, value, onChange) {
  const min = range.start;
  const max = Math.min(range.end, MAX_PORT);
  let committed = value;

  const wrap = document.createElement("div");
  wrap.className = "port-stepper";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = "port";
  input.value = value;

  const upBtn = buildStepButton("Next port", "M1 5l4-4 4 4", 1);
  const downBtn = buildStepButton("Previous port", "M1 1l4 4 4-4", -1);
  const btns = document.createElement("div");
  btns.className = "port-step-btns";
  btns.append(upBtn, downBtn);
  wrap.append(input, btns);

  function buildStepButton(label, path, delta) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "port-step";
    btn.setAttribute("aria-label", label);
    btn.innerHTML =
      `<svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">` +
      `<path d="${path}" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
    btn.addEventListener("click", () => step(delta));
    return btn;
  }

  function syncButtons() {
    const n = Number(input.value);
    downBtn.disabled = input.value !== "" && n <= min;
    upBtn.disabled = input.value !== "" && n >= max;
  }

  function commit(n) {
    committed = String(Math.min(Math.max(n, min), max));
    input.value = committed;
    syncButtons();
    onChange(committed);
  }

  function step(delta) {
    commit(input.value ? Number(input.value) + delta : min);
  }

  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "");
    if (digits !== input.value) input.value = digits;
    syncButtons();
    onChange(input.value);
  });
  input.addEventListener("change", () => {
    if (input.value) {
      commit(Number(input.value));
    } else {
      input.value = committed;
      syncButtons();
      onChange(committed);
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    step(e.key === "ArrowUp" ? 1 : -1);
  });

  syncButtons();
  return { el: wrap, input };
}

function buildCreateProjectForm() {
  let editingEntry = null;
  let editingSource = null;
  if (editingKey) {
    editingSource = editingKey.list;
    editingEntry =
      editingKey.list === "entries"
        ? entries.find((e) => e.port === editingKey.port)
        : unassigned.find((e) => e.name === editingKey.name);
    if (!editingEntry) {
      // The entry being edited vanished from under us (unassigned/assigned/
      // removed elsewhere) — fall back to a normal create form.
      editingKey = null;
      editingSource = null;
    }
  }
  const excludePort = editingSource === "entries" ? editingKey.port : null;

  if (createForm.category === null) {
    createForm.category = CATEGORIES.find((cat) => !isCategoryFull(cat)) || CATEGORIES[0];
  }
  if (createForm.port === null) {
    createForm.port = nextFreePortInCategory(createForm.category, -1) || "";
  }

  const form = document.createElement("div");
  form.className = "add-form-card";

  const heading = document.createElement("div");
  heading.className = "create-form-heading";
  heading.textContent = editingEntry ? `Edit ${editingEntry.name}` : "Add project";
  form.appendChild(heading);

  if (!editingEntry) {
    const subtitle = document.createElement("button");
    subtitle.type = "button";
    subtitle.className = "create-form-subtitle";
    subtitle.textContent = "loading projects folder…";
    subtitle.disabled = true;
    fetchProjectsRoot().then((rootPath) => {
      if (!rootPath) {
        subtitle.remove();
        return;
      }
      subtitle.textContent = rootPath;
      subtitle.title = "Open in File Explorer";
      subtitle.disabled = false;
    });
    subtitle.addEventListener("click", async () => {
      try {
        await openProjectsRoot();
      } catch (err) {
        fail(err.message);
      }
    });
    form.appendChild(subtitle);
  }

  const categoryDropdown = buildCreateCategoryDropdown(!editingEntry);

  const isUnassignedTarget = createForm.category === "unassigned";

  // Unassigned has no port range; the field is hidden then, so any range does.
  const portRange = isUnassignedTarget ? { start: 1, end: MAX_PORT } : categoryPortRange(createForm.category);
  const { el: portStepper, input: portInput } = buildPortStepper(portRange, createForm.port, (value) => {
    createForm.port = value;
    updateSubmitState();
  });
  portStepper.hidden = isUnassignedTarget;
  if (!isUnassignedTarget) {
    portStepper.title = `${createForm.category}'s port range: ${formatPortRange(portRange)}`;
  }

  const nameInput = document.createElement("input");
  nameInput.placeholder = "folder name";
  nameInput.value = createForm.name;

  const folderListPromise = editingEntry ? Promise.resolve([]) : fetchProjectFolders();
  const datalist = document.createElement("datalist");
  datalist.id = "project-folder-options";

  if (editingEntry) {
    nameInput.disabled = true;
    nameInput.title = "Name can't be changed here — it must match the project's folder name";
  } else {
    nameInput.setAttribute("list", "project-folder-options");
    nameInput.addEventListener("input", () => {
      createForm.name = nameInput.value;
      updateSubmitState();
    });
    const claimedNames = new Set([...entries.map((e) => e.name), ...unassigned.map((e) => e.name)]);
    folderListPromise.then((folders) => {
      for (const folder of folders) {
        if (claimedNames.has(folder) || SUGGESTION_EXCLUDED_FOLDERS.has(folder)) continue;
        const opt = document.createElement("option");
        opt.value = folder;
        datalist.appendChild(opt);
      }
    });
  }

  // The project's live site, linked from its page header (see
  // buildLiveSiteLink). Plain text rather than type="url", so a bare
  // "example.com" isn't flagged as invalid — normalizeSiteUrl adds https://.
  const urlInput = document.createElement("input");
  urlInput.inputMode = "url";
  urlInput.placeholder = "live site URL (optional)";
  urlInput.value = createForm.url;
  urlInput.addEventListener("input", () => {
    createForm.url = urlInput.value;
  });

  const descInput = document.createElement("textarea");
  descInput.className = "card-desc";
  descInput.rows = 3;
  descInput.maxLength = PROJECT_DESCRIPTION_MAX_LENGTH;
  descInput.placeholder = "description (optional)";
  descInput.value = createForm.description;
  function autoResizeDescInput() {
    descInput.style.height = "auto";
    descInput.style.height = `${descInput.scrollHeight}px`;
  }
  const descCounter = document.createElement("div");
  descCounter.className = "desc-counter";
  function updateDescCounter() {
    const over = descInput.value.length > descInput.maxLength;
    descCounter.textContent = `${descInput.value.length}/${descInput.maxLength}`;
    descCounter.classList.toggle("over-limit", over);
  }
  updateDescCounter();
  descInput.addEventListener("input", () => {
    createForm.description = descInput.value;
    autoResizeDescInput();
    updateDescCounter();
    updateSubmitState();
  });
  requestAnimationFrame(autoResizeDescInput);

  const createBtn = document.createElement("button");
  createBtn.className = "create-btn";
  createBtn.textContent = editingEntry ? "Save changes" : "Add project";

  async function persistWithSpinner() {
    const originalLabel = createBtn.innerHTML;
    createBtn.disabled = true;
    createBtn.innerHTML = ICON_SPINNER;
    const ok = await persist();
    if (!ok) {
      createBtn.disabled = false;
      createBtn.innerHTML = originalLabel;
    }
    return ok;
  }

  function updateSubmitState() {
    const categoryOk = createForm.category !== null && !isCategoryFullExcluding(createForm.category, excludePort);
    const portOk = createForm.category === "unassigned" || /^\d+$/.test(portInput.value.trim());
    const descOk = descInput.value.length <= descInput.maxLength;
    createBtn.disabled = !nameInput.value.trim() || !portOk || !categoryOk || !descOk;
  }
  updateSubmitState();

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cancel-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    editingKey = null;
    createForm = { category: null, port: null, name: "", description: "", url: "" };
    createDrawerOpen = false;
    render();
  });

  const actions = document.createElement("div");
  actions.className = "add-form-actions";

  function fail(message) {
    const existing = form.querySelector(".card-error");
    if (existing) existing.remove();
    const err = document.createElement("div");
    err.className = "card-error";
    err.textContent = message;
    form.insertBefore(err, actions);
  }

  createBtn.addEventListener("click", async () => {
    const existingFail = form.querySelector(".card-error");
    if (existingFail) existingFail.remove();

    const category = createForm.category;
    const port = portInput.value.trim();
    const url = normalizeSiteUrl(urlInput.value);
    if (url === null) return fail("Live site must be a web address, like example.com or https://example.com");

    if (editingSource === "entries") {
      if (!/^\d+$/.test(port)) return fail("Port must be a positive integer");
      const range = categoryPortRange(category);
      const portNum = Number(port);
      if (portNum < range.start || portNum > range.end) {
        return fail(`Port must be within ${category}'s range (${formatPortRange(range)})`);
      }
      const selfIndex = entries.findIndex((e) => e.port === editingKey.port);
      if (selfIndex === -1) {
        editingKey = null;
        render();
        return;
      }
      if (portConflict(port, selfIndex)) return fail(`Port ${port} is already in use`);
      if (isCategoryFullExcluding(category, excludePort)) return fail(`${category} is already at its limit`);
      const portsChanged = port !== editingEntry.port;
      if (portsChanged && !(await confirmPortsFree([editingEntry.port, port]))) return;

      const prev = { ...entries[selfIndex] };
      entries[selfIndex] = { ...entries[selfIndex], category, port, description: descInput.value.trim(), url, status: formStatus() };
      const ok = await persistWithSpinner();
      if (!ok) {
        entries[selfIndex] = prev;
        return;
      }
      editingKey = null;
      createForm = { category: null, port: null, name: "", description: "", url: "" };
      createDrawerOpen = false;
      render();
      return;
    }

    if (editingSource === "unassigned") {
      if (!/^\d+$/.test(port)) return fail("Port must be a positive integer");
      const range = categoryPortRange(category);
      const portNum = Number(port);
      if (portNum < range.start || portNum > range.end) {
        return fail(`Port must be within ${category}'s range (${formatPortRange(range)})`);
      }
      const unassignedIndex = unassigned.findIndex((e) => e.name === editingKey.name);
      if (unassignedIndex === -1) {
        editingKey = null;
        render();
        return;
      }
      if (portConflict(port, -1)) return fail(`Port ${port} is already in use`);
      if (isCategoryFull(category)) return fail(`${category} is already at its limit`);
      if (!(await confirmPortsFree([port]))) return;

      const removed = unassigned.splice(unassignedIndex, 1)[0];
      entries.push({ port, category, name: removed.name, description: descInput.value.trim(), url, status: formStatus() });
      const ok = await persistWithSpinner();
      if (!ok) {
        entries.pop();
        unassigned.splice(unassignedIndex, 0, removed);
        return;
      }
      editingKey = null;
      createForm = { category: null, port: null, name: "", description: "", url: "" };
      createDrawerOpen = false;
      render();
      return;
    }

    const name = nameInput.value.trim();
    if (!name) return fail("Name is required — must match the project's folder name");
    const folders = await folderListPromise;
    if (!folders.includes(name)) {
      try {
        await createProjectFolder(name);
      } catch (err) {
        return fail(err.message);
      }
    }

    if (category === "unassigned") {
      unassigned.push({ name, description: descInput.value.trim(), url });
      const ok = await persistWithSpinner();
      if (!ok) {
        unassigned.pop();
        return;
      }
      createForm = { category: null, port: null, name: "", description: "", url: "" };
      createDrawerOpen = false;
      render();
      return;
    }

    if (!/^\d+$/.test(port)) return fail("Port must be a positive integer");
    const range = categoryPortRange(category);
    const portNum = Number(port);
    if (portNum < range.start || portNum > range.end) {
      return fail(`Port must be within ${category}'s range (${formatPortRange(range)})`);
    }
    if (portConflict(port, -1)) return fail(`Port ${port} is already in use`);
    if (isCategoryFull(category)) return fail(`${category} is already at its limit`);
    if (!(await confirmPortsFree([port]))) return;

    entries.push({ port, category, name, description: descInput.value.trim(), url });
    const ok = await persistWithSpinner();
    if (!ok) {
      entries.pop();
      return;
    }
    createForm = { category: null, port: null, name: "", description: "", url: "" };
    createDrawerOpen = false;
    render();
  });

  const topRow = document.createElement("div");
  topRow.className = "add-form-row";
  topRow.appendChild(categoryDropdown);
  topRow.appendChild(portStepper);

  form.appendChild(topRow);
  form.appendChild(nameInput);
  form.appendChild(datalist);
  form.appendChild(urlInput);
  form.appendChild(descInput);
  form.appendChild(descCounter);
  if (editingEntry) form.appendChild(buildFinishedField());
  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  form.appendChild(actions);
  return form;
}
