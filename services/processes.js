const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, exec } = require("child_process");

// name -> { dev: ChildProcess, tw: ChildProcess|null }. In-memory only — if
// this server restarts, previously started dev/tw processes are orphaned and
// no longer trackable/stoppable from here.
const runningProjects = new Map();

// Whether some process is actually listening on a port right now, as opposed
// to just being reserved for a project in the registry.
function isPortServing(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

function hasScript(projectDir, scriptName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    return !!(pkg.scripts && pkg.scripts[scriptName]);
  } catch {
    return false;
  }
}

// Best-effort classification from exit code/signal plus the tail of stderr,
// so the client can show something more useful than "it stopped".
function classifyExitError(code, signal, stderrTail, port) {
  if (signal) return `process was terminated (${signal})`;
  if (/EADDRINUSE/i.test(stderrTail)) return `port ${port} is already in use by another process`;
  if (/ENOENT/i.test(stderrTail)) return "npm (or a required command) was not found on PATH";
  return `exited with code ${code}`;
}

// A shell-spawned npm process on Windows is really cmd.exe -> npm -> node
// (nodemon) -> node (the actual script). Only a recursive tree-kill reliably
// takes down the whole chain; proc.kill() alone only kills the shell.
function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.pid === undefined) return;
  if (process.platform === "win32") {
    exec(`taskkill /pid ${proc.pid} /t /f`);
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  }
}

// Tracks stderr (for error classification only — stdout is discarded, we're
// not building a log viewer) and reconciles `state`/`runningProjects` once
// the process exits, distinguishing a user-requested stop from a crash.
function attachExitWatcher(proc, name, kind, state) {
  let stderrTail = "";
  if (proc.stderr) {
    proc.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
  }
  proc.on("exit", (code, signal) => {
    if (state.stoppedByUser) {
      if (kind === "dev") state.dev = null;
      else state.tw = null;
      if (!state.dev && !state.tw) runningProjects.delete(name);
      return;
    }
    if (kind === "dev") {
      state.dev = null;
      if (code === 0 && !signal) {
        runningProjects.delete(name); // exited cleanly on its own — not a crash
        return;
      }
      state.status = "crashed";
      state.error = classifyExitError(code, signal, stderrTail, state.port);
      if (state.tw) killProcessTree(state.tw); // tailwind watching alone isn't useful without the server
    } else {
      state.tw = null;
      if (!(code === 0 && !signal)) {
        state.twError = classifyExitError(code, signal, stderrTail, state.port);
      }
    }
  });
}

// Finds the PID(s) with an OS socket LISTENING on a port, for stopping a
// project we never spawned ourselves (started from a terminal outside this
// dashboard). Only the exact listening process is targeted — deliberately
// not walking up to its parent/shell, since that chain could lead to a
// terminal window or IDE process well outside this dev server's tree.
function findPidsListeningOnPort(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec("netstat -ano -p tcp", (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const pids = new Set();
        for (const line of stdout.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 5 || parts[3] !== "LISTENING") continue;
          const localPort = parts[1].split(":").pop();
          if (localPort !== String(port) || !/^\d+$/.test(parts[4])) continue;
          pids.add(Number(parts[4]));
        }
        resolve([...pids]);
      });
    } else {
      exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve([...new Set(stdout.split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).map(Number))]);
      });
    }
  });
}

// name -> { status, error, twError } for each project Dispatch started.
function runsSnapshot() {
  const out = {};
  for (const [name, state] of runningProjects.entries()) {
    out[name] = { status: state.status, error: state.error || null, twError: state.twError || null };
  }
  return out;
}

// explorer.exe opening a folder just messages the already-running shell
// process to create the window — that window belongs to the shell, not to
// this spawned child, so Windows' focus-stealing prevention tends to leave
// it in the background (the request came from this unfocused Node process,
// not from something the user was just interacting with). Nudging it to the
// front via AppActivate is best-effort: the folder name is passed through an
// env var rather than interpolated into the command string, so it can't
// break out of the PowerShell script regardless of what characters it has.
function bringExplorerToFront(folderName) {
  if (process.platform !== "win32") return;
  setTimeout(() => {
    spawn(
      "powershell",
      ["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).AppActivate($env:DISPATCH_FOCUS_TARGET)"],
      { env: { ...process.env, DISPATCH_FOCUS_TARGET: folderName }, windowsHide: true }
    ).on("error", () => {}); // best-effort — a failed nudge shouldn't surface anywhere
  }, 400);
}

module.exports = {
  runningProjects,
  isPortServing,
  hasScript,
  killProcessTree,
  attachExitWatcher,
  findPidsListeningOnPort,
  runsSnapshot,
  bringExplorerToFront,
};
