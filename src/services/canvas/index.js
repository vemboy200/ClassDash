/**
 * Canvas, as the services bridge (61-services.js) sees it.
 *
 * This is the only file of Canvas's the check calls. Each function takes the
 * `bridge` object the check hands it:
 *
 *   bridge.settings   the settings, as read at the start of the check
 *   bridge.openPage   async () => a tab of ClassDash's signed-in browser,
 *                     launching it first if it isn't running (only in read)
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

/** Reads Canvas: { items, courses, pending, note, detail, fallback }. */
async function read(bridge) {
  return require('./10-canvas.js').collectCanvasPlanned(plan(bridge.settings), bridge.openPage);
}

module.exports = { plan, enabled, browserNeeded, signInNeeded, addresses, read };
