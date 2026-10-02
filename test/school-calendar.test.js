// The school calendar: reading a calendar PDF (month grids with drawn
// marks), what's saved, "by tomorrow" landing on the next school day, the
// month view, Settings → Calendar, and /api/calendar.
// The PDFs are made up here, drawn with plain PDF operators.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);
const { readCalendarPdf } = require(path.join(proj, '32-calendar-pdf.js'));
const cal = require(path.join(proj, '33-school-calendar.js'));

// ── A made-up calendar PDF ──
//
// September and October 2026, a grid each, Sunday first, 20pt cells. Marks:
//   circle    Sep 7 (drawn twice), Oct 12
//   slash     Oct 5, 6, 7 (filled slivers, like real calendars draw them)
//   triangle  Oct 23
//   18*  20X  as text after the day number
// plus a legend row, a stray "31" in September, and cross-hatching (a
// redaction) that mustn't be read as slashes.
function pdfFile(...pages) {
  const n = pages.length;
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [i, content] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 420] /Contents ${pageIds[i] + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

const text = (x, y, s, size = 9) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`;
const circle = (cx, cy, r = 8) => {
  const k = 0.55 * r;
  return `${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ` +
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c S`;
};
const slash = (cx, cy) => `${cx - 9} ${cy - 7} m ${cx - 7} ${cy - 7} l ${cx + 9} ${cy + 7} l ${cx + 7} ${cy + 7} l h f`;
const triangle = (cx, cy) => `${cx - 10} ${cy - 7} m ${cx + 10} ${cy - 7} l ${cx} ${cy + 8} l h S`;

function month(left, title, firstWeekday, days, opts = {}) {
  const parts = title ? [text(left + 30, 380, title, 11)] : [];
  const at = {};
  for (let d = 1; d <= days; d++) {
    const slot = firstWeekday + d - 1;
    const x = left + (slot % 7) * 20, y = 350 - Math.floor(slot / 7) * 20;
    parts.push(text(x, y, `${d}${(opts.suffix || {})[d] || ''}`));
    at[d] = [x + (d < 10 ? 2.5 : 5), y + 3];   // roughly the number's middle
  }
  return { parts, at };
}

const sep = month(40, 'September, 2026', 2, 30, { suffix: { 18: '*' } });
const oct = month(320, 'October, 2026', 4, 31, { suffix: { 20: 'X' } });
const CONTENT = [
  text(200, 405, 'Made-up Elementary', 14),
  ...sep.parts, ...oct.parts,
  text(40 + 6 * 20, 350 - 5 * 20, '31'),   // September has no 31st
  circle(...sep.at[7]), circle(...sep.at[7]),
  circle(...oct.at[12]),
  slash(...oct.at[5]), slash(...oct.at[6]), slash(...oct.at[7]),
  triangle(...oct.at[23]),
  // a redaction's cross-hatching over September's second week: one path, many strokes
  `${sep.at[13][0] - 8} ${sep.at[13][1] - 6} m ${sep.at[13][0] + 8} ${sep.at[13][1] + 6} l ${sep.at[13][0] - 8} ${sep.at[13][1] + 6} m ${sep.at[13][0] + 8} ${sep.at[13][1] - 6} l S`,
  // legend
  circle(48, 60), text(62, 57, 'State Holiday'),
  triangle(200, 60), text(214, 62, 'Staff Development Day'), text(214, 50, 'Students Not in Attendance'),
  text(400, 57, 'X', 11), text(412, 57, 'Minimum Day'),
  text(480, 57, '*', 11), text(490, 57, 'Student Holiday'), text(578, 57, 'TOTAL 180'),   // a note further along, not the legend
].join('\n');

// A second page, the next school year, written differently: the year only
// once at the top, a month cut short ("Sept"), one title in two pieces
// ("October," and "2027"), and a stray month name that's no title.
const sep27 = month(40, '', 3, 30);
const oct27 = month(320, '', 5, 31);
const PAGE_2 = [
  text(250, 405, 'School Year 2027-2028', 12),
  text(70, 380, 'Sept', 11),
  text(350, 380, 'October,', 11), text(394, 380, '2027', 11),
  ...sep27.parts, ...oct27.parts,
  circle(...sep27.at[6]),
  text(40, 120, 'March', 9), text(40, 100, '15', 9),
].join('\n');

// A third page with no school year anywhere: the two-piece title has to
// carry its own year.
const nov27 = month(40, '', 1, 30);
const PAGE_3 = [text(70, 380, 'November,', 11), text(145, 380, '2027', 11), ...nov27.parts, circle(...nov27.at[11])].join('\n');

// A fourth page: another school's calendar for the same months as page 1,
// with its own holiday. It mustn't be mixed into page 1's.
const sepB = month(40, 'September, 2026', 2, 30);
const PAGE_4 = [text(200, 405, 'Made-up Middle School', 14), ...sepB.parts, circle(...sepB.at[14])].join('\n');

const PDF = path.join(proj, 'made-up-calendar.pdf');
fs.writeFileSync(PDF, pdfFile(CONTENT, PAGE_2, PAGE_3, PAGE_4));
fs.writeFileSync(path.join(proj, 'blank.pdf'), pdfFile('0 0 m 100 100 l S'));
fs.writeFileSync(path.join(proj, 'not-a.pdf'), 'hello');

(async () => {
  // ── reading the PDF ──
  const r = await readCalendarPdf(PDF);
  ok('the PDF is read', r.ok, JSON.stringify(r).slice(0, 300));
  ok('every month on every page is found', r.months.join() === '2026-09,2026-10,2027-09,2027-10,2027-11', r.months.join());
  ok('...the second year\'s too, from "Sept" and the year at the top, and from a title in two pieces',
    (r.marks['2027-09-06'] || []).join() === 'circle' && (r.marks['2027-11-11'] || []).join() === 'circle', JSON.stringify(Object.keys(r.marks)));
  ok('a stray month name with no days under it isn\'t a month', !r.months.includes('2028-03'));
  ok('each page is its own calendar, named by its heading', r.pages.map(p => `${p.page}:${p.name}`).join() ===
    '1:Made-up Elementary,2:School Year 2027-2028,3:,4:Made-up Middle School', r.pages.map(p => `${p.page}:${p.name}`).join());
  ok('pages for other years are used together; another school\'s for the same months isn\'t', r.selected.join() === '1,2,3' && !r.marks['2026-09-14'],
    r.selected.join());
  const m = d => (r.marks[d] || []).join();
  ok('a circle lands on its day', m('2026-09-07') === 'circle' && m('2026-10-12') === 'circle', JSON.stringify(r.marks));
  ok('...once, though it was drawn twice', m('2026-09-07') === 'circle');
  ok('slashes land on their days', ['05', '06', '07'].every(d => m(`2026-10-${d}`) === 'slash'));
  ok('a triangle lands on its day', m('2026-10-23') === 'triangle');
  ok('X and * after a number are marks too', m('2026-09-18') === '*' && m('2026-10-20') === 'X');
  ok('nothing else got a mark (the hatching isn\'t a slash)', Object.keys(r.marks).length === 10 && r.pages.length === 4, Object.keys(r.marks).join());
  ok('a day number the month can\'t have is reported, not placed', r.warnings.length === 1 && /31/.test(r.warnings[0]) && !r.marks['2026-10-01'], JSON.stringify(r.warnings));
  const legend = Object.fromEntries(r.legend.map(l => [l.mark, l.text]));
  ok('the legend is read beside each mark', legend.circle === 'State Holiday' && legend.X === 'Minimum Day' && legend['*'] === 'Student Holiday', JSON.stringify(r.legend));
  ok('...stopping at a big gap, so a note further along the line isn\'t part of it', !/TOTAL/.test(JSON.stringify(r.legend)));
  ok('...including two-line legend text', legend.triangle === 'Staff Development Day Students Not in Attendance', legend.triangle);
  ok('a PDF with no text says so', (await readCalendarPdf(path.join(proj, 'blank.pdf'))).why === 'noText');
  ok('a file that isn\'t a PDF says so', (await readCalendarPdf(path.join(proj, 'not-a.pdf'))).why === 'unreadable');

  // ── meanings, saving, what a day is ──
  const guessed = cal.guessMeanings(r.legend);
  ok('meanings are guessed from the legend', guessed.circle === 'noSchool' && guessed.triangle === 'noSchool' &&
    guessed.X === 'minimumDay' && guessed['*'] === 'noSchool', JSON.stringify(guessed));
  const actions = require(path.join(proj, '21-notifier-actions.js'));
  const imported = await actions.main('importCalendarPdf', encodeURIComponent(PDF));
  ok('importCalendarPdf reads and saves at once, meanings guessed', imported.ok && imported.calendar.read.file === 'made-up-calendar.pdf' &&
    fs.existsSync(cal.FILE) && cal.readCalendar().pdf.meanings.circle === 'noSchool');
  ok('...and a mark with no legend is left for the user', imported.calendar.read.meanings.slash === 'ignore');
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const saved = actions.main('saveCalendar', b64({ meanings: { slash: 'noSchool' }, overrides: { '2026-10-07': 'normal', '2026-10-16': 'minimumDay', bad: 'x' } }));
  ok('saveCalendar saves a change on the saved calendar', saved.ok && cal.readCalendar().pdf.meanings.slash === 'noSchool', JSON.stringify(saved));
  const c = cal.readCalendar();
  ok('...and keeps only well-formed day changes', JSON.stringify(c.overrides) === '{"2026-10-07":"normal","2026-10-16":"minimumDay"}');
  ok('a marked day is what its mark means, with the legend as label', JSON.stringify(cal.dayInfo('2026-09-07', c)) === '{"date":"2026-09-07","kind":"noSchool","label":"State Holiday","events":[]}');
  ok('a day changed by hand wins over its mark', cal.dayInfo('2026-10-07', c).kind === null && cal.dayInfo('2026-10-16', c).kind === 'minimumDay');
  ok('X is a minimum day, which is still a school day', cal.dayInfo('2026-10-20', c).kind === 'minimumDay' && cal.isSchoolDay('2026-10-20', c));
  ok('weekends and no-school days aren\'t school days', !cal.isSchoolDay('2026-09-06', c) && !cal.isSchoolDay('2026-09-07', c) && cal.isSchoolDay('2026-09-08', c));
  ok('the next school day skips a 3-day weekend', cal.dayKey(cal.nextSchoolDay(new Date(2026, 8, 4, 15), c)) === '2026-09-08');
  ok('...and a run of no-school days', cal.dayKey(cal.nextSchoolDay(new Date(2026, 9, 2, 15), c)) === '2026-10-07');
  const resaved = actions.main('saveCalendar', b64({ meanings: { slash: 'ignore' } }));
  const switched = actions.main('saveCalendar', b64({ pages: [4] }));
  ok('choosing another page uses its marks instead', switched.ok && cal.dayInfo('2026-09-14').kind === 'noSchool' && cal.dayInfo('2026-09-07').kind === null &&
    cal.readCalendar().pdf.months.join() === '2026-09');
  ok('...and choosing no page at all is refused', actions.main('saveCalendar', b64({ pages: [] })).ok === false);
  actions.main('saveCalendar', b64({ pages: [1, 2, 3] }));
  ok('a meaning changed later needs no PDF, and leaves the day changes alone', resaved.ok && cal.dayInfo('2026-10-05').kind === null &&
    cal.readCalendar().pdf.marks['2026-10-05'] && cal.readCalendar().overrides['2026-10-16'] === 'minimumDay');
  actions.main('saveCalendar', b64({ meanings: { slash: 'noSchool' }, overrides: { '2026-10-07': 'normal', '2026-10-16': 'minimumDay' } }));

  const up = cal.upcoming(new Date(2026, 9, 1, 9), 15);
  ok('upcoming joins a run of days and keeps the rest apart',
    JSON.stringify(up.map(u => [u.from, u.to, u.kind])) ===
    JSON.stringify([['2026-10-05', '2026-10-06', 'noSchool'], ['2026-10-12', '2026-10-12', 'noSchool'], ['2026-10-16', '2026-10-16', 'minimumDay']]), JSON.stringify(up));

  // ── "by tomorrow" is the next school day ──
  const draft = require(path.join(proj, '05-playwright-draft.js'));
  const friday = new Date(2026, 9, 9, 16, 30);   // the Friday before Monday the 12th, a holiday
  const b = draft.sortIntoBuckets([
    { id: 'u', class: 'Made-up Art', type: 'Assignment', title: 'Undated', due: null },
    { id: 'd', class: 'Made-up Art', type: 'Assignment', title: 'Dated', due_iso: new Date(2026, 9, 12, 23, 59).toISOString() },
  ], friday);
  const undated = b.burning.find(x => x.id === 'u'), dated = b.burning.find(x => x.id === 'd');
  ok('undated work is due the next school day (Tuesday, past the weekend and the holiday)',
    undated && cal.dayKey(undated.due_at) === '2026-10-13' && undated.due_at.getHours() === 16, undated && String(undated.due_at));
  ok('a due date a teacher set is never moved', dated && cal.dayKey(dated.due_at) === '2026-10-12');
  const va = require(path.join(proj, '24-virtual-assignments.js'));
  va.create({ title: 'Made-up reminder', class: 'Made-up Art', due: '' });
  const rem = va.bucketed(friday, true).burning.find(x => x.title === 'Made-up reminder');
  ok('an undated reminder too', rem && cal.dayKey(rem.due_at) === '2026-10-13', rem && String(rem.due_at));

  // ── the home API ──
  const api = require(path.join(proj, '17-api.js'));
  const view = api.HANDLERS['/api/calendar']({ ...api.gather(), now: new Date(2026, 9, 9, 10) });
  ok('/api/calendar: today, the next school day, what\'s coming up', view.available && view.today.date === '2026-10-09' && view.today.schoolDay &&
    view.nextSchoolDay === '2026-10-13' && view.upcoming[0].from === '2026-10-12', JSON.stringify(view));
  const status = api.HANDLERS['/api/status']({ ...api.gather(), now: new Date(2026, 9, 12, 10) });
  ok('/api/status says whether today is a school day', status.schoolToday === false);

  // ── the page ──
  const { JSDOM, VirtualConsole } = T.jsdom();
  const errors = [], sent = [];
  // The page is drawn "today", so the strip is checked with a calendar
  // around today, then the review with the made-up one.
  const today = new Date();
  const inDays = n => cal.dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  let soon = 1; while ([0, 6].includes(new Date(today.getFullYear(), today.getMonth(), today.getDate() + soon).getDay())) soon++;
  const saveFile = JSON.parse(fs.readFileSync(cal.FILE, 'utf8'));
  fs.writeFileSync(cal.FILE, JSON.stringify({ ...saveFile, overrides: { ...saveFile.overrides, [inDays(soon)]: 'noSchool' } }));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: proj });
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.confirm = () => true; w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } }; } });
  await sleep(300);
  const w = dom.window, d = w.document;
  const strip = d.getElementById('coming-up');
  ok('no "Coming up" list beside the assignments (the calendar shows those days)', !strip);
  const section = d.getElementById('calendar-section');
  ok('the month has its own section, not inside Settings', section && !section.closest('#settings-panel') &&
    section.parentElement.querySelector('.calendar-section + *, .calendar-section ~ section') !== null);
  const setup = d.getElementById('calendar-settings-view');
  ok('...and what sets it up is in Settings → Calendar, saying which PDF it came from', setup && !!setup.closest('#settings-panel') &&
    /made-up-calendar\.pdf/.test(d.getElementById('calendar-source').textContent) && !!d.getElementById('calendar-source').closest('#settings-panel'));

  const decoded = m => JSON.parse(Buffer.from(m.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const grid = d.getElementById('calendar-view');
  const day = date => grid.querySelector(`.calendar-day[data-date="${date}"]`);
  w.calendarMonth = '2026-10'; w.renderCalendar();
  ok('one month at a time', grid.querySelectorAll('.calendar-grid').length === 1 && /October 2026/.test(grid.querySelector('.calendar-month-title').textContent));
  ok('days show as what they are, with the saved day changes', day('2026-10-12').classList.contains('day-noSchool') &&
    day('2026-10-20').classList.contains('day-minimumDay') && day('2026-10-05').classList.contains('day-noSchool') &&
    day('2026-10-07').classList.contains('day-normal') && day('2026-10-16').classList.contains('day-minimumDay') && day('2026-10-16').classList.contains('day-changed'));
  grid.querySelector('.calendar-nav .mini-btn:last-child').click();
  ok('› goes to the next month in the calendar, the next year\'s page included', /September 2027/.test(grid.querySelector('.calendar-month-title').textContent) &&
    day('2027-09-06').classList.contains('day-noSchool'));
  grid.querySelector('.calendar-nav .mini-btn').click();

  const select = mark => setup.querySelector(`select[data-mark="${mark}"]`);
  ok('what each mark means: the legend\'s words and the choice', select('circle').value === 'noSchool' && select('X').value === 'minimumDay' &&
    /State Holiday/.test(select('circle').closest('.calendar-meaning').textContent));
  ok('...slashes, which had no legend, say so', /no legend text found/.test(select('slash').closest('.calendar-meaning').textContent) && select('slash').value === 'noSchool');
  select('slash').value = 'ignore'; select('slash').onchange();
  let save = sent.filter(x => x.action === 'saveCalendar').pop();
  ok('changing a meaning saves at once, and repaints its days', save && decoded(save).meanings.slash === 'ignore' && day('2026-10-05').classList.contains('day-normal'),
    save && JSON.stringify(decoded(save)));
  w.classdashBridgeResult(save.id, { ok: true });
  ok('...and says it\'s saved, in Settings and beside the month', [...d.querySelectorAll('.calendar-save-state')].every(x => /Saved/.test(x.textContent)) &&
    d.querySelectorAll('.calendar-save-state').length === 2);
  day('2026-10-21').click();
  save = sent.filter(x => x.action === 'saveCalendar').pop();
  ok('clicking a day changes it and saves at once', day('2026-10-21').classList.contains('day-noSchool') && day('2026-10-21').classList.contains('day-changed') &&
    decoded(save).overrides['2026-10-21'] === 'noSchool' && decoded(save).overrides['2026-10-16'] === 'minimumDay');
  day('2026-10-12').click(); day('2026-10-12').click(); day('2026-10-12').click();
  save = sent.filter(x => x.action === 'saveCalendar').pop();
  ok('clicking back round to what the mark says drops the change', !day('2026-10-12').classList.contains('day-changed') && !('2026-10-12' in decoded(save).overrides));

  const pageBox = n => setup.querySelector(`.calendar-pages input[data-page="${n}"]`);
  ok('with more than one calendar, it asks which, by page and heading', pageBox(1).checked && pageBox(2).checked && !pageBox(4).checked &&
    /Made-up Middle School/.test(pageBox(4).closest('label').textContent));
  pageBox(4).checked = true; pageBox(4).onchange();
  save = sent.filter(x => x.action === 'saveCalendar').pop();
  ok('ticking another school\'s page unticks the one for the same months, keeps the other years, and saves',
    decoded(save).pages.join() === '2,3,4' && !pageBox(1).checked && pageBox(2).checked, JSON.stringify(decoded(save).pages));
  w.calendarMonth = '2026-09'; w.renderCalendar();
  ok('...and its days show instead', day('2026-09-14').classList.contains('day-noSchool') && day('2026-09-07').classList.contains('day-normal'));
  pageBox(1).checked = true; pageBox(1).onchange();
  w.calendarMonth = '2026-10'; w.renderCalendar();
  ok('ticking the first school again swaps back', !pageBox(4).checked && day('2026-10-21').classList.contains('day-noSchool'));
  w.importCalendarPdf(d.querySelector('#settings-panel [onclick*="importCalendarPdf"]'));
  const pick = sent.find(x => x.action === 'pickCalendarPdf');
  ok('Read PDF asks the app for its file picker', !!pick);
  w.classdashBridgeResult(pick.id, { ok: false, why: 'noText' });
  ok('a PDF that can\'t be read says why, and the calendar stays', /no readable text/.test(d.getElementById('calendar-error').textContent) && !!day('2026-10-21'));
  w.importCalendarPdf(d.querySelector('#settings-panel [onclick*="importCalendarPdf"]'));
  const pick2 = sent.filter(x => x.action === 'pickCalendarPdf')[1];
  w.classdashBridgeResult(pick2.id, imported);
  ok('a newly read PDF shows at once, its days changed by hand gone', !day('2026-10-21').classList.contains('day-changed') &&
    !!setup.querySelector('select[data-mark="circle"]'));
  ok('the page script runs clean', errors.length === 0, errors.join(' | '));
  dom.window.close();
})();
