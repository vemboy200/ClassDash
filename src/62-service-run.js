/**
 * Runs one service through the bridge (61-services.js): asks whether it's on
 * and due, reads it, and records how it went as its status dot.
 *
 *   node 62-service-run.js <domain> --if-due   after a check, for a service
 *                                              whose manifest says
 *                                              "runs": "background"
 *   node 62-service-run.js <domain> --now      Check now, from Settings
 *
 * Background services are the slow ones (Q signs in to a portal with a
 * browser of its own): run in a process of their own, they never hold up a
 * check or make it fail. The command-line run redraws the page when it's done,
 * through --grades-read when grades came in, so they reach the grade history
 * and its alerts.
 *
 * One run per service at a time: a lock file in the project, cleared if the
 * process that took it is gone.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');
const services = require('./61-services.js');

const lockFile = domain => path.join(PROJECT_ROOT, `service-${domain}.lock`);

function takeLock(domain) {
  try {
    const pid = Number(fs.readFileSync(lockFile(domain), 'utf8'));
    if (pid) { try { process.kill(pid, 0); return false; } catch { /* stale: that process is gone */ } }
  } catch { /* no lock */ }
  fs.writeFileSync(lockFile(domain), String(process.pid));
  return true;
}
const dropLock = domain => { try { fs.unlinkSync(lockFile(domain)); } catch {} };

/**
 * @returns {Promise<{ok: boolean, skipped?: string, why?: string, busy?: boolean, result?: object}>}
 *   skipped  why it didn't even try: 'missing' (no such service), 'off', or
 *            the reason the service's due() gave ('recent', or Q's 'password')
 */
async function run(domain, { force = false, now = new Date(), log = () => {} } = {}) {
  const service = services.load(domain);
  if (!service) return { ok: false, skipped: 'missing' };
  const bridge = { domain, settings: require('./19-settings.js').read(), force, log };
  if (service.enabled && !service.enabled(bridge)) return { ok: false, skipped: 'off' };
  // due() answers true/false, or { due, why } when the why is worth showing.
  const due = service.due ? service.due(bridge, now) : true;
  if (!(due && typeof due === 'object' ? due.due : due)) return { ok: false, skipped: (due && due.why) || 'recent' };

  if (!takeLock(domain)) return { ok: false, busy: true, why: 'already running' };
  const status = require('./25-check-status.js');
  try {
    const result = services.result(await service.read(bridge));
    status.record(domain, result.status.ok, result.status.detail, { fallback: result.status.fallback });
    return { ok: result.status.ok, why: result.status.ok ? null : result.status.detail, result };
  } catch (e) {
    const why = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    status.record(domain, false, why);
    return { ok: false, why };
  } finally {
    dropLock(domain);
  }
}

/** Starts a run in a process of its own and returns at once. */
function startInBackground(domain, flag = '--if-due') {
  require('child_process').spawn(process.execPath, [__filename, domain, flag],
    { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { run, startInBackground, takeLock, dropLock };

if (require.main === module) {
  const [domain] = process.argv.slice(2);
  run(domain, { force: process.argv.includes('--now'), log: console.log }).then(r => {
    if (r.skipped || r.busy) return;
    console.log(r.ok ? `${domain}: read` : `${domain}: not read: ${r.why}`);
    const grades = r.ok && r.result.grades.length;
    require('child_process').spawnSync(process.execPath,
      [path.join(__dirname, '05-playwright-draft.js'), grades ? '--grades-read' : '--redraw'], { stdio: 'ignore' });
  }).catch(e => console.error(`${domain}: run failed: ${e.message}`));
}
