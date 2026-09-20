// The settings panel: saves on close, the gear says so, failures reopen it.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const proj = T.classProject(undefined, { 'settings.json': { language: 'en' } }); T.redraw(proj);
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const results = [];
const ok = (n, c, extra='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : extra); if (!c) process.exitCode = 1; };

function load({ bridge = true } = {}) {
  const posted = [], timers = [], errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  vc.on('error', e => errors.push(String(e)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
      const real = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...a) => { if (ms >= 100) timers.push(ms); return ms >= 1000 ? 0 : real(fn, ms, ...a); };
    },
  });
  return { w: dom.window, d: dom.window.document, posted, timers, errors };
}
const b64 = s => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

// ---------- no pending: panel behaviour ----------
{
  const { w, d, posted, timers, errors } = load();
  const scriptErrors = errors.filter(e => !/Not implemented: navigation/.test(e));
  ok('page script loads without errors', scriptErrors.length === 0, scriptErrors.join(' | '));
  ok('optimisticExclusions is gone', typeof w.optimisticExclusions === 'undefined');
  ok('no Save button, one Done button in the panel',
    d.querySelectorAll('.settings-actions button').length === 1 &&
    d.querySelector('.settings-actions button').textContent === 'Done');

  const panel = d.getElementById('settings-panel');
  w.toggleSettingsPanel(); ok('opens', panel.hidden === false);
  w.toggleSettingsPanel(); ok('closes', panel.hidden === true);
  ok('opening and closing with no edits sends nothing', posted.length === 0, JSON.stringify(posted));
  ok('...and schedules no reload', timers.length === 0, JSON.stringify(timers));

  const boxes = [...d.querySelectorAll('#settings-panel input[type=checkbox][data-key="exclusions"]')];
  ok('there are class checkboxes to test with', boxes.length > 0, String(boxes.length));

  // edit -> close saves once
  w.toggleSettingsPanel();
  boxes[0].checked = true;
  ok('settingsDirty sees the edit', w.settingsDirty() === true);
  w.toggleSettingsPanel();
  ok('closing after an edit sends exactly one config action', posted.length === 1 && posted[0].action === 'config', JSON.stringify(posted));
  const sent = b64(posted[0].arg);
  ok('payload carries the ticked class', sent.exclusions.length === 1 && sent.exclusions[0] === boxes[0].value, JSON.stringify(sent.exclusions));
  ok('payload is the full snapshot (other keys present)', 'language' in sent && 'staleMonths' in sent && 'apiEnabled' in sent);
  ok('panel stays closed while saving', panel.hidden === true);
  const gear = d.getElementById('settings-button'), status = d.getElementById('settings-status');
  ok('gear expands and says Saving…', gear.classList.contains('expanded') && status.textContent === 'Saving…', status.textContent);
  ok('no toast element any more', !d.getElementById('settings-toast'));

  // success
  w.classdashBridgeResult(posted[0].id, { ok: true, rejected: [], pending: ['exclusions'], mode: 'redraw' });
  ok('gear says Saved.', gear.classList.contains('expanded') && status.textContent === 'Saved.', status.textContent);
  const collapse = timers.length; 
  ok('reload scheduled at 1500ms (redraw only, no 30s wait)', timers.includes(1500) && !timers.includes(30000), JSON.stringify(timers));
  w.toggleSettingsPanel(); w.toggleSettingsPanel();
  ok('baseline moved: reopening/closing sends nothing more', posted.length === 1, String(posted.length));

  // failure -> panel comes back with the reason
  w.toggleSettingsPanel();
  boxes[1] ? (boxes[1].checked = true) : (boxes[0].checked = false);
  w.toggleSettingsPanel();
  ok('second edit sends a second save', posted.length === 2);
  w.classdashBridgeResult(posted[1].id, { ok: false, why: 'disk is full' });
  ok('failed save reopens the panel', panel.hidden === false);
  ok('...with the reason in the panel', d.getElementById('settings-result').textContent === 'Save failed: disk is full', d.getElementById('settings-result').textContent);
  ok('...and the gear collapses while the panel is open', !gear.classList.contains('expanded') && status.textContent === '');
  const reloadsBefore = timers.filter(t => t === 1500).length;
  ok('...and no reload that would wipe the panel', reloadsBefore === 1, JSON.stringify(timers));

  // closing again retries (still dirty)
  w.toggleSettingsPanel();
  ok('closing again retries the save', posted.length === 3);

  // some fields refused
  w.classdashBridgeResult(posted[2].id, { ok: true, rejected: ['freshCheckAsleepMinutes: needs at least 10'], accepted: ['exclusions'] });
  ok('partial refusal reopens the panel', panel.hidden === false);
  ok('...naming what was refused', /freshCheckAsleepMinutes/.test(d.getElementById('settings-result').textContent));
  ok('...without reloading', timers.filter(t => t === 1500).length === reloadsBefore, JSON.stringify(timers));
  ok('...and still dirty, so closing retries', w.settingsDirty() === true);
}

// ---------- pending banner + its button ----------
{
  const { w, d, posted, timers } = load();
  ok('banner absent when nothing pending', !d.getElementById('pending-banner'));
}
process.exit(process.exitCode || 0);
