/**
 * Finding services after a sign-in, the way Home Assistant offers devices it
 * discovered: sign in to Google once, and ClassDash tries the services that
 * use Google sign-in and aren't set up yet. The ones that work are offered in
 * Settings → Services as "Found", with Set up and Ignore. Nothing is turned
 * on by itself.
 *
 * A service takes part with a found(bridge) in its index.js: given
 * bridge.openPage (a tab of ClassDash's browser, headless), it answers
 * whether this sign-in works for it, by looking, never by changing anything.
 * An optional canFind(bridge) says whether there's anything to try at all
 * (Canvas: only with its address saved), so nothing opens a browser for
 * nothing.
 *
 * Run by 05-playwright-draft.js --discover [sign-in], which the sign-in
 * window starts as it closes, and Settings → Sign-ins' Look again.
 *
 * discovered.json: { found: { <domain>: { by, at } }, ignored: [<domain>] }
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');
const services = require('./61-services.js');
const signIns = require('./64-sign-ins.js');

const FILE = path.join(PROJECT_ROOT, 'discovered.json');

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { found: d.found || {}, ignored: Array.isArray(d.ignored) ? d.ignored : [] };
  } catch { return { found: {}, ignored: [] }; }
}
function write(d) {
  try { fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch { /* best effort */ }
}

/** Whether a service is off in these settings (only those are worth finding). */
function isOff(service, settings, domain) {
  try { return !!service.enabled && !service.enabled({ domain, settings }); } catch { return false; }
}

/**
 * The services worth trying after a sign-in (`signInId`, or every sign-in
 * when empty): they use it, have a found(), are off, and weren't ignored.
 */
function candidates(signInId, settings) {
  const { ignored } = read();
  const out = [];
  for (const manifest of services.list()) {
    const uses = signIns.stepsFor(manifest).map(st => st.id);
    if (!uses.length || (signInId && !uses.includes(signInId))) continue;
    if (ignored.includes(manifest.domain)) continue;
    const service = services.load(manifest.domain);
    if (!service || typeof service.found !== 'function' || !isOff(service, settings, manifest.domain)) continue;
    try { if (service.canFind && !service.canFind({ domain: manifest.domain, settings })) continue; } catch { continue; }
    out.push({ manifest, service, by: signInId || uses[0] });
  }
  return out;
}

/**
 * Tries each candidate and keeps what was found. One whose test fails or
 * throws just isn't found; an earlier finding it no longer confirms is
 * dropped.
 * @returns {Promise<string[]>} the domains found
 */
async function run(signInId, settings, openPage, log = () => {}) {
  const d = read();
  const found = [];
  for (const c of candidates(signInId, settings)) {
    const domain = c.manifest.domain;
    let ok = false;
    try { ok = !!(await c.service.found({ domain, settings, openPage, log })); } catch (e) { log(`  ${domain}: ${e.message}`); }
    log(`  ${services.nameOf(c.manifest)}: ${ok ? 'found' : 'not found'}`);
    if (ok) { d.found[domain] = { by: c.by, at: new Date().toISOString() }; found.push(domain); } else delete d.found[domain];
  }
  write(d);
  return found;
}

/** What to offer in Settings → Services: found, still off, not ignored. */
function offers(settings) {
  const d = read();
  return services.list().filter(m => {
    if (!d.found[m.domain] || d.ignored.includes(m.domain)) return false;
    const service = services.load(m.domain);
    return !!service && isOff(service, settings, m.domain);
  });
}

/** Ignore: never offered again (setting it up by hand still works). */
function ignore(domain) {
  if (!/^[a-z0-9_]+$/.test(String(domain))) return false;
  const d = read();
  if (!d.ignored.includes(domain)) d.ignored.push(domain);
  delete d.found[domain];
  write(d);
  return true;
}

module.exports = { candidates, run, offers, ignore, read, FILE };
