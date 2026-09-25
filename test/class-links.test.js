// Class links (Settings → Classes): several platforms' classes shown as one,
// or one class under a nicer name — on the page, in the settings tab and in
// the home API. Display only: the real names stay underneath.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HIST_CR = 'Period 3 (U.S. History) Period 3';
const HIST_CANVAS = 'US History - Vardanyan';
const MATH = 'P1: Int 3B/Precalculus';
const ART = 'Art 1';
const links = [{ name: 'US History', classes: [HIST_CR, HIST_CANVAS] }, { name: 'Precalc', classes: [MATH] }];

const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const proj = T.makeProject({
  'settings.json': { language: 'en', email: 'a@b', canvas: '', showEmptyClasses: true, classLinks: links },
  'classes.json': [{ id: 'h', name: HIST_CR, teacher: 'Mr. Classroom', teacherAt: new Date().toISOString() }, { id: 'm', name: MATH }, { id: 'a', name: ART }],
  'canvas-classes.json': [{ name: HIST_CANVAS, teacher: 'Ms. Canvas' }],
  'last-collection.json': [
    { class: HIST_CR, id: 'c1', type: 'Assignment', title: 'Classroom homework', due: null, due_iso: soon(2), link: 'x' },
    { class: HIST_CANVAS, id: 'v1', type: 'Assignment', title: 'Canvas essay', due: null, due_iso: soon(3), link: 'x', platform: 'Canvas' },
    { class: MATH, id: 'm1', type: 'Assignment', title: 'Worksheet', due: null, due_iso: soon(1), link: 'x' },
  ],
  'messages.json': [{ id: 'p1', class: HIST_CANVAS, text: 'Quiz Friday', date: 'Sep 24', sortTime: Date.now(), link: 'x' }],
});
process.chdir(proj);
const cl = require(path.join(proj, '29-class-links.js'));
const settings = require(path.join(proj, '19-settings.js'));

// ── the mapping ──
{
  const map = cl.linkMap(links);
  ok('a linked class takes the link name', cl.linkedName(HIST_CANVAS, map) === 'US History');
  ok('an unlinked class keeps its own', cl.linkedName(ART, map) === ART);
  const items = cl.linkItems([{ class: HIST_CR, id: 1 }, { class: ART, id: 2 }], map);
  ok('items get the linked name and keep the real one as sourceClass', items[0].class === 'US History' && items[0].sourceClass === HIST_CR);
  ok('unlinked items are left exactly as they were', items[1].class === ART && !('sourceClass' in items[1]));
  ok('names come out linked, once', cl.linkedClassNames([HIST_CR, ART, HIST_CANVAS], map).join('|') === `US History|${ART}`);
  const teachers = cl.linkedTeachers(new Map([[HIST_CR, 'Mr. C'], [HIST_CANVAS, 'Ms. V, Mr. C']]), map);
  ok('a link lists every member\'s teachers once', teachers.get('US History') === 'Mr. C, Ms. V', teachers.get('US History'));
  const status = cl.linkedStatus(new Map([[HIST_CR, 'orphaned'], [HIST_CANVAS, 'known']]), map);
  ok('a link is known if any member is', status.get('US History') === 'known');
  ok('membersOf: a link\'s real classes, or just the name', cl.membersOf('US History', links).length === 2 && cl.membersOf(ART, links)[0] === ART);
}

// ── the setting ──
{
  const v = (x) => settings.validate('classLinks', x);
  ok('JSON from the page is accepted, trimmed, blank rows dropped',
    JSON.stringify(v('[{"name":" A ","classes":["x","x"]},{"name":"","classes":[]}]').value) === '[{"name":"A","classes":["x"]}]');
  ok('a class in two links is refused', !v([{ name: 'A', classes: ['x'] }, { name: 'B', classes: ['x'] }]).ok);
  ok('two links with the same name are refused', !v([{ name: 'A', classes: ['x'] }, { name: 'A', classes: ['y'] }]).ok);
  ok('a link with no classes is refused', !v([{ name: 'A', classes: [] }]).ok);
  ok('a link with no name is refused', !v([{ name: '', classes: ['x'] }]).ok);
  ok('one class alone is fine (a rename)', v([{ name: 'Nice', classes: ['Messy name'] }]).ok);
}

// ── the page ──
cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: proj });
const { JSDOM, VirtualConsole } = T.jsdom();

(async () => {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.webkit = { messageHandlers: { classdash: { postMessage() {} } } }; } });
  await sleep(300);
  const w = dom.window, d = w.document;

  const filterRows = [...d.querySelectorAll('.filters input[data-group="cls"]')].map(b => b.value);
  ok('the class filter lists linked names once', filterRows.includes('US History') && filterRows.includes('Precalc') &&
    !filterRows.includes(HIST_CR) && !filterRows.includes(HIST_CANVAS) && !filterRows.includes(MATH), filterRows.join(' | '));
  ok('an unlinked class still shows under its own name', filterRows.includes(ART), filterRows.join(' | '));
  const count = d.querySelector('.filters input[data-group="cls"][value="US History"]').closest('label').querySelector('.count-badge').textContent;
  ok('the linked class counts both platforms\' work', count === '2', count);
  const cards = [...d.querySelectorAll('.row[data-cls="US History"]')];
  ok('both cards carry the linked name', cards.length === 2 && cards.every(c => c.querySelector('.cls').textContent === 'US History'), cards.length);
  const teacher = cards[0].querySelector('.teacher');
  ok('the teacher line lists both platforms\' teachers', teacher && teacher.textContent === 'Mr. Classroom, Ms. Canvas', teacher && teacher.textContent);
  ok('announcements take the linked name too', !!d.querySelector('.post[data-cls="US History"]'));
  ok('the exclusions picker keeps real names (exclusions are per platform class)',
    [...d.querySelectorAll('input[data-key="exclusions"]')].map(b => b.value).includes(HIST_CR));

  // ── the Classes tab ──
  const field = d.getElementById('class-links-value');
  ok('the hidden field holds the saved links', JSON.stringify(JSON.parse(field.value)) === JSON.stringify(links), field.value);
  ok('opening the page is not an unsaved change', w.settingsDirty() === false);
  const rows = () => [...d.querySelectorAll('#class-links .class-link')];
  ok('one row per link', rows().length === 2);
  ok('a row\'s dropdown is labelled with its classes', rows()[0].querySelector('.link-summary').textContent === `${HIST_CR}, ${HIST_CANVAS}`);
  const box = (row, name) => [...row.querySelectorAll('.class-link-member')].find(b => b.value === name);
  ok('a class in one link is greyed out in the others', box(rows()[1], HIST_CR).disabled && !box(rows()[1], ART).disabled);
  ok('...but not in its own row', !box(rows()[0], HIST_CR).disabled);
  ok('the row checkboxes are not settings of their own', !d.querySelector('.class-link-member[data-key]'));

  w.addClassLink();
  ok('New link adds an empty row', rows().length === 3 && rows()[2].querySelector('.class-link-name').value === '');
  ok('...and a blank row changes nothing yet', w.settingsDirty() === false);
  rows()[2].querySelector('.class-link-name').value = 'Art';
  box(rows()[2], ART).checked = true;
  w.updateClassLinks();
  ok('naming it and ticking a class puts it in the setting', JSON.parse(field.value)[2].name === 'Art' && JSON.parse(field.value)[2].classes[0] === ART, field.value);
  ok('...which counts as an unsaved change', w.settingsDirty() === true);
  ok('...and greys that class out in the other rows', box(rows()[0], ART).disabled);
  const payload = w.collectSettings();
  ok('the save sends it as the classLinks setting', settings.validate('classLinks', payload.classLinks).value.length === 3, payload.classLinks);
  w.removeClassLink(rows()[2].querySelector('button'));
  ok('Remove takes it out again', rows().length === 2 && JSON.parse(field.value).length === 2 && w.settingsDirty() === false);
  ok('the page script runs clean', errors.length === 0, errors.join(' | '));

  // ── the home API ──
  const api = require(path.join(proj, '17-api.js'));
  const g = api.gather();
  const roster = api.HANDLERS['/api/classes'](g);
  const hist = roster.find(c => c.name === 'US History');
  ok('/api/classes has one entry for the link', !!hist && !roster.some(c => c.name === HIST_CR || c.name === HIST_CANVAS), roster.map(c => c.name).join(' | '));
  ok('...counting both platforms', hist && hist.dueSoon + hist.ahead === 2, JSON.stringify(hist));
  ok('...listing its real classes', hist && JSON.stringify(hist.classes) === JSON.stringify([HIST_CR, HIST_CANVAS]));
  ok('...with both teachers', hist && hist.teacher === 'Mr. Classroom, Ms. Canvas', hist && hist.teacher);
  ok('an unlinked class lists just itself', JSON.stringify((roster.find(c => c.name === ART) || {}).classes) === JSON.stringify([ART]));
  const all = [...api.HANDLERS['/api/due-soon'](g), ...api.HANDLERS['/api/ahead'](g)];
  const essay = all.find(x => x.title === 'Canvas essay');
  ok('items carry the linked class and the platform\'s own', essay && essay.class === 'US History' && essay.sourceClass === HIST_CANVAS, JSON.stringify(essay));
  const art = api.HANDLERS['/api/announcements'](g)[0];
  ok('announcements too', art.class === 'US History' && art.sourceClass === HIST_CANVAS);
  ok('/api/status counts linked classes', api.HANDLERS['/api/status'](g).classes === 3, api.HANDLERS['/api/status'](g).classes);

  // ── a class in a link that the automatic hiding skips (skipStaleClasses) ──
  // Staleness is per real class: the link stays while any member is active.
  {
    const ARTS = [{ name: 'Arts', classes: [ART, 'Band'] }];
    const cls = JSON.parse(fs.readFileSync('classes.json', 'utf8'));
    fs.writeFileSync('classes.json', JSON.stringify([...cls, { id: 'b', name: 'Band' }]));
    const s = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
    fs.writeFileSync('settings.json', JSON.stringify({ ...s, skipStaleClasses: true, staleMonths: 1, classLinks: [...links, ...ARTS] }));
    const longAgo = Date.now() - 400 * 864e5;
    const names = () => api.HANDLERS['/api/classes'](api.gather()).map(c => c.name);
    fs.writeFileSync('class-activity.json', JSON.stringify({ [ART]: longAgo, Band: Date.now() }));
    ok('one member gone quiet: the link still shows', names().includes('Arts'), names().join(' | '));
    fs.writeFileSync('class-activity.json', JSON.stringify({ [ART]: longAgo, Band: longAgo }));
    ok('every member gone quiet: the link is skipped like any quiet class', !names().includes('Arts'), names().join(' | '));
    ok('...and the link itself is left as the user made it', settings.read().classLinks.some(l => l.name === 'Arts' && l.classes.length === 2));
    fs.writeFileSync('class-activity.json', '{}');
    fs.writeFileSync('settings.json', JSON.stringify(s));
  }

  // ── reminders follow a renamed or removed link ──
  {
    const renames = cl.renamesAfter(links, [{ name: 'History', classes: [HIST_CR, HIST_CANVAS] }]);
    ok('renamed: the new link sharing its classes', renames.get('US History') === 'History');
    ok('removed: its first real class', renames.get('Precalc') === MATH);
    ok('a link that stays by name is not moved', !cl.renamesAfter(links, links).size);

    const reminders = require(path.join(proj, '24-virtual-assignments.js'));
    for (const [title, c] of [['Study for quiz', 'US History'], ['Bring calculator', 'Precalc'], ['Sketchbook', ART], ['No class', '']]) {
      reminders.create({ title, class: c, due: '' });
    }
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const notifier = require(path.join(proj, '21-notifier-actions.js'));
    const r = notifier.main('config', b64({ classLinks: [{ name: 'History', classes: [HIST_CR, HIST_CANVAS] }] }));
    ok('saving renamed links works', r && r.ok, JSON.stringify(r));
    const byTitle = Object.fromEntries(reminders.readAll().map(v => [v.title, v.class]));
    ok('a reminder under a renamed link follows it', byTitle['Study for quiz'] === 'History', byTitle['Study for quiz']);
    ok('a reminder under a removed link goes back to its real class', byTitle['Bring calculator'] === MATH, byTitle['Bring calculator']);
    ok('other reminders are untouched', byTitle['Sketchbook'] === ART && !byTitle['No class'], JSON.stringify(byTitle));
    notifier.main('config', b64({ classLinks: [{ name: 'History', classes: [HIST_CR, HIST_CANVAS] }] }));
    ok('saving without a link change moves nothing', reminders.readAll().find(v => v.title === 'Study for quiz').class === 'History');
  }

  dom.window.close();
  process.exit(process.exitCode || 0);
})();
