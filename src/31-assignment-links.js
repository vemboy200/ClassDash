// Assignment links: the same piece of work on two platforms (an Edpuzzle
// posted in Classroom and in Edpuzzle itself, say) shown as one card.
// Linked by hand on the page: "Link" on one card, "Link here" on another.
//
// Stored in assignment-links.json as [{ items: [id, id, ...] }], the first
// id leading: its title, link and class are the card's. sortIntoBuckets()
// (05-playwright-draft.js) merges each group into one item before
// bucketing, so the page and the API both see one assignment.
//
// WHAT "DONE" MEANS PER PLATFORM. Classroom turns a handed-in assignment's
// type into "Completed ...". Canvas and Edpuzzle never return handed-in work
// (10-canvas.js and 11-edpuzzle.js skip it), so it disappears and is marked
// `removed` a few checks later. So a part is done when it's "Completed", or
// when it's a removed Canvas/Edpuzzle one. A removed Classroom part means
// the teacher took it down: it leaves the count, and the link goes on.
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const FILE = path.join(PROJECT_ROOT, 'assignment-links.json');
const STATE_FILE = path.join(PROJECT_ROOT, 'last-collection.json');

function readLinks() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list.filter(g => g && Array.isArray(g.items) && g.items.length > 1) : [];
  } catch {
    return [];
  }
}

function writeLinks(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function isDone(x) {
  if (/^completed\b/i.test(x.type || '')) return true;
  return !!x.removed && (x.platform === 'Canvas' || x.platform === 'Edpuzzle');
}

/** Taken down by the teacher: a removed Classroom part. */
function isDropped(x) {
  return !!x.removed && !isDone(x);
}

/** The class each item shows under (class links applied), by id. */
function shownClasses(ids) {
  const { linkMap, linkedName } = require('./29-class-links.js');
  const map = linkMap();
  let items = [];
  try { items = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const byId = new Map(items.map(x => [x.id, x]));
  return ids.map(id => (byId.has(id) ? linkedName(byId.get(id).class, map) : null));
}

/**
 * Links b to a (a was clicked first, so a's group leads). With
 * assignmentLinksSameClass on, both have to show under the same class.
 */
function link(a, b) {
  a = String(a || '').trim(); b = String(b || '').trim();
  if (!a || !b || a === b) return { ok: false, why: 'needs two different assignments' };
  if (require('./19-settings.js').read().assignmentLinksSameClass) {
    const [ca, cb] = shownClasses([a, b]);
    if (!ca || !cb) return { ok: false, why: 'assignment not found' };
    if (ca !== cb) return { ok: false, why: 'only assignments in the same class can be linked (Settings → Classes)' };
  }
  const list = readLinks();
  const ga = list.find(g => g.items.includes(a));
  const gb = list.find(g => g.items.includes(b));
  if (ga && ga === gb) return { ok: true, items: ga.items };
  const items = [...(ga ? ga.items : [a]), ...(gb ? gb.items : [b])];
  const next = list.filter(g => g !== ga && g !== gb);
  next.push({ items });
  writeLinks(next);
  return { ok: true, items };
}

/** Undoes the whole link the assignment is part of. */
function unlink(id) {
  const list = readLinks();
  const next = list.filter(g => !g.items.includes(id));
  if (next.length === list.length) return { ok: false, why: 'not linked' };
  writeLinks(next);
  return { ok: true };
}

/**
 * One item per linked group (2+ parts present), in the leader's place.
 * dueOf(x) gives a part's due date, for picking the earliest open part.
 */
function mergeLinked(items, links = readLinks(), dueOf = x => (x.due_iso ? new Date(x.due_iso) : null)) {
  if (!links.length) return items;
  const byId = new Map(items.map(x => [x.id, x]));
  const groupOf = new Map();
  for (const g of links) {
    const present = g.items.filter(id => byId.has(id));
    if (present.length > 1) for (const id of present) groupOf.set(id, present);
  }
  if (!groupOf.size) return items;

  const out = [];
  const done = new Set();
  for (const x of items) {
    const group = groupOf.get(x.id);
    if (!group) { out.push(x); continue; }
    if (done.has(group)) continue;
    done.add(group);

    const parts = group.map(id => byId.get(id));
    const leader = parts[0];
    const counted = parts.filter(p => !isDropped(p));
    const open = counted.filter(p => !isDone(p));
    const partsDone = counted.length - open.length;
    const merged = {
      ...leader,
      parts: parts.map(p => ({
        id: p.id, title: p.title, platform: p.platform || null, link: p.link || null,
        done: isDone(p), removed: isDropped(p),
      })),
      partsDone,
      partsTotal: counted.length,
    };
    if (!counted.length) {
      merged.removed = true;   // every part taken down
    } else if (!open.length) {
      merged.allDone = true;
      delete merged.removed;
    } else {
      // Bucketed by what's still open: the earliest open part's due date
      // and type, whatever state the leader itself is in.
      const soonest = open.slice().sort((p, q) => {
        const dp = dueOf(p), dq = dueOf(q);
        if (!dp) return dq ? 1 : 0;
        if (!dq) return -1;
        return dp - dq;
      })[0];
      merged.due = soonest.due;
      merged.due_iso = soonest.due_iso;
      merged.type = soonest.type;
      delete merged.removed;
      delete merged.removedAt;
    }
    out.push(merged);
  }
  return out;
}

module.exports = { FILE, readLinks, link, unlink, mergeLinked, isDone };
