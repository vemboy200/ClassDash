/**
 * Repairs, like Home Assistant's: what's broken right now that only you can
 * fix, each with the service it's about, since when, and where in Settings
 * to fix it. Shown at the top of Settings (08-page.js), with app updates
 * under them, and counted on the sidebar's Settings.
 *
 * Only what the last checks actually found, never a guess, so each one goes
 * away by itself once it's fixed and the next check works:
 *
 *   signedOut      a sign-in ran out (64-sign-ins.js state "out"): Google
 *                  for every service that uses it, or a service's own
 *   qRejected      Aequitas Q turned down the saved username or password
 *                  (it isn't tried again until they change)
 *   qNewPassword   Q signed in, but wants a new password first
 *   canvasToken    Canvas refused the access token, whether the Google
 *                  sign-in carried the check (a warning) or nothing did
 *
 * Each: { id, kind, severity: 'error' | 'warning', domain, name, by, at, open }
 *   name   who it's about ("Google", "Canvas"), for its title
 *   by     the services it stops, in words, for its second line
 *   at     when it was found (ISO), or null
 *   open   the Settings section to fix it in (showSettingsSection)
 *   said   what the service itself said, when it said something (Q's
 *          message, Canvas's refusal), for the repair's popup
 */

const services = require('./61-services.js');
const signIns = require('./64-sign-ins.js');

const TOKEN_REFUSED = /refused the access token/i;

function list({ settings = require('./19-settings.js').read(), status = require('./25-check-status.js').checkStatus(), language = 'en', grades } = {}) {
  const out = [];
  const nameOf = domain => {
    const m = services.list().find(x => x.domain === domain);
    return m ? services.nameOf(m, language) : domain;
  };

  for (const row of signIns.list(settings, language)) {
    if (signIns.state(row.id, status) !== 'out') continue;
    // The services stopped by it, and the first time one of them was.
    const domains = Object.entries(status).filter(([d, s]) => s && s.status === 'problem' && (s.waitingFor === row.id || signIns.waitingFor(d, s.detail) === row.id)).map(([d]) => d);
    const at = domains.map(d => status[d].at).filter(Boolean).sort()[0] || null;
    out.push({ id: `signedOut:${row.id}`, kind: 'signedOut', severity: 'error', domain: row.id, name: row.name, by: domains.map(nameOf), at, open: 'sign-ins' });
  }

  if (settings.gradesProvider === 'q') {
    const q = require('./services/q/40-grades.js');
    const saved = grades || q.readGrades();
    // Wanting a new password is also a rejection (40-grades.js sets both, so
    // it isn't tried again), so it's asked first: it says what to do.
    if (saved.rejected && saved.newPassword) {
      out.push({ id: 'qNewPassword', kind: 'qNewPassword', severity: 'error', domain: 'q', name: nameOf('q'), by: [nameOf('q')], at: saved.triedAt || null, open: 'svc-q', said: saved.why || null });
    } else if (q.due(Date.now(), { s: settings, saved }).why === 'rejected') {
      out.push({ id: 'qRejected', kind: 'qRejected', severity: 'error', domain: 'q', name: nameOf('q'), by: [nameOf('q')], at: saved.triedAt || null, open: 'svc-q' });
    }
  }

  const canvas = status.canvas;
  if (canvas && ['problem', 'fallback'].includes(canvas.status) && TOKEN_REFUSED.test(canvas.detail || '')) {
    out.push({ id: 'canvasToken', kind: 'canvasToken', severity: canvas.status === 'problem' ? 'error' : 'warning', domain: 'canvas', name: nameOf('canvas'), by: [nameOf('canvas')], at: canvas.at || null, open: 'svc-canvas' });
  }
  return out;
}

module.exports = { list };
