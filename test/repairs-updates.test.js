// Settings' Repairs and Updates cards (67-repairs.js, settingsNotices in
// 08-page.js), like Home Assistant's: what's broken that only you can fix,
// a newer ClassDash, and how many of them on the sidebar's Settings.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '' } });
const repairs = (args) => {
  const r = cp.spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require('./67-repairs.js').list(${args})))`], { cwd: proj, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return 'failed: ' + r.stderr.slice(-300); }
};
const AT = '2026-11-10T08:00:00.000Z';

// ── What counts ──
ok(JSON.stringify(repairs(`{ status: {} }`)) === '[]', 'nothing found: no repairs');
let r = repairs(`{ status: { classroom: { status: 'problem', at: '${AT}', detail: 'cookies expired, need to sign in again', waitingFor: 'google' } } }`);
ok(r.length === 1 && r[0].kind === 'signedOut' && r[0].name === 'Google' && r[0].by.join() === 'Google Classroom' && r[0].at === AT && r[0].open === 'sign-ins',
  'a sign-in that ran out: one repair for Google, saying what it stops and since when, opening Sign-ins: ' + JSON.stringify(r));
r = repairs(`{ status: { classroom: { status: 'problem', detail: 'Classroom responded 500' } } }`);
ok(r.length === 0, 'a failure that isn\'t yours to fix (the site broke) isn\'t a repair: the status cloud has it');
r = repairs(`{ settings: { gradesProvider: 'q' }, status: {}, grades: { rejected: true, newPassword: true, why: 'Q said so', triedAt: '${AT}' } }`);
ok(r.length === 1 && r[0].kind === 'qNewPassword' && r[0].open === 'svc-q' && r[0].said === 'Q said so', 'Q wanting a new password (saved as rejected too, the way a real check saves it) is that, not "turned down", with Q\'s words: ' + JSON.stringify(r));
r = repairs(`{ status: { canvas: { status: 'fallback', at: '${AT}', detail: "Fallback: the API (access token) didn't work (Canvas refused the access token (expired or deleted?) — make a new one), so Google sign-in was used instead" } } }`);
ok(r.length === 1 && r[0].kind === 'canvasToken' && r[0].severity === 'warning' && r[0].open === 'svc-canvas', 'a refused Canvas token the sign-in covered for: a warning: ' + JSON.stringify(r));
r = repairs(`{ status: { canvas: { status: 'problem', detail: 'Canvas refused the access token (expired or deleted?)' } } }`);
ok(r.length === 1 && r[0].severity === 'error', 'and with nothing covering for it: an error');

// ── On the page ──
fs.writeFileSync(path.join(proj, 'check-status.json'), JSON.stringify({
  classroom: { status: 'problem', at: AT, detail: 'cookies expired, need to sign in again', waitingFor: 'google' },
}));
const NOTES = '## What\'s new\n- **Repairs** in Settings\n- A `beta` channel, see [the docs](https://example.test/docs)\n\n<script>alert(1)</script> stays text';
fs.writeFileSync(path.join(proj, 'update-status.json'), JSON.stringify({ currentVersion: '3.0.0', latestVersion: '3.1.0', url: 'https://example.test/releases/3.1.0', checkedAt: AT, updateAvailable: true, notes: NOTES }));
T.redraw(proj);
let html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const menu = html.slice(html.indexOf('id="settings-menu"'), html.indexOf('data-open="services"'));
ok(/1 repair/.test(menu) && /data-repair="signedOut:google"[^>]*showSettingsSection\('sign-ins'\)/.test(menu) && /Sign-in failed for Google/.test(menu) && /stops Google Classroom/.test(menu),
  'Settings starts with "1 repair": Sign-in failed for Google, stops Google Classroom, opening Sign-ins');
ok(/1 update/.test(menu) && /v3\.1\.0/.test(menu) && /you have v3\.0\.0/.test(menu) && /data-update="3\.1\.0"[^>]*showSettingsSection\('update'\)/.test(menu),
  'then "1 update": ClassDash v3.1.0, opening its own page');
const page = html.slice(html.indexOf('data-section="update"'), html.indexOf('data-section="advanced"'));
ok(/<h4>What&#39;s new<\/h4>|<h4>What's new<\/h4>/.test(page) && /<li><b>Repairs<\/b> in Settings<\/li>/.test(page) && /<code>beta<\/code>/.test(page) && /<a href="https:\/\/example\.test\/docs" target="_blank" rel="noopener">the docs<\/a>/.test(page),
  'its page shows the release notes: headings, bullets, bold, code, links');
ok(!/<script>alert\(1\)<\/script>/.test(page) && /&lt;script&gt;/.test(page), 'and HTML in the notes stays text');
ok(/installUpdate\(this\)/.test(page) && /href="https:\/\/example\.test\/releases\/3\.1\.0"/.test(page) && /skipUpdate\(this\)/.test(page), 'with Install, the release on GitHub, and Skip');
ok(!/data-open="update"/.test(html), 'the update\'s page isn\'t a row of the Settings menu');
ok(menu.indexOf('repairs-card') < menu.indexOf('updates-card'), 'repairs first, like Home Assistant');
ok(/id="settings-button"[\s\S]{0,600}<span class="nav-badge">2<\/span>/.test(html), 'the sidebar\'s Settings counts both');
ok(!/update-banner/.test(html), 'and the update isn\'t a banner on the dashboard any more');

// Skip: gone, and not counted.
const act = cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'dismissUpdate', '3.1.0'], { cwd: proj, encoding: 'utf8' });
ok(/"ok":true/.test(act.stdout), 'Skip answers ok');
html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(!/id="updates-card"/.test(html) && /<span class="nav-badge">1<\/span>/.test(html), 'skipped: no Updates card, and the count is down to 1');

// All fixed: nothing at the top of Settings, no count.
fs.writeFileSync(path.join(proj, 'check-status.json'), JSON.stringify({ classroom: { status: 'ok', at: AT } }));
T.redraw(proj);
html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(!/id="repairs-card"/.test(html) && !/class="nav-badge"/.test(html), 'once it works again the repair goes away by itself, and so does the count');
