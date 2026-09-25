// Class links: several platforms' classes shown as one class (a Classroom
// class, its Canvas course, its Edpuzzle class), or one class shown under a
// nicer name. Set in Settings → Classes, stored as `classLinks`.
//
// Display only. The page (writePage in 08-page.js) and the API (gather in
// 17-api.js) rename each item's `class` as they read the data, so everything
// that groups by class (cards, the class filter, counts, teachers, the API
// roster) groups by the linked name. What gets read, exclusions, stale
// classes and each platform's own class file all stay on the real names.
const settings = require('./19-settings.js');

function readLinks() {
  return settings.read().classLinks || [];
}

/** real class name -> linked name, for linked classes only */
function linkMap(links = readLinks()) {
  const map = new Map();
  for (const link of links) for (const c of link.classes) map.set(c, link.name);
  return map;
}

function linkedName(raw, map = linkMap()) {
  return map.get(raw) || raw;
}

/** Copies of the items with `class` linked; the platform's own name is kept as `sourceClass`. */
function linkItems(list, map = linkMap()) {
  if (!map.size || !list) return list;
  return list.map(x => {
    const linked = x && x.class ? map.get(x.class) : undefined;
    return linked && linked !== x.class ? { ...x, class: linked, sourceClass: x.class } : x;
  });
}

/** Real names, linked and without repeats, in their original order. */
function linkedClassNames(rawNames, map = linkMap()) {
  return [...new Set(rawNames.map(n => linkedName(n, map)))];
}

/** A linked class's teachers are all its members' teachers: "A, B". */
function linkedTeachers(rawTeachers, map = linkMap()) {
  const out = new Map();
  for (const [raw, teacher] of rawTeachers) {
    const name = linkedName(raw, map);
    const names = out.has(name) ? out.get(name).split(', ') : [];
    for (const t of teacher.split(', ')) if (!names.includes(t)) names.push(t);
    out.set(name, names.join(', '));
  }
  return out;
}

/** A linked class is "known" if any of its members still is. */
function linkedStatus(rawStatus, map = linkMap()) {
  const out = new Map();
  for (const [raw, status] of rawStatus) {
    const name = linkedName(raw, map);
    if (out.get(name) !== 'known') out.set(name, status);
  }
  return out;
}

/** The real classes behind a shown name: a link's members, or just the name. */
function membersOf(name, links = readLinks()) {
  const link = links.find(l => l.name === name);
  return link ? [...link.classes] : [name];
}

/**
 * After the links change: where each link name that's gone should point now.
 * Reminders keep their class as plain text, so one saved under a link's name
 * would otherwise be stranded under a name nothing uses any more. Renamed
 * (the new link sharing the most of its classes) -> the new name; removed ->
 * its first class, which is what that reminder's class really was.
 */
function renamesAfter(oldLinks, newLinks) {
  const out = new Map();
  const stillThere = new Set(newLinks.map(l => l.name));
  for (const old of oldLinks) {
    if (stillThere.has(old.name)) continue;
    let best = null, shared = 0;
    for (const link of newLinks) {
      const n = link.classes.filter(c => old.classes.includes(c)).length;
      if (n > shared) { best = link; shared = n; }
    }
    out.set(old.name, best ? best.name : old.classes[0]);
  }
  return out;
}

module.exports = {
  readLinks, linkMap, linkedName, linkItems, linkedClassNames,
  linkedTeachers, linkedStatus, membersOf, renamesAfter,
};
