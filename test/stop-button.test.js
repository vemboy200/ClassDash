// Fresh check IS the Stop button while a check runs — one element, not two: baked-in state, live toggling, and the click.
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
  // ---- baked-in state: a page written mid-check bakes .running (Stop); one written idle doesn't ----
  const idlePage = path.join(proj, 'idle.html');
  writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [], now: new Date() }, idlePage);
  {
    const idleHtml = fs.readFileSync(idlePage, 'utf8');
    ok('idle page: freshcheck-button is not .running', !/id="freshcheck-button"[^>]*\bclass="[^"]*running/.test(idleHtml));
    ok('idle page: only one header button with this id — never a separate stop-check-button', !/stop-check-button/.test(idleHtml));
    ok('its title is the Fresh check hint', /id="freshcheck-button"[\s\S]*?title="Checks everything again/.test(idleHtml));
    ok('its label reads "Fresh check"', /id="freshcheck-button"[\s\S]*?class="reload-label">Fresh check</.test(idleHtml));
  }

  const runningPage = path.join(proj, 'running.html');
  writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [],
    reading: ['Canvas'], progress: { done: 3, total: 8 }, now: new Date() }, runningPage);
  const runningHtml = fs.readFileSync(runningPage, 'utf8');
  ok('a page reloaded mid-check bakes .running onto the SAME button',
    /id="freshcheck-button"/.test(runningHtml) && /class="reload named running"\s*\n\s*id="freshcheck-button"/.test(runningHtml));
  ok('its title is the Stop hint, not the Fresh check one', /id="freshcheck-button"[\s\S]*?title="Stop the check/.test(runningHtml));
  ok('its label reads "Stop", not "Fresh check" — a real label, same as Refresh and Fresh check get, not an icon-only button',
    /id="freshcheck-button"[\s\S]*?class="reload-label">Stop</.test(runningHtml));
  ok('both icon spans are present (CSS picks which shows)', /icon-freshcheck/.test(runningHtml) && /icon-stop/.test(runningHtml));

  // ---- live toggling: becomes Stop the moment a check is heard running, becomes Fresh check again once it ends ----
  {
    const { w, d, close } = await open(idlePage);
    const button = d.getElementById('freshcheck-button');
    const label = () => button.querySelector('.reload-label').textContent;
    ok('starts as Fresh check on the idle page', !button.classList.contains('running'));
    ok('...with the Fresh check hint', button.title === 'Checks everything again, Edpuzzle included — takes about a minute — ⇧⌘R' || /Checks everything again/.test(button.title));
    ok('...and the "Fresh check" label', label() === 'Fresh check');
    w.classdashLiveChanged({ run: runState({ done: 2, total: 8 }), version: null });
    ok('becomes Stop once a check is heard running', await until(() => button.classList.contains('running')));
    ok('...and the title switches to the Stop hint', /Stop the check/.test(button.title));
    ok('...and the label switches to "Stop"', label() === 'Stop');
    w.classdashLiveChanged({ run: runState({ running: false, done: 8, total: 8 }), version: null });
    ok('becomes Fresh check again once the check ends', await until(() => !button.classList.contains('running')));
    ok('...and the title switches back', /Checks everything again/.test(button.title));
    ok('...and so does the label', label() === 'Fresh check');
    close();
  }

  // ---- clicking it while running: dispatches stopCheck (not check), disables itself, stays disabled on success ----
  {
    const { w, d, posted, close } = await open(runningPage);
    const button = d.getElementById('freshcheck-button');
    ok('already Stop, baked in from a running page', button.classList.contains('running'));
    ok('not disabled before the click', button.disabled === false);
    button.click();
    ok('sends the stopCheck action, nothing else (not a fresh check)', posted.length === 1 && posted[0].action === 'stopCheck', JSON.stringify(posted));
    ok('disables itself right away, not waiting on a reply', button.disabled === true);
    w.classdashBridgeResult(posted[0].id, { ok: true, action: 'stopCheck', stopped: true });
    await sleep(50);
    ok('stays disabled while still confirmed running (there is a live update to flip it, not a re-enable here)', button.disabled === true);
    w.classdashLiveChanged({ run: runState({ running: false, done: 8, total: 8 }), version: null });
    ok('...and IS re-enabled once the run is actually confirmed over', await until(() => button.disabled === false));
    close();
  }

  // ---- clicking it while running, when nothing was actually running server-side: re-enabled immediately so a retry works ----
  {
    const { w, d, posted, close } = await open(runningPage);
    const button = d.getElementById('freshcheck-button');
    button.click();
    w.classdashBridgeResult(posted[0].id, { ok: true, action: 'stopCheck', stopped: false });
    await sleep(50);
    ok('re-enabled when there was nothing to stop', button.disabled === false);
    close();
  }

  // ---- stopped within the original 15s spin window: does not go on spinning afterward ----
  //
  // freshSpinUntil bridges the click-to-confirmation gap on a fresh START.
  // If a run is stopped EARLY — before that 15s window has elapsed on its
  // own — and nothing consumes the timer the moment the run was actually
  // confirmed live, the button starts spinning again once it ends, for
  // however long was left of the ORIGINAL window, well after it's back to
  // being plain Fresh check.
  {
    const { w, d, close } = await open(idlePage);
    const button = d.getElementById('freshcheck-button');
    button.click();   // starts the click-to-confirmation window (freshSpinUntil = now + 15000)
    ok('spinning right after the click', button.classList.contains('spinning'));
    w.classdashLiveChanged({ run: runState({ done: 1, total: 8 }), version: null });   // confirmed running, well inside the 15s window
    ok('running -> not spinning', await until(() => button.classList.contains('running') && !button.classList.contains('spinning')));
    w.classdashLiveChanged({ run: runState({ running: false, done: 2, total: 8 }), version: null });   // stopped a moment later, still inside the original window
    ok('back to Fresh check', await until(() => !button.classList.contains('running')));
    ok('...and NOT spinning — the confirmation already happened, nothing left to wait on', button.classList.contains('spinning') === false);
    await sleep(60);
    ok('...still not spinning a little later, either (no delayed reactivation)', button.classList.contains('spinning') === false);
    close();
  }

  // ---- clicking it while idle: still starts a fresh check the normal way, not stopCheck ----
  {
    const { w, d, posted, close } = await open(idlePage);
    const button = d.getElementById('freshcheck-button');
    button.click();
    ok('idle click sends check, not stopCheck', posted.length === 1 && posted[0].action === 'check', JSON.stringify(posted));
    ok('spins while dispatched and unconfirmed', button.classList.contains('spinning'));
    ok('not yet .running (not confirmed by a live update)', !button.classList.contains('running'));
    close();
  }

  // ---- no bridge: does not throw ----
  {
    const { w, close } = await open(runningPage, { bridge: false });
    let threw = null; try { w.stopFreshCheck(); } catch (e) { threw = e; }
    ok('no bridge: does not throw', !threw, String(threw));
    close();
  }

  // ---- the stop icon is a real stencil, wired up the same way as the other header icons ----
  ok('the stop icon is wired up as a mask', /--icon-stop: url\("data:image\/png;base64,/.test(runningHtml) && /\.icon-stop \{ -webkit-mask-image: var\(--icon-stop\)/.test(runningHtml));

  process.exit(process.exitCode || 0);
})();
