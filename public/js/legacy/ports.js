// Port math: each category's range, how full it is, free ports and conflicts.

function portConflict(candidatePort, selfIndex) {
  return entries.some((e, i) => i !== selfIndex && e.port === candidatePort);
}

function categoryCount(category) {
  return entries.filter((e) => e.category === category).length;
}

function isCategoryFull(category) {
  const limit = CATEGORY_LIMITS[category];
  return limit !== undefined && categoryCount(category) >= limit;
}

// Same as isCategoryFull, but doesn't count the entry currently being
// edited against its own category's limit.
function isCategoryFullExcluding(category, excludePort) {
  const limit = CATEGORY_LIMITS[category];
  if (limit === undefined) return false;
  const count = entries.filter((e) => e.category === category && e.port !== excludePort).length;
  return count >= limit;
}

// Ports belong to their category, not to a project: each category owns a
// contiguous block sized to its limit, in CATEGORIES order. Cold is last and
// unlimited, so its block just keeps growing.
function categoryPortRange(category) {
  let start = BASE_PORT;
  for (const cat of CATEGORIES) {
    const limit = CATEGORY_LIMITS[cat];
    const end = limit !== undefined ? start + limit - 1 : Infinity;
    if (cat === category) return { start, end };
    start = end + 1;
  }
}

function formatPortRange(range) {
  return `${range.start}–${range.end === Infinity ? "∞" : range.end}`;
}

// A port's category is whichever category's block it falls in, so a project's
// category always follows its port.
function categoryForPort(port) {
  return CATEGORIES.find((cat) => {
    const range = categoryPortRange(cat);
    return port >= range.start && port <= range.end;
  });
}

// Which projects have to slide over when a project (`moving`, or null when
// it's coming from unassigned) is dropped onto `targetPort`. The dragged
// project takes that port; whoever holds it and the projects lined up
// directly behind it each move one port along, until an open port (the
// dragged project's vacated one counts) absorbs the last of them. Moving down
// within its own category is the one exception: it closes up the gap it left,
// so the projects in between move back toward it instead. A project pushed
// over a category boundary changes category along with its port. Returns
// { entry, port } for each project that moves — not the dragged one.
function planPortShifts(moving, targetPort) {
  const occupied = new Map();
  for (const e of entries) if (e !== moving) occupied.set(Number(e.port), e);
  const closingGap = moving && Number(moving.port) < targetPort && moving.category === categoryForPort(targetPort);
  const step = closingGap ? -1 : 1;
  const shifts = [];
  for (let p = targetPort; occupied.has(p); p += step) {
    shifts.push({ entry: occupied.get(p), port: p + step });
  }
  return shifts;
}

// What a drop on the Switcher does: the slide planPortShifts() plans,
// unless that would touch a port with something listening (a running dev
// server, which a registry change can't move) and a straight swap wouldn't.
// The dragged project and whoever holds `targetPort` then trade ports, and no
// one else moves. `live` maps port (string) to listening, as portLiveStatus
// does. Returns { swap, shifts }, shifts as planPortShifts() gives them.
function planPortDrop(moving, targetPort, live) {
  const shifts = planPortShifts(moving, targetPort);
  if (!moving || shifts.length === 0) return { swap: false, shifts }; // nothing to trade with
  const anyLive = (ports) => ports.some((p) => live[String(p)]);
  const from = Number(moving.port);
  if (!anyLive([from, targetPort, ...shifts.flatMap((m) => [Number(m.entry.port), m.port])])) return { swap: false, shifts };
  if (anyLive([from, targetPort])) return { swap: false, shifts }; // a swap touches those too
  return { swap: true, shifts: [{ entry: shifts[0].entry, port: from }] }; // shifts[0] holds targetPort
}

function nextFreePortInCategory(category, selfIndex) {
  const range = categoryPortRange(category);
  let candidate = range.start;
  while (candidate <= range.end && portConflict(String(candidate), selfIndex)) {
    candidate++;
  }
  return candidate <= range.end ? String(candidate) : null;
}
