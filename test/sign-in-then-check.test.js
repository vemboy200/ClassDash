// After the sign-in window, the check that proves the sign-in worked starts
// by itself (checkAfter in 64-sign-ins.js, thenCheck in 05-playwright-draft.js),
// and a repair says "Checking…" while a check that looks at it runs, instead of
// Error: it then clears, or stays, without anyone pressing Quick check.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '', classroomEnabled: true, edpuzzleEnabled: true } });
const after = (id, settings) => {
  const r = cp.spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require('./64-sign-ins.js').checkAfter(${JSON.stringify(id)}, require('./19-settings.js').read())))`], { cwd: proj, encoding: 'utf8' });
  return JSON.parse(r.stdout || 'null');
};
ok(after('google') === 'quick', 'Google: a quick check reads Classroom, so that proves it');
ok(after('edpuzzle') === 'full', 'Edpuzzle: only a full check reads it');
ok(after('') === 'full', 'every sign-in at once: full, for Edpuzzle');
fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', email: 'a@example.test', canvas: '', classroomEnabled: false, edpuzzleEnabled: false }));
ok(after('google') === null, 'nothing on uses it: no check');

const src = fs.readFileSync(path.join(proj, '05-playwright-draft.js'), 'utf8');
const login = src.slice(src.indexOf('async function login'), src.indexOf('async function discover'));
ok(/checkAfter\(which, SETTINGS\)/.test(login) && /'--then-check', proof/.test(login), 'closing the sign-in window starts it, after looking for services (they take turns with the profile)');
const disc = src.slice(src.indexOf('async function discover'), src.indexOf('// ── Lock against'));
ok((disc.match(/thenCheck\(\);/g) || []).length === 2, '...whether or not there was a service to look for');
ok(/live\.startRun\(PROJECT_ROOT, \{ full: process\.argv\.includes\('--full'\) \}\)/.test(src), 'a check says whether it\'s a full one');

// ── the page ──
fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', email: 'a@example.test', canvas: '', classroomEnabled: true, edpuzzleEnabled: true }));
const AT = new Date().toISOString();
fs.writeFileSync(path.join(proj, 'check-status.json'), JSON.stringify({
  classroom: { status: 'problem', at: AT, detail: 'cookies expired, need to sign in again', waitingFor: 'google' },
  edpuzzle: { status: 'problem', at: AT, detail: 'Edpuzzle responded 401', waitingFor: 'edpuzzle' },
}));
T.redraw(proj);
const { JSDOM, VirtualConsole } = T.jsdom();
const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
  beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; win.Element.prototype.scrollIntoView = () => {}; } }).window;
const d = w.document;
w.showPage('settings');
const shows = (id, cls) => { const el = d.querySelector(`[data-repair="${id}"] ${cls}`); return !!el && w.getComputedStyle(el).display !== 'none'; };
const state = () => ['signedOut:google', 'signedOut:edpuzzle'].map(id => (shows(id, '.repair-checking') ? 'checking' : '') + (shows(id, '.repair-word') ? 'error' : '')).join();
ok(state() === 'error,error', 'no check running: both say Error: ' + state());
w.applyRunState({ running: true, full: false, at: Date.now() });
ok(state() === 'checking,error', 'a quick check: Google says Checking…, Edpuzzle (not in it) still Error: ' + state());
w.applyRunState({ running: true, full: true, at: Date.now() });
ok(state() === 'checking,checking', 'a full check: both say Checking…: ' + state());
d.querySelector('[data-repair="signedOut:google"]').click();
const pop = d.querySelector('#repair-box .repair-checking');
ok(!!pop && w.getComputedStyle(pop).display !== 'none', '...in the popup too');
w.applyRunState({ running: false, at: Date.now() });
ok(state() === 'error,error', 'over: back to Error until the page hears how it went: ' + state());
w.close();
process.exit(process.exitCode || 0);
