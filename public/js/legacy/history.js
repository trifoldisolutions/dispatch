// A project's History panel and its Push bar.

// Lazily fetches and caches a project's git history (once per project, same
// dedupe pattern as ensureGitStatusLoaded), for the History panel's last
// commit / last push display.
function ensureHistoryLoaded(project) {
  if (historyCache[project] || historyInFlight.has(project)) return;
  historyInFlight.add(project);
  fetchGitHistory(project)
    .then((result) => {
      historyCache[project] = result;
    })
    .catch((err) => {
      historyCache[project] = { error: err.message };
    })
    .finally(() => {
      historyInFlight.delete(project);
      render();
    });
}

// The History panel's content: the repo's last commit and when it was last
// pushed (see the git-history endpoint for how "last push" is derived from
// the upstream branch's reflog). Read-only — nothing here writes to the repo.
function buildHistoryPanel(entry, panel) {
  ensureHistoryLoaded(entry.name);
  const container = document.createElement("div");
  container.className = "history-tab";
  const state = historyCache[entry.name];

  if (!state) {
    container.appendChild(buildPanelLoading());
    return container;
  }
  if (state.error) {
    container.appendChild(buildLoadErrorEmpty(entry.name, "Couldn't load history", state.error));
    return container;
  }
  if (!state.isRepo) {
    container.appendChild(
      buildPanelEmpty({
        icon: ICON_GIT_BRANCH,
        title: "Not a git repository",
        text: "The project's last commit and push show here once its folder is a git repository.",
      })
    );
    return container;
  }

  const columns = document.createElement("div");
  columns.className = "history-columns";

  columns.appendChild(
    buildHistoryRow(
      "Last commit",
      state.lastCommit
        ? [
            { text: state.lastCommit.message },
            { text: `${state.lastCommit.shortHash} · ${state.lastCommit.author} · ${formatTimestamp(state.lastCommit.date)}`, dim: true },
          ]
        : [{ text: "No commits yet.", dim: true }]
    )
  );

  columns.appendChild(
    buildHistoryRow(
      "Last push",
      state.lastPush
        ? [{ text: formatTimestamp(state.lastPush.date) }, { text: `to ${state.upstream}`, dim: true }]
        : [{ text: state.upstream ? "No push recorded yet." : "No upstream branch configured.", dim: true }]
    )
  );

  // The push bar heads the panel: pending change count plus one-click Push,
  // counted from the same gitStatusCache entry that colors the Explorer.
  ensureGitStatusLoaded(entry.name);
  const gitState = gitStatusCache[entry.name];
  if (gitState && gitState.isRepo) {
    container.appendChild(buildGitPushBar(entry, panel, gitState, state.commitMessage));
  }

  // With nothing committed, there's no last commit or push to show yet.
  container.appendChild(
    state.lastCommit
      ? columns
      : buildPanelEmpty({ icon: ICON_GIT_COMMIT, title: "No commits yet", text: "The project's last commit and push show here after its first commit." })
  );

  return container;
}

// One label + stacked value lines for the History panel (e.g. "Last commit").
function buildHistoryRow(label, lines) {
  const row = document.createElement("div");
  row.className = "history-row";
  const labelEl = document.createElement("div");
  labelEl.className = "history-row-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);
  const valueEl = document.createElement("div");
  valueEl.className = "history-row-value";
  lines.forEach(({ text, dim }) => {
    const line = document.createElement("div");
    line.className = "history-row-line" + (dim ? " history-row-line-dim" : "");
    line.textContent = text;
    valueEl.appendChild(line);
  });
  row.appendChild(valueEl);
  return row;
}

// Re-applies the push button's disabled/label state without a full render()
// — same reasoning as refreshTaskRowDisabled: a full render on success
// already reflects this correctly, but the error path needs the button
// re-enabled without wiping the showCardError message about to be shown.
function refreshGitPushButton(project) {
  const btn = document.querySelector(`.git-push-btn[data-project="${project}"]`);
  if (!btn) return;
  const busy = gitPushInFlight.has(project);
  btn.disabled = busy;
  btn.textContent = busy ? "Pushing…" : "Push";
}

// Stages everything, commits with the project's pending message (server-side
// — see the git-push endpoint) if there's anything to commit, then pushes.
// The one push behind both Push buttons, this panel's and Ready to push's in
// the side column (window.DispatchLegacy.pushProject), so each shows the
// other's running: every start and end is announced as "dispatch:push".
// Resolves with the endpoint's { ok, committed }, or null when this project
// is already pushing. Invalidates the git-status and history caches on
// success so the Explorer badges and History panel both pick up the new
// state on the next render, which is the caller's to do.
async function runGitPush(name) {
  if (gitPushInFlight.has(name)) return null;
  const announce = () => {
    refreshGitPushButton(name);
    document.dispatchEvent(new CustomEvent("dispatch:push", { detail: { pushing: [...gitPushInFlight] } }));
  };
  gitPushInFlight.add(name);
  announce();
  try {
    const result = await requestGitPush(name);
    delete gitStatusCache[name];
    delete historyCache[name];
    return result;
  } finally {
    gitPushInFlight.delete(name);
    announce();
  }
}

async function pushProjectChanges(entry, panel) {
  try {
    if (await runGitPush(entry.name)) render();
  } catch (err) {
    showCardError(panel, err.message);
  }
}

// The bar heading the History panel for a git-repo project: how many paths
// currently show a git status, the commit message the next push will use
// (the summary line, full text on hover), plus a one-click "Push" button.
// No commit-message prompt by design — the project's agents keep that
// message written as they work (see git-push in routes/api.js).
function buildGitPushBar(entry, panel, gitState, commitMessage) {
  const bar = document.createElement("div");
  bar.className = "git-push-bar";

  const info = document.createElement("div");
  info.className = "git-push-info";
  const status = document.createElement("span");
  status.className = "git-push-status";
  const changeCount = gitState.byPath.size;
  status.textContent = changeCount === 0 ? "No pending changes" : `${changeCount} change${changeCount === 1 ? "" : "s"}`;
  info.appendChild(status);
  const message = document.createElement("span");
  message.className = "git-push-message" + (commitMessage ? "" : " empty");
  if (commitMessage) {
    message.textContent = commitMessage.split("\n")[0];
    message.title = commitMessage;
  } else {
    message.textContent = "No commit message yet — Push would use “Auto-commit: <date>”";
  }
  info.appendChild(message);
  bar.appendChild(info);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "git-push-btn";
  btn.dataset.project = entry.name;
  // A redraw mid-push (one started on Ready to push, maybe) keeps showing it.
  btn.textContent = gitPushInFlight.has(entry.name) ? "Pushing…" : "Push";
  btn.disabled = gitPushInFlight.has(entry.name);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pushProjectChanges(entry, panel);
  });
  bar.appendChild(btn);
  return bar;
}

function historyMeta(name) {
  const state = historyCache[name];
  if (!state || state.error || !state.isRepo) return null;
  const parts = [state.branch, countLabel(state.commitCount, "commit")];
  if (state.unpushedCount > 0) parts.push(`${state.unpushedCount} unpushed`);
  return {
    text: parts.join(" · "),
    title: state.unpushedCount > 0 ? `${countLabel(state.unpushedCount, "commit")} not on ${state.upstream} yet` : null,
  };
}
