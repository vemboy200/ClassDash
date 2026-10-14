// Grade history and grade alerts: a point kept per change, an alert per
// change of a grade a class goes by (or only drops, or none), the ▲/▼ in
// the Grades list and the chart in the Grades center. Made-up classes.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '', gradesProvider: 'q' }, 'last-collection.json': [] });
process.chdir(proj);
const H = require(path.join(proj, '45-grade-history.js'));
const day = n => new Date(Date.UTC(2026, 8, 1) + n * 864e5);
const view = list => ({ classes: list });
const bio = (percent, grade, extra = {}) => ({ source: 'q', class: 'Made-up Biology', grade, percent, estimate: null, ...extra });

// ── record ──
ok('a first grade is kept but is no change', H.record(view([bio(91.2, 'A-')]), day(0)).length === 0 && H.readHistory().series['q:Made-up Biology'].points.length === 1);
const before = fs.readFileSync(H.FILE, 'utf8');
ok('the same grade again: nothing kept, file untouched', H.record(view([bio(91.2, 'A-')]), day(1)).length === 0 && fs.readFileSync(H.FILE, 'utf8') === before);
let ch = H.record(view([bio(88.4, 'B+')]), day(2));
ok('a change: kept, and answered', ch.length === 1 && ch[0].from.percent === 91.2 && ch[0].to.percent === 88.4 && ch[0].class === 'Made-up Biology', JSON.stringify(ch));
ok('...in words', H.changeText(ch[0], 'en-US') === 'Made-up Biology: 91.2% → 88.4% (A- → B+)', H.changeText(ch[0], 'en-US'));
ok('...and it\'s a drop', H.isDrop(ch[0]));
ch = H.record(view([bio(90, 'A-')]), day(3));
ok('going up is not a drop', ch.length === 1 && !H.isDrop(ch[0]));
ok('alerts: all / drops / off', H.alertsFor(ch, 'all').length === 1 && H.alertsFor(ch, 'drops').length === 0 && H.alertsFor(ch, 'off').length === 0);
// A linked class keeps its own series, by the place's own name.
ch = H.record(view([bio(90, 'A-'), { source: 'canvas', class: 'Made-up Biology', sourceClass: 'Bio - Made-up', grade: null, percent: 70, estimate: null, superseded: true }]), day(4));
ch = H.record(view([bio(90, 'A-'), { source: 'canvas', class: 'Made-up Biology', sourceClass: 'Bio - Made-up', grade: null, percent: 72, estimate: null, superseded: true }]), day(5));
ok('a superseded grade is kept under its own place and name, but never an alert', ch.length === 0 && H.readHistory().series['canvas:Bio - Made-up'].points.length === 2);
// Hidden percent: the estimate, marked.
H.record(view([{ source: 'canvas', class: 'Made-up Art', grade: null, percent: null, estimate: { percent: 95 } }]), day(4));
ch = H.record(view([{ source: 'canvas', class: 'Made-up Art', grade: null, percent: null, estimate: { percent: 93.5 } }]), day(5));
ok('a hidden percent goes by the estimate, with a ~', ch.length === 1 && ch[0].to.est && H.changeText(ch[0], 'en-US') === 'Made-up Art: ~95% → ~93.5%', ch[0] && H.changeText(ch[0], 'en-US'));
ok('letters only: a drop by letter', H.isDrop({ from: { percent: null, grade: 'B' }, to: { percent: null, grade: 'C+' } }) && !H.isDrop({ from: { percent: null, grade: 'P' }, to: { percent: null, grade: 'F' } }));
ok('historyByClass: the series a class goes by', H.historyByClass(view([bio(90, 'A-')]))['Made-up Biology'].length === 3);
fs.unlinkSync(H.FILE);

// ── after Q's check: history, alert, page ──
(async () => {
  const notes = path.join(proj, 'notes.jsonl');
  const env = { ...process.env, CLASSDASH_NOTIFY_TO: notes };
  const run = () => cp.spawnSync(process.execPath, ['05-playwright-draft.js', '--grades-read'], { cwd: proj, env, encoding: 'utf8' });
  const sent = () => fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const grades = list => fs.writeFileSync('grades.json', JSON.stringify({ checkedAt: new Date().toISOString(), triedAt: new Date().toISOString(), ok: true, classes: list }));
  const q = (cls, period, grade, percent) => ({ period, class: cls, grade, percent, term: 'S1', assignments: [] });

  grades([q('Made-up Biology', '1', 'A-', 91.2), q('Made-up Math', '2', 'B', 84)]);
  run();
  ok('the first read: history starts, no alert', sent().length === 0 && Object.keys(H.readHistory().series).length === 2);
  grades([q('Made-up Biology', '1', 'B+', 88.4), q('Made-up Math', '2', 'B', 84)]);
  run();
  let s = sent();
  ok('a grade drops: one notification', s.length === 1 && s[0].subtitle === 'A grade changed' && s[0].message === 'Made-up Biology: 91.2% → 88.4% (A- → B+)', JSON.stringify(s));
  fs.writeFileSync('settings.json', JSON.stringify({ language: 'en', email: 'a@b', canvas: '', gradesProvider: 'q', gradeAlerts: 'drops' }));
  grades([q('Made-up Biology', '1', 'B+', 88.4), q('Made-up Math', '2', 'B+', 86)]);
  run();
  ok('only drops: going up says nothing', sent().length === 1);
  grades([q('Made-up Biology', '1', 'B+', 88.4), q('Made-up Math', '2', 'B', 85)]);
  run();
  ok('...going down does', sent().length === 2 && /Made-up Math: 86% → 85%/.test(sent()[1].message));

  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; } });
  await sleep(300);
  const d = dom.window.document;
  const rows = [...d.querySelectorAll('#grades-section .grade-row')];
  const trend = name => { const r = rows.find(x => x.textContent.includes(name)); return r && r.querySelector('.grade-trend'); };
  ok('the Grades list marks a recent drop', trend('Made-up Math') && trend('Made-up Math').classList.contains('grade-down') && trend('Made-up Math').textContent === '▼1', trend('Made-up Math') && trend('Made-up Math').outerHTML);
  ok('...and a recent drop of the other', trend('Made-up Biology') && trend('Made-up Biology').textContent === '▼2.8');
  ok('...inside the mark, so Hide masks it', trend('Made-up Math').parentElement.classList.contains('grade-mark'));
  const charts = d.querySelectorAll('#grades-center .gc-history-chart');
  ok('the Grades center draws each class\'s history', charts.length === 2 && charts[0].querySelectorAll('circle').length >= 2, String(charts.length));
  ok('...with where it started and how often it changed', /Since .+: 84% → 85% \(2 changes\)/.test(d.querySelector('#grades-center').textContent.replace(/\s+/g, ' ')));
  const select = d.querySelector('select[data-key="gradeAlerts"]');
  ok('Settings → Grades has the alert choice, showing the saved one', select && select.value === 'drops' && select.options.length === 3);
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();
})();
