// Pushed live updates (the app calls classdashLiveChanged): bar, dead heartbeat, reloads.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); T.redraw(proj);
// a page written WHILE a check runs: it has the progress banner and a baked-in bar
{
  const { writePage } = require(path.join(proj, '08-page.js'));
  writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(),
    broken: [], reading: ['Science'], progress: { done: 5, total: 8 }, now: new Date() }, path.join(proj, 'summary.html'));
}
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return f(); };
const liveDir = path.join(proj, 'live');
const cur = Number(/var PAGE_VERSION = (\d+);/.exec(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'))[1]);
const setJs = (name, body) => fs.writeFileSync(path.join(liveDir, name), body);
const rmJs = name => { try { fs.unlinkSync(path.join(liveDir, name)); } catch {} };

async function open({ bridge = true } = {}) {
  const posted = [], loads = { n: 0 };
  const vc = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
      const real = w.setTimeout.bind(w); w.setTimeout = (fn, ms, ...a) => real(fn, Math.min(ms, 40), ...a);
      const realSI = w.setInterval.bind(w); w.setInterval = (fn, ms, ...a) => realSI(fn, Math.min(ms, 40), ...a);
      const append = w.Node.prototype.appendChild;
      w.Node.prototype.appendChild = function (c) { if (c && c.tagName === 'SCRIPT' && /live\//.test(c.src || '')) loads.n++; return append.call(this, c); };
    } });
  const w = dom.window; await until(() => typeof w.pollLive === 'function');
  return { w, d: w.document, posted, loads, close: () => w.close() };
}
const runState = o => ({ running: true, done: 0, total: 0, at: Date.now(), ...o });

(async () => {
  setJs('page-version.js', 'window.classdashPageVersion = ' + cur + ';\n'); rmJs('check-run.js');

  // ---- a push shows the bar, moves it, and ends polling ----
  {
    const { w, d, loads, close } = await open();
    const box = d.getElementById('check-progress');
    w.classdashLiveChanged({ run: runState({ done: 3, total: 10 }), version: null });
    ok('push shows the bar', box.hidden === false);
    ok('push sets the label', d.getElementById('check-progress-label').textContent === 'Checking 3 of 10');
    ok('first push marks the page as pushed', w.livePushed === true);
    await sleep(150); const after = loads.n;
    await sleep(400);
    ok('no more polling after a push', loads.n === after, after + ' -> ' + loads.n);
    w.classdashLiveChanged({ run: runState({ done: 8, total: 10 }), version: null });
    ok('a later push moves it', d.getElementById('check-progress-label').textContent === 'Checking 8 of 10');

    // "no news" must never take the bar down
    w.classdashLiveChanged({ run: null, version: null });
    ok('a push with no run info leaves the bar alone', box.hidden === false);
    w.classdashLiveChanged(null);
    ok('a null push is harmless', box.hidden === false);
    w.classdashLiveChanged({ run: runState({ running: false, done: 10, total: 10 }), version: null });
    ok('a push that says the run ended hides it', box.hidden === true);
    close();
  }

  // ---- heartbeat stopped: hides by itself, and leaves a trace ----
  {
    const { w, d, posted, close } = await open();
    const box = d.getElementById('check-progress');
    ok('an in-progress page is used for this test (has the banner)', !!d.querySelector('.live'));
    w.classdashLiveChanged({ run: runState({ done: 4, total: 8 }), version: null });
    ok('bar is up', box.hidden === false);
    w.lastRun = runState({ done: 4, total: 8, at: Date.now() - 45000 });   // heartbeat stopped 45s ago
    ok('with no further push, the timer notices the dead heartbeat and hides it', await until(() => box.hidden === true));
    const dbg = posted.filter(m => m.action === 'liveDebug');
    ok('...and leaves a trace via the bridge', dbg.length === 1, JSON.stringify(posted.map(m => m.action)));
    const info = dbg[0] && JSON.parse(dbg[0].arg);
    ok('...saying how old the heartbeat was and that it was pushed', info && info.ageMs > 30000 && info.pushed === true, dbg[0] && dbg[0].arg);
    await sleep(300);
    ok('...only once (throttled)', posted.filter(m => m.action === 'liveDebug').length === 1);
    close();
  }
  // a heartbeat 20s old is still fine now (the old 15s cutoff was too tight)
  { const { w, d, close } = await open();
    w.classdashLiveChanged({ run: runState({ done: 2, total: 8, at: Date.now() - 20000 }), version: null });
    ok('a 20s-old heartbeat still counts as running', d.getElementById('check-progress').hidden === false); close(); }

  // ---- a baked bar isn't hidden on no news, until it has waited long enough ----
  {
    rmJs('check-run.js');
    const { w, d, close } = await open();
    const box = d.getElementById('check-progress');
    w.livePushed = true;                       // simulate: app pushes, but nothing has arrived yet
    await sleep(300);
    ok('baked bar survives having heard nothing yet', box.hidden === false);
    w.pageLoadedAt = Date.now() - 20000;
    ok('...and goes after a long silence', await until(() => box.hidden === true));
    close();
  }

  // ---- poll mode: a failed load is not "the run ended" ----
  {
    setJs('check-run.js', 'window.classdashCheckRun = ' + JSON.stringify(runState({ done: 2, total: 8 })) + ';\n');
    const { w, d, close } = await open();
    const box = d.getElementById('check-progress');
    ok('polled run shows', await until(() => box.hidden === false));
    setJs('check-run.js', 'window.classdashCheckRun = ' + JSON.stringify(runState({ done: 2, total: 8 })) + ';\n');
    rmJs('check-run.js');                      // the file vanishes (a failed load from now on)
    await sleep(500);
    ok('file gone -> bar stays (no news is not bad news)', box.hidden === false);
    close();
  }

  // ---- pushed newer version reloads when quiet, waits otherwise ----
  {
    const { w, close } = await open(); w.pageLoadedAt = 0; w.lastInteraction = 0;
    w.classdashLiveChanged({ run: null, version: cur + 10 });
    ok('newer pushed version + quiet -> reloads', await until(() => w.reloadingForLive === true)); close();
  }
  {
    const { w, close } = await open(); w.pageLoadedAt = 0; w.lastInteraction = Date.now();
    w.classdashLiveChanged({ run: null, version: cur + 10 });
    await sleep(200);
    const held = w.reloadingForLive === false;
    w.lastInteraction = 0;
    ok('a held-back reload goes through by itself once quiet (no new push needed)', held && await until(() => w.reloadingForLive === true)); close();
  }
  { const { w, close } = await open(); w.pageLoadedAt = 0; w.lastInteraction = 0;
    w.classdashLiveChanged({ run: null, version: cur });
    w.classdashLiveChanged({ run: null, version: cur - 3 });
    await sleep(200);
    ok('same or older pushed version never reloads', w.reloadingForLive === false); close(); }

  // ---- no bridge: nothing throws ----
  { const { w, d, close } = await open({ bridge: false });
    let threw = null; try { w.classdashLiveChanged({ run: runState({ done: 1, total: 3 }), version: null });
      w.lastRun = runState({ at: Date.now() - 60000 }); await sleep(200); } catch (e) { threw = e; }
    ok('no bridge: a push and a dead heartbeat work without throwing', !threw && d.getElementById('check-progress').hidden === true, String(threw)); close(); }
  process.exit(process.exitCode || 0);
})();
