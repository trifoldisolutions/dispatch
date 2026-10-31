// A project's Explorer panel: the file tree, its git marks and its search.

// The tree-view arrow used by the file explorer: points down when expanded,
// rotated (via .json-toggle.collapsed) to point right when collapsed.
const JSON_TOGGLE_CHEVRON =
  '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">' +
  '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Lazily fetches and caches one folder level of the Explorer panel's tree
// (per project + relative path, so collapsing/re-expanding or an unrelated
// re-render doesn't repeat the readdir), re-rendering once it resolves.
function ensureTreeLoaded(project, subpath) {
  const key = `${project}::${subpath}`;
  if (fileTreeCache[key] || fileTreeInFlight.has(key)) return;
  fileTreeInFlight.add(key);
  fetchProjectTree(project, subpath)
    .then((entries) => {
      fileTreeCache[key] = entries;
    })
    .catch((err) => {
      fileTreeCache[key] = { error: err.message };
    })
    .finally(() => {
      fileTreeInFlight.delete(key);
      render();
    });
}

// The cache key for searching `project` for `query`, its words tidied so
// "Server " and "server" share one search; null when there are no words.
function explorerSearchKey(project, query) {
  const terms = filterTerms(query);
  return terms.length > 0 ? `${project}::${terms.join(" ")}` : null;
}

// Same lazy-load/cache/dedupe pattern as ensureTreeLoaded, for the
// Explorer's search, re-rendering once the results are in — while the
// search box still has focus (see renderProjectPage).
function ensureExplorerSearch(project, query) {
  const key = explorerSearchKey(project, query);
  if (!key || explorerSearchCache[key] || explorerSearchInFlight.has(key)) return;
  explorerSearchInFlight.add(key);
  const terms = filterTerms(query);
  fetchProjectTreeSearch(project, terms.join(" "))
    .then((result) => {
      explorerSearchCache[key] = { ...result, terms };
    })
    .catch((err) => {
      explorerSearchCache[key] = { error: err.message };
    })
    .finally(() => {
      explorerSearchInFlight.delete(key);
      render();
    });
}

// Same lazy-load/cache/dedupe pattern again, for the Explorer panel header's
// folder and file counts. It walks the whole project, so it's fetched once
// per visit (see applyRoute), not on every expand.
function ensureExplorerCountsLoaded(project) {
  if (explorerCountsCache[project] || explorerCountsInFlight.has(project)) return;
  explorerCountsInFlight.add(project);
  fetchProjectTreeCounts(project)
    .then((result) => {
      explorerCountsCache[project] = result;
    })
    .catch((err) => {
      explorerCountsCache[project] = { error: err.message };
    })
    .finally(() => {
      explorerCountsInFlight.delete(project);
      render();
    });
}

// Lazily fetches and caches a project's git status (once per project — the
// Explorer panel doesn't re-fetch on every re-render/expand, only when it's
// missing from cache), re-rendering once it resolves.
function ensureGitStatusLoaded(project) {
  if (gitStatusCache[project] || gitStatusInFlight.has(project)) return;
  gitStatusInFlight.add(project);
  fetchGitStatus(project)
    .then((result) => {
      gitStatusCache[project] = { isRepo: result.isRepo, byPath: new Map(result.entries.map((e) => [e.path, e.status])) };
    })
    .catch((err) => {
      // Shown as no repo, but marked failed so retryFailedLoads asks again.
      gitStatusCache[project] = { isRepo: false, byPath: new Map(), error: err.message };
    })
    .finally(() => {
      gitStatusInFlight.delete(project);
      render();
    });
}

// Same priority order as the server's GIT_STATUS_PRIORITY — used here to
// pick one status for a folder that contains a mix of changed paths.
const GIT_STATUS_PRIORITY = ["conflicted", "modified", "renamed", "added", "untracked", "deleted", "ignored"];
const GIT_STATUS_LABELS = {
  conflicted: "Merge conflict",
  modified: "Modified",
  renamed: "Renamed",
  added: "Added",
  untracked: "Untracked",
  deleted: "Deleted",
  ignored: "Ignored",
};
// Single-letter badges, matching the convention VS Code's Explorer uses.
const GIT_STATUS_LETTERS = {
  conflicted: "C",
  modified: "M",
  renamed: "R",
  added: "A",
  untracked: "U",
  deleted: "D",
  ignored: "I",
};

// A file's status is a direct lookup; a folder's is the highest-priority
// status among any changed path at or beneath it, so an untouched folder
// with one modified file three levels down still shows as modified.
function gitStatusForPath(project, itemPath, isDir) {
  const cache = gitStatusCache[project];
  if (!cache || !cache.isRepo) return null;
  if (!isDir) return cache.byPath.get(itemPath) || null;
  const prefix = itemPath + "/";
  let best = null;
  for (const [path, status] of cache.byPath) {
    if (path !== itemPath && !path.startsWith(prefix)) continue;
    if (best === null || GIT_STATUS_PRIORITY.indexOf(status) < GIT_STATUS_PRIORITY.indexOf(best)) best = status;
  }
  return best;
}

function fileTreeMessage(text, depth, isError) {
  const msg = document.createElement("div");
  msg.className = "file-tree-message" + (isError ? " error" : "");
  msg.style.paddingLeft = `${4 + depth * 16 + 20}px`;
  msg.textContent = text;
  return msg;
}

// One folder's contents — fetched (or read from cache) for `subpath`, then
// rendered as a flat run of rows at `depth`. Expanded subfolders append
// their own children level recursively via buildFileTreeNode.
function buildFileTreeChildren(project, subpath, depth) {
  const key = `${project}::${subpath}`;
  ensureTreeLoaded(project, subpath);
  const container = document.createElement("div");
  container.className = "file-tree-children";
  const cached = fileTreeCache[key];
  if (!cached) {
    container.appendChild(fileTreeMessage("Loading…", depth, false));
  } else if (cached.error) {
    container.appendChild(fileTreeMessage(cached.error, depth, true));
  } else if (cached.length === 0) {
    container.appendChild(fileTreeMessage("Empty folder", depth, false));
  } else {
    for (const item of cached) {
      container.appendChild(buildFileTreeNode(project, subpath, item, depth));
    }
  }
  return container;
}

// Drops every cached tree level under (and including) `itemPath`, plus its
// parent's listing — the parent needs a fresh readdir since it no longer
// includes the deleted entry, and any cached descendant levels are now
// stale/gone regardless of whether they were ever expanded.
function invalidateTreeCache(project, itemPath) {
  const parentPath = itemPath.includes("/") ? itemPath.slice(0, itemPath.lastIndexOf("/")) : "";
  delete fileTreeCache[`${project}::${parentPath}`];
  const prefix = `${project}::${itemPath}`;
  for (const key of Object.keys(fileTreeCache)) {
    if (key === prefix || key.startsWith(prefix + "/")) delete fileTreeCache[key];
  }
  fileTreeExpanded.delete(prefix);
  delete explorerCountsCache[project]; // it took some folders or files with it
  // Searches that found it, or anything inside it, can't any more.
  for (const [key, result] of Object.entries(explorerSearchCache)) {
    if (!key.startsWith(`${project}::`) || !result.matches) continue;
    result.matches = result.matches.filter((m) => m.path !== itemPath && !m.path.startsWith(itemPath + "/"));
  }
}

async function handleFileTreeDelete(project, itemPath, item) {
  const message =
    item.type === "dir"
      ? `This permanently deletes the "${item.name}" folder and everything inside it. This can't be undone.`
      : `This permanently deletes "${item.name}". This can't be undone.`;
  const confirmed = await customConfirm(message);
  if (!confirmed) return;
  try {
    await deleteProjectTreeEntry(project, itemPath);
  } catch (err) {
    setStatus("error", err.message);
    return;
  }
  invalidateTreeCache(project, itemPath);
  render();
}

// One row (folder or file) plus, if it's an expanded folder, its children
// level nested beneath it — folders start collapsed until their toggle (or
// the row itself) is clicked, at which point their contents are fetched.
// In a search's results (`search`, see buildExplorerSearchResults) a folder
// holding matches lists only those instead, and starts open; a matching
// name has the search's words marked, and a file found by its contents
// has its matching lines under it.
function buildFileTreeNode(project, parentPath, item, depth, search = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "file-tree-node";
  const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
  const key = `${project}::${itemPath}`;
  const isDir = item.type === "dir";
  const holdsMatches = isDir && search !== null && search.levels.has(itemPath);
  const expanded = isDir && (holdsMatches ? !explorerSearchCollapsed.has(key) : fileTreeExpanded.has(key));

  const gitStatus = gitStatusForPath(project, itemPath, isDir);

  const row = document.createElement("div");
  row.className = "file-tree-row" + (gitStatus ? ` git-${gitStatus}` : "");
  row.dataset.dir = String(isDir);
  row.style.paddingLeft = `${4 + depth * 16}px`;
  if (gitStatus) row.title = GIT_STATUS_LABELS[gitStatus];

  const toggle = document.createElement(isDir ? "button" : "span");
  if (isDir) {
    toggle.type = "button";
    toggle.className = "json-toggle" + (expanded ? "" : " collapsed");
    toggle.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
    toggle.innerHTML = JSON_TOGGLE_CHEVRON;
  } else {
    toggle.className = "json-toggle-spacer";
  }
  row.appendChild(toggle);

  const icon = document.createElement("span");
  icon.className = "file-tree-icon";
  icon.innerHTML = isDir ? ICON_FOLDER : iconForFileName(item.name);
  row.appendChild(icon);

  const label = document.createElement("span");
  label.className = "file-tree-label";
  if (search && item.matched) appendHighlighted(label, item.name, search.terms);
  else label.textContent = item.name;
  row.appendChild(label);

  const end = document.createElement("span");
  end.className = "file-tree-end";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "file-tree-delete";
  deleteBtn.setAttribute("aria-label", `Delete ${item.name}`);
  deleteBtn.title = `Delete "${item.name}"`;
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleFileTreeDelete(project, itemPath, item);
  });
  end.appendChild(deleteBtn);

  if (gitStatus) {
    const badge = document.createElement("span");
    badge.className = "file-tree-badge";
    badge.textContent = GIT_STATUS_LETTERS[gitStatus];
    badge.title = GIT_STATUS_LABELS[gitStatus];
    end.appendChild(badge);
  }

  row.appendChild(end);

  if (isDir) {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      if (holdsMatches) {
        if (expanded) explorerSearchCollapsed.add(key);
        else explorerSearchCollapsed.delete(key);
      } else if (expanded) {
        fileTreeExpanded.delete(key);
      } else {
        fileTreeExpanded.add(key);
      }
      render();
    });
  }

  wrapper.appendChild(row);
  if (search && item.lineCount > 0) wrapper.appendChild(buildFileTreeSnippets(item, depth, search));
  if (expanded) {
    wrapper.appendChild(
      holdsMatches
        ? buildFileTreeSearchLevel(project, itemPath, depth + 1, search)
        : buildFileTreeChildren(project, itemPath, depth + 1)
    );
  }
  return wrapper;
}

// Folders first, then by name ignoring case — the order the server lists a
// folder in (see its tree route).
function compareTreeItems(a, b) {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// The Explorer with a search set: every match laid out in the tree under the
// folders that hold it — the search's words marked in a name that matched,
// and a file found by its contents followed by its first matching lines
// (see buildFileTreeSnippets). Those folders start open, though each can
// still be closed. A folder that matched with nothing inside it matching
// starts closed, and opening it lists everything it holds, the same as it
// would without a search.
function buildExplorerSearchResults(project, result) {
  const levels = new Map(); // folder path -> Map(name -> { name, type, matched, lines, lineCount })
  for (const match of result.matches) {
    const parts = match.path.split("/");
    parts.forEach((name, i) => {
      const parent = parts.slice(0, i).join("/");
      if (!levels.has(parent)) levels.set(parent, new Map());
      const level = levels.get(parent);
      const isMatch = i === parts.length - 1;
      const item = level.get(name) || { name, type: isMatch ? match.type : "dir", matched: false };
      if (isMatch) Object.assign(item, { matched: match.nameMatch, lines: match.lines || [], lineCount: match.lineCount || 0 });
      level.set(name, item);
    });
  }
  const container = document.createElement("div");
  container.className = "file-tree";
  container.appendChild(buildFileTreeSearchLevel(project, "", 0, { levels, terms: result.terms }));
  return container;
}

// Under a file the search found by its contents, lined up with its name:
// its first few matching lines, each with its line number and the search
// marked, then how many more there are. Contents match the search as one
// phrase, so that's what gets marked, not its words one by one.
function buildFileTreeSnippets(item, depth, search) {
  const list = document.createElement("div");
  list.className = "file-tree-snippets";
  list.style.paddingLeft = `${50 + depth * 16}px`; // a row's padding, toggle, icon and gaps (see buildFileTreeNode)
  const phrase = [search.terms.join(" ")];
  for (const { line, text } of item.lines) {
    const row = document.createElement("div");
    row.className = "file-tree-snippet";
    row.title = `Line ${line}: ${text}`;
    const number = document.createElement("span");
    number.className = "file-tree-snippet-line";
    number.textContent = line;
    const code = document.createElement("span");
    code.className = "file-tree-snippet-text";
    appendHighlighted(code, text, phrase);
    row.append(number, code);
    list.appendChild(row);
  }
  const more = item.lineCount - item.lines.length;
  if (more > 0) {
    const moreEl = document.createElement("div");
    moreEl.className = "file-tree-snippet-more";
    moreEl.textContent = `+${more} more line${more === 1 ? "" : "s"}`;
    list.appendChild(moreEl);
  }
  return list;
}

// One folder's worth of a search's results, at `depth`.
function buildFileTreeSearchLevel(project, subpath, depth, search) {
  const container = document.createElement("div");
  container.className = "file-tree-children";
  for (const item of [...search.levels.get(subpath).values()].sort(compareTreeItems)) {
    container.appendChild(buildFileTreeNode(project, subpath, item, depth, search));
  }
  return container;
}

// The Explorer's file tree without a search: the project folder's own
// top-level entries, collapsed by default, indented one step deeper per
// level as they're expanded.
function buildFileTree(entry) {
  const container = document.createElement("div");
  container.className = "file-tree";
  container.appendChild(buildFileTreeChildren(entry.name, "", 0));
  return container;
}

const EXPLORER_SEARCH_DELAY = 150; // ms of no typing before the Explorer searches

// The Explorer panel's content: a search box over the file tree, or over
// the search's results once there's something in it (see
// buildExplorerSearchResults). Searching walks the whole project on the
// server, reading every file's contents, so typing waits for a pause first;
// meanwhile, and while it runs,
// the last search's results stay on screen rather than flashing
// "Searching…" on every keystroke.
function buildExplorerPanel(entry) {
  ensureGitStatusLoaded(entry.name);
  const container = document.createElement("div");
  container.className = "explorer-tab";

  // A project folder that couldn't be listed, or holds nothing, has nothing
  // to search either, so there's no search box over saying so.
  const key = explorerSearchKey(entry.name, explorerQuery);
  if (!key) {
    ensureTreeLoaded(entry.name, "");
    const root = fileTreeCache[`${entry.name}::`];
    if (root && (root.error || root.length === 0)) {
      delete explorerLastSearch[entry.name];
      container.appendChild(
        root.error
          ? buildLoadErrorEmpty(entry.name, "Couldn't load files", root.error)
          : buildPanelEmpty({ icon: ICON_FOLDER, title: "Empty folder", text: "The project's folder has no files or folders in it yet." })
      );
      return container;
    }
  }

  const filter = buildPanelFilter({
    key: "explorer",
    value: explorerQuery,
    placeholder: "Search files…",
    label: "Search files and folders",
    onInput: (query) => {
      explorerQuery = query;
      explorerSearchCollapsed = new Set();
      clearTimeout(explorerSearchTimer);
      const key = explorerSearchKey(entry.name, query);
      if (!key || explorerSearchCache[key]) render();
      else explorerSearchTimer = setTimeout(render, EXPLORER_SEARCH_DELAY);
    },
    onClear: () => {
      explorerQuery = "";
      explorerSearchCollapsed = new Set();
      clearTimeout(explorerSearchTimer);
    },
  });
  container.appendChild(filter.el);

  const listEl = document.createElement("div");
  listEl.className = "explorer-list panel-scroll";
  listEl.dataset.scrollKey = "explorer"; // see renderProjectPage
  container.appendChild(listEl);

  if (!key) {
    delete explorerLastSearch[entry.name];
    listEl.appendChild(buildFileTree(entry));
    filter.updateStatus(null, false);
    return container;
  }

  ensureExplorerSearch(entry.name, explorerQuery);
  let shownKey = key;
  if (explorerSearchCache[key]) explorerLastSearch[entry.name] = key;
  else shownKey = explorerLastSearch[entry.name];
  const result = explorerSearchCache[shownKey];
  // Each search's results start from the top; re-renders of the same ones
  // (opening a folder in them, ...) keep their scroll.
  if (result) listEl.dataset.scrollKey = `explorer:${shownKey}`;

  if (!result) {
    listEl.appendChild(fileTreeMessage("Searching…", 0, false));
    filter.updateStatus(null, true);
  } else if (result.error) {
    listEl.appendChild(buildLoadErrorEmpty(entry.name, "Couldn't search", result.error));
    filter.updateStatus(null, true);
  } else {
    const count = result.matches.length;
    filter.updateStatus(`${count}${result.truncated ? "+" : ""} result${count === 1 ? "" : "s"}`, true);
    if (count === 0) {
      listEl.appendChild(
        buildPanelEmpty({
          icon: ICON_SEARCH,
          title: "No matches",
          text: `No file or folder names or contents match “${result.terms.join(" ")}”.`,
          action: { label: "Clear search", onClick: filter.clear },
        })
      );
    } else {
      listEl.appendChild(buildExplorerSearchResults(entry.name, result));
      if (result.truncated) {
        listEl.appendChild(fileTreeMessage(`Showing the first ${count} — add to the search to narrow it down.`, 0, false));
      }
    }
  }
  return container;
}

// The panels' header figures. Read from whatever's already cached — the
// panel's own render kicks off the fetch (the Explorer's counts, which its
// body doesn't need, are fetched from here), and the render() that follows
// it fills these in.
function explorerCountsMeta(name) {
  ensureExplorerCountsLoaded(name);
  const state = explorerCountsCache[name];
  if (!state || state.error) return null;
  return {
    text: `${countLabel(state.folders, "folder")} · ${countLabel(state.files, "file")}`,
    title: state.skipped.length > 0 ? `Not counting what's in ${state.skipped.join(", ")}` : null,
  };
}
