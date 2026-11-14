/**
 * When ClassDash's browser keeps failing to start, and what to do about it.
 *
 * ── What happened ──
 *
 * For two days in November every check failed with "couldn't start a browser
 * (… Target page, context or browser has been closed)". Brave and its profile
 * were fine: the same launch worked from a terminal. A server restart and a
 * Sign In a few seconds apart fixed it, so which one did is unknown, and only
 * the first line of the error had been kept, which doesn't say. So:
 *
 *   - Every failed launch's whole error is kept in browser-launch-log.txt:
 *     Playwright's message carries the browser's own output ("Browser
 *     logs:"), which is where the real reason is (a locked profile, a crash,
 *     a permission).
 *   - After FAILURES_BEFORE_RESTART failures in a row, the home API server is
 *     restarted once (the checks are its children, so a server that has gone
 *     wrong passes that on). The check that asks for it runs on its own and
 *     isn't stopped by it.
 *     Only when a server is running for this project (canRestart): with none,
 *     there's nothing to restart, and restartApi would start one.
 *   - If launches still fail after that restart, the person is told, once,
 *     to sign in again (Settings → Sign-ins), which opens the same
 *     browser with a window.
 *
 * One launch that works clears all of it.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const STATE_FILE = path.join(PROJECT_ROOT, 'browser-launch.json');
const LOG_FILE = path.join(PROJECT_ROOT, 'browser-launch-log.txt');
const LOG_MAX = 200 * 1024;
const FAILURES_BEFORE_RESTART = 3;

function read() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { return {}; }
}
function write(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
}

/** Appends a line or block to the log, keeping it to about LOG_MAX. */
function log(text, now = new Date()) {
  try {
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX) {
        const kept = fs.readFileSync(LOG_FILE, 'utf8').slice(-LOG_MAX / 2);
        fs.writeFileSync(LOG_FILE, kept.slice(kept.indexOf('\n') + 1));
      }
    } catch { /* no log yet */ }
    fs.appendFileSync(LOG_FILE, `${now.toISOString()}  ${text}\n`);
  } catch { /* best effort */ }
}

/**
 * A launch failed. Keeps the whole error and says what to do next:
 *   'restart'  restart the server (once per run of failures)
 *   'signIn'   tell the person to sign in again (once, after the restart)
 *   null       nothing more
 */
function failed(message, now = new Date(), { canRestart = true } = {}) {
  const state = read();
  state.failures = (state.failures || 0) + 1;
  state.firstAt = state.firstAt || now.toISOString();
  state.lastAt = now.toISOString();
  log(`launch failed (${state.failures} in a row):\n${String(message).trim()}\n`, now);
  let step = null;
  if (!state.restartedAt && !state.toldAt && state.failures >= FAILURES_BEFORE_RESTART && canRestart) {
    state.restartedAt = now.toISOString();
    step = 'restart';
    log('restarting the home API server, which starts the checks', now);
  } else if (!state.toldAt && (state.restartedAt || state.failures >= FAILURES_BEFORE_RESTART)) {
    state.toldAt = now.toISOString();
    step = 'signIn';
    log('still failing after the restart: asking for a sign-in', now);
  }
  write(state);
  return step;
}

/** A launch worked: everything above starts over. */
function worked(now = new Date()) {
  const state = read();
  if (!state.failures) return;
  log(`launch worked again, after ${state.failures} failure${state.failures === 1 ? '' : 's'}${state.restartedAt ? ' and a server restart' : ''}`, now);
  write({});
}

/** Whether the server was already restarted for this run of failures. */
const restarted = () => !!read().restartedAt;

module.exports = { failed, worked, restarted, read, note: log, STATE_FILE, LOG_FILE, FAILURES_BEFORE_RESTART };
