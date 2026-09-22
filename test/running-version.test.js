// The running version is recorded at launch, so the page is built from the truth.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process'), vm = require('vm');
const PROJ = T.makeProject(); process.chdir(PROJ);
const REAL = T.REPO;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const FILE = path.join(PROJ, 'update-status.json');
const put = o => fs.writeFileSync(FILE, JSON.stringify(o, null, 2));
const get = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const backup = fs.existsSync(FILE) ? fs.readFileSync(FILE) : null;
const U = require(path.join(PROJ, '26-update-check.js'));

// ── the comparison ──
ok(U.isNewer('1.4.5', '0.0.0-dev.8c6b765'), 'a dev build is older than any release');
ok(U.isNewer('2.0.0', '1.4.5') && !U.isNewer('1.4.5', '2.0.0') && !U.isNewer('2.0.0', '2.0.0'), 'ordinary versions compare');

// ── no file: nothing to change, nothing created ──
try { fs.unlinkSync(FILE); } catch {}
ok(U.recordRunningVersion('2.0.0') === false && !fs.existsSync(FILE), 'no record yet: false, and no file is created out of thin air');

// ── the laptop's case: record says an older build, a newer one is running ──
put({ currentVersion: '0.0.0-dev.59617b2', latestVersion: '1.4.5', url: 'https://x/releases/1.4.5', checkedAt: '2026-09-20T02:14:28Z', updateAvailable: true, error: null, dismissedVersion: '1.4.4' });
ok(U.recordRunningVersion('0.0.0-dev.8c6b765') === true, 'a different running version changes the record');
let s = get();
ok(s.currentVersion === '0.0.0-dev.8c6b765', 'currentVersion is the running one');
ok(s.latestVersion === '1.4.5' && s.url === 'https://x/releases/1.4.5' && s.checkedAt === '2026-09-20T02:14:28Z' && s.dismissedVersion === '1.4.4' && s.error === null, 'everything else in the record is kept');
ok(s.updateAvailable === true, 'a dev build is still offered the release (updateAvailable stays true)');

// ── same version: untouched, not even rewritten ──
const before = fs.readFileSync(FILE, 'utf8'); const m = fs.statSync(FILE).mtimeMs;
ok(U.recordRunningVersion('0.0.0-dev.8c6b765') === false && fs.readFileSync(FILE, 'utf8') === before && fs.statSync(FILE).mtimeMs === m, 'the same version: false, file untouched');

// ── after updating to the release itself, the banner must go ──
put({ currentVersion: '1.4.5', latestVersion: '2.0.0', updateAvailable: true });
U.recordRunningVersion('2.0.0');
ok(get().updateAvailable === false, 'running the latest release: "update available" is cleared');
put({ currentVersion: '1.4.5', latestVersion: '2.0.0', updateAvailable: false });
U.recordRunningVersion('1.4.4');
ok(get().updateAvailable === true, 'running something older than latest: an update is available');

// ── a downloaded installer for the version now running is spent ──
put({ currentVersion: '1.4.5', latestVersion: '2.0.0', readyToInstall: true, readyVersion: '2.0.0', downloadedPath: 'C:\\x\\update-download.exe', updateAvailable: true });
U.recordRunningVersion('2.0.0');
s = get();
ok(s.readyToInstall === false && !('readyVersion' in s) && !('downloadedPath' in s), 'the installer for the now-running version is cleared (no "install what is already installed")');
put({ currentVersion: '1.4.5', latestVersion: '2.0.0', readyToInstall: true, readyVersion: '2.0.0', downloadedPath: 'C:\\x\\update-download.exe' });
U.recordRunningVersion('1.4.6');
s = get();
ok(s.readyToInstall === true && s.readyVersion === '2.0.0' && s.downloadedPath, 'a downloaded installer for a NEWER version is kept');

// ── end to end through the real notifier: the page's version row ──
const row = () => { const h = fs.readFileSync('summary.html', 'utf8'); const m = /v(0\.0\.0-dev\.[0-9a-f]+|[0-9][0-9.]*)</.exec(h.slice(h.indexOf('ClassDash</span>') > 0 ? h.indexOf('ClassDash</span>') : 0)); return m && m[1]; };
fs.writeFileSync('settings.json', JSON.stringify({ email: 'a@b', language: 'en' }));
put({ currentVersion: '0.0.0-dev.59617b2', latestVersion: '1.4.5', checkedAt: new Date().toISOString(), updateAvailable: true });
cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });
ok(/0\.0\.0-dev\.59617b2/.test(fs.readFileSync('summary.html', 'utf8')), 'setup: the page was built showing the OLD version (the laptop\'s situation)');
const run = v => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', 'noteVersion', v], { cwd: PROJ, encoding: 'utf8' }).stdout.trim().split('\n').pop());
let r = run('0.0.0-dev.8c6b765');
ok(r.ok && r.changed === true, 'noteVersion reports a change: ' + JSON.stringify(r));
const html = fs.readFileSync('summary.html', 'utf8');
ok(/0\.0\.0-dev\.8c6b765/.test(html) && !/0\.0\.0-dev\.59617b2/.test(html), 'the page now shows the version that is really running, and not the old one');
const mt = fs.statSync('summary.html').mtimeMs;
r = run('0.0.0-dev.8c6b765');
ok(r.ok && r.changed === false && fs.statSync('summary.html').mtimeMs === mt, 'a second launch on the same version does not redraw');
r = run('');
ok(r.ok && r.changed === false, 'an empty version is ignored');

// ── the app launch order (checked in the real sources) ──
const main = fs.readFileSync(path.join(REAL, 'electron/main.js'), 'utf8');
const i1 = main.indexOf('syncProjectScripts();\n    noteRunningVersion();'), i2 = main.indexOf('buildMenu();', i1), i3 = main.indexOf('createWindow();', i1);
ok(i1 > 0 && i2 > i1 && i3 > i2, 'Windows: scripts refreshed, then version noted, both BEFORE the window loads the page');
const sw = fs.readFileSync(path.join(REAL, 'mac', '16-summary.swift'), 'utf8');
const j1 = sw.indexOf('syncProjectScripts(from:'), j2 = sw.indexOf('"noteVersion"', j1), j3 = sw.indexOf('buildMainMenu()', j2);
ok(j1 > 0 && j2 > j1 && j3 > j2, 'Mac: scripts refreshed, then version noted, both BEFORE the window is built');
// the Windows function itself
{
  const a = main.indexOf('function noteRunningVersion()'), b = main.indexOf('// Genuinely fire-and-forget', a);
  const calls = [];
  const ctx = { app: { getVersion: () => '9.9.9-test' }, projectDir: '/p', runNodeScriptSync: (...a) => calls.push(a) };
  vm.createContext(ctx); vm.runInContext(main.slice(a, b) + '\nthis.go = noteRunningVersion;', ctx); ctx.go();
  ok(JSON.stringify(calls) === JSON.stringify([['21-notifier-actions.js', ['noteVersion', '9.9.9-test'], '/p']]), 'Windows passes app.getVersion() to the notifier in the project: ' + JSON.stringify(calls));
}

try { fs.unlinkSync('settings.json'); } catch {}
if (backup) fs.writeFileSync(FILE, backup); else try { fs.unlinkSync(FILE); } catch {}
console.log(`running-version: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
