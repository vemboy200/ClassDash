// Assignment links: the same work on two platforms shown as one card —
// merging, "1 of 2 done", the same-class rule, the page's link mode and
// the home API.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HIST = 'Period 3 (U.S. History)';
const HIST_EDP = 'Mr. V Edpuzzle';
const MATH = 'Precalculus';
const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const item = (id, cls, extra = {}) => ({ id, class: cls, type: 'Assignment', title: 'T ' + id, due: null, due_iso: soon(3), link: 'https://x/' + id, ...extra });

const ITEMS = [
  item('cr1', HIST, { title: 'Edpuzzle: Causes of WW1', due_iso: soon(2) }),
  item('edp1', HIST_EDP, { platform: 'Edpuzzle', title: 'Causes of WW1', removed: true, removedAt: new Date().toISOString() }),
  item('cr2', HIST, { title: 'Chapter 4 reading', due_iso: soon(4) }),
  item('m1', MATH, { title: 'Worksheet 2', due_iso: soon(1) }),
];
const proj = T.makeProject({
  'settings.json': { language: 'en', email: 'a@b', canvas: '', classLinks: [{ name: 'US History', classes: [HIST, HIST_EDP] }] },
  'classes.json': [{ id: 'h', name: HIST }, { id: 'm', name: MATH }],
  'last-collection.json': ITEMS,
});
process.chdir(proj);
const links = require(path.join(proj, '31-assignment-links.js'));
const { sortIntoBuckets } = require(path.join(proj, '05-playwright-draft.js'));
const settings = require(path.join(proj, '19-settings.js'));
const writeLinks = l => fs.writeFileSync('assignment-links.json', JSON.stringify(l));
const readLinks = () => JSON.parse(fs.readFileSync('assignment-links.json', 'utf8'));

// ── merging ──
{
  const m = links.mergeLinked(ITEMS, [{ items: ['cr1', 'edp1'] }]);
  const one = m.filter(x => x.id === 'cr1' || x.id === 'edp1');
  ok('a linked pair becomes one item, under the first id', one.length === 1 && one[0].id === 'cr1', one.map(x => x.id).join());
  ok('Edpuzzle handed in (disappeared) counts as done: 1 of 2', one[0].partsDone === 1 && one[0].partsTotal === 2);
  ok('...and the card still counts as open work, not removed', !one[0].removed && !one[0].allDone);
  ok('the first picked leads: its title and link', one[0].title === 'Edpuzzle: Causes of WW1' && one[0].link === 'https://x/cr1');
  ok('every part is listed', one[0].parts.map(p => `${p.id}:${p.done}`).join() === 'cr1:false,edp1:true');
  ok('unlinked items are untouched', m.find(x => x.id === 'm1') === ITEMS[3]);
}
{
  const done = [item('a', HIST, { type: 'Completed Assignment' }), item('b', HIST, { platform: 'Canvas', removed: true })];
  const m = links.mergeLinked(done, [{ items: ['a', 'b'] }])[0];
  ok('Classroom "Completed" + Canvas handed in: all done', m.allDone === true && m.partsDone === 2);
  writeLinks([{ items: ['a', 'b'] }]);
  const buckets = sortIntoBuckets(done, new Date());
  ok('...so it goes to done, not due soon', buckets.done.length === 1 && !buckets.burning.length && !buckets.later.length && !buckets.gone.length);
}
{
  const parts = [item('a', HIST, { type: 'Completed Assignment', due_iso: soon(1) }), item('b', HIST, { platform: 'Edpuzzle', type: 'Edpuzzle', due_iso: soon(5) })];
  const m = links.mergeLinked(parts, [{ items: ['a', 'b'] }])[0];
  ok('the leader done: due date and type come from the part still open', m.due_iso === parts[1].due_iso && m.type === 'Edpuzzle' && m.title === 'T a');
}
{
  const parts = [item('a', HIST, { removed: true }), item('b', HIST, { platform: 'Edpuzzle' })];
  const m = links.mergeLinked(parts, [{ items: ['a', 'b'] }])[0];
  ok('a Classroom part taken down by the teacher leaves the count', m.partsTotal === 1 && m.partsDone === 0 && !m.removed);
  const gone = links.mergeLinked([item('a', HIST, { removed: true }), item('b', HIST, { removed: true })], [{ items: ['a', 'b'] }])[0];
  ok('every part taken down: removed', gone.removed === true);
}
ok('only one part still around: shown as it is', links.mergeLinked([ITEMS[0]], [{ items: ['cr1', 'gone'] }])[0] === ITEMS[0]);

// ── linking and the same-class rule ──
writeLinks([]);
{
  const r = links.link('cr1', 'edp1');
  ok('a Classroom and an Edpuzzle class linked in Settings → Classes count as the same class', r.ok, JSON.stringify(r));
  ok('...refused across classes while "same class only" is on', !links.link('cr1', 'm1').ok);
  links.link('cr2', 'cr1');
  ok('linking to a card already in a link: the new card leads, the rest follow',
    JSON.stringify(readLinks()) === JSON.stringify([{ items: ['cr2', 'cr1', 'edp1'] }]), JSON.stringify(readLinks()));
  ok('unlinking undoes the whole link', links.unlink('edp1').ok && readLinks().length === 0);
  const s = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
  fs.writeFileSync('settings.json', JSON.stringify({ ...s, assignmentLinksSameClass: false }));
  ok('with the option off, any two can be linked', links.link('cr1', 'm1').ok);
  fs.writeFileSync('settings.json', JSON.stringify(s));
  ok('...and turning it back on leaves that link alone', readLinks().length === 1 && settings.read().assignmentLinksSameClass === true);
  ok('an assignment can\'t be linked to itself', !links.link('cr1', 'cr1').ok);
}

// ── the page ──
writeLinks([{ items: ['cr1', 'edp1'] }]);
require(path.join(proj, '24-virtual-assignments.js')).create({ title: 'Bring permission slip', class: HIST, due: '' });
cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: proj });
const { JSDOM, VirtualConsole } = T.jsdom();

(async () => {
  const errors = [], sent = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } }; } });
  await sleep(300);
  const w = dom.window, d = w.document;
  const row = id => d.querySelector(`.row[data-id="${id}"]`);

  ok('the linked pair is one card', !!row('cr1') && !row('edp1'));
  ok('...with a "1 of 2 done" pill', /1 of 2 done/.test(row('cr1').querySelector('.parts-badge').textContent));
  const also = row('cr1').querySelector('.quiet.also');
  ok('...and a link to the other part, beside the card', also && also.getAttribute('href') === 'https://x/edp1' && /Edpuzzle/.test(also.textContent), also && also.outerHTML);
  ok('...and Unlink', /unlinkAssignment/.test(row('cr1').innerHTML));
  ok('every card button sits in the hover-only overlay, not beside the card',
    !!row('m1').querySelector('.card-actions .link-start') && !!row('cr1').querySelector('.card-actions [onclick*="unlinkItem"]') &&
    !!row('cr1').querySelector('.card-actions .also') && !row('cr1').querySelector(':scope > .quiet:not(.link-here)'));
  const css = d.querySelector('style').textContent;
  ok('...which is collapsed until the card is hovered', /\.card-actions \{[^}]*grid-template-columns: 0fr[^}]*opacity: 0/.test(css) &&
    /\.row:hover \.card-actions[^{]*\{ grid-template-columns: 1fr/.test(css));
  ok('...slides and fades rather than popping', /\.card-actions \{[^}]*transition: grid-template-columns/.test(css));
  ok('...not for someone who asked for less motion', /prefers-reduced-motion: reduce\) \{ \.card-actions \{ transition: none/.test(css));
  ok('...and always open on a screen with no hover', /@media \(hover: none\) \{ \.card-actions \{ grid-template-columns: 1fr/.test(css));
  ok('"Link here" stays beside the card (seen without hovering while picking)', !!row('cr1').querySelector(':scope > .link-here'));
  const rem = d.querySelector('.row[data-title]');
  ok('reminder cards get the overlay too', !!rem && (!!rem.querySelector('.card-actions') && !rem.querySelector(':scope > .quiet')));

  const start = id => row(id).querySelector('.link-start');
  w.startLink(null, start('cr2'));
  ok('Link starts picking: the bar shows with the card\'s title', !d.getElementById('link-bar').hidden && /Chapter 4 reading/.test(d.getElementById('link-bar').textContent));
  ok('"Link here" is offered on the same class\'s cards', row('cr1').classList.contains('link-target'));
  ok('...not on another class\'s, nor on itself', !row('m1').classList.contains('link-target') && !row('cr2').classList.contains('link-target'));
  row('cr1').querySelector('.link-here').click();
  const msg = sent.find(m => m.action === 'linkAssignments');
  ok('Link here sends the first card, then this one', msg && msg.arg === 'cr2,cr1', JSON.stringify(msg));
  w.cancelLink();
  w.startLink(null, start('m1'));
  ok('a class with nothing to link with says so', /Settings → Classes/.test(d.getElementById('link-bar').textContent));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Esc stops picking', d.getElementById('link-bar').hidden && !d.body.classList.contains('linking') && !d.querySelector('.link-target'));
  w.unlinkItem(null, row('cr1').querySelector('[onclick*="unlinkItem"]'));
  const un = sent.find(m => m.action === 'unlinkAssignment');
  ok('Unlink sends the card\'s id', un && un.arg === 'cr1', JSON.stringify(un));
  ok('the page script runs clean', errors.length === 0, errors.join(' | '));
  dom.window.close();

  // ── the home API ──
  const api = require(path.join(proj, '17-api.js'));
  const g = api.gather();
  const cr1 = [...api.HANDLERS['/api/due-soon'](g), ...api.HANDLERS['/api/ahead'](g)].find(x => x.id === 'cr1');
  ok('an item carries its link: done, total, parts', cr1 && cr1.linked && cr1.linked.done === 1 && cr1.linked.total === 2 && cr1.linked.parts.length === 2, JSON.stringify(cr1 && cr1.linked));
  const m1 = [...api.HANDLERS['/api/due-soon'](g), ...api.HANDLERS['/api/ahead'](g)].find(x => x.id === 'm1');
  ok('...and null when it has none', m1 && m1.linked === null);
  ok('the linked Edpuzzle part isn\'t a separate item', !JSON.stringify(api.HANDLERS['/api/removed'](g)).includes('"edp1"'));
  const bad = api.WRITE_HANDLERS['/api/link']({ ids: ['cr2', 'm1'] });
  ok('/api/link refuses across classes', bad.status === 409 && bad.body.ok === false, JSON.stringify(bad));
  const good = api.WRITE_HANDLERS['/api/link']({ ids: ['cr2', 'cr1'] });
  ok('/api/link links in the same class', good.status === 200 && readLinks()[0].items.join() === 'cr2,cr1,edp1', JSON.stringify(readLinks()));
  ok('/api/link needs two ids', api.WRITE_HANDLERS['/api/link']({ ids: ['cr1'] }).status === 400);
  ok('/api/unlink undoes it', api.WRITE_HANDLERS['/api/unlink']({ id: 'cr2' }).status === 200 && readLinks().length === 0);
  ok('/api/unlink on something not linked: 404', api.WRITE_HANDLERS['/api/unlink']({ id: 'm1' }).status === 404);

  process.exit(process.exitCode || 0);
})();
