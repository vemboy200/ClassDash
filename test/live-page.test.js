// The open page: progress bar from the live/ files, and when it may reload itself.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); T.redraw(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return f(); };
const liveDir = path.join(proj, 'live');
const setRun = o => fs.writeFileSync(path.join(liveDir, 'check-run.js'), 'window.classdashCheckRun = ' + JSON.stringify(o) + ';\n');
const setVersion = v => fs.writeFileSync(path.join(liveDir, 'page-version.js'), 'window.classdashPageVersion = ' + v + ';\n');
const noRun = () => { try { fs.unlinkSync(path.join(liveDir, 'check-run.js')); } catch {} };

async function open() {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      const real = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...a) => real(fn, Math.min(ms, 40), ...a);   // fast polling
    },
  });
  const w = dom.window;
  await until(() => typeof w.pollLive === 'function');
  return { w, d: w.document, errors, close: () => dom.window.close() };
}

(async () => {
  // Current version on disk = what the page was built with.
  const cur = Number(/var PAGE_VERSION = (\d+);/.exec(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'))[1]);
  setVersion(cur); noRun();

  let { w, d, errors, close } = await open();
  const box = d.getElementById('check-progress');
  const label = () => d.getElementById('check-progress-label').textContent;
  ok('page script loads with the live code', errors.filter(e => !/Not implemented: navigation/.test(e)).length === 0, errors.join('|'));
  await sleep(300);
  ok('no run file -> bar hidden', box.hidden === true);
  ok('same version -> no reload', w.reloadingForLive === false);

  // running 3/10
  setRun({ running: true, done: 3, total: 10, at: Date.now() });
  ok('a run appears -> bar shows', await until(() => box.hidden === false));
  ok('label "Checking 3 of 10"', await until(() => label() === 'Checking 3 of 10'), label());
  ok('percent 30%', d.getElementById('check-progress-pct').textContent === '30%');
  ok('aria-valuenow 30', box.getAttribute('aria-valuenow') === '30');
  ok('not indeterminate once total is known', !box.classList.contains('indeterminate'));
  // Fresh check IS the Stop button while a run is live — not a spinning
  // Fresh check icon anymore, a static Stop one (see 08-page.js's own
  // .running class and applyRunState).
  ok('Fresh check becomes Stop (.running) while a run is live', d.getElementById('freshcheck-button').classList.contains('running'));
  ok('...and is not spinning (the Stop icon is the "in progress" signal now, not a spin)',
    !d.getElementById('freshcheck-button').classList.contains('spinning'));

  // progress moves on the next poll (heartbeat-stamped)
  setRun({ running: true, done: 7, total: 10, at: Date.now() });
  ok('moves to 7 of 10 without a reload', await until(() => label() === 'Checking 7 of 10') && w.reloadingForLive === false);

  // all done, not yet exited
  setRun({ running: true, done: 10, total: 10, at: Date.now() });
  ok('all sources done -> "Finishing…"', await until(() => label() === 'Finishing…'), label());

  // total unknown yet
  setRun({ running: true, done: 0, total: 0, at: Date.now() });
  ok('total unknown -> "Starting…" and indeterminate', await until(() => label() === 'Starting…' && box.classList.contains('indeterminate')), label());
  ok('...with no percent shown', d.getElementById('check-progress-pct').textContent === '');

  // clean end
  setRun({ running: false, done: 10, total: 10, at: Date.now() });
  ok('run ended -> bar hides', await until(() => box.hidden === true));
  ok('...and the icon stops spinning', await until(() => !d.getElementById('freshcheck-button').classList.contains('spinning')));
  ok('...and it is Fresh check again, not Stop', !d.getElementById('freshcheck-button').classList.contains('running'));

  // a dead run: says running, but the heartbeat stopped 40s ago
  setRun({ running: true, done: 4, total: 10, at: Date.now() - 40000 });
  await sleep(300);
  ok('stale heartbeat -> treated as over, bar stays hidden', box.hidden === true);

  // clicking Fresh check keeps the icon going until the run shows up, then hands over
  noRun();
  d.getElementById('freshcheck-button').click();
  await sleep(200);
  ok('click keeps the icon spinning while waiting for the run to appear', d.getElementById('freshcheck-button').classList.contains('spinning'));
  close();

  // ---- reload rules ----
  async function reloadCase(name, setup, expectReload) {
    noRun(); setVersion(cur);
    const p = await open();
    p.w.pageLoadedAt = 0; p.w.lastInteraction = 0;
    setup && setup(p);
    setVersion(cur + 1000);
    await sleep(500);
    ok(name, p.w.reloadingForLive === expectReload, 'reloadingForLive=' + p.w.reloadingForLive);
    p.close();
  }
  await reloadCase('newer page + quiet -> reloads', null, true);
  await reloadCase('recent click -> waits', p => { p.w.lastInteraction = Date.now(); }, false);
  await reloadCase('settings panel open -> waits', p => { p.d.getElementById('settings-panel').hidden = false; }, false);
  await reloadCase('typing in a text field -> waits', p => { const el = p.d.querySelector('.reminder-add input[type="text"]'); el.focus(); }, false);
  await reloadCase('half-typed reminder (focus elsewhere) -> waits', p => { p.d.getElementById('reminder-title').value = 'buy poster board'; }, false);
  await reloadCase('reminder being edited -> waits', p => { p.d.getElementById('reminder-editing-id').value = 'abc'; }, false);
  await reloadCase('page only just loaded -> waits', p => { p.w.pageLoadedAt = Date.now(); }, false);

  // older / equal version never reloads (a lagging or failed publish can't loop)
  for (const [name, v] of [['older version -> no reload', cur - 5], ['equal version -> no reload', cur]]) {
    noRun(); setVersion(cur);
    const p = await open(); p.w.pageLoadedAt = 0; p.w.lastInteraction = 0;
    setVersion(v); await sleep(400);
    ok(name, p.w.reloadingForLive === false); p.close();
  }
  // missing version file -> no reload
  { noRun(); setVersion(cur); const p = await open(); p.w.pageLoadedAt = 0; p.w.lastInteraction = 0;
    fs.unlinkSync(path.join(liveDir, 'page-version.js')); await sleep(400);
    ok('missing version file -> no reload', p.w.reloadingForLive === false); p.close(); setVersion(cur); }

  // once quiet, a blocked reload goes through by itself
  { noRun(); setVersion(cur); const p = await open(); p.w.pageLoadedAt = 0; p.w.lastInteraction = Date.now();
    setVersion(cur + 1); await sleep(300);
    const waited = p.w.reloadingForLive === false;
    p.w.lastInteraction = 0;
    ok('...and reloads by itself once things go quiet', waited && await until(() => p.w.reloadingForLive === true)); p.close(); setVersion(cur); }
  process.exit(process.exitCode || 0);
})();
