// A new reminder for a class on the schedule is due 11:59 PM the night
// before its next meeting after today, unless a due date is already there. The classes are
// made up.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({
  'settings.json': { language: 'en', email: 'a@b', canvas: '' },
  'classes.json': [{ name: 'Made-up Biology' }, { name: 'Made-up Math' }, { name: 'Made-up Art' }],
  'last-collection.json': [],
  // Monday Oct 12 2026 is a day off.
  'school-calendar.json': { overrides: { '2026-10-12': 'noSchool' } },
});
process.chdir(proj);
const schedule = require(path.join(proj, '35-school-schedule.js'));
const realCal = require(path.join(proj, '33-school-calendar.js'));
const cal = realCal.readCalendar();

// ── nextMeetings ──
{
  // Odd/even: Biology odd days, Math even, Art every day.
  const sched = { type: 'oddEven', flips: [], classes: [
    { class: 'Made-up Biology', period: 1, days: 'A' }, { class: 'Made-up Math', period: 2, days: 'B' }, { class: 'Made-up Art', period: 3, days: 'all' }] };
  // Friday Oct 9: the next school day is Tue 13 (odd), then Wed 14 (even).
  const m = schedule.nextMeetings(new Date(2026, 9, 9, 10), sched, cal);
  ok('odd class: the next odd school day, skipping the weekend and the day off', m['Made-up Biology'][0] === '2026-10-13', JSON.stringify(m['Made-up Biology']));
  ok('even class: the next even one', m['Made-up Math'][0] === '2026-10-14', JSON.stringify(m['Made-up Math']));
  ok('every-day class: the next school day', m['Made-up Art'][0] === '2026-10-13');
  ok('today itself is never the next meeting', !Object.values(m).some(l => l.includes('2026-10-09')));
  ok('a few dates each, in order', m['Made-up Art'].length === 3 && m['Made-up Art'].join() === [...m['Made-up Art']].sort().join());
  ok('no schedule: nothing', Object.keys(schedule.nextMeetings(new Date(), { type: 'none', classes: sched.classes }, cal)).length === 0);
}

(async () => {
  // Daily: Biology and Math every school day; Art isn't on the schedule.
  fs.writeFileSync('school-schedule.json', JSON.stringify({ type: 'daily', classes: [
    { class: 'Made-up Biology', period: 1, days: 'all' }, { class: 'Made-up Math', period: 2, days: 'all' }] }));
  T.redraw(proj);
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; } });
  await sleep(300);
  const w = dom.window, d = w.document;
  const cls = d.getElementById('reminder-class'), due = d.getElementById('reminder-due'), note = d.getElementById('reminder-next-class');
  const type = v => { cls.value = v; cls.dispatchEvent(new w.Event('input')); };
  const meet = realCal.nextSchoolDay(new Date());
  const expected = realCal.dayKey(new Date(meet.getFullYear(), meet.getMonth(), meet.getDate() - 1)) + 'T23:59';

  type('Made-up Biology');
  ok('a class on the schedule: due 11:59 PM the night before its next school day', due.value === expected, due.value + ' vs ' + expected);
  ok('...with a note saying so', !note.hidden && /night before the next class on the schedule/.test(note.textContent), note.textContent);
  type('made-up math');
  ok('another class moves the date it filled itself (any capitalization)', due.value === expected && !note.hidden);
  type('Made-up Art');
  ok('a class not on the schedule clears the date it filled', due.value === '' && note.hidden);

  due.value = '2027-01-05T13:30'; due.dispatchEvent(new w.Event('input'));
  type('Made-up Biology');
  ok('a date typed in by hand is never replaced', due.value === '2027-01-05T13:30' && note.hidden, due.value);

  w.cancelEditReminder();
  d.getElementById('reminder-editing-id').value = 'v-x';
  type('Made-up Biology');
  ok('editing a reminder never fills a date', due.value === '');
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();
})();
