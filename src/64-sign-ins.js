/**
 * The sign-ins done in ClassDash's browser, for Settings → Sign-ins and the
 * sign-in window (05-playwright-draft.js --login <id>).
 *
 * Two of the sign-in classes in docs/services.md happen in the browser, and
 * each gets a row here:
 *
 *   google   the shared Google sign-in: one row, used by every service whose
 *            manifest's sign_in has "google" and that's using it right now
 *            (Classroom; Canvas only with its Google sign-in way on)
 *   browser  a service's own sign-in page, used by it alone: a row per
 *            service (Edpuzzle), opening its address
 *
 * The other class, own fields (a token, a password), is typed into the
 * service's own settings and has nothing here.
 *
 * Which services use a sign-in comes from the services bridge
 * (61-services.js), so a custom service fits in the same way.
 */

const services = require('./61-services.js');

const GOOGLE_START = 'https://accounts.google.com/';

/** Each service that's on, with its manifest, code and bridge object. */
function inUse(settings) {
  const out = [];
  for (const manifest of services.list()) {
    const service = services.load(manifest.domain);
    if (!service) continue;
    const bridge = { domain: manifest.domain, settings };
    try {
      if (service.enabled && !service.enabled(bridge)) continue;
      // A service using a sign-in right now: Canvas only with its Google way on.
      if (service.signInNeeded && !service.signInNeeded(bridge)) continue;
    } catch { continue; }
    out.push({ manifest, service, bridge });
  }
  return out;
}

/** The pages a service's sign-in starts on: its addresses. */
function pagesOf({ service, bridge }) {
  try { return (service.addresses && service.addresses(bridge)) || []; } catch { return []; }
}

/**
 * The browser sign-ins in use, as rows:
 *   { id, name, usedBy: [service names], pages: [addresses to open] }
 * Google first, then each service's own, in the services' order.
 */
function list(settings, language = 'en') {
  const using = inUse(settings);
  const rows = [];
  const google = using.filter(u => u.manifest.sign_in.includes('google'));
  // Google's row is there whenever any service could use it, even with
  // none of them on yet: signing in to Google is how ClassDash finds them
  // (65-discovery.js). It then opens Google's own sign-in page.
  if (google.length || services.list().some(m => m.sign_in.includes('google'))) {
    // Opening the services themselves, not just Google's page: each one
    // passes you through Google and lands signed in, which is also the
    // proof it worked. Google's own page only when no service gives one.
    const pages = [...new Set(google.flatMap(pagesOf))];
    rows.push({ id: 'google', name: 'Google', usedBy: google.map(u => services.nameOf(u.manifest, language)), pages: pages.length ? pages : [GOOGLE_START] });
  }
  for (const u of using.filter(x => x.manifest.sign_in.includes('browser'))) {
    const name = services.nameOf(u.manifest, language);
    rows.push({ id: u.manifest.domain, name, usedBy: [name], pages: pagesOf(u) });
  }
  return rows.filter(r => r.pages.length);
}

/**
 * The pages to open for one sign-in (`id` as in list()), or every sign-in's
 * when `id` is empty: the sign-in window before there was a choice.
 * Unknown ids open nothing.
 */
function pagesFor(id, settings) {
  const rows = list(settings);
  // Every sign-in in use; Google with nothing using it yet isn't one.
  if (!id) return [...new Set(rows.filter(r => r.usedBy.length).flatMap(r => r.pages))];
  const row = rows.find(r => r.id === id);
  return row ? row.pages : [];
}

/**
 * What the last checks say about a sign-in, from the status of the services
 * that use it (25-check-status.js):
 *   'out'      one landed on a sign-in page: Classroom on Google's, Canvas
 *              stuck on its own, Edpuzzle refusing with a 401
 *   'in'       one that can only be read signed in worked
 *   'unknown'  neither, yet
 * Canvas working proves nothing about Google: it may have used its token.
 */
const SIGNED_OUT = {
  classroom: /cookies expired/,
  canvas: /stuck on sign-in/,
  edpuzzle: /responded 401\b/,
};
const NOT_PROOF = ['canvas'];

/** The services a sign-in is for: every one whose manifest has Google for
 *  "google", or the service itself for its own sign-in. */
function domainsFor(id) {
  return id === 'google' ? services.list().filter(m => m.sign_in.includes('google')).map(m => m.domain) : [id];
}

/** The sign-in a failure is waiting for ("google", or a service's own),
 *  when its message says the sign-in ran out; otherwise null. */
function waitingFor(domain, detail) {
  if (!SIGNED_OUT[domain] || !SIGNED_OUT[domain].test(String(detail || ''))) return null;
  const manifest = services.list().find(m => m.domain === domain);
  const steps = manifest ? stepsFor(manifest) : [];
  return steps.length ? steps[0].id : null;
}

function state(id, status) {
  const domains = domainsFor(id);
  const s = d => status[d] || {};
  if (domains.some(d => s(d).status === 'problem' && (s(d).waitingFor === id || (SIGNED_OUT[d] && SIGNED_OUT[d].test(s(d).detail || ''))))) return 'out';
  if (domains.some(d => !NOT_PROOF.includes(d) && ['ok', 'fallback'].includes(s(d).status))) return 'in';
  return 'unknown';
}

/** Whether the last checks found this row's sign-in signed out. */
const signedOut = (row, status) => state(row.id, status) === 'out';

/**
 * The sign-ins a service uses, from its manifest, whether or not it's on
 * yet (its setup asks for them first): [{ id, name }].
 */
function stepsFor(manifest, language = 'en') {
  const out = [];
  if (manifest.sign_in.includes('google')) out.push({ id: 'google', name: 'Google' });
  if (manifest.sign_in.includes('browser')) out.push({ id: manifest.domain, name: services.nameOf(manifest, language) });
  return out;
}

/**
 * One notification per sign-in that ran out, not one per service and not
 * one per check: told once when it goes from working to signed out, and
 * again only after it has worked in between. sign-in-alerts.json keeps
 * which ones were told. `notify(name)` shows it; returns the ids told now.
 */
const ALERTS_FILE = require('path').join(require('./00-project-root.js').PROJECT_ROOT, 'sign-in-alerts.json');
function alerts(status, notify, language = 'en') {
  const fs = require('fs');
  let told = {};
  try { told = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')) || {}; } catch { /* none yet */ }
  const ids = new Map();
  for (const m of services.list()) for (const st of stepsFor(m, language)) ids.set(st.id, st.name);
  const now = [];
  for (const [id, name] of ids) {
    if (state(id, status) === 'out') {
      if (told[id]) continue;
      told[id] = new Date().toISOString();
      now.push(id);
      try { notify(name, id); } catch { /* a notification that can't show isn't worth failing over */ }
    } else if (state(id, status) === 'in') {
      delete told[id];
    }
  }
  try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(told, null, 2)); } catch { /* best effort */ }
  return now;
}

/**
 * The check that proves a sign-in worked (`id` as in list(), empty for all of
 * them): 'full' when a service using it is only read in a full check (its
 * browser class is "visible", like Edpuzzle), 'quick' when a quick check
 * reads them, null when nothing that's on uses it. Run when the sign-in
 * window closes, and what a repair shows "Checking…" for.
 */
function checkAfter(id, settings) {
  const using = inUse(settings).filter(u => id ? stepsFor(u.manifest).some(s => s.id === id) : stepsFor(u.manifest).length);
  if (!using.length) return null;
  return using.some(u => u.manifest.browser_class === 'visible') ? 'full' : 'quick';
}

module.exports = { list, pagesFor, signedOut, state, stepsFor, waitingFor, alerts, checkAfter, GOOGLE_START, ALERTS_FILE };
