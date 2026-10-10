// Google Classroom grades (44-classroom-grades.js): read off each class's
// "View your work" page, and ranked under Q's and Canvas's (40-grades.js).
// Made-up classes, titles and scores; the page is a stand-in shaped like the
// real one (score and "/possible" as lines of their own, a status line, the
// to-do list's cards still in the document after the click).
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

const WORK_PAGE = `<main>
<div class="old-page" hidden><li data-stream-item-id="111"><div>Made-up Old To-do Card</div><div>Posted Sep 5</div></li>
<li data-stream-item-id="201"><div>Made-up Lab Report</div><div>Due Sep 12</div><div>Assigned</div></li></div>
<li data-stream-item-id="201"><div data-stream-item-id="201"><span>Made-up Lab Report</span></div>
  <div>Due Sep 12, 11:59 PM</div><div>Made-up label text here</div><div>18</div><div>/20</div><div>Not turned in</div><div>Made-up</div></li>
<li data-stream-item-id="202"><div>Made-up Essay</div><div>Due Sep 20</div><div>Turned in</div><div>Made-up</div></li>
<li data-stream-item-id="203"><div>Made-up Quiz</div><div>Made-up</div><div>2</div><div>Made-up label</div><div>Due Oct 1</div><div>9.5/10</div><div>Done late</div></li>
<li data-stream-item-id="204"><div>Made-up 10/7: Warm-up</div><div>Due Oct 7</div><div>Missing</div></li>
<li data-stream-item-id="205"><div>Made-up collapsed row with everything on one line</div></li>
</main>`;

(async () => {
  const now = new Date();
  const proj = T.makeProject({
    'settings.json': { language: 'en', email: 'a@b', canvas: '',
      gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user',
      classLinks: [{ name: 'Biology', classes: ['Made-up Bio Classroom', 'Made-up Biology (1111A)'] }] },
    'classes.json': [{ id: 'c1', name: 'Made-up Bio Classroom' }, { id: 'c2', name: 'Made-up Spanish' }],
    'grades.json': { checkedAt: now.toISOString(), triedAt: now.toISOString(), ok: true, classes: [
      { period: '1', class: 'Made-up Biology (1111A)', grade: 'B', percent: 85, term: 'S1', assignments: [] }] },
  });
  process.chdir(proj);
  const cg = require(path.join(proj, '44-classroom-grades.js'));
  const grades = require(path.join(proj, '40-grades.js'));

  // ── reading the work page ──
  const w = new JSDOM(WORK_PAGE, { runScripts: 'outside-only', virtualConsole: new VirtualConsole() }).window;
  // jsdom has no layout: visible here means not inside [hidden], like Chrome's checkVisibility().
  w.Element.prototype.checkVisibility = function () { return !this.closest('[hidden]'); };
  const entries = w.eval(`(${cg.workEntriesFromPage.toString()})()`);
  const by = id => entries.find(e => e.id === id);
  ok('the to-do list\'s hidden cards (even with the same id) and one-line rows are left out', !by('111') && !by('205') && entries.length === 4, JSON.stringify(entries.map(e => e.id)));
  ok('a graded one: the score line and the "/possible" line after it', by('201').score === 18 && by('201').possible === 20 && by('201').status === 'Not turned in' && by('201').title === 'Made-up Lab Report');
  ok('...its due line kept', by('201').due === 'Due Sep 12, 11:59 PM');
  ok('not graded yet: no score', by('202').score === null && by('202').possible === null && by('202').status === 'Turned in');
  ok('a lone count elsewhere isn\'t a score; "9.5/10" on one line is', by('203').score === 9.5 && by('203').possible === 10 && by('203').status === 'Done late', JSON.stringify(by('203')));
  ok('a date in the title isn\'t a score', by('204').score === null && by('204').status === 'Missing');
  ok('the nested id isn\'t read twice', entries.filter(e => e.id === '201').length === 1);

  // ── opening it from the to-do list ──
  {
    const calls = [];
    const page = {
      goto: async u => calls.push('goto ' + u.replace(/^https:\/\/classroom\.google\.com/, '')), url: () => 'https://classroom.google.com/u/0/w/c1/t/all',
      waitForSelector: async sel => calls.push('wait ' + sel), waitForTimeout: async () => {}, waitForURL: async re => calls.push('url ' + re),
      locator: sel => ({ first: () => ({ click: async () => calls.push('click ' + sel) }) }),
      evaluate: async fn => { if (fn === cg.workEntriesFromPage) { calls.push('read'); return entries; } },
    };
    const got = await cg.readClassroomWork(page, { id: 'c1', name: 'x' }, { U: 0, timeout: 1000 });
    ok('goes to the class\'s to-do list and clicks "View your work"', calls[0] === 'goto /u/0/w/c1/t/all' && calls.includes('click a[href*="/sp/"]'), JSON.stringify(calls));
    ok('...waits for the work page, and reads until it settles', calls.indexOf('url /\\/sp\\//') > calls.indexOf('click a[href*="/sp/"]') && calls.filter(c => c === 'read').length >= 3 && got === entries, JSON.stringify(calls));
  }

  // ── when, and what's kept ──
  ok('never read: due', cg.classesDue([{ id: 'c1' }], Date.now(), { classes: {} }).length === 1);
  ok('read 10 minutes ago: not due; over an hour: due', cg.classesDue([{ id: 'c1' }, { id: 'c2' }], Date.now(), { classes: {
    c1: { checkedAt: new Date(Date.now() - 6e5).toISOString() }, c2: { checkedAt: new Date(Date.now() - 2 * 3600e3).toISOString() } } }).map(c => c.id).join() === 'c2');
  ok('due dates: this year\'s unless Classroom gives one', cg.dueDate('Due Sep 12, 11:59 PM', new Date('2026-10-10T12:00')) === '2026-09-12' &&
    cg.dueDate('Due Dec 1, 2025') === '2025-12-01' && cg.dueDate('Posted Sep 1') === null && cg.dueDate(null) === null);

  cg.save(new Map([['c1', { name: 'Made-up Bio Classroom', entries }], ['gone', { name: 'Made-up Left Class', entries }]]));
  const points = cg.pointsOf(entries);
  ok('points added up over graded work only', points.graded === 2 && points.earned === 27.5 && points.possible === 30 && points.percent === 91.67, JSON.stringify(points));
  const classes = cg.gradeClasses();
  ok('only classes still on the class list', classes.length === 1 && classes[0].class === 'Made-up Bio Classroom' && classes[0].percent === 91.67);
  const a = classes[0].assignments;
  ok('assignments shaped like the others: due date, percent, missing, late', a[0].due === `${now.getFullYear()}-09-12` &&
    a[0].percent === 90 && a.find(x => x.title === 'Made-up 10/7: Warm-up').missing && a.find(x => x.title === 'Made-up Quiz').late);

  // ── Q first, then Canvas, then Classroom ──
  {
    const view = grades.gradesView();
    const bio = view.classes.filter(c => c.class === 'Biology');
    const q = bio.find(c => c.source === 'q'), room = bio.find(c => c.source === 'classroom');
    ok('a linked class has both, by the link name', !!q && !!room && room.sourceClass === 'Made-up Bio Classroom', JSON.stringify(view.classes));
    ok('Q\'s is the one it goes by; Classroom\'s is marked superseded', !q.superseded && room.superseded === true && room.percent === 91.67);
    ok('...and when the last read was', view.classroomCheckedAt && !isNaN(Date.parse(view.classroomCheckedAt)));
    const api = require(path.join(proj, '17-api.js'));
    const roster = api.HANDLERS['/api/classes'](api.gather());
    const entry = roster.find(c => c.name === 'Biology');
    ok('/api/classes takes Q\'s grade for it', entry && entry.grade.source === 'q' && entry.grade.percent === 85, JSON.stringify(entry));
    // Canvas over Classroom, with no Q.
    fs.writeFileSync(path.join(proj, 'grades.json'), JSON.stringify({ classes: [] }));
    fs.writeFileSync(path.join(proj, 'canvas-grades.json'), JSON.stringify({ checkedAt: now.toISOString(), classes: [{ class: 'Made-up Bio Canvas', grade: 'A-', percent: 91, assignments: [] }] }));
    const s = JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8'));
    s.canvas = 'https://made-up.instructure.example'; s.canvasToken = 'made-up-token';
    s.classLinks = [{ name: 'Biology', classes: ['Made-up Bio Classroom', 'Made-up Bio Canvas'] }];
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(s));
    const v2 = grades.gradesView().classes.filter(c => c.class === 'Biology');
    ok('no Q: Canvas\'s over Classroom\'s', v2.find(c => c.source === 'canvas') && !v2.find(c => c.source === 'canvas').superseded && v2.find(c => c.source === 'classroom').superseded, JSON.stringify(v2));
    // Back to Q for the page.
    fs.writeFileSync(path.join(proj, 'grades.json'), JSON.stringify({ checkedAt: now.toISOString(), triedAt: now.toISOString(), ok: true, classes: [
      { period: '1', class: 'Made-up Biology (1111A)', grade: 'B', percent: 85, term: 'S1', assignments: [] }] }));
    s.canvas = ''; s.classLinks = [{ name: 'Biology', classes: ['Made-up Bio Classroom', 'Made-up Biology (1111A)'] }];
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(s));
  }

  // ── the page ──
  {
    T.redraw(proj);
    const d = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { virtualConsole: new VirtualConsole() }).window.document;
    const rows = [...d.querySelectorAll('#grades-section .grade-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
    ok('the Grades list has the class once, with Q\'s grade', rows.length === 1 && /Biology/.test(rows[0]) && /85/.test(rows[0]) && !/91/.test(rows[0]), JSON.stringify(rows));
    const blocks = [...d.querySelectorAll('#grades-center .gc-class-name')].map(n => n.textContent.replace(/\s+/g, ' ').trim());
    ok('the Grades center still shows Classroom\'s assignments, marked Classroom', blocks.includes('Biology Classroom') && blocks.includes('Biology Q'), JSON.stringify(blocks));
    const text = require(path.join(proj, '41-grades-center.js')).gradesText(require(path.join(proj, '41-grades-center.js')).centerData());
    ok('the AI is told which grade the class goes by', /from Google Classroom \(not the grade this class goes by/.test(text) && /Made-up Lab Report/.test(text));
  }

  // Classroom off: none of its grades.
  const s = JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8'));
  s.classroomEnabled = false;
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(s));
  // Nothing graded yet: not in the list.
  cg.save(new Map([['c2', { name: 'Made-up Spanish', entries: [{ id: '9', title: 'Made-up', due: null, status: 'Turned in', score: null, possible: null }] }]]));
  ok('a Classroom class with nothing graded isn\'t listed', !grades.gradesView().classes.some(c => c.class === 'Made-up Spanish'));
  ok('Classroom off: no Classroom grades', !grades.gradesView().classes.some(c => c.source === 'classroom'));
})();
