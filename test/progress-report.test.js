// Q's progress report (42-progress-report.js): the term list, picking the
// term, reading the PDF, putting its assignments with the page's, and the
// category weights typed in for it (gradesWeights). A made-up report laid
// out the way Q's are: positioned text, wrapped categories, a score and its
// percent run together into one piece of text.
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

function pdfFile(content) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 613 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(out + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const text = (x, y, s, size = 8) => `BT /F1 ${size} Tf ${x} ${y} Td (${s.replace(/[()\\]/g, m => '\\' + m)}) Tj ET`;
// One assignment row: due, category, title, max, then score and percent as one run, like Q's.
const row = (y, due, cat, title, max, score, pct, flag) => [text(19, y, due), text(76, y, cat), text(220, y, title),
  max === null ? '' : text(372, y, max), score === null ? '' : text(408, y, pct === null ? score : `${score} ${pct}`), flag ? text(flag === 'EC' ? 486 : 500, y, 'X') : ''].join('\n');
const REPORT = pdfFile([
  text(20, 766, 'Print Date: 10/10/2026'), text(236, 762, 'Student Progress Report', 12),
  text(21, 727, 'Student: Made-up, Student (123456)', 11), text(535, 727, 'Grade: 10', 11),
  text(21, 710, 'Class: 1111A-1 Made-up Biology'), text(454, 710, 'Dates: 8/12/2026 - 12/18/2026'),
  text(20, 673, 'Current 1st Semester Progress Grade: B (85.0%) (Pts: 85.0/100.0)'),
  text(207, 661, 'Based on Assignments From: 8/12/2026 To 12/18/2026'),
  text(21, 648, 'Due Date'), text(78, 648, 'Category'), text(222, 648, 'Assignment'), text(371, 648, 'Max'), text(399, 648, 'Score'), text(443, 648, 'Pct'), text(484, 648, 'EC NG'), text(542, 648, 'Class Avg'),
  row(633, '9/2/2026', 'Tests/Quizzes (Semester)', 'Made-up Cell Test', '50.0', '40.0', '80.0%'),
  row(619, '9/9/2026', 'Practice/Classwork', 'Made-up Lab One', '10.0', '10.0', '100.0%'),
  text(76, 607, '(Semester)'),
  row(594, '9/16/2026', 'Practice/Classwork', 'Made-up Lab Two that wraps onto', '10.0', '6.0', '60.0%'),
  text(76, 582, '(Semester)'), text(220, 582, 'a second line'),
  row(569, '9/20/2026', 'Practice/Classwork', 'Made-up Bonus', '5.0', '5.0', '100.0%', 'EC'),
  text(76, 557, '(Semester)'),
  row(544, '10/1/2026', 'Tests/Quizzes (Semester)', 'Made-up Quiz', '20.0', null, null),
  // A long title run together with its numbers in one piece of text, the way PDF.js joins them.
  text(19, 532, '10/2/2026'), text(76, 532, 'Practice/Classwork'), text(220, 532, 'Made-up Mmmmmmmm Wwwwwwww Lab  10.0  9.0  90.0%'),
  text(76, 524, '(Semester)'),
  // A rubric score Q counts by its percent, the class average beside it, and the teacher's comment under it.
  row(512, '10/3/2026', 'Practice/Classwork', 'Made-up Rubric Task', '4.0', '3.5', '75.0%'), text(556, 512, '95.0%'),
  text(226, 500, '3 Points'),
  // Dropped by the teacher: it says so under the row.
  row(488, '10/4/2026', 'Tests/Quizzes (Semester)', 'Made-up Dropped Quiz', '10.0', null, null), text(562, 488, '70.0%'),
  text(226, 476, '< Assignment Dropped >'),
  // Points with nothing possible: extra.
  row(464, '10/5/2026', 'Practice/Classwork', 'Made-up Bonus Points', null, '2.0', null),
  text(458, 440, 'EC = Extra Credit | NG = Not Graded', 8),
  text(22, 420, 'Missing Scores:'), text(155, 420, 'Due Date'), text(224, 420, 'Category'), text(375, 420, 'Assignment'), text(566, 420, 'Note'),
  text(155, 406, '9/16/2026'), text(224, 406, 'Practice/Classwork'), text(375, 406, 'Made-up Lab Two that wraps onto'), text(566, 406, 'Late'),
  text(22, 390, 'Number of Missing Assignments:'), text(188, 390, '1'),
  text(23, 370, 'Class Grading Scale:'),
  text(204, 350, 'A'), text(350, 350, '90.0'), text(204, 336, 'B'), text(350, 336, '80.0'), text(204, 322, 'C'), text(350, 322, '70.0'), text(204, 308, 'D'), text(350, 308, '60.0'), text(204, 294, 'F'), text(353, 294, '0.0'),
].join('\n'));

const TERMS = `<center><div><b><label id="lblprogressreportterms">Progress Report Terms</label></b><br>
<table id="tbltermlist" class="txtin3 displaytbl"><thead><tr class="lightHighlight"><th><b><label id="lblterm">Term</label></b></th><th><b><label id="lblbegindate">Begin Date</label></b></th><th><b><label id="lblenddate">End Date</label></b></th><th><b><label id="lblgrade">Grade</label></b></th><td></td></tr></thead>
<tbody>
<tr><td>5 Week Progress - Fall</td><td>08/12/2026</td><td>09/15/2026</td><td>A  (95.0%)</td><td><a href="JavaScript:PrintProgress2(777,'P1');"><label id="lblprintprogressreport">Print Progress Report</label></a></td></tr>
<tr><td>1st Quarter</td><td>08/12/2026</td><td>10/16/2026</td><td>B  (85.0%)</td><td><a href="JavaScript:PrintProgress2(777,'Q1');"><label>Print Progress Report</label></a></td></tr>
<tr><td>1st Semester</td><td>08/12/2026</td><td>12/18/2026</td><td>B  (85.0%)</td><td><a href="JavaScript:PrintProgress2(777,'S1');"><label>Print Progress Report</label></a></td></tr>
<tr><td>No link here</td><td>08/12/2026</td><td>12/18/2026</td><td></td><td></td></tr>
</tbody></table></div></center>`;

(async () => {
  const on = { language: 'en', gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user', aiProvider: 'none' };
  const proj = T.makeProject({ 'settings.json': on });
  process.chdir(proj);
  const report = require(path.join(proj, '42-progress-report.js'));
  const grades = require(path.join(proj, '40-grades.js'));
  const settings = require(path.join(proj, '19-settings.js'));

  // ── the term list ──
  const terms = report.parseTermList(new JSDOM(TERMS).window.document);
  ok('terms: name, dates, grade, and the print link\'s id and code; a row without a link is skipped', terms.length === 3 &&
    JSON.stringify(terms[1]) === JSON.stringify({ name: '1st Quarter', begin: '2026-08-12', end: '2026-10-16', grade: 'B', percent: 85, id: '777', code: 'Q1' }), JSON.stringify(terms));
  ok('...it stands on its own, for running inside Q\'s page', (0, eval)('(' + report.parseTermList.toString() + ')')(new JSDOM(TERMS).window.document).length === 3);
  ok('the term on today, the longest: the semester', report.chooseTerm(terms, new Date('2026-10-10T12:00:00Z')).code === 'S1');
  ok('...between terms, the one that ended last', report.chooseTerm(terms.slice(0, 2), new Date('2026-11-01T12:00:00Z')).code === 'Q1');
  ok('...no terms: none', report.chooseTerm([], new Date()) === null);

  // ── the PDF ──
  const r = await report.readReportPdf(REPORT);
  ok('the grade line: letter, percent, Q\'s points, and the term\'s range', r && r.grade === 'B' && r.percent === 85 && r.earned === 85 && r.possible === 100 && r.from === '2026-08-12' && r.to === '2026-12-18', JSON.stringify(r && { ...r, assignments: undefined }));
  const a = r.assignments;
  ok('every row, in order', a.length === 9 && a.map(x => x.title).join('|') === 'Made-up Cell Test|Made-up Lab One|Made-up Lab Two that wraps onto a second line|Made-up Bonus|Made-up Quiz|Made-up Mmmmmmmm Wwwwwwww Lab|Made-up Rubric Task|Made-up Dropped Quiz|Made-up Bonus Points', a.map(x => x.title).join('|'));
  ok('...the line under a row is the teacher\'s comment, not more title', a[6].comment === '3 Points' && a[6].title === 'Made-up Rubric Task' && a[2].comment === null, JSON.stringify(a[6]));
  ok('...the Class Avg column isn\'t the student\'s percent', a[6].percent === 75 && a[6].score === 3.5 && a[6].possible === 4 && a[7].percent === null, JSON.stringify(a[6]));
  ok('...< Assignment Dropped > marks it dropped', a[7].dropped && !a[6].dropped && a[7].comment === null);
  ok('...points with nothing possible', a[8].score === 2 && a[8].possible === null);
  ok('...numbers run together with a long title still land in their columns', a[5].possible === 10 && a[5].score === 9 && a[5].percent === 90, JSON.stringify(a[5]));
  ok('...a wrapped category joins its second line', a[1].category === 'Practice/Classwork (Semester)' && a[0].category === 'Tests/Quizzes (Semester)', a.map(x => x.category).join('|'));
  ok('...score and percent run together are split, and Max read as points possible', a[0].possible === 50 && a[0].score === 40 && a[0].percent === 80 && a[2].score === 6 && a[2].percent === 60, JSON.stringify(a[0]));
  ok('...extra credit marked', a[3].extraCredit && !a[0].extraCredit);
  ok('...not graded yet: no score', a[4].score === null && a[4].possible === 20 && a[4].due === '2026-10-01');
  ok('missing work, from its own table (the note column left out)', r.missing.length === 1 && r.missing[0].title === 'Made-up Lab Two that wraps onto' && r.missing[0].due === '2026-09-16', JSON.stringify(r.missing));
  ok('the grading scale, as percent cutoffs', r.scale.length === 5 && report.scaleCutoffs(r.scale)[0].letter === 'A' && report.letterFor(85, r.scale) === 'B' && report.letterFor(10, r.scale) === 'F');
  ok('...a GPA scale (4.0 for an A) isn\'t used as cutoffs', report.scaleCutoffs([{ letter: 'A', min: 4 }, { letter: 'B', min: 3 }]) === null && report.letterFor(85, [{ letter: 'A', min: 4 }]) === null);
  ok('not a report: null', await report.readReportPdf(pdfFile(text(20, 700, 'Something else entirely'))) === null);

  // ── with the page's assignments ──
  const page = [
    { title: 'Made-up Cell Test', due: '2026-09-02', assigned: '2026-08-30', possible: 50, score: 40, scoreText: '40', percent: 80, comment: 'Made-up good work', missing: false, id: '11' },
    { title: 'Made-up Newer Thing', due: '2026-10-09', assigned: '2026-10-05', possible: 10, score: null, scoreText: null, percent: null, comment: null, missing: false, id: '12' },
  ];
  const merged = report.mergeAssignments(page, r);
  ok('the report\'s list, with the page\'s comment and id where they match', merged.length === 10 && merged[0].comment === 'Made-up good work' && merged[0].id === '11' && merged[0].category === 'Tests/Quizzes (Semester)' && merged[0].assigned === '2026-08-30');
  ok('...the report\'s missing table marks its row missing', merged.find(x => /Lab Two/.test(x.title)).missing === true && !merged[0].missing);
  ok('...the page\'s newer work the report doesn\'t have is kept', merged[9].title === 'Made-up Newer Thing' && merged[9].category === undefined);
  ok('...extra credit carried over', merged[3].extraCredit === true);
  ok('...no report: the page as it was', report.mergeAssignments(page, null) === page);
  ok('...Q\'s points from the percent where the score says otherwise; the report\'s comment where the page has none', merged[6].points === 3 && merged[6].score === 3.5 && merged[6].comment === '3 Points' && !('points' in merged[0]));
  ok('...dropped work doesn\'t count', merged[7].omitted && merged[7].dropped);
  const est0 = grades.estimateGrade({ weighting: { weighted: false, groups: [{ id: 'c', weight: 0, dropLowest: 0, dropHighest: 0, neverDrop: [] }] }, assignments: [merged[6], merged[7], merged[8]].map(x => ({ ...x, group: 'c' })) });
  ok('...the math: Q\'s points, dropped left out, extra points added', est0 && Math.abs(est0.percent - (3 + 2) / 4 * 100) < 0.01, JSON.stringify(est0));

  // ── typed-in weights ──
  // The long-title row only tests reading; the weights math below goes without it.
  const forWeights = merged.filter(x => !/Mmmm|Rubric|Dropped Quiz|Bonus Points/.test(x.title));
  ok('settings: weights per class and category, 0-100, blanks left out', JSON.stringify(settings.validate('gradesWeights', { 'Made-up Biology': { 'Tests/Quizzes (Semester)': '70', 'Practice/Classwork (Semester)': 30, 'Blank': '' }, 'Empty': { 'X': '' } }).value) ===
    JSON.stringify({ 'Made-up Biology': { 'Tests/Quizzes (Semester)': 70, 'Practice/Classwork (Semester)': 30 } }));
  ok('...a weight over 100, or not a number: refused', !settings.validate('gradesWeights', { A: { B: 101 } }).ok && !settings.validate('gradesWeights', { A: { B: 'lots' } }).ok && !settings.validate('gradesWeights', '[1]').ok);
  const cls = { class: 'Made-up Biology', grade: 'B', percent: 85, assignments: forWeights, report: { percent: 85 } };
  // Tests 40/50 = 80%; Classwork 10+6+5(EC) over 20 = 105%. 70/30: 56 + 31.5 = 87.5.
  let est = grades.typedEstimate(cls, { 'Tests/Quizzes (Semester)': 70, 'Practice/Classwork (Semester)': 30 });
  ok('weights typed in: the grade worked out from them, extra credit adding points only', est && Math.abs(est.percent - 87.5) < 0.01 && est.typed && est.weighted, JSON.stringify(est));
  ok('...and it says they don\'t land on Q\'s grade', est.matches === false);
  est = grades.typedEstimate(cls, { 'Tests/Quizzes (Semester)': 80, 'Practice/Classwork (Semester)': 20 });
  ok('...weights that do give Q\'s grade: matches', Math.abs(est.percent - 85) < 0.01 && est.matches === true, JSON.stringify(est));
  ok('...a category left without a weight: no estimate', grades.typedEstimate(cls, { 'Tests/Quizzes (Semester)': 80 }) === null && grades.typedEstimate(cls, undefined) === null);
  ok('...no grade from Q to check against: matches is null', grades.typedEstimate({ ...cls, percent: null, report: null }, { 'Tests/Quizzes (Semester)': 80, 'Practice/Classwork (Semester)': 20 }).matches === null);

  // ── on the page ──
  fs.writeFileSync(path.join(proj, 'grades.json'), JSON.stringify({ ok: true, triedAt: new Date().toISOString(), checkedAt: new Date().toISOString(),
    classes: [{ period: '1', class: 'Made-up Biology', code: '1111A', grade: 'B', percent: 85, term: '1st Semester', assignments: forWeights, report: { term: '1st Semester', from: '2026-08-12', to: '2026-12-18', grade: 'B', percent: 85, earned: 85, possible: 100, scale: r.scale } },
      { period: '2', class: 'Made-up No Report', grade: 'A', percent: 95, term: '1st Semester', assignments: [{ title: 'Made-up x', due: '2026-10-01', possible: 5, score: 5, percent: 100, missing: false, id: '9' }] }] }));
  const draw = () => {
    T.redraw(proj);
    const posted = [];
    const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; win.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; } }).window;
    return { w, d: w.document, posted };
  };
  let { w, d, posted } = draw();
  let bio = [...d.querySelectorAll('.gc-class')].find(x => /Made-up Biology/.test(x.querySelector('summary').textContent));
  ok('the center says where the list comes from', /progress report: 1st Semester/.test(bio.querySelector('.gc-report').textContent));
  const inputs = [...bio.querySelectorAll('.gc-weights input[data-cat]')];
  ok('a box per category to type its weight, open while none are set', inputs.length === 2 && inputs[0].getAttribute('data-cat') === 'Tests/Quizzes (Semester)' && bio.querySelector('.gc-weights').open && !bio.querySelector('.gc-estimate'));
  ok('...each assignment shows its category', /Tests\/Quizzes \(Semester\)/.test(bio.querySelector('.gc-cat').textContent));
  ok('a class with no categories gets no weights box', ![...d.querySelectorAll('.gc-class')].find(x => /No Report/.test(x.textContent)).querySelector('.gc-weights'));
  inputs[0].value = '200';
  bio.querySelector('.gc-weights button').click();
  ok('a weight over 100: says so, saves nothing', /0 to 100/.test(bio.querySelector('.gc-weights-status').textContent) && !posted.length);
  inputs[0].value = '80'; inputs[1].value = '20';
  bio.querySelector('.gc-weights button').click();
  const sent = posted.find(m => m.action === 'config');
  ok('Save sends the weights for this class', sent && JSON.stringify(JSON.parse(Buffer.from(sent.arg, 'base64url').toString())) === JSON.stringify({ gradesWeights: { 'Made-up Biology': { 'Tests/Quizzes (Semester)': 80, 'Practice/Classwork (Semester)': 20 } } }), sent && Buffer.from(sent.arg, 'base64url').toString());
  w.close();

  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...on, gradesWeights: { 'Made-up Biology': { 'Tests/Quizzes (Semester)': 80, 'Practice/Classwork (Semester)': 20 }, 'Made-up Other': { X: 50 } } }));
  ({ w, d, posted } = draw());
  bio = [...d.querySelectorAll('.gc-class')].find(x => /Made-up Biology/.test(x.querySelector('summary').textContent));
  ok('saved: the estimate, and that it\'s Q\'s grade exactly', /With your weights: 85%\. That's Q's own grade exactly/.test(bio.querySelector('.gc-estimate').textContent) && !bio.querySelector('.gc-weights').open && inputs.length);
  ok('...the boxes show the saved weights', bio.querySelector('input[data-cat="Tests/Quizzes (Semester)"]').value === '80');
  bio.querySelector('.gc-weights-clear').click();
  const cleared = posted.find(m => m.action === 'config');
  ok('Clear removes only this class\'s weights', cleared && JSON.stringify(JSON.parse(Buffer.from(cleared.arg, 'base64url').toString())) === JSON.stringify({ gradesWeights: { 'Made-up Other': { X: 50 } } }));
  w.close();
  const view = grades.gradesView().classes[0];
  ok('/api/grades has the estimate for a Q class with weights', view.estimate && view.estimate.typed && view.estimate.matches === true && !('assignments' in view));
  const aiText = require(path.join(proj, '41-grades-center.js')).gradesText(require(path.join(proj, '41-grades-center.js')).centerData());
  ok('the AI reads the categories, the typed weights and whether they check out, and the report', /Categories \(weighted\): Tests\/Quizzes \(Semester\) weight 80%/.test(aiText) && /typed in by the student; they reproduce Q's grade exactly/.test(aiText) &&
    /progress report for 1st Semester/.test(aiText) && /Made-up Cell Test \[Tests\/Quizzes \(Semester\)\]/.test(aiText), aiText);

  // ── the AI filling in weights from what the student pastes ──
  const center = require(path.join(proj, '41-grades-center.js'));
  const typedOne = { 'Made-up Biology': { 'Tests/Quizzes (Semester)': 80 } };
  const ai = { ...settings.read(), aiProvider: 'ollama', gradesWeights: typedOne };
  ok('the AI is told which categories have no weight yet', /Category weights the student has typed in: Tests\/Quizzes \(Semester\) 80%; Practice\/Classwork \(Semester\) \(no weight yet\)/.test(center.gradesText(center.centerData(ai))) && /WEIGHTS:/.test(center.SYSTEM));
  const writes = [];
  const fakeWrite = (k, v) => { writes.push([k, v]); return { ok: true }; };
  const reply = text => async () => ({ ok: true, text });
  let said = await center.ask('Syllabus: tests 50%, classwork 20%', { s: ai, write: fakeWrite, complete: reply('Got it, saving those.\nWEIGHTS: {"made-up biology": {"practice/classwork (semester)": 20, "Tests/Quizzes (Semester)": 50, "Made-up Nowhere": 20}, "Made-up Not A Class": {"X": 20}}') });
  ok('only the blank category is saved, matched whatever the case; the typed one is left alone', writes.length === 1 && writes[0][0] === 'gradesWeights' &&
    JSON.stringify(writes[0][1]) === JSON.stringify({ 'Made-up Biology': { 'Tests/Quizzes (Semester)': 80, 'Practice/Classwork (Semester)': 20 } }) &&
    JSON.stringify(said.savedWeights) === JSON.stringify({ 'Made-up Biology': { 'Practice/Classwork (Semester)': 20 } }), JSON.stringify(writes));
  ok('...the WEIGHTS line is taken out, and the answer says what was saved and what was kept', !/WEIGHTS/.test(said.answer) && /^Got it, saving those\./.test(said.answer) &&
    /Saved as category weights for Made-up Biology: Practice\/Classwork \(Semester\) 20%/.test(said.answer) && /Left alone, since you'd already entered them: Tests\/Quizzes \(Semester\)/.test(said.answer) && !/WEIGHTS/.test(center.readChat().slice(-1)[0].text), said.answer);
  writes.length = 0;
  said = await center.ask('What should the weights be?', { s: ai, write: fakeWrite, complete: reply('Maybe these.\nWEIGHTS: {"Made-up Biology": {"Practice/Classwork (Semester)": 20}}') });
  ok('a weight the student never gave is not saved', !writes.length && !said.savedWeights && said.answer === 'Maybe these.', said.answer);
  said = await center.ask('Classwork is 20', { s: ai, write: fakeWrite, complete: reply('WEIGHTS: not json\nWEIGHTS: {"Made-up Biology": {"Practice/Classwork (Semester)": 120}}') });
  ok('...nor a broken line, or a weight over 100', !writes.length && !said.savedWeights && said.answer === '…', said.answer);
  said = await center.ask('Made-up 20?', { s: { ...ai, gradesWeights: {} }, write: fakeWrite, complete: reply('Fine.') });
  ok('no WEIGHTS line: nothing saved', !writes.length && said.answer === 'Fine.');
})().catch(e => { console.log('FAIL crashed', e.stack); process.exitCode = 1; });
