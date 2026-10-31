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

function nextFreePortInCategory(category, selfIndex) {
  const range = categoryPortRange(category);
  let candidate = range.start;
  while (candidate <= range.end && portConflict(String(candidate), selfIndex)) {
    candidate++;
  }
  return candidate <= range.end ? String(candidate) : null;
}
