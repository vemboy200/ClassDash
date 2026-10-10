// A Classroom class renamed by its teacher (43-class-renames.js): same id,
// new name, so everything saved under the old name follows it instead of a
// second class appearing. Made-up classes only.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const OLD = 'Made-up Period 2 Chemistry';
const NEW = 'Made-up Chemistry (2nd)';
const LINKED_OLD = 'Made-up Period 4 History';
const LINKED_NEW = 'Made-up History 26-27';
const OTHER = 'Made-up Art';
const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const T1 = Date.now() - 864e5, T2 = Date.now() - 3600e3;

(async () => {
  const r = require(path.join(T.makeProject({ 'settings.json': { language: 'en' } }), '43-class-renames.js'));

  // ── which name became which ──
  {
    const before = [{ id: 'c1', name: OLD }, { id: 'c2', name: OTHER }];
    let m = r.renamesBetween(before, [{ id: 'c1', name: NEW }, { id: 'c2', name: OTHER }]);
    ok('same id, new name: a rename', m.size === 1 && m.get(OLD) === NEW);
    ok('nothing renamed: nothing', r.renamesBetween(before, before).size === 0);
    ok('a new class isn\'t a rename', r.renamesBetween(before, [...before, { id: 'c3', name: 'Made-up New' }]).size === 0);
    ok('a name that\'s only the id isn\'t a rename', r.renamesBetween(before, [{ id: 'c1', name: 'c1' }, { id: 'c2', name: OTHER }]).size === 0);
    m = r.renamesBetween(before, [{ id: 'c1', name: OTHER }, { id: 'c2', name: OTHER }]);
    ok('a name two classes now share isn\'t followed', m.size === 0);
    m = r.renamesBetween(before, [{ id: 'c1', name: OTHER }, { id: 'c2', name: OLD }]);
    ok('two classes swapping names aren\'t followed', m.size === 0);
    ok('no old list: nothing', r.renamesBetween([], [{ id: 'c1', name: NEW }]).size === 0);
  }

  // ── through the collector's class list, with a stand-in Classroom page ──
  const proj = T.makeProject({
    'settings.json': {
      language: 'en', email: 'a@b',
      exclusions: [OLD],
      classLinks: [{ name: 'History', classes: [LINKED_OLD, 'Made-up History Canvas'] }],
      filterUnchecked: { cls: [OLD, 'History'], type: [], days: [] },
    },
    'fetch-applied.json': { exclusions: [OLD] },
    'classes.json': [{ id: 'c1', name: OLD, teacher: 'Made-up Teacher', teacherAt: new Date().toISOString() }, { id: 'c4', name: LINKED_OLD }, { id: 'c2', name: OTHER }],
    'class-activity.json': { [OLD]: T1, [OTHER]: T2 },
    'last-collection.json': [
      { class: OLD, id: 'a1', type: 'Assignment', title: 'Made-up Lab', due: null, due_iso: soon(2), link: 'x' },
      { class: LINKED_OLD, id: 'a2', type: 'Assignment', title: 'Made-up Essay', due: null, due_iso: soon(3), link: 'x' },
      { class: OTHER, id: 'a3', type: 'Assignment', title: 'Made-up Sketch', due: null, due_iso: soon(4), link: 'x' },
    ],
    'messages.json': [{ id: 'p1', class: OLD, text: 'Made-up post', date: 'Oct 1', sortTime: Date.now(), link: 'x' }],
    'new.json': { assignments: [{ id: 'a1', class: OLD }], announcements: [] },
    'school-schedule.json': { type: 'daily', classes: [{ class: OLD, period: 2, days: 'all' }, { class: 'History', period: 4, days: 'all' }] },
    'virtual-assignments.json': [{ id: 'v1', class: OLD, title: 'Made-up reminder', created: new Date().toISOString() }],
  });
  process.chdir(proj);
  const draft = require(path.join(proj, '05-playwright-draft.js'));
  const listed = [{ id: 'c1', name: NEW }, { id: 'c4', name: LINKED_NEW }, { id: 'c2', name: OTHER }];
  const page = {
    goto: async () => {}, url: () => 'https://classroom.google.com/u/0/h', waitForSelector: async () => {}, waitForTimeout: async () => {},
    evaluate: async fn => /labels/.test(String(fn)) ? listed : 3,
  };
  const selected = await draft.resolveClasses(page);
  const read = n => JSON.parse(fs.readFileSync(path.join(proj, n), 'utf8'));

  ok('the renamed class stays excluded this very pass', !selected.some(c => c.name === NEW) && selected.some(c => c.name === OTHER), JSON.stringify(selected.map(c => c.name)));
  const s = read('settings.json');
  ok('exclusions follow the new name', JSON.stringify(s.exclusions) === JSON.stringify([NEW]));
  ok('...and what the last collection used, so nothing looks pending', JSON.stringify(read('fetch-applied.json').exclusions) === JSON.stringify([NEW]) &&
    !require(path.join(proj, '19-settings.js')).pendingFetchKeys().includes('exclusions'));
  ok('a link\'s class follows, the link keeps its name', s.classLinks[0].name === 'History' && s.classLinks[0].classes.includes(LINKED_NEW) && !s.classLinks[0].classes.includes(LINKED_OLD));
  ok('the class filter follows an unlinked class, a link\'s name stays', JSON.stringify(s.filterUnchecked.cls) === JSON.stringify([NEW, 'History']));
  ok('the teacher stays (kept by id)', read('classes.json').find(c => c.id === 'c1').teacher === 'Made-up Teacher' && read('classes.json').find(c => c.id === 'c1').name === NEW);
  const act = read('class-activity.json');
  ok('class activity moves, so it isn\'t stale or brand new', act[NEW] === T1 && !(OLD in act) && act[OTHER] === T2);
  const items = read('last-collection.json');
  ok('assignments move to the new name', items.find(x => x.id === 'a1').class === NEW && items.find(x => x.id === 'a2').class === LINKED_NEW && items.find(x => x.id === 'a3').class === OTHER);
  ok('announcements and the new marks move too', read('messages.json')[0].class === NEW && read('new.json').assignments[0].class === NEW);
  const sched = read('school-schedule.json');
  ok('the schedule follows an unlinked class, a link\'s name stays', sched.classes[0].class === NEW && sched.classes[1].class === 'History');
  ok('reminders follow', read('virtual-assignments.json')[0].class === NEW);
  ok('the class list has the new names', JSON.stringify(read('classes.json').map(c => c.name)) === JSON.stringify([NEW, LINKED_NEW, OTHER]));

  // The page: one class, under the new name, no orphan left behind.
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  ok('the page has no trace of the old name', !html.includes(OLD) && !html.includes(LINKED_OLD) && html.includes('Made-up Lab'));

  // A second read with nothing renamed changes nothing.
  const before = fs.readFileSync(path.join(proj, 'settings.json'), 'utf8');
  await draft.resolveClasses(page);
  ok('nothing renamed: settings untouched', fs.readFileSync(path.join(proj, 'settings.json'), 'utf8') === before);
})();
