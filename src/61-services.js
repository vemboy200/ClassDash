/**
 * The bridge between ClassDash and its services, the way Home Assistant's
 * loader sits between HA and its integrations.
 *
 * Each service is a folder, services/<domain>/, with a manifest.json saying
 * what it is. The bridge finds them and reads their manifests, so the rest of
 * ClassDash (the Services cards in Settings, and later the check itself) asks
 * the bridge which services there are instead of keeping its own list.
 *
 * ── manifest.json ──
 *
 * The same facts as the Details table at the bottom of the service's page in
 * docs/services/, and test/service-manifests.test.js fails if the two ever
 * disagree:
 *
 *   domain               the folder's name, and the service's id everywhere
 *   name                 a string, or { en, ru, ... } when it's translated
 *   categories           assignments, instructions, announcements, grades,
 *                        progress_reports, calendar
 *   introduced           the ClassDash version it first came in
 *   communication_class  cloud_polling, cloud_push or cloud_mixed (HA's
 *                        iot_class, for school services)
 *   browser_class        background, visible, optional or none
 *   codeowners           GitHub names, [] for none yet
 *   documentation        its page, relative to the repository
 *   runs                 optional: "background" to be read in a process of
 *                        its own after a check (62-service-run.js), not in it
 *
 * A folder without a readable, valid manifest is skipped with a warning
 * rather than taking every other service down with it.
 *
 * ── Custom services ──
 *
 * Like Home Assistant's custom_components: a folder of the same shape in the
 * project's own custom_services/<domain>/, which ClassDash loads next to the
 * built-in ones. Its manifest also needs a `version` (its own, not
 * ClassDash's), and the bridge marks it `custom: true`. One with a built-in
 * service's domain is skipped: a custom service adds a service, it doesn't
 * replace one. A custom service is code you put there yourself, run with the
 * same access as ClassDash, so only add one you trust.
 */

const fs = require('fs');
const path = require('path');

const SERVICES_DIR = path.join(__dirname, 'services');
const CUSTOM_DIR = path.join(require('./00-project-root.js').PROJECT_ROOT, 'custom_services');

const CATEGORIES = ['assignments', 'instructions', 'announcements', 'grades', 'progress_reports', 'calendar'];
const COMMUNICATION_CLASSES = ['cloud_polling', 'cloud_push', 'cloud_mixed'];
const BROWSER_CLASSES = ['background', 'visible', 'optional', 'none'];
// Optional: "background" for a slow service read in a process of its own after
// a check (62-service-run.js); left out, or "check", it's read during the check.
const RUNS = ['check', 'background'];

// The built-in services in the order their cards have always had. Anything
// else (a service added later without being put here) comes after them,
// alphabetically.
const ORDER = ['classroom', 'canvas', 'edpuzzle', 'q', 'calendar'];

/** What's wrong with a manifest, as a list of reasons; empty when it's fine. */
function problems(m, folder, { custom = false } = {}) {
  const out = [];
  const isStrings = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['not a JSON object'];
  if (m.domain !== folder) out.push(`domain should be "${folder}", the folder's name`);
  // It ends up in the page's HTML and in file names, so only these.
  if (!/^[a-z0-9_]+$/.test(folder)) out.push('the folder\'s name (the domain) should be lowercase letters, digits and _ only');
  const nameOk = typeof m.name === 'string' ? !!m.name.trim()
    : m.name && typeof m.name === 'object' && typeof m.name.en === 'string' && !!m.name.en.trim();
  if (!nameOk) out.push('name should be a string, or an object with at least "en"');
  if (!isStrings(m.categories) || !m.categories.length || m.categories.some(c => !CATEGORIES.includes(c))) {
    out.push(`categories should be one or more of ${CATEGORIES.join(', ')}`);
  }
  if (typeof m.introduced !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.introduced)) out.push('introduced should be a version like 1.0.0');
  if (!COMMUNICATION_CLASSES.includes(m.communication_class)) out.push(`communication_class should be one of ${COMMUNICATION_CLASSES.join(', ')}`);
  if (!BROWSER_CLASSES.includes(m.browser_class)) out.push(`browser_class should be one of ${BROWSER_CLASSES.join(', ')}`);
  if (!isStrings(m.codeowners) || m.codeowners.some(o => !o.startsWith('@'))) out.push('codeowners should be a list of @names');
  if (typeof m.documentation !== 'string' || !m.documentation) out.push('documentation should be the path to its page');
  if (m.runs !== undefined && !RUNS.includes(m.runs)) out.push(`runs should be one of ${RUNS.join(', ')}`);
  if (custom && (typeof m.version !== 'string' || !m.version.trim())) out.push('version should be the custom service\'s own version, like 1.0.0');
  return out;
}

/** Every valid manifest in one folder of services, with where it was found. */
function listIn(dir, { custom = false } = {}) {
  let folders = [];
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
  const found = [];
  for (const folder of folders) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, folder, 'manifest.json'), 'utf8'));
    } catch (e) {
      console.warn(`service "${folder}" skipped: no readable manifest.json (${e.message})`);
      continue;
    }
    const wrong = problems(manifest, folder, { custom });
    if (wrong.length) {
      console.warn(`${custom ? 'custom ' : ''}service "${folder}" skipped: ${wrong.join('; ')}`);
      continue;
    }
    // Where it was found, for load(); not part of what a manifest says.
    Object.defineProperty(manifest, 'dir', { value: path.join(dir, folder) });
    if (custom) manifest.custom = true;
    found.push(manifest);
  }
  return found;
}

/**
 * Every service with a valid manifest: the built-in ones in their order, then
 * custom ones (custom_services/ in the project) alphabetically.
 * @param {string} [dir] only this folder of services (tests point it at one of their own)
 * @param {object} [options] { customDir }: where custom services are, or null for none
 * @returns {object[]} the manifests
 */
function list(dir, { customDir = dir ? null : CUSTOM_DIR } = {}) {
  const found = listIn(dir || SERVICES_DIR);
  if (customDir) {
    for (const m of listIn(customDir, { custom: true })) {
      if (found.some(b => b.domain === m.domain)) {
        console.warn(`custom service "${m.domain}" skipped: there's a built-in service with that name`);
        continue;
      }
      found.push(m);
    }
  }
  const rank = d => (ORDER.includes(d) ? ORDER.indexOf(d) : ORDER.length);
  return found.sort((a, b) => (!!a.custom - !!b.custom) || rank(a.domain) - rank(b.domain) || a.domain.localeCompare(b.domain));
}

/**
 * A service's code: its index.js, which is the only file of a service the
 * check calls. null when there's no such service, it has no index.js, or its
 * index.js fails to load (a custom service with a mistake in it is skipped
 * with a warning, and takes nothing else down).
 */
function load(domain, dir, options) {
  const manifest = list(dir, options).find(m => m.domain === domain);
  if (!manifest) return null;
  const entry = path.join(manifest.dir, 'index.js');
  if (!fs.existsSync(entry)) return null;
  try {
    return require(entry);
  } catch (e) {
    console.warn(`service "${domain}" not loaded: its index.js failed (${String(e.message).split('\n')[0]})`);
    return null;
  }
}

/**
 * What every service's read() hands back, filled out: whatever it leaves out
 * is empty, so the check can merge every service the same way.
 *
 *   items          assignments and materials, in the page's shared item shape
 *   announcements  teachers' posts
 *   grades         per class
 *   events         calendar events
 *   status         { ok, detail, fallback }: the service's dot in Settings and
 *                  /api/check-status. `fallback` is a yellow dot: it worked,
 *                  but not the way it was set up to (Canvas's token failing
 *                  over to the sign-in).
 *   sources        optional, for a service read in parts that can fail on
 *                  their own (Classroom: one per class): [{ id, name, ok,
 *                  error, items, announcements }]. A part with ok: false keeps
 *                  its items from memory instead of losing them.
 *
 * A read() that fails throws instead; the check turns that into a red dot.
 */
function result(raw = {}) {
  const list = key => (Array.isArray(raw[key]) ? raw[key] : []);
  const status = raw.status || {};
  return {
    items: list('items'),
    announcements: list('announcements'),
    grades: list('grades'),
    events: list('events'),
    status: { ok: status.ok !== false, detail: status.detail || null, fallback: !!status.fallback },
    sources: list('sources'),
  };
}

/**
 * What ClassDash kept from a service's last read, handed to it as
 * bridge.saved. The calendar feed's is in school-calendar.json, where it was
 * from before services went through the bridge, so it's read from there.
 */
const SAVED_ELSEWHERE = {
  calendar: () => {
    const ics = require('./33-school-calendar.js').readCalendar().ics || {};
    return { url: ics.url, fetchedAt: ics.fetchedAt, failedAt: ics.failedAt };
  },
};
function savedFor(domain) {
  return SAVED_ELSEWHERE[domain] ? SAVED_ELSEWHERE[domain]() : {};
}

/** A service's name in the page's language, falling back to English. */
function nameOf(manifest, language = 'en') {
  return typeof manifest.name === 'string' ? manifest.name : (manifest.name[language] || manifest.name.en);
}

module.exports = { list, load, result, savedFor, nameOf, problems, SERVICES_DIR, CUSTOM_DIR, CATEGORIES, COMMUNICATION_CLASSES, BROWSER_CLASSES };
