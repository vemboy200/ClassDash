// Settings → Account → Setup and Advanced → Browser path, with and without a native bridge.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
const { JSDOM, VirtualConsole } = T.jsdom();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const render = (settings) => {
  fs.writeFileSync('settings.json', JSON.stringify(settings));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });
};
// bridge: a stand-in for the native app — records what the page sends and lets the test answer
const open = async ({ bridge }) => {
  const sent = [];
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = await JSDOM.fromFile(path.join(PROJ, 'summary.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      w.location.reload = () => {};                       // not implemented in jsdom
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } };
    } });
  await sleep(300);
  const w = dom.window, d = w.document;
  return { w, d, sent, errors, answer: (i, res) => w.classdashBridgeResult(sent[i].id, res) };
};
const hidden = (d, sel) => { const e = d.querySelector(sel); return !e || e.hidden; };   // the element itself (the whole panel starts closed)
const field = d => d.querySelector('[data-key="browserPath"]');

(async () => {
  const backup = fs.existsSync('last-collection.json') ? fs.readFileSync('last-collection.json') : null;

  // ── a plain browser tab: no bridge ──
  render({ email: 'a@b', canvas: 'https://x.instructure.com', language: 'en' });
  let s = await open({ bridge: false });
  ok(hidden(s.d, '.setup-group'), 'no bridge: the Setup group is hidden');
  ok([...s.d.querySelectorAll('[onclick*="chooseBrowserApp"], [onclick*="clearBrowserPath"]')].every(b => b.hidden), 'no bridge: Choose App… / Clear are hidden');
  ok(field(s.d).readOnly === false, 'no bridge: the browser path is an ordinary editable field');
  s.w.close();

  // ── inside the app ──
  render({ email: 'a@b', canvas: 'https://x.instructure.com', language: 'en' });
  s = await open({ bridge: true });
  const { w, d } = s;
  ok(!hidden(d, '.setup-group'), 'bridge: the Setup group is shown (Classroom is on)');
  ok(/Setup/.test(d.querySelector('.settings-subhead').textContent), 'the group is headed "Setup"');
  const labels = [...d.querySelectorAll('.setup-group .field-name')].map(e => e.textContent.trim());
  ok(JSON.stringify(labels) === JSON.stringify(['Browser', 'Sign in']), 'Setup rows: ' + labels);
  const btns = [...d.querySelectorAll('.setup-group .mini-btn')].map(b => b.textContent.trim());
  ok(JSON.stringify(btns) === JSON.stringify(['Choose Browser…', 'Sign In…']), 'buttons named "Choose Browser…" and "Sign In…" (not "…to Google Classroom"): ' + btns);
  ok(field(d).readOnly === true, 'bridge: the browser path is read-only (you pick, you do not type)');
  ok([...d.querySelectorAll('[onclick*="chooseBrowserApp"], [onclick*="clearBrowserPath"]')].every(b => !b.hidden), 'bridge: Choose App… and Clear are shown');
  const current = () => d.getElementById('browser-current').textContent;
  const startLabel = current();
  ok(/Brave|Chrome/.test(startLabel), 'the current browser is named: ' + startLabel);

  // Setup → Choose Browser…: a path comes back
  d.querySelector('[onclick*="setupBrowser"]').click();
  ok(s.sent.length === 1 && s.sent[0].action === 'setupBrowser', 'Choose Browser… sends setupBrowser');
  s.answer(0, { ok: true, browserPath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', installedBrave: false });
  ok(field(d).value.endsWith('Brave Browser') && current() === 'Brave Browser', 'a chosen path fills the field and the label names the app: ' + current());
  ok(w.settingsDirty(), 'and the panel counts as changed, so closing it saves the path');
  // each request is answered once, so each case is a fresh click
  const ask = (res) => { d.querySelector('[onclick*="setupBrowser"]').click(); s.answer(s.sent.length - 1, res); };
  // a Windows path
  ask({ ok: true, browserPath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' });
  ok(current() === 'brave', 'a Windows path is named too: ' + current());
  // nothing changed -> null keeps the field
  const before = field(d).value;
  ask({ ok: true, browserPath: null, installedBrave: false });
  ok(field(d).value === before, 'null (nothing changed) leaves the field alone');
  // a fresh Brave clears a custom path and says so
  ask({ ok: true, browserPath: '', installedBrave: true });
  ok(field(d).value === '' && current() === 'Brave (installed by ClassDash)', 'a fresh Brave clears the path: ' + current());
  // a failure changes nothing
  field(d).value = '/keep/me';
  ask({ ok: false });
  ok(field(d).value === '/keep/me', 'a failed answer changes nothing');
  w.close();

  // Advanced → Choose App…, Clear
  s = await open({ bridge: true });
  s.d.querySelector('[onclick*="chooseBrowserApp"]').click();
  ok(s.sent[0].action === 'pickBrowserApp', 'Choose App… sends pickBrowserApp');
  s.answer(0, { ok: true, browserPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  ok(field(s.d).value.endsWith('Google Chrome') && s.d.getElementById('browser-current').textContent === 'Google Chrome', 'a picked app fills the field and updates the label');
  s.d.querySelector('[onclick*="chooseBrowserApp"]').click();
  s.answer(s.sent.length - 1, { ok: true, browserPath: null });
  ok(field(s.d).value.endsWith('Google Chrome'), 'cancelling the picker (null) keeps the current value');
  s.d.querySelector('[onclick*="clearBrowserPath"]').click();
  ok(field(s.d).value === '' && /Brave|Chrome/.test(s.d.getElementById('browser-current').textContent), 'Clear empties the path and goes back to the default label');
  s.w.close();

  // Sign In…: nothing pending -> straight to the native sign-in
  s = await open({ bridge: true });
  const signIn = s.d.querySelector('[onclick*="setupSignIn"]');
  signIn.click();
  ok(s.sent.length === 1 && s.sent[0].action === 'setupSignIn', 'Sign In… with nothing pending goes straight to setupSignIn');
  ok(signIn.textContent === 'Opening sign-in window…', 'the button says it is opening: ' + signIn.textContent);
  s.answer(0, { ok: true });
  ok(signIn.textContent === 'Sign In…', 'and goes back to its label once the app answers');
  // pending edits -> saved first, then sign-in
  s.d.querySelector('[data-bool-key="canvasSsoEnabled"]').click();
  s.d.querySelector('[data-bool-key="canvasSsoEnabled"]').dispatchEvent(new s.w.Event('change'));
  ok(s.w.settingsDirty(), 'a ticked source makes the panel dirty');
  s.sent.length = 0;
  signIn.click();
  ok(s.sent.length === 1 && s.sent[0].action === 'config', 'Sign In… with pending edits saves them first (config)');
  s.answer(0, { ok: true, rejected: [] });
  ok(s.sent.length === 2 && s.sent[1].action === 'setupSignIn', 'and only then starts the sign-in');
  // a rejected save does not start the sign-in on stale settings
  s.w.close();
  s = await open({ bridge: true });
  s.d.querySelector('[data-bool-key="canvasSsoEnabled"]').click();
  s.d.querySelector('[onclick*="setupSignIn"]').click();
  s.answer(0, { ok: true, rejected: ['bad value'] });
  ok(!s.sent.some(m => m.action === 'setupSignIn'), 'a save that was refused does not go on to sign in');
  s.w.close();

  // Setup only shows when a browser source is ticked
  s = await open({ bridge: true });
  for (const k of ['classroomEnabled', 'edpuzzleEnabled', 'canvasSsoEnabled']) {
    const b = s.d.querySelector(`[data-bool-key="${k}"]`);
    if (b.checked) { b.checked = false; b.dispatchEvent(new s.w.Event('change')); }
  }
  ok(hidden(s.d, '.setup-group'), 'no browser source ticked: Setup is hidden');
  const c = s.d.querySelector('[data-bool-key="canvasSsoEnabled"]'); c.checked = true; c.dispatchEvent(new s.w.Event('change'));
  ok(!hidden(s.d, '.setup-group'), 'Canvas Google sign-in alone brings it back');
  ok(s.errors.filter(e => !/Not implemented|live\/(check-run|page-version)/.test(e)).length === 0, 'no page script errors: ' + s.errors.join('|'));
  s.w.close();

  // settings saved with a custom path render it
  render({ language: 'en', browserPath: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' });
  s = await open({ bridge: true });
  ok(s.d.getElementById('browser-current').textContent === 'Vivaldi' && field(s.d).value.endsWith('Vivaldi'), 'a saved custom path is shown by name');
  s.w.close();

  // Russian
  render({ language: 'ru' });
  const html = fs.readFileSync('summary.html', 'utf8');
  ok(/Выбрать браузер…/.test(html) && /Войти…/.test(html) && /Выбрать приложение…/.test(html), 'Russian button labels render');

  fs.unlinkSync('settings.json');
  if (backup) fs.writeFileSync('last-collection.json', backup);
  console.log(`setup-buttons: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
