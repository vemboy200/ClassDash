// Stop takes over Fresh check's own spot while a check runs: baked-in visibility, live toggling, and the click.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(20); } return f(); };
const { writePage } = require(path.join(proj, '08-page.js'));
const runState = o => ({ running: true, done: 0, total: 0, at: Date.now(), ...o });

async function open(file, { bridge = true } = {}) {
  const posted = [];
  const vc = new VirtualConsole();
  const dom = await JSDOM.fromFile(file, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
    },
  });
  const w = dom.window;
  await until(() => typeof w.stopFreshCheck === 'function');
  return { w, d: w.document, posted, close: () => w.close() };
}

(async () => {
  // ---- baked-in state: a page written mid-check shows Stop and hides Fresh check; one written idle is the other way round ----
  const idlePage = path.join(proj, 'idle.html');
  writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [], now: new Date() }, idlePage);
  {
    const idleHtml = fs.readFileSync(idlePage, 'utf8');
    ok('idle page: Stop is baked in hidden', /id="stop-check-button"[^>]*\bhidden\b/.test(idleHtml));
    ok('idle page: Fresh check is baked in visible', !/id="freshcheck-button"[^>]*\bhidden\b/.test(idleHtml));
  }

  const runningPage = path.join(proj, 'running.html');
  writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [],
    reading: ['Canvas'], progress: { done: 3, total: 8 }, now: new Date() }, runningPage);
  const runningHtml = fs.readFileSync(runningPage, 'utf8');
  ok('a page reloaded mid-check shows Stop right away, not hidden',
    /id="stop-check-button"/.test(runningHtml) && !/id="stop-check-button"[^>]*\bhidden\b/.test(runningHtml));
  ok('...and Fresh check is hidden instead, not sitting beside it',
    /id="freshcheck-button"[^>]*\bhidden\b/.test(runningHtml));
  ok('it has a title (an icon-only button, no visible label)', /id="stop-check-button"[^>]*title="[^"]+"/.test(runningHtml));

  // ---- live toggling: Stop takes Fresh check's spot when a check starts, gives it back when it ends ----
  {
    const { w, d, close } = await open(idlePage);
    const stop = d.getElementById('stop-check-button');
    const fresh = d.getElementById('freshcheck-button');
    ok('starts hidden on the idle page', stop.hidden === true);
    ok('...with Fresh check showing', fresh.hidden === false);
    w.classdashLiveChanged({ run: runState({ done: 2, total: 8 }), version: null });
    ok('Stop shown once a check is heard running', await until(() => stop.hidden === false));
    ok('...and Fresh check hides at the same moment', fresh.hidden === true);
    w.classdashLiveChanged({ run: runState({ running: false, done: 8, total: 8 }), version: null });
    ok('Stop hidden again once the check ends', await until(() => stop.hidden === true));
    ok('...and Fresh check is back', fresh.hidden === false);
    close();
  }

  // ---- clicking it: dispatches stopCheck, disables itself, stays disabled on success ----
  {
    const { w, d, posted, close } = await open(runningPage);
    const button = d.getElementById('stop-check-button');
    ok('visible to start with (baked in from a running page)', button.hidden === false);
    ok('not disabled before the click', button.disabled === false);
    w.stopFreshCheck();
    ok('sends the stopCheck action, nothing else', posted.length === 1 && posted[0].action === 'stopCheck', JSON.stringify(posted));
    ok('disables itself right away, not waiting on a reply', button.disabled === true);
    w.classdashBridgeResult(posted[0].id, { ok: true, action: 'stopCheck', stopped: true });
    await sleep(50);
    ok('stays disabled on a real stop (there is a live update to hide it, not a re-enable)', button.disabled === true);
    close();
  }

  // ---- clicking it when nothing was actually running: re-enabled so a retry works ----
  {
    const { w, d, posted, close } = await open(runningPage);
    const button = d.getElementById('stop-check-button');
    w.stopFreshCheck();
    w.classdashBridgeResult(posted[0].id, { ok: true, action: 'stopCheck', stopped: false });
    await sleep(50);
    ok('re-enabled when there was nothing to stop', button.disabled === false);
    close();
  }

  // ---- no bridge: does not throw ----
  {
    const { w, close } = await open(runningPage, { bridge: false });
    let threw = null; try { w.stopFreshCheck(); } catch (e) { threw = e; }
    ok('no bridge: does not throw', !threw, String(threw));
    close();
  }

  // ---- the icon is a real stencil, present in both colour skins ----
  ok('the stop icon is wired up as a mask, like the other header icons', /--icon-stop: url\("data:image\/png;base64,/.test(runningHtml) && /\.icon-stop \{ -webkit-mask-image: var\(--icon-stop\)/.test(runningHtml));

  process.exit(process.exitCode || 0);
})();
