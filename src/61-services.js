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
 */

const fs = require('fs');
const path = require('path');

const SERVICES_DIR = path.join(__dirname, 'services');

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
function problems(m, folder) {
  const out = [];
  const isStrings = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['not a JSON object'];
  if (m.domain !== folder) out.push(`domain should be "${folder}", the folder's name`);
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
  return out;
}

/**
 * Every service with a valid manifest, built-in order first.
 * @param {string} [dir] where to look (tests point it at a folder of their own)
 * @returns {object[]} the manifests
 */
function list(dir = SERVICES_DIR) {
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
    const wrong = problems(manifest, folder);
    if (wrong.length) {
      console.warn(`service "${folder}" skipped: ${wrong.join('; ')}`);
      continue;
    }
    found.push(manifest);
  }
  const rank = d => (ORDER.includes(d) ? ORDER.indexOf(d) : ORDER.length);
  return found.sort((a, b) => rank(a.domain) - rank(b.domain) || a.domain.localeCompare(b.domain));
}

/**
 * A service's code: its services/<domain>/index.js, which is the only file of
 * a service the check calls. null when it has none yet (not every built-in
 * service goes through the bridge yet) or no valid manifest.
 */
function load(domain, dir = SERVICES_DIR) {
  if (!list(dir).some(m => m.domain === domain)) return null;
  const entry = path.join(dir, domain, 'index.js');
  return fs.existsSync(entry) ? require(entry) : null;
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

module.exports = { list, load, result, savedFor, nameOf, problems, SERVICES_DIR, CATEGORIES, COMMUNICATION_CLASSES, BROWSER_CLASSES };
