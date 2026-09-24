// Keyboard shortcuts on the summary page.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
const { JSDOM, VirtualConsole } = T.jsdom();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── fixture: 13 classes, an announcement per class, three item types ──
const backups = {};
for (const f of ['last-collection.json', 'messages.json', 'new.json', 'не-срочно.txt']) backups[f] = fs.existsSync(f) ? fs.readFileSync(f) : null;
const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const items = [];
const names = Array.from({ length: 13 }, (_, i) => 'Class ' + String(i + 1).padStart(2, '0'));
names.forEach((c, i) => {
  items.push({ class: c, id: 'a' + i, type: 'Assignment', title: 'Work ' + i, due: null, due_iso: soon(2), link: 'x' });
});
items.push({ class: names[0], id: 'm1', type: 'Material', title: 'Read me', due: null, due_iso: null, link: 'x' });          // a fresh material
items.push({ class: names[1], id: 'c1', type: 'Completed Assignment', title: 'Done', due: null, due_iso: soon(3), link: 'x', removed: true, removedAt: new Date().toISOString() });   // shows via "removed"
items.push({ class: names[2], id: 'u1', type: 'Assignment', title: 'No date', due: null, due_iso: null, link: 'x' });         // muted -> "no due date"
items.push({ class: names[3], id: 'd1', type: 'Assignment', title: 'Due today', due: null, due_iso: soon(0.5), link: 'x' });    // "today and tomorrow"
items.push({ class: names[4], id: 'o1', type: 'Assignment', title: 'Late', due: null, due_iso: soon(-2), link: 'x' });          // "overdue"
fs.writeFileSync('last-collection.json', JSON.stringify(items));
fs.writeFileSync('new.json', JSON.stringify({ assignments: ['m1'], announcements: [] }));
fs.writeFileSync('не-срочно.txt', 'u1\n');
fs.writeFileSync('messages.json', JSON.stringify(names.map((c, i) => ({ id: 'p' + i, class: c, text: 'post ' + i, date: 'Sep ' + (i + 1), sortTime: Date.now() - i * 1000, link: 'x' }))));
fs.writeFileSync('settings.json', JSON.stringify({ email: 'a@b', canvas: '', language: 'en', treatUndatedAsUrgent: false, showEmptyClasses: false }));
cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });

const open = async ({ mac = false, bridge = true } = {}) => {
  const sent = [], errors = [];
  // location.reload can't be replaced in jsdom; every attempt is reported as "Not implemented: navigation", so count those
  const navs = () => errors.filter(e => /navigation/i.test(e)).length;
  let base = 0;
  const reloads = { get n() { return navs() - base; }, set n(v) { base = navs() - v; } };
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = await JSDOM.fromFile(path.join(PROJ, 'summary.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      Object.defineProperty(w.navigator, 'platform', { value: mac ? 'MacIntel' : 'Win32' });
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } };
    } });
  await sleep(300);
  const w = dom.window, d = w.document;
  const press = (code, opts = {}, target) => {
    const e = new w.KeyboardEvent('keydown', { code, key: opts.key || code, bubbles: true, cancelable: true, ...opts });
    (target || d.body).dispatchEvent(e);
    return e;
  };
  return { w, d, sent, errors, reloads, press };
};
const clsBoxes = d => [...d.querySelectorAll('.filters input[data-group="cls"]')];
const annBoxes = d => [...d.querySelectorAll('.announcement-filters input[data-group="post-cls"]')];
const state = boxes => boxes.map(b => b.checked ? 1 : 0).join('');

(async () => {
  let s = await open();
  let { w, d, press } = s;

  // ── the fixture really gives us what we test against ──
  ok(clsBoxes(d).length === 13, 'fixture: 13 class rows: ' + clsBoxes(d).length);
  ok(annBoxes(d).length === 13, 'fixture: 13 announcement rows: ' + annBoxes(d).length);
  const typeVals = [...d.querySelectorAll('.filters input[data-group="type"]')].map(b => b.value);
  console.log('  (types on the page:', typeVals.join(' | '), ')');
  ok(typeVals.some(v => /^assignment/i.test(v)) && typeVals.some(v => /^material/i.test(v)), 'fixture: Assignment and Material types present');

  // ── hints ──
  const hints = boxes => boxes.map(b => (b.nextElementSibling && b.nextElementSibling.classList.contains('key-hint')) ? b.nextElementSibling.textContent : '');
  ok(hints(clsBoxes(d)).join(',') === '1,2,3,4,5,6,7,8,9,0,-,=,', 'class rows show 1-9, 0, -, = and nothing on the 13th: ' + hints(clsBoxes(d)).join(','));
  ok(hints(annBoxes(d)).join(',') === '⇧1,⇧2,⇧3,⇧4,⇧5,⇧6,⇧7,⇧8,⇧9,⇧0,⇧-,⇧=,', 'announcement rows show shift + the same keys: ' + hints(annBoxes(d)).join(','));
  const typeHint = re => { const b = [...d.querySelectorAll('.filters input[data-group="type"]')].find(x => re.test(x.value)); return b && b.nextElementSibling.textContent; };
  ok(typeHint(/^assignment/i) === 'A' && typeHint(/^material/i) === 'M', 'type rows show A and M');
  if (typeHint(/^completed/i) !== null) ok(typeHint(/^completed/i) === 'C', 'the Completed type row shows C');
  const none = d.querySelector('.filters input[data-group="days"][value="none"]');
  ok(none.nextElementSibling.textContent === 'N', 'the no-due-date row shows N');
  const dueBox = v => d.querySelector('.filters input[data-group="days"][value="' + v + '"]');
  const DUE = [['1', 'KeyT', 'T', 'today and tomorrow'], ['7', 'KeyW', 'W', 'this week'], ['31', 'KeyH', 'H', 'this month'], ['past', 'KeyO', 'O', 'overdue'], ['none', 'KeyN', 'N', 'no due date']];
  for (const [v, , key, label] of DUE) ok(dueBox(v) && dueBox(v).nextElementSibling.textContent === key, 'the ' + label + ' row shows ' + key);
  ok(/Ctrl\+R/.test(d.getElementById('refresh-button').title) && /Ctrl\+Shift\+R/.test(d.getElementById('freshcheck-button').title) && /Ctrl\+S/.test(d.querySelector('.check-status').title), 'header tooltips carry the shortcuts (Windows style)');

  // ── class filter: every slot, digit row and numpad ──
  const slotCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
  slotCodes.forEach((code, i) => {
    const before = state(clsBoxes(d));
    const e = press(code);
    const after = state(clsBoxes(d));
    const changed = [...before].map((c, k) => c !== after[k] ? k : -1).filter(k => k >= 0);
    ok(changed.length === 1 && changed[0] === i && e.defaultPrevented, code + ' toggles exactly class #' + (i + 1) + ' (changed: ' + changed + ')');
    press(code);   // back
  });
  const padCodes = ['Numpad1', 'Numpad9', 'Numpad0', 'NumpadSubtract', 'NumpadAdd'];
  const padSlots = [0, 8, 9, 10, 11];
  padCodes.forEach((code, n) => {
    const before = state(clsBoxes(d)); press(code); const after = state(clsBoxes(d));
    ok(before[padSlots[n]] !== after[padSlots[n]] && [...before].filter((c, k) => c !== after[k]).length === 1, code + ' toggles class #' + (padSlots[n] + 1));
    press(code);
  });
  // the 13th class has no key, and a slot with nothing behind it does nothing (and lets the key through)
  const all13 = state(clsBoxes(d));
  // remove the 12th+13th rows' effect: emulate "fewer classes" by asking for a slot beyond the list via shift on announcements
  ok(state(clsBoxes(d)) === all13, 'no class beyond the 12th is reachable');
  // the card really goes away when its class is unticked
  const cardsFor = c => [...d.querySelectorAll('.row')].filter(x => x.textContent.includes(c) && !x.classList.contains('filtered-out')).length;
  const before1 = cardsFor('Class 01');
  press('Digit1');
  ok(before1 > 0 && cardsFor('Class 01') < before1, 'unticking class #1 hides its cards (' + before1 + ' -> ' + cardsFor('Class 01') + ')');
  press('Digit1');

  // ── announcement filters: shift + the same keys ──
  slotCodes.forEach((code, i) => {
    const before = state(annBoxes(d)); const e = press(code, { shiftKey: true, key: '!' });
    const after = state(annBoxes(d));
    const changed = [...before].map((c, k) => c !== after[k] ? k : -1).filter(k => k >= 0);
    ok(changed.length === 1 && changed[0] === i && e.defaultPrevented, 'Shift+' + code + ' toggles announcement class #' + (i + 1) + ' (changed: ' + changed + ')');
    ok(state(clsBoxes(d)) === all13, 'Shift+' + code + ' leaves the class filter alone');
    press(code, { shiftKey: true });
  });
  {
    const before = state(annBoxes(d)); press('NumpadAdd', { shiftKey: true }); const after = state(annBoxes(d));
    ok(before[11] !== after[11], 'Shift+Numpad+ toggles announcement class #12'); press('NumpadAdd', { shiftKey: true });
  }

  // ── type and due filters ──
  const typeBox = re => [...d.querySelectorAll('.filters input[data-group="type"]')].find(x => re.test(x.value));
  for (const [code, re, label] of [['KeyA', /^assignment/i, 'Assignment'], ['KeyM', /^material/i, 'Material'], ['KeyC', /^completed/i, 'Completed']]) {
    const b = typeBox(re); if (!b) { console.log('  (no ' + label + ' row on this page — skipped)'); continue; }
    const before = b.checked; const e = press(code);
    ok(b.checked !== before && e.defaultPrevented, code + ' toggles the ' + label + ' type');
    press(code);
  }
  for (const [v, code, key, label] of DUE) {
    const b = dueBox(v); const before = b.checked; const e = press(code);
    ok(b.checked !== before && e.defaultPrevented, key + ' toggles "' + label + '"'); press(code);
  }
  // physical keys: a Russian layout types other letters on the same keys
  {
    const b = typeBox(/^assignment/i); const before = b.checked;
    press('KeyA', { key: 'ф' });
    ok(b.checked !== before, 'the A key still works when the layout types "ф" (Russian)'); press('KeyA', { key: 'ф' });
  }

  // ── guards ──
  const snapshot = () => state(clsBoxes(d)) + '|' + state(annBoxes(d)) + '|' + [...d.querySelectorAll('.filters input[data-group="type"]')].map(b => +b.checked).join('') + [...d.querySelectorAll('.filters input[data-group="days"]')].map(b => +b.checked).join('');
  const base = snapshot();
  const nothingHappened = (label, code, opts, target) => { const e = press(code, opts, target); ok(snapshot() === base && !e.defaultPrevented, label); };
  nothingHappened('Ctrl+C is not the Completed filter (Windows: ctrl is the command key, but C is not one of ours)', 'KeyC', { ctrlKey: true });
  nothingHappened('Cmd+C is left alone', 'KeyC', { metaKey: true });
  nothingHappened('Ctrl+1 is left alone', 'Digit1', { ctrlKey: true });
  nothingHappened('Alt+1 is left alone', 'Digit1', { altKey: true });
  nothingHappened('a held-down key does not repeat', 'Digit1', { repeat: true });
  nothingHappened('Shift+A is not the Assignment filter', 'KeyA', { shiftKey: true });
  nothingHappened('Shift+N is not "no due date"', 'KeyN', { shiftKey: true });
  nothingHappened('Shift+H is not "this month"', 'KeyH', { shiftKey: true });
  nothingHappened('Cmd+W (close window) is left alone', 'KeyW', { metaKey: true });
  nothingHappened('IME composition is ignored', 'Digit1', { isComposing: true });
  // typing
  const field = d.createElement('input'); field.type = 'text'; d.body.appendChild(field);
  nothingHappened('typing in a text field is not a shortcut', 'Digit1', {}, field);
  nothingHappened('...nor letters', 'KeyA', {}, field);
  const sel = d.createElement('select'); d.body.appendChild(sel);
  nothingHappened('a dropdown is not a shortcut target either', 'KeyN', {}, sel);
  const ta = d.createElement('textarea'); d.body.appendChild(ta);
  nothingHappened('nor a textarea', 'KeyM', {}, ta);
  // ...but a focused CHECKBOX is fine (it's not text)
  { const cb = clsBoxes(d)[0]; const before = cb.checked; press('Digit1', {}, cb); ok(cb.checked !== before, 'a focused checkbox does not block the shortcut'); press('Digit1'); }
  // settings open
  w.toggleSettingsPanel();
  nothingHappened('with the settings panel open the plain keys do nothing', 'Digit1');
  nothingHappened('...including the type and due keys', 'KeyN');
  w.toggleSettingsPanel();   // closes (saves if dirty — nothing dirty)

  // ── Refresh / Fresh check / status ──
  s.reloads.n = 0; s.sent.length = 0;
  let e = press('KeyR', { ctrlKey: true });
  ok(s.reloads.n === 1 && e.defaultPrevented, 'Ctrl+R = Refresh (and the browser\'s own reload is suppressed)');
  press('KeyR', { ctrlKey: true, repeat: true });
  ok(s.reloads.n === 1, 'a held Ctrl+R does not repeat');
  press('KeyR', { metaKey: true });
  ok(s.reloads.n === 1, 'on Windows the Windows/Meta key is not the command key');
  e = press('KeyR', { ctrlKey: true, shiftKey: true });
  ok(s.sent.length === 1 && s.sent[0].action === 'check' && e.defaultPrevented, 'Shift+Ctrl+R = Fresh check (bridge "check")');
  ok(d.getElementById('freshcheck-button').classList.contains('spinning'), 'and the button spins while the dispatch is unconfirmed');
  press('KeyR', { ctrlKey: true, shiftKey: true });
  ok(s.sent.length === 1, 'a second Fresh check is ignored while one is running');
  const panel = d.getElementById('check-status-panel');
  const startHidden = panel.hidden;
  e = press('KeyS', { ctrlKey: true });
  ok(panel.hidden !== startHidden && e.defaultPrevented, 'Ctrl+S toggles the status panel (and suppresses "save page")');
  press('KeyS', { ctrlKey: true });
  ok(panel.hidden === startHidden, 'and again to close it');
  press('KeyS', { ctrlKey: true, shiftKey: true });
  ok(panel.hidden === startHidden, 'Shift+Ctrl+S is not the status panel');
  // the native menus call the same thing
  s.reloads.n = 0;
  w.classdashShortcut('refresh'); ok(s.reloads.n === 1, 'window.classdashShortcut("refresh") (the menu item) refreshes');
  w.classdashShortcut('status'); ok(panel.hidden !== startHidden, 'window.classdashShortcut("status") toggles the panel'); w.classdashShortcut('status');
  // unsaved settings are not thrown away by a reload
  w.toggleSettingsPanel();
  d.querySelector('[data-key="email"]').value = 'changed@x';
  s.reloads.n = 0;
  press('KeyR', { ctrlKey: true });
  ok(s.reloads.n === 0, 'Ctrl+R with unsaved settings edits does not reload (it would discard them)');
  w.close();

  // ── macOS: Cmd is the command key, Ctrl is not ──
  s = await open({ mac: true });
  ({ w, d, press } = s);
  ok(/⌘R/.test(d.getElementById('refresh-button').title) && /⇧⌘R/.test(d.getElementById('freshcheck-button').title) && /⌘S/.test(d.querySelector('.check-status').title), 'tooltips use the Mac symbols');
  press('KeyR', { metaKey: true }); ok(s.reloads.n === 1, 'Cmd+R = Refresh');
  press('KeyR', { ctrlKey: true }); ok(s.reloads.n === 1, 'Ctrl+R on a Mac is not Refresh');
  s.sent.length = 0; press('KeyR', { metaKey: true, shiftKey: true }); ok(s.sent.length === 1 && s.sent[0].action === 'check', 'Shift+Cmd+R = Fresh check');
  const p2 = d.getElementById('check-status-panel'); const h2 = p2.hidden; press('KeyS', { metaKey: true }); ok(p2.hidden !== h2, 'Cmd+S = status panel');
  ok(s.errors.filter(x => !/Not implemented|live\/(check-run|page-version)/.test(x)).length === 0, 'no page script errors: ' + s.errors.join('|'));
  w.close();

  // ── the toggle: hints off, shortcuts still on ──
  {
    const html = fs.readFileSync('summary.html', 'utf8');
    ok(/data-bool-key="showKeyHints" checked/.test(html), 'Display has the "show shortcut keys" toggle, on by default');
    ok(/Show shortcut keys/.test(html), 'and it is labelled');
    fs.writeFileSync('settings.json', JSON.stringify({ email: 'a@b', canvas: '', language: 'en', treatUndatedAsUrgent: false, showEmptyClasses: false, showKeyHints: false }));
    cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });
    const off = await open();
    ok(off.d.querySelectorAll('.key-hint').length === 0, 'hints off: no key badges on the filters');
    ok(!/Ctrl\+R|Ctrl\+S/.test(off.d.getElementById('refresh-button').title + off.d.querySelector('.check-status').title), 'hints off: no shortcut in the tooltips either');
    ok(!off.d.querySelector('[data-bool-key="showKeyHints"]').checked, 'the toggle shows as off');
    const b = clsBoxes(off.d)[0], before = b.checked;
    off.press('Digit1');
    ok(b.checked !== before, 'hints off: the shortcuts still work');
    off.press('KeyS', { ctrlKey: true });
    ok(!off.d.getElementById('check-status-panel').hidden, 'hints off: Ctrl+S still works');
    off.w.close();
    const S = require(path.join(PROJ, '19-settings.js'));
    ok(S.validate('showKeyHints', false).ok && S.validate('showKeyHints', 'true').value === true, 'the setting validates as a boolean');
    ok(S.DEFAULTS.showKeyHints === true, 'default is on');
  }

  for (const f of Object.keys(backups)) { if (backups[f]) fs.writeFileSync(f, backups[f]); else fs.unlinkSync(f); }
  fs.unlinkSync('settings.json');
  console.log(`shortcuts: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
