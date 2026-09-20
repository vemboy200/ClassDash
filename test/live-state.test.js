// 28-live-state.js: the page version and the run's heartbeat, written to live/.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } });
process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const readLive = f => { const t = fs.readFileSync(path.join(proj, 'live', f), 'utf8'); const w = {}; new Function('window', t)(w); return w; };

// --- page version ---
cp.execFileSync(process.execPath, ['05-playwright-draft.js', '--redraw'], { cwd: proj, stdio: 'ignore' });
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const embedded = Number(/var PAGE_VERSION = (\d+);/.exec(html)[1]);
const published = readLive('page-version.js').classdashPageVersion;
ok('redraw publishes a page version', Number.isFinite(published));
ok('published version equals the one baked into the page', embedded === published, embedded + ' vs ' + published);
ok('no bar in a normal page (hidden)', /id="check-progress"[^>]*hidden/.test(html));
ok('page-version.json holds the same number, bare', Number(fs.readFileSync(path.join(proj, 'live', 'page-version.json'), 'utf8')) === published);
ok('no stray .tmp file left behind', !fs.readdirSync(path.join(proj, 'live')).some(f => f.endsWith('.tmp')));
cp.execFileSync(process.execPath, ['05-playwright-draft.js', '--redraw'], { cwd: proj, stdio: 'ignore' });
ok('a second write publishes a newer (larger) version', readLive('page-version.js').classdashPageVersion > published);

// --- run lifecycle ---
const L = require(path.join(proj, '28-live-state.js'));
ok('nothing to end before a run starts (safe no-op)', (L.endRun(), true));
L.startRun(proj);
let r = readLive('check-run.js').classdashCheckRun;
ok('start: running, 0 of unknown', r.running === true && r.done === 0 && r.total === 0, JSON.stringify(r));
ok('start: stamped just now', Date.now() - r.at < 2000);
L.setProgress(0, 9); L.setProgress(4, 9);
r = readLive('check-run.js').classdashCheckRun;
ok('progress: 4 of 9', r.running && r.done === 4 && r.total === 9, JSON.stringify(r));
L.endRun();
r = readLive('check-run.js').classdashCheckRun;
ok('end: running false', r.running === false, JSON.stringify(r));
ok('check-run.json matches the .js copy', JSON.stringify(JSON.parse(fs.readFileSync(path.join(proj, 'live', 'check-run.json'), 'utf8'))) === JSON.stringify(r));
L.setProgress(5, 9);
ok('progress after end is ignored', readLive('check-run.js').classdashCheckRun.done === 4);
L.endRun();  // twice is fine

// --- a real process that exits leaves running:false and doesn't hang on the heartbeat ---
const t0 = Date.now();
cp.execFileSync(process.execPath, ['-e', `
  const L = require('${path.join(proj, '28-live-state.js')}');
  L.startRun('${proj}'); L.setProgress(1, 3);
  process.on('exit', L.endRun);
`], { cwd: proj });
ok('heartbeat timer does not keep the process alive', Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');
ok('exit handler wrote running:false', readLive('check-run.js').classdashCheckRun.running === false);

// --- killed run: heartbeat keeps stamping while alive ---
const child = cp.spawn(process.execPath, ['-e', `
  const L = require('${path.join(proj, '28-live-state.js')}');
  L.startRun('${proj}'); L.setProgress(2, 5); setInterval(() => {}, 1000);
`], { cwd: proj });
setTimeout(() => {
  const a = readLive('check-run.js').classdashCheckRun.at;
  setTimeout(() => {
    const b = readLive('check-run.js').classdashCheckRun.at;
    ok('heartbeat re-stamps while the run is alive', b > a, a + ' -> ' + b);
    child.kill('SIGKILL');
    setTimeout(() => {
      const r2 = readLive('check-run.js').classdashCheckRun;
      ok('a SIGKILLed run leaves running:true behind (page must use the stamp)', r2.running === true);
      ok('...and the stamp stops advancing', readLive('check-run.js').classdashCheckRun.at === r2.at);
    }, 500);
  }, 4500);
}, 700);

// --- unwritable dir never throws ---
let threw = false;
try { L.publishPageVersion('/nonexistent-root-dir/xyz', 1); L.startRun('/nonexistent-root-dir/xyz'); L.setProgress(1, 2); L.endRun(); } catch { threw = true; }
ok('an unwritable folder never throws', !threw);
