// Locked Canvas work: what Canvas says about a lock, where locked work goes
// (ahead, whatever its due date), closed work (overdue, marked closed, with
// hide and a delete that's for good), the API, and the page.
// The class and assignments are made up.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);

// ── what Canvas says ──
const { lockOf } = require(path.join(proj, '10-canvas.js'));
ok('open work has no lock', lockOf({ locked_for_user: false, unlock_at: '2026-10-09T15:00:00Z' }) === null);
ok('an "available from" date', JSON.stringify(lockOf({ locked_for_user: true, unlock_at: '2026-10-09T15:00:00Z', lock_info: { unlock_at: '2026-10-09T15:00:00Z' } })) ===
  '{"unlockAt":"2026-10-09T15:00:00Z","lockAt":null,"module":null}');
ok('a module to finish first', lockOf({ locked_for_user: true, lock_info: { context_module: { name: 'Made-up Unit 2' } } }).module === 'Made-up Unit 2');
ok('an "available until" date', lockOf({ locked_for_user: true, lock_at: '2026-09-30T06:59:00Z' }).lockAt === '2026-09-30T06:59:00Z');

// ── where it goes ──
const draft = require(path.join(proj, '05-playwright-draft.js'));
const { sortIntoBuckets, lockState } = draft;
// The API buckets against the clock, so everything here is relative to it.
const now = new Date();
const at = (days, hours = 0) => new Date(+now + days * 864e5 + hours * 36e5).toISOString();
const item = (id, due, lock) => ({ platform: 'Canvas', class: 'Made-up Art', id: `canvas-${id}`, type: 'Assignment', title: `Made-up ${id}`,
  link: `http://x/${id}`, due_iso: due, due: null, lock });

ok('a lock whose "available from" date has passed since the check is open', lockState(item(1, null, { unlockAt: at(-1), lockAt: null, module: null }), now) === null);
ok('...one still ahead says when', lockState(item(1, null, { unlockAt: at(1), lockAt: null, module: null }), now).why === 'opens');
ok('...a module wins over a passed date', lockState(item(1, null, { unlockAt: at(-1), lockAt: null, module: 'M' }), now).why === 'module');
ok('...no reason at all is still locked', lockState(item(1, null, { unlockAt: null, lockAt: null, module: null }), now).why === 'locked');

const items = [
  item('opens', at(2), { unlockAt: at(1), lockAt: at(9), module: null }),          // due in 2 days, but not open till tomorrow
  item('module', null, { unlockAt: null, lockAt: null, module: 'Made-up Unit 2' }), // no due date
  item('closed', at(-2), { unlockAt: null, lockAt: at(-1), module: null }),
  item('closed-undated', null, { unlockAt: null, lockAt: at(-3), module: null }),
  item('opened', at(2), { unlockAt: at(0, -2), lockAt: null, module: null }),       // opened 2 hours ago
  item('plain', at(10), null),
];
let b = sortIntoBuckets(items, now);
const ids = list => list.map(x => x.id.replace('canvas-', '')).join();
ok('locked work isn\'t due soon, even when its date is close', !b.burning.some(x => x.locked) && ids(b.burning) === 'opened', ids(b.burning));
ok('...it waits ahead, by due date, undated after the dated', ids(b.later) === 'opens,plain,module', ids(b.later));
ok('...saying why', b.later[0].locked.why === 'opens' && +b.later[0].locked.at === +new Date(at(1)) && b.later[2].locked.module === 'Made-up Unit 2');
ok('closed work is with the overdue, marked closed', ids(b.overdue) === 'closed,closed-undated' && b.overdue.every(x => x.locked.why === 'closed'), ids(b.overdue));
ok('...dated by its due date, or when it closed', +b.overdue[0].due_at === +new Date(at(-2)) && +b.overdue[1].due_at === +new Date(at(-3)));
ok('...and it can be hidden like any overdue work', sortIntoBuckets(items, now, new Set(), new Set(['canvas-closed'])).overdue[0].hidden === true);

// ── delete, for good ──
const actions = require(path.join(proj, '21-notifier-actions.js'));
fs.writeFileSync(path.join(proj, 'скрытые.txt'), 'canvas-closed\n');
const del = actions.main('deleteAssignment', 'canvas-closed');
b = sortIntoBuckets(items, now, new Set(), draft.readHiddenIds());
ok('deleting takes it out of everything', del.ok && ids(b.overdue) === 'closed-undated' &&
  ![...b.burning, ...b.later, ...b.undated, ...b.deferred, ...b.done].some(x => x.id === 'canvas-closed'), ids(b.overdue));
ok('...and off the hidden list too', !draft.readHiddenIds().has('canvas-closed'));
ok('...with no id, nothing', actions.main('deleteAssignment', '').ok === false);
fs.writeFileSync(draft.DELETED_FILE, '');

// ── the API ──
fs.writeFileSync(path.join(proj, 'last-collection.json'), JSON.stringify(items));
const api = require(path.join(proj, '17-api.js'));
const ahead = api.HANDLERS['/api/ahead']({ ...api.gather(), now });
const opens = ahead.find(x => x.id === 'canvas-opens');
ok('/api/ahead says why locked work is locked', opens && opens.locked.why === 'opens' && opens.locked.at === new Date(at(1)).toISOString() &&
  ahead.find(x => x.id === 'canvas-plain').locked === null, JSON.stringify(opens));
ok('/api/due-soon leaves it out', !api.HANDLERS['/api/due-soon']({ ...api.gather(), now }).some(x => x.locked));
const overdue = api.HANDLERS['/api/overdue']({ ...api.gather(), now });
ok('/api/overdue marks closed work', overdue.find(x => x.id === 'canvas-closed').locked.why === 'closed');

// ── the page (drawn "now", so the dates are around today) ──
(async () => {
  const real = new Date();
  const around = (days, hours = 0) => new Date(+real + days * 864e5 + hours * 36e5).toISOString();
  fs.writeFileSync(path.join(proj, 'last-collection.json'), JSON.stringify([
    item('opens', around(2), { unlockAt: around(1), lockAt: around(9), module: null }),
    item('module', null, { unlockAt: null, lockAt: null, module: 'Made-up Unit 2' }),
    item('closed', around(-2), { unlockAt: null, lockAt: around(-1), module: null }),
    item('late', around(-2), null),
  ]));
  T.redraw(proj);
  const errors = [], sent = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  let answer = false;
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.confirm = () => answer; w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } }; } });
  await sleep(300);
  const d = dom.window.document;
  const row = id => d.querySelector(`.row[data-id="canvas-${id}"]`);
  const badge = id => (row(id) && row(id).querySelector('.lock-badge') || {}).textContent || '';
  ok('locked work shows ahead, not due soon', row('opens') && row('opens').dataset.sect === 'ahead' && row('module').dataset.sect === 'ahead',
    row('opens') && row('opens').dataset.sect);
  ok('...with when it opens', /^locked · opens /.test(badge('opens')), badge('opens'));
  ok('...or which module comes first', badge('module') === 'locked · finish “Made-up Unit 2” first', badge('module'));
  ok('closed work is overdue, marked closed', row('closed') && row('closed').dataset.sect === 'overdue' && /closed/.test(badge('closed')));
  const delLink = r => r && [...r.querySelectorAll('a.quiet')].find(a => /deleteAssignment/.test(a.getAttribute('href')));
  ok('...with hide and delete; other overdue work has no delete', delLink(row('closed')) &&
    [...row('closed').querySelectorAll('a.quiet')].some(a => /napominalka:\/\/hide\//.test(a.getAttribute('href'))) && !delLink(row('late')));
  delLink(row('closed')).click();
  ok('backing out of delete leaves it', row('closed') && !sent.some(m => m.action === 'deleteAssignment'));
  answer = true;
  delLink(row('closed')).click();
  const s = sent.find(m => m.action === 'deleteAssignment');
  ok('delete asks, then goes at once and tells the app', !row('closed') && s && decodeURIComponent(s.arg) === 'canvas-closed', JSON.stringify(sent));
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();
})();
