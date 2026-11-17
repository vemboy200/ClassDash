// The settings panel: each change saves by itself (autoSave), closing saves
// what's left, the gear says so, failures reopen it.
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
  ok('no Save or Done button: leaving Settings saves it',
    d.querySelectorAll('#settings-panel button').length > 0 && !d.querySelector('.settings-actions button') &&
    ![...d.querySelectorAll('#settings-panel button')].some(b => /^(Done|Save)$/.test(b.textContent.trim())));

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
  ok('payload is the full snapshot (other keys present)', 'language' in sent && 'staleMonths' in sent && 'apiLan' in sent);
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

// ---------- each change saves by itself ----------
(async () => {
  const { w, d, posted, timers } = load();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  w.toggleSettingsPanel();
  const box = d.querySelector('#settings-panel [data-bool-key="treatUndatedAsUrgent"]');
  box.checked = !box.checked;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(450);
  const sent = posted.filter(m => m.action === 'config');
  ok('flipping a switch saves it right away, with Settings still open', sent.length === 1 && b64(sent[0].arg).treatUndatedAsUrgent === box.checked && !d.getElementById('settings-panel').hidden, JSON.stringify(sent.map(m => m.action)));
  w.classdashBridgeResult(sent[0].id, { ok: true, accepted: ['treatUndatedAsUrgent'], rejected: [] });
  ok('...says Saved', /^Saved/.test(d.getElementById('settings-result').textContent), d.getElementById('settings-result').textContent);
  ok('...and doesn\'t reload the page', !timers.includes(1500), JSON.stringify(timers));
  ok('...so leaving Settings has nothing left to save', w.settingsDirty() === false);

  const field = d.querySelector('#settings-panel input[type="text"][data-key]');
  field.value = field.value + '1';
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(450);
  ok('typing alone doesn\'t save each letter', posted.filter(m => m.action === 'config').length === 1);
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(450);
  ok('leaving the field (its change) saves it', posted.filter(m => m.action === 'config').length === 2);
  const last = posted.filter(m => m.action === 'config').pop();
  w.classdashBridgeResult(last.id, { ok: false, why: 'nope' });
  ok('a refused save says so in the open panel, which stays where it is', /nope/.test(d.getElementById('settings-result').textContent) && !d.getElementById('settings-panel').hidden);
})().then(async () => {
  // ---------- the two changes that ask first ----------
  const { w, d, posted } = load();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const asked = [];
  let answer = false;
  w.confirm = m => { asked.push(m); return answer; };
  const configs = () => posted.filter(m => m.action === 'config').length;
  const flip = (el, on) => { el.checked = on; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  w.toggleSettingsPanel();
  const lan = d.querySelector('[data-bool-key="apiLan"]');
  const mcp = d.querySelector('[data-bool-key="aiMcpGrades"]');

  lan.checked = true; w.settingsBaseline = JSON.stringify(w.collectSettings());
  w.lastClientCounts = null;
  flip(lan, false); await sleep(450);
  ok('network access off with nobody connected and no followers: no question, just saved', asked.length === 0 && configs() === 1);
  w.classdashBridgeResult(posted.filter(m => m.action === 'config')[0].id, { ok: true, accepted: ['apiLan'], rejected: [] });

  flip(lan, true); await sleep(450);
  w.classdashBridgeResult(posted.filter(m => m.action === 'config')[1].id, { ok: true, accepted: ['apiLan'], rejected: [] });
  ok('turning it on never asks', asked.length === 0);
  w.lastClientCounts = { followers: 0, browsers: 1, programs: 1, list: [{ kind: 'browser', name: 'Laptop' }, { kind: 'program', name: 'Home Assistant' }] };
  flip(lan, false); await sleep(450);
  ok('with something connected it asks, naming who', asked.length === 1 && /Turn off network access/.test(asked[0]) && /Connected now: Laptop, Home Assistant/.test(asked[0]), asked[0]);
  ok('...and No puts the switch back, saving nothing', lan.checked === true && configs() === 2);

  w.lastClientCounts = null;
  lan.setAttribute('data-followers', '1');
  flip(lan, false); await sleep(450);
  ok('with a computer following this one it asks too, even when it isn\'t connected right now', asked.length === 2 && /Computers following this one/.test(asked[1]) && !/Connected now/.test(asked[1]), asked[1]);
  answer = true;
  flip(lan, false); await sleep(450);
  ok('...and Yes saves it', lan.checked === false && configs() === 3);
  w.classdashBridgeResult(posted.filter(m => m.action === 'config')[2].id, { ok: true, accepted: ['apiLan'], rejected: [] });

  answer = false;
  flip(mcp, true); await sleep(450);
  ok('grades for other AI apps: asks before turning on', asked.length === 4 && /read your grades/.test(asked[3]) && mcp.checked === false && configs() === 3, asked[3]);
  answer = true;
  flip(mcp, true); await sleep(450);
  ok('...saved on Yes', mcp.checked === true && configs() === 4);
  w.classdashBridgeResult(posted.filter(m => m.action === 'config')[3].id, { ok: true, accepted: ['aiMcpGrades'], rejected: [] });
  flip(mcp, false); await sleep(450);
  ok('...and turning it off doesn\'t ask', asked.length === 5 && configs() === 5);
}).then(() => {

// ---------- pending banner + its button ----------
{
  const { w, d, posted, timers } = load();
  ok('banner absent when nothing pending', !d.getElementById('pending-banner'));
}
process.exit(process.exitCode || 0);
});
