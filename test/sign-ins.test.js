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
  ok(ask({ classroomEnabled: false, edpuzzleEnabled: false, canvas: '' }, 's.list(settings)').length === 0, 'nothing using the browser: no rows');
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
