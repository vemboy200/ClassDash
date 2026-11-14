/**
 * Canvas, as the services bridge (61-services.js) sees it.
 *
 * This is the only file of Canvas's the check calls. Each function takes the
 * `bridge` object the check hands it:
 *
 *   bridge.settings   the settings, as read at the start of the check
 *   bridge.openPage   async () => a tab of ClassDash's signed-in browser,
 *                     launching it first if it isn't running (only in read)
 *   bridge.log        a line for the check's log (only in read)
 *
 * How Canvas is actually read (its API, or the browser sign-in as a way in or
 * a fallback) is in 10-canvas.js.
 */

/**
 * Which ways of reading Canvas the settings allow.
 *   enabled  there's an address, and at least one way is switched on
 *   api      the access token way is on AND a token is filled in
 *   sso      the Google sign-in (browser) way is on
 * Off is off all the way down, so nothing has to check `enabled` before
 * trusting the other two.
 */
function plan(settings) {
  const address = !!String(settings.canvas || '').trim();
  const apiOn = settings.canvasApiEnabled !== false;
  const sso = settings.canvasSsoEnabled !== false;
  const api = apiOn && !!String(settings.canvasToken || '').trim();
  if (!address || !(apiOn || sso)) return { enabled: false, api: false, sso: false };
  return { enabled: true, api, sso };
}

const enabled = bridge => plan(bridge.settings).enabled;

/** A browser for this check: only when the sign-in way is the plan, not a
 *  fallback behind a token (that one launches its own if it's needed). */
function browserNeeded(bridge) {
  const p = plan(bridge.settings);
  return p.enabled && p.sso && !p.api;
}

/** Something to sign into: the sign-in way is on, even if a token means it
 *  isn't used right now, since a fallback session has to be signed in too. */
function signInNeeded(bridge) {
  const p = plan(bridge.settings);
  return p.enabled && p.sso;
}

/** Where Canvas is, for the "is there internet" check and for signing in. */
function addresses(bridge) {
  if (!enabled(bridge)) return [];
  return [require('./10-canvas.js').normalizeCanvasSite(bridge.settings.canvas) + '/'];
}

/** Reads Canvas, in the shape every service's read() has (61-services.js). */
async function read(bridge) {
  const r = await require('./10-canvas.js').collectCanvasPlanned(plan(bridge.settings), bridge.openPage);
  (bridge.log || (() => {}))(`  Canvas: courses ${r.courses.length}, items ${r.items.length}` +
    (r.pending.length ? `, waiting to publish: ${r.pending.join(', ')}` : ''));
  return { items: r.items, status: { ok: true, detail: r.detail, fallback: !!r.fallback } };
}

/**
 * Discovery (65-discovery.js): with its address saved but Canvas off, does
 * the browser's sign-in reach it? Landing on Canvas itself, rather than a
 * sign-in page (Canvas's /login, Google's, or anyone else's), says yes.
 * Only looks.
 */
async function found(bridge) {
  const address = String(bridge.settings.canvas || '').trim();
  if (!address) return false;
  const site = require('./10-canvas.js').normalizeCanvasSite(address);
  const page = await bridge.openPage();
  try {
    await page.goto(site + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Give a sign-in that hands off (to Google and back) a moment to settle.
    await page.waitForTimeout(2000);
    const url = new URL(page.url());
    return url.origin === new URL(site).origin && !/\/login\b/.test(url.pathname);
  } catch {
    return false;
  } finally {
    try { await page.close(); } catch { /* already closed */ }
  }
}

/** Only with its address saved: every school's Canvas is somewhere else. */
const canFind = bridge => !!String(bridge.settings.canvas || '').trim();

module.exports = { plan, enabled, browserNeeded, signInNeeded, addresses, read, found, canFind };
