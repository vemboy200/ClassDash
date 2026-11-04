/**
 * Automatic fresh checks, run by the API server (17-api.js).
 *
 * ── Why here and not in the app ──
 *
 * The Mac and Windows apps used to keep this timer themselves. That made
 * the app (the window, a client) do the server's job: a server with no app
 * in front of it, like one on a NAS, would never check on its own. The
 * server now decides when a check is due; the app only tells it the two
 * things only the computer's own system knows, written to host-state.json
 * about once a minute:
 *
 *   asleep     the display is off (macOS) or the session is locked
 *              (Windows): nobody's there to be interrupted by Edpuzzle's
 *              visible browser window, so it's a FULL check, every
 *              freshCheckAsleepMinutes. While awake it's a QUICK one
 *              (Classroom and Canvas, no window) every
 *              freshCheckAwakeMinutes.
 *   onBattery  for freshCheckOnlyWhenCharging.
 *
 * ── No report, no automatic checks ──
 *
 * The server keeps running after the app quits. A full check opens a
 * visible browser window, which nobody asked for once the app is closed,
 * so with no report from the last few minutes nothing is started.
 * The exception is a server started with --headless (a NAS or Docker,
 * later), where there's no app and no screen to interrupt: it's treated as
 * always awake and plugged in, so quick checks: a full one needs a screen
 * for Edpuzzle's window.
 *
 * "Asleep" means the DISPLAY, not the whole system. Full system sleep
 * freezes this process, timer included, and the first tick after waking
 * just sees more minutes since the last collection.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const HOST_STATE_FILE = path.join(PROJECT_ROOT, 'host-state.json');
const LAST_COLLECTION_FILE = path.join(PROJECT_ROOT, 'last-collection.json');
// The apps write every 60 seconds; three missed writes means the app
// isn't running (or is frozen), not that a write was a little late.
const REPORT_FRESH_MS = 3 * 60 * 1000;

/** The app's last report, or null when there's none from the last few
 *  minutes (or the file is broken). */
function readHostState(now = Date.now()) {
  try {
    const s = JSON.parse(fs.readFileSync(HOST_STATE_FILE, 'utf8'));
    if (!s || !Number.isFinite(s.at) || now - s.at > REPORT_FRESH_MS || s.at - now > REPORT_FRESH_MS) return null;
    return { asleep: s.asleep === true, onBattery: s.onBattery === true };
  } catch {
    return null;
  }
}

/** Minutes since the last collection finished: last-collection.json's own
 *  mtime, the same signal /api/status calls collectedAt. A check started
 *  by hand (the button, /api/check) resets the clock too. Null when
 *  nothing has ever been collected. */
function minutesSinceLastCollection(now = Date.now()) {
  try {
    return (now - fs.statSync(LAST_COLLECTION_FILE).mtimeMs) / 60000;
  } catch {
    return null;
  }
}

/** THE RUNTIME ENFORCEMENT POINT for the 10-minute minimum, not just
 *  19-settings.js's validate(): settings.json can be edited by hand.
 *  freshCheckAsleepMinutes at 5 once meant a full browser check every few
 *  minutes around the clock, swapping and leaving Brave helpers behind
 *  until force-quit. Anything under 10 is off, not rounded up. */
function clampMinutes(n) {
  n = Number(n) || 0;
  return n > 0 && n < 10 ? 0 : n;
}

/**
 * Whether a check is due now, and why (or why not), as plain data so it
 * can be tested without a clock or a filesystem.
 *
 *   settings   freshCheckAwakeMinutes, freshCheckAsleepMinutes,
 *              freshCheckOnlyWhenCharging
 *   host       readHostState()'s answer, or null
 *   headless   started with --headless
 *   minutes    minutesSinceLastCollection(), null for never
 *   running    a check is running right now
 */
function decide({ settings, host, headless, minutes, running }) {
  if (!host && !headless) return { run: false, why: 'no app reporting' };
  const state = host || { asleep: false, onBattery: false };
  const interval = clampMinutes(state.asleep ? settings.freshCheckAsleepMinutes : settings.freshCheckAwakeMinutes);
  if (interval <= 0) return { run: false, why: `off while ${state.asleep ? 'asleep' : 'awake'}` };
  if (settings.freshCheckOnlyWhenCharging !== false && state.onBattery) return { run: false, why: 'on battery' };
  if (running) return { run: false, why: 'a check is running' };
  const elapsed = minutes === null || minutes === undefined ? Infinity : minutes;
  if (elapsed < interval) return { run: false, why: 'not yet' };
  const kind = state.asleep ? 'full' : 'quick';
  return {
    run: true,
    kind,
    why: `${Number.isFinite(elapsed) ? Math.floor(elapsed) + 'm' : 'never'} since last collection, ` +
      `${interval}m interval (${state.asleep ? 'asleep' : 'awake'}), ${kind} check`,
  };
}

/** One tick: starts a check when one is due. `start(kind)` runs it,
 *  'quick' or 'full', `log` gets a line when it does, or when a check was
 *  due but the battery held it back. */
function tick({ headless, start, log }) {
  const settings = require('./19-settings.js').read();
  const { readCollection } = require('./28-live-state.js');
  const now = Date.now();
  const verdict = decide({
    settings,
    host: readHostState(now),
    headless,
    minutes: minutesSinceLastCollection(now),
    running: readCollection(PROJECT_ROOT, now).running,
  });
  if (verdict.run) {
    log(`auto fresh check: ${verdict.why} — running one`);
    start(verdict.kind);
  } else if (verdict.why === 'on battery') {
    log('auto fresh check: skipped — on battery and freshCheckOnlyWhenCharging is on');
  }
  return verdict;
}

/** Ticks once a minute, the same cadence the apps used. The timer doesn't
 *  keep the process alive on its own (the server does that). */
function startSchedule(options) {
  const timer = setInterval(() => {
    try { tick(options); } catch (e) { options.log(`auto fresh check: tick failed: ${e.message}`); }
  }, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { HOST_STATE_FILE, REPORT_FRESH_MS, readHostState, minutesSinceLastCollection, clampMinutes, decide, tick, startSchedule };
