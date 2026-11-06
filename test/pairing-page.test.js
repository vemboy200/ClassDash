// The page's side of three things, with made-up data: cancelling a pairing code
// (answers arriving late, a code outliving the page), the "Still reading" banner
// once a check is over, and Cmd/Ctrl+R in a browser versus in the app.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const PROJ = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(PROJ);
T.redraw(PROJ);
const { JSDOM, VirtualConsole } = T.jsdom();
const html = fs.readFileSync(path.join(PROJ, 'summary.html'), 'utf8');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open({ bridge }) {
  const sent = [], fetched = [];
  const dom = new JSDOM(html, {
    url: 'https://127.0.0.1:8734/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      Object.defineProperty(w.navigator, 'platform', { value: 'MacIntel' });
      w.fetch = (url) => { fetched.push(String(url)); return new Promise(() => {}); };
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } };
    },
  });
  const w = dom.window;
  // Answers the oldest unanswered request for this action.
  const answer = (action, result) => {
    const i = sent.findIndex(m => m.action === action && !m.done);
    if (i < 0) throw new Error('nothing waiting for ' + action);
    sent[i].done = true;
    w.classdashBridgeResult(sent[i].id, { ok: true, action, ...result });
  };
  const waiting = action => sent.some(m => m.action === action && !m.done);
  return { w, d: w.document, sent, fetched, answer, waiting, close: () => w.close() };
}

(async () => {
  // ---- Cancel, with a device-list answer still on its way ----
  let p = open({ bridge: true });
  const box = () => p.d.getElementById('api-pair-code');
  const cancel = () => p.d.getElementById('api-pair-cancel');
  p.w.pairDevice();
  p.answer('pairCode', { code: 'ABC-DEF', expires: Date.now() + 600000 });
  ok(!box().hidden && p.d.getElementById('api-pair-value').textContent === 'ABC-DEF', 'the code shows');
  p.answer('devices', { devices: [], pairing: { waiting: true } });
  await sleep(2150);
  ok(p.waiting('devices'), 'the watch asked for the list again');
  p.w.cancelPairing();
  ok(box().hidden, 'Cancel hides the box right away');
  ok(p.waiting('pairCancel'), 'Cancel tells the server');
  p.answer('pairCancel', {});
  p.answer('devices', { devices: [], pairing: { waiting: false } });
  ok(box().hidden, 'a late answer does not bring the box back');
  await sleep(2150);
  ok(!p.waiting('devices'), 'the watch really stopped');

  // ---- Cancel before the first list answer ----
  p.w.pairDevice();
  p.answer('pairCode', { code: 'GHJ-KLM', expires: Date.now() + 600000 });
  p.w.cancelPairing();
  p.answer('pairCancel', {});
  p.answer('devices', { devices: [], pairing: { waiting: false } });
  await sleep(2150);
  ok(box().hidden && !p.waiting('devices'), 'no watch starts after an early Cancel');
  p.close();

  // ---- A code that outlived the page ----
  p = open({ bridge: true });
  p.w.watchDevices();
  p.answer('devices', { devices: [], pairing: { waiting: true, expires: Date.now() + 240000 } });
  ok(!box().hidden, 'a waiting code from before a reload is mentioned');
  ok(p.d.getElementById('api-pair-value').textContent === '', 'its code cannot be shown again');
  ok(/about 4 more minutes/.test(p.d.getElementById('api-pair-note').textContent), 'it says how long is left');
  ok(!cancel().hidden, 'and it can be cancelled');
  p.answer('devices', { devices: [], pairing: { waiting: true } });
  p.w.cancelPairing();
  ok(box().hidden && p.waiting('pairCancel'), 'cancelling it works');
  // The server refusing leaves the code valid, so the page says so again.
  p.sent.find(m => m.action === 'pairCancel').done = true;
  p.w.classdashBridgeResult(p.sent.find(m => m.action === 'pairCancel').id, { ok: false });
  p.answer('devices', { devices: [], pairing: { waiting: true, expires: Date.now() + 240000 } });
  ok(!box().hidden, 'a Cancel that failed brings it back');
  p.w.cancelPairing();
  p.close();

  // ---- "Still reading" ----
  p = open({ bridge: true });
  const banner = p.d.createElement('div'); banner.className = 'live'; p.d.body.appendChild(banner);
  p.w.classdashLiveChanged({ run: { running: true, at: Date.now() }, version: 0 });
  ok(p.d.querySelector('.live'), 'the banner stays while a check runs');
  p.w.classdashLiveChanged({ run: { running: false, at: Date.now() }, version: 0 });
  ok(!p.d.querySelector('.live'), 'and goes once it is over');
  p.close();

  // ---- Cmd+R ----
  const press = (s, opts) => {
    const e = new s.w.KeyboardEvent('keydown', { code: 'KeyR', key: 'r', metaKey: true, bubbles: true, cancelable: true, ...opts });
    s.d.body.dispatchEvent(e);
    return e;
  };
  p = open({ bridge: false });
  let e = press(p, {});
  ok(!e.defaultPrevented && !p.fetched.some(u => /api\/action/.test(u)), 'in a browser Cmd+R is left to the browser');
  e = press(p, { shiftKey: true });
  ok(!e.defaultPrevented && !p.fetched.some(u => /api\/action/.test(u)), 'and so is Shift+Cmd+R');
  ok(!/⌘R/.test(p.d.getElementById('quickcheck-button').title), 'the button does not claim the key there');
  p.close();
  p = open({ bridge: true });
  e = press(p, {});
  ok(e.defaultPrevented && p.sent.some(m => m.action === 'quickCheck'), 'in the app it is still Quick check');
  ok(/⌘R/.test(p.d.getElementById('quickcheck-button').title), 'and the button says so');
  p.close();
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
