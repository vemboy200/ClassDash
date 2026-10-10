// A Google Classroom class renamed by its teacher.
//
// Everything in ClassDash goes by class name: assignments, announcements,
// exclusions, links, the schedule, reminders, the class filter. A teacher
// renaming a class used to make a second class appear, with the old one
// left behind as an orphan holding all its settings. But a Classroom class
// keeps its id (the /c/<id> in its address) through a rename, and
// classes.json has it, so the class list read each pass says which name
// became which (renamesBetween), and everything saved under the old name
// moves to the new one (followRenames) before the pass reads anything.
//
// Two kinds of saved name. Real names (exclusions, a link's classes, class
// activity, the collected items) always move. Shown names (the class
// filter, the schedule, reminders) go by a link's name when the class is
// linked, and a link's name doesn't change, so they only move for a class
// that isn't linked.
//
// Classroom only: Canvas's and Edpuzzle's class files keep no ids yet.
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

/**
 * old name -> new name, for the classes whose id is in both lists under
 * different names. Left out when a name is ambiguous (two classes sharing
 * the old or the new one), or the new one is only the id: the list page's
 * last resort when it found no name, not a rename.
 */
function renamesBetween(before, now) {
  const out = new Map();
  if (!Array.isArray(before) || !Array.isArray(now)) return out;
  const count = list => {
    const n = new Map();
    for (const c of list) if (c && c.name) n.set(c.name, (n.get(c.name) || 0) + 1);
    return n;
  };
  const beforeNames = count(before), nowNames = count(now);
  const oldById = new Map(before.filter(c => c && c.id && c.name).map(c => [c.id, c.name]));
  for (const c of now) {
    if (!c || !c.id || !c.name || c.name === c.id) continue;
    const old = oldById.get(c.id);
    if (!old || old === c.name) continue;
    if (beforeNames.get(old) > 1 || nowNames.get(c.name) > 1 || nowNames.has(old)) continue;
    out.set(old, c.name);
  }
  return out;
}

/** Points each item's `class` at its new name, in place. How many moved. */
function renameIn(list, renames) {
  let moved = 0;
  if (!Array.isArray(list) || !renames.size) return 0;
  for (const x of list) {
    if (x && renames.has(x.class)) { x.class = renames.get(x.class); moved++; }
  }
  return moved;
}

function editJson(name, edit) {
  const file = path.join(PROJECT_ROOT, name);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  const moved = edit(data);
  if (moved) fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return moved || 0;
}

const swap = (list, renames) => Array.isArray(list) ? list.map(n => renames.get(n) || n) : list;

/** Moves everything saved under each old name to its new one. */
function followRenames(renames) {
  if (!renames || !renames.size) return { moved: 0 };
  const settings = require('./19-settings.js');
  const links = require('./29-class-links.js');
  const s = settings.read();
  const linked = links.linkMap(s.classLinks || []);
  // Shown names move only for classes no link renames.
  const shown = new Map([...renames].filter(([old]) => !linked.has(old)));
  let moved = 0;

  // Settings, through write() so each still passes its own checks.
  if ((s.exclusions || []).some(n => renames.has(n))) {
    if (settings.write('exclusions', swap(s.exclusions, renames)).ok) moved++;
  }
  if ((s.classLinks || []).some(l => l.classes.some(c => renames.has(c)))) {
    if (settings.write('classLinks', s.classLinks.map(l => ({ ...l, classes: swap(l.classes, renames) }))).ok) moved++;
  }
  const f = s.filterUnchecked;
  if (f && Array.isArray(f.cls) && f.cls.some(n => shown.has(n))) {
    if (settings.write('filterUnchecked', { ...f, cls: swap(f.cls, shown) }).ok) moved++;
  }
  // What the last collection read with: an exclusion that only moved in
  // settings.json would look like a change still waiting for a check.
  moved += editJson('fetch-applied.json', d => {
    if (!Array.isArray(d.exclusions) || !d.exclusions.some(n => renames.has(n))) return 0;
    d.exclusions = swap(d.exclusions, renames);
    return 1;
  });
  moved += editJson('class-activity.json', d => {
    let n = 0;
    for (const [old, now] of renames) {
      if (!(old in d)) continue;
      d[now] = Math.max(d[old], d[now] || 0);
      delete d[old];
      n++;
    }
    return n;
  });
  moved += editJson('last-collection.json', d => renameIn(d, renames));
  moved += editJson('messages.json', d => renameIn(d, renames));
  moved += editJson('new.json', d => renameIn(d.assignments, renames) + renameIn(d.announcements, renames));
  moved += editJson('school-schedule.json', d => renameIn(d.classes, shown));
  moved += require('./24-virtual-assignments.js').renameClasses(shown);
  return { moved };
}

module.exports = { renamesBetween, renameIn, followRenames };
