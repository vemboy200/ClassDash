// Settings → Sign-ins (64-sign-ins.js): which sign-ins done in ClassDash's
// browser are in use, the pages each one opens, and --login <id>.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const SITE = 'https://school.example.test';
// Runs in a project of its own: the list follows the project's services.
const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test' } });
const ask = (settings, code) => {
  const r = cp.spawnSync(process.execPath, ['-e', `
    const s = require('./64-sign-ins.js'); const settings = ${JSON.stringify(settings)};
    process.stdout.write(JSON.stringify(${code}));`], { cwd: proj, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return 'failed: ' + r.stderr.slice(-300); }
};

{
  const rows = ask({ canvas: SITE }, 's.list(settings)');
  ok(Array.isArray(rows) && rows.map(r => r.id).join() === 'google,edpuzzle', 'Google, then Edpuzzle\'s own: ' + JSON.stringify(rows));
  const google = rows[0] || {};
  ok(google.usedBy.join() === 'Google Classroom,Canvas', 'Google is used by Classroom and Canvas\'s Google way');
  ok(google.pages.join() === `https://classroom.google.com/,${SITE}/`, 'and opens those two, which pass you through Google');
}
{
  const rows = ask({ canvas: SITE, canvasToken: 'T', canvasSsoEnabled: false }, 's.list(settings)');
  ok(rows[0].usedBy.join() === 'Google Classroom', 'Canvas on a token only doesn\'t use Google');
}
{
  const rows = ask({ classroomEnabled: false, edpuzzleEnabled: false, canvas: SITE, canvasSsoEnabled: true }, 's.list(settings)');
  ok(rows.length === 1 && rows[0].usedBy.join() === 'Canvas', 'with Classroom off, Google is there for Canvas alone');
  const none = ask({ classroomEnabled: false, edpuzzleEnabled: false, canvas: '' }, 's.list(settings)');
  ok(none.length === 1 && none[0].id === 'google' && none[0].usedBy.length === 0 && none[0].pages.join() === 'https://accounts.google.com/',
    'nothing on: Google is still there, to sign in and find services, opening Google\'s own page: ' + JSON.stringify(none));
  ok(ask({ classroomEnabled: false, edpuzzleEnabled: false, canvas: '' }, 's.pagesFor("", settings)').length === 0, 'but the window with none chosen opens nothing for it');
}
{
  ok(ask({}, 's.pagesFor("edpuzzle", settings)').join() === 'https://edpuzzle.com/', 'one sign-in opens only its own pages');
  ok(ask({}, 's.pagesFor("nope", settings)').length === 0, 'an unknown one opens nothing');
  ok(ask({}, 's.pagesFor("", settings)').join() === 'https://classroom.google.com/,https://edpuzzle.com/', 'none chosen opens every sign-in\'s, as before');
  ok(ask({ edpuzzleEnabled: false }, 's.pagesFor("", settings)').join() === 'https://classroom.google.com/', 'Edpuzzle switched off isn\'t opened any more');
}
{
  const signedOut = (detail, domain = 'classroom') => ask({}, `s.signedOut(s.list(settings)[0], { ${domain}: { status: 'problem', detail: ${JSON.stringify(detail)} } })`);
  ok(signedOut('cookies expired, need to sign in again') === true, 'Classroom on Google\'s sign-in page: Google is signed out');
  ok(signedOut('Classroom responded "Class not found"') === false, 'another Classroom problem isn\'t a sign-out');
  ok(ask({}, `s.signedOut(s.list(settings)[1], { edpuzzle: { status: 'problem', detail: 'Edpuzzle responded 401 to https://edpuzzle.com/api' } })`) === true, 'Edpuzzle refusing with 401: Edpuzzle is signed out');
}

{
  ok(ask({}, `s.state('google', { classroom: { status: 'ok' } })`) === 'in', 'Classroom read fine: Google is signed in');
  ok(ask({}, `s.state('google', { canvas: { status: 'ok' } })`) === 'unknown', 'Canvas reading fine proves nothing (it may have used its token)');
  ok(ask({}, `s.state('edpuzzle', {})`) === 'unknown', 'never checked: not known yet');
  ok(JSON.stringify(ask({}, `s.stepsFor(require('./61-services.js').list().find(m => m.domain === 'canvas'))`)) === '[{"id":"google","name":"Google"}]', 'Canvas\'s setup step is the Google sign-in (its token is a field)');
}

// --login with a sign-in nothing uses says so and opens no browser.
{
  const r = cp.spawnSync(process.execPath, ['05-playwright-draft.js', '--login', 'nope'], { cwd: proj, encoding: 'utf8', timeout: 30000 });
  ok(/Nothing to sign into for "nope"/.test(r.stdout) && !/launch|executable/i.test(r.stdout + r.stderr), '--login nope: nothing to open, no browser');
}

// The page: a Sign-ins row in the menu after Services, a row per sign-in,
// and no Sign In… left under Services → Setup.
{
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  const menu = [...html.matchAll(/class="settings-row" data-open="([a-z-]+)"/g)].map(m => m[1]);
  ok(menu.indexOf('sign-ins') === menu.indexOf('services') + 1, 'Sign-ins comes right after Services in the menu');
  ok(/data-sign-in="google"[\s\S]*?setupSignIn\(this, 'google'\)/.test(html) && /data-sign-in="edpuzzle"/.test(html), 'a row and a Sign In… for each sign-in');
  ok(!/onclick="setupSignIn\(this\)"/.test(html), 'no Sign In… without a sign-in left anywhere');
}

// Waiting for a sign-in (4b): which sign-in a failure names, one
// notification per sign-in, and yellow on the page.
{
  ok(ask({}, `[s.waitingFor('classroom', 'cookies expired, need to sign in again'), s.waitingFor('canvas', 'stuck on sign-in (https://x) — Canvas may need signing into again'), s.waitingFor('edpuzzle', 'Edpuzzle responded 401 to https://edpuzzle.com/api'), s.waitingFor('classroom', 'Classroom responded "Class not found"'), s.waitingFor('q', 'cookies expired')]`).join() === 'google,google,edpuzzle,,',
    'a sign-in that ran out is named (Google for Classroom and Canvas, Edpuzzle\'s own), anything else isn\'t');
  const rec = cp.spawnSync(process.execPath, ['-e', `const c = require('./25-check-status.js'); c.record('classroom', false, 'cookies expired, need to sign in again'); c.record('canvas', false, 'Canvas responded 500');
    const raw = JSON.parse(require('fs').readFileSync(c.FILE, 'utf8')); process.stdout.write(JSON.stringify([raw.classroom.status, raw.classroom.waitingFor, raw.canvas.status, 'waitingFor' in raw.canvas]))`], { cwd: proj, encoding: 'utf8' });
  ok(rec.stdout === '["problem","google","problem",false]', 'its status stays "problem" (what /api/check-status always had), with waitingFor added: ' + rec.stdout + rec.stderr.slice(-200));

  const alertsRun = cp.spawnSync(process.execPath, ['-e', `const s = require('./64-sign-ins.js'); const told = [];
    const out = { classroom: { status: 'problem', waitingFor: 'google' }, edpuzzle: { status: 'problem', waitingFor: 'edpuzzle' } };
    const r = [s.alerts(out, n => told.push(n)), s.alerts(out, n => told.push(n)),
      s.alerts({ classroom: { status: 'ok' } }, n => told.push(n)), s.alerts(out, n => told.push(n))];
    process.stdout.write(JSON.stringify({ r, told }))`], { cwd: proj, encoding: 'utf8' });
  const a = JSON.parse(alertsRun.stdout || '{}');
  ok(a.r && a.r[0].join() === 'google,edpuzzle', 'one notification per sign-in that ran out: ' + alertsRun.stdout + alertsRun.stderr.slice(-200));
  ok(a.r && a.r[1].length === 0, 'none on the next check while it\'s still out');
  ok(a.r && a.r[3].join() === 'google', 'again only after it worked in between (Edpuzzle hasn\'t, so it isn\'t told twice)');
  ok(a.told && a.told.slice(0, 2).join() === 'Google,Edpuzzle', 'named the way Settings → Sign-ins names them');

  fs.writeFileSync(path.join(proj, 'check-status.json'), JSON.stringify({
    classroom: { status: 'problem', at: new Date().toISOString(), detail: 'cookies expired, need to sign in again', waitingFor: 'google' },
  }));
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  ok(/data-piece="svc-classroom">[\s\S]{0,40}<span class="svc-status status-fallback">Waiting for sign-in · /.test(html), 'Classroom\'s card: yellow, waiting for sign-in');
  ok(/class="status-cloud pixel-icon status-fallback"[\s\S]{0,200}1 needs sign-in/.test(html), 'the status cloud: yellow, "1 needs sign-in", not failed');
  ok(/Google signed you out: Settings → Sign-ins → Google/.test(html), 'the status panel says where to sign in');
  ok(!/sign-in-banner/.test(html) && /data-repair="signedOut:google"/.test(html), 'no banner on the dashboard: it\'s a repair in Settings');
}
