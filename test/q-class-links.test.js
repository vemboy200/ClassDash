// Q's classes in class links (Settings → Classes): linked to their Classroom
// class, a Q class's grade goes with it, to the Grades list, the Grades AI
// (with that class's upcoming work) and /api/classes. Made-up classes only.
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

const BIO_Q = 'Made-up Biology (1111A)';
const BIO_CR = 'Made-up Bio Classroom';
const ART_Q = 'Made-up Art (3333C)';
const LONE_Q = 'Made-up Unlinked (2222B)';
const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const now = new Date().toISOString();

const proj = T.makeProject({
  'settings.json': {
    language: 'en', email: 'a@b', canvas: '', showEmptyClasses: false,
    gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user',
    aiProvider: 'ollama', aiModel: 'made-up:1b',
    classLinks: [{ name: 'Biology', classes: [BIO_CR, BIO_Q] }, { name: 'Art', classes: [ART_Q] }],
    gradesWeights: { [BIO_Q]: { 'Made-up Labs': 40 } },
  },
  'classes.json': [{ id: 'b', name: BIO_CR }, { id: 'h', name: 'Made-up History' }],
  'grades.json': { checkedAt: now, triedAt: now, ok: true, classes: [
    { period: '1', class: BIO_Q, grade: 'B', percent: 85, term: 'S1', assignments: [
      { title: 'Made-up Lab', due: '2026-10-01', category: 'Made-up Labs', score: 9, possible: 10, percent: 90 },
      { title: 'Made-up Test', due: '2026-10-03', category: 'Made-up Tests', score: 40, possible: 50, percent: 80 }] },
    { period: '2', class: LONE_Q, grade: 'A', percent: 95, term: 'S1', assignments: [] },
    { period: '3', class: ART_Q, grade: 'P', percent: null, term: 'S1', assignments: [] },
  ] },
  'last-collection.json': [
    { class: BIO_CR, id: 'c1', type: 'Assignment', title: 'Made-up Unit 3 Test', due: null, due_iso: soon(3), link: 'x' },
    { class: 'Made-up History', id: 'c2', type: 'Assignment', title: 'Made-up Essay', due: null, due_iso: soon(2), link: 'x' },
  ],
});
process.chdir(proj);
const grades = require(path.join(proj, '40-grades.js'));
const center = require(path.join(proj, '41-grades-center.js'));
const api = require(path.join(proj, '17-api.js'));

// ── the grades list ──
{
  const view = grades.gradesView();
  const bio = view.classes.find(c => c.source === 'q' && c.period === '1');
  const lone = view.classes.find(c => c.period === '2');
  ok('a linked Q class goes by the link name, with Q\'s own as sourceClass', bio.class === 'Biology' && bio.sourceClass === BIO_Q, JSON.stringify(bio));
  ok('an unlinked one is as Q names it, with no sourceClass', lone.class === LONE_Q && !('sourceClass' in lone));
  ok('typed-in weights still found by Q\'s own name', center.centerData().find(c => c.class === 'Biology').typedWeights['Made-up Labs'] === 40);
}

// ── the API ──
{
  const roster = api.HANDLERS['/api/classes'](api.gather());
  const bio = roster.find(c => c.name === 'Biology');
  ok('/api/classes: the linked class carries Q\'s grade', bio && bio.grade && bio.grade.source === 'q' && bio.grade.letter === 'B' && bio.grade.percent === 85 && bio.grade.term === 'S1' && !!bio.grade.checkedAt, JSON.stringify(bio));
  ok('...and lists Q\'s class among its members', bio.classes.includes(BIO_Q) && bio.classes.includes(BIO_CR));
  ok('a class with no grade has grade null', roster.find(c => c.name === 'Made-up History').grade === null);
  const art = roster.find(c => c.name === 'Art');
  ok('a linked Q class is there with nothing due, showEmptyClasses off', !!art && art.dueSoon === 0 && art.grade.letter === 'P' && art.grade.percent === null, JSON.stringify(roster.map(c => c.name)));
  ok('an unlinked Q class isn\'t a class here', !roster.some(c => c.name === LONE_Q));
  const g = api.HANDLERS['/api/grades'](api.gather());
  ok('/api/grades: the link name, Q\'s own as sourceClass', g.classes.some(c => c.class === 'Biology' && c.sourceClass === BIO_Q));
}

// ── the Grades AI ──
{
  const classes = center.centerData();
  const text = center.gradesText(classes);
  const bioPart = text.split('\n\n').find(p => p.startsWith('Biology'));
  ok('the AI sees a linked class\'s upcoming work', /Coming up in this class/.test(bioPart) && /Made-up Unit 3 Test \(Google Classroom\)/.test(bioPart), bioPart);
  ok('...and not other classes\' work under it', !/Made-up Essay/.test(bioPart));
  ok('an unlinked Q class has no upcoming list', !/Coming up/.test(text.split('\n\n').find(p => p.startsWith(LONE_Q))));
  const typed = { [BIO_Q]: { 'Made-up Labs': 40 } };
  const r = center.takeWeights('Done.\nWEIGHTS: {"Biology": {"Made-up Tests": 60, "Made-up Labs": 40}}', 'tests are 60 and labs 40', classes, typed);
  ok('weights the AI gives by the link name are saved under Q\'s own', r.saved[BIO_Q] && r.saved[BIO_Q]['Made-up Tests'] === 60 && !r.saved.Biology, JSON.stringify(r.saved));
  ok('...and a typed one is left alone', r.kept.length === 1 && r.kept[0].class === BIO_Q);
}

// ── the page ──
{
  T.redraw(proj);
  const d = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { virtualConsole: new VirtualConsole() }).window.document;
  const boxes = [...d.querySelectorAll('#class-links .class-link-member')];
  ok('Settings → Classes offers Q\'s classes, marked Q', boxes.some(b => b.value === LONE_Q && /Q$/.test(b.parentNode.textContent.trim())));
  ok('...and a linked one is ticked in its link', boxes.some(b => b.value === BIO_Q && b.checked));
  ok('...but not a Classroom class twice or marked Q', boxes.filter(b => b.value === BIO_CR).every(b => !/Q$/.test(b.parentNode.textContent.trim())));
  const rows = [...d.querySelectorAll('#grades-section .grade-class')].map(r => r.textContent.trim());
  ok('the Grades list shows the link name', rows.includes('Biology') && !rows.includes(BIO_Q), JSON.stringify(rows));
  const form = d.querySelector('#grades-center .gc-weight-rows');
  ok('the weights form saves under Q\'s own name, filled in', form && form.dataset.class === BIO_Q && form.querySelector('[data-cat="Made-up Labs"]').value === '40');
}
