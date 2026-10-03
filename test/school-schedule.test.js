// The class schedule: odd/even and A/B days (flipped days, both flip
// modes), the heads-ups (a flipped day, and with odd/even the same day twice
// in a row) and when their notification goes out, Settings → Schedule,
// the calendar's day labels, the banner, the "class tomorrow" pill and
// /api/schedule. The classes are made up.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({
  'settings.json': { language: 'en', email: 'a@b', canvas: '', exclusions: ['Made-up Skipped'] },
  'classes.json': [{ name: 'Made-up Biology' }, { name: 'Made-up Math' }, { name: 'Made-up Art' }, { name: 'Made-up Chem Per 4' },
    { name: 'Made-up Old Club' }, { name: 'Made-up Skipped' }],
  // The club last had anything 2 years ago; the other is excluded in settings.
  'class-activity.json': { 'Made-up Old Club': Date.now() - 730 * 864e5, 'Made-up Biology': Date.now() },
  'last-collection.json': [],
  // Monday Oct 12 2026 is a day off.
  'school-calendar.json': { overrides: { '2026-10-12': 'noSchool' } },
});
process.chdir(proj);
const schedule = require(path.join(proj, '35-school-schedule.js'));
const cal = require(path.join(proj, '33-school-calendar.js')).readCalendar();
const types = (sched, from, to) => {
  const all = schedule.dayTypes(from, to, sched, cal);
  return Object.keys(all).sort().map(k => k.slice(5) + all[k].day + (all[k].flipped ? '*' : '')).join(' ');
};

// ── odd/even ──
const odd = { type: 'oddEven', flips: [], classes: [] };
ok('odd/even goes by the date, school days only', types(odd, '2026-10-08', '2026-10-14') === '10-08B 10-09A 10-13A 10-14B', types(odd, '2026-10-08', '2026-10-14'));
const headsOn = (sched, now) => schedule.headsUps(now, sched, cal).map(h => `${h.kind}:${h.date}${h.previous ? '<' + h.previous : ''}`).join(' ');
ok('a holiday makes the same day twice: Fri 9 → Tue 13, both odd', headsOn(odd, new Date(2026, 9, 9, 10)) === 'repeat:2026-10-13<2026-10-09', headsOn(odd, new Date(2026, 9, 9, 10)));
ok('...the 31st → the 1st, both school days', headsOn(odd, new Date(2027, 2, 31, 10)) === 'repeat:2027-04-01<2027-03-31', headsOn(odd, new Date(2027, 2, 31, 10)));
ok('...and Fri 30 → Mon 2 (the 31st a Saturday), both even', headsOn(odd, new Date(2026, 9, 30, 10)) === 'repeat:2026-11-02<2026-10-30');
ok('a normal day after day: nothing', headsOn(odd, new Date(2026, 9, 5, 10)) === '');
const oddFlip = { ...odd, flips: ['2026-10-14', '2026-10-17'] };
ok('a flipped day swaps (and one on a weekend means nothing)', types(oddFlip, '2026-10-13', '2026-10-19') === '10-13A 10-14A* 10-15A 10-16B 10-19A', types(oddFlip, '2026-10-13', '2026-10-19'));
// On the 13th, today is itself a repeat (of the 9th, over the holiday).
ok('...and gets its heads-up, the repeat it makes too', headsOn(oddFlip, new Date(2026, 9, 13, 16)) === 'repeat:2026-10-13<2026-10-09 flip:2026-10-14 repeat:2026-10-14<2026-10-13', headsOn(oddFlip, new Date(2026, 9, 13, 16)));

// ── A/B ──
const ab = mode => ({ type: 'ab', ab: { anchor: '2026-10-05', anchorDay: 'A', flipMode: mode }, flips: [], classes: [] });
ok('A/B alternates by school day, skipping weekends and days off', types(ab('day'), '2026-10-05', '2026-10-14') === '10-05A 10-06B 10-07A 10-08B 10-09A 10-13B 10-14A', types(ab('day'), '2026-10-05', '2026-10-14'));
ok('...and backwards from the day it was set', types(ab('day'), '2026-09-30', '2026-10-02') === '09-30B 10-01A 10-02B', types(ab('day'), '2026-09-30', '2026-10-02'));
ok('a flip that swaps only its day', types({ ...ab('day'), flips: ['2026-10-07'] }, '2026-10-06', '2026-10-09') === '10-06B 10-07B* 10-08B 10-09A');
ok('a flip that restarts the order from it', types({ ...ab('shift'), flips: ['2026-10-07'] }, '2026-10-06', '2026-10-13') === '10-06B 10-07B* 10-08A 10-09B 10-13A',
  types({ ...ab('shift'), flips: ['2026-10-07'] }, '2026-10-06', '2026-10-13'));
ok('...a restart before the day it was set changes the days before it', types({ ...ab('shift'), flips: ['2026-10-01'] }, '2026-09-29', '2026-10-05') === '09-29B 09-30A 10-01A* 10-02B 10-05A',
  types({ ...ab('shift'), flips: ['2026-10-01'] }, '2026-09-29', '2026-10-05'));
ok('"today is A" on a flipped day means A is today\'s real day', types({ ...ab('day'), flips: ['2026-10-05'] }, '2026-10-05', '2026-10-06') === '10-05A* 10-06A');
ok('A/B gets flip heads-ups but never repeat ones', headsOn({ ...ab('day'), flips: ['2026-10-08'] }, new Date(2026, 9, 7, 16)) === 'flip:2026-10-08');

// ── a period in the class name ──
const periods = ['AP World Hist 1 Per 2 - 6255D-1 (S1)', 'Period 3 (U.S. History) Period 3', 'Made-up Bio P1', 'Chem (P4)', 'Math Pd. 5',
  '3rd period English', 'Spanish 2 per6', 'AP Bio', 'Chapter 1', 'Biology 1', 'PE'].map(n => schedule.periodFromName(n));
ok('the period is read from "Per 2", "Period 3", "P1", "(P4)", "Pd. 5", "3rd period", "per6", not from "AP", "Chapter 1" or "Biology 1"',
  JSON.stringify(periods) === '[2,3,1,4,5,3,6,null,null,null,null]', JSON.stringify(periods));

// ── classes ──
const withClasses = { ...odd, classes: [{ class: 'Made-up Math', period: 3, days: 'A' }, { class: 'Made-up Biology', period: 1, days: 'all' }, { class: 'Made-up Art', period: 2, days: 'B' }] };
ok('the classes that meet, by period', schedule.classesOn('2026-10-09', withClasses, cal).map(c => c.class).join() === 'Made-up Biology,Made-up Math');
ok('...none on a day off', schedule.classesOn('2026-10-12', withClasses, cal).length === 0);
ok('...every class every school day with "same every day"', schedule.classesOn('2026-10-13', { ...withClasses, type: 'daily' }, cal).length === 3);

// ── when the notification goes out ──
fs.writeFileSync(schedule.FILE, JSON.stringify(odd));
ok('not before 3 PM on the school day before', schedule.dueNotifications(new Date(2026, 9, 9, 14, 59)).length === 0);
const due = schedule.dueNotifications(new Date(2026, 9, 9, 15));
ok('...from 3 PM', due.length === 1 && due[0].kind === 'repeat' && due[0].date === '2026-10-13');
schedule.markNotified(due, new Date(2026, 9, 9, 15));
ok('...once', schedule.dueNotifications(new Date(2026, 9, 9, 18)).length === 0 && schedule.dueNotifications(new Date(2026, 9, 11, 9)).length === 0);
ok('on a weekend, the window from Friday is open for Monday', schedule.dueNotifications(new Date(2026, 9, 31, 10)).map(h => h.date).join() === '2026-11-02');
ok('the day before a normal day, nothing', schedule.dueNotifications(new Date(2026, 9, 29, 20)).length === 0);
ok('the collector sends each one, and marks it', /dueNotifications\(new Date\(\)\);[\s\S]{0,200}notify\(t\('schoolLabel'\), t\('headsUpTitle'\), text\)[\s\S]{0,150}markNotified\(due\)/
  .test(fs.readFileSync(path.join(proj, '05-playwright-draft.js'), 'utf8')));

// ── saving ──
const actions = require(path.join(proj, '21-notifier-actions.js'));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
ok('a bad type is refused', actions.main('saveSchedule', b64({ type: 'weekly' })).ok === false);
ok('...a bad date', actions.main('saveSchedule', b64({ flips: ['2026-02-30'] })).ok === false);
ok('...a bad class row, saving nothing of it', actions.main('saveSchedule', b64({ type: 'daily', classes: [{ class: '', period: 1, days: 'all' }] })).ok === false &&
  schedule.readSchedule().type === 'oddEven');
const saved = actions.main('saveSchedule', b64({ type: 'oddEven', classes: withClasses.classes, flips: ['2026-10-15', '2026-10-14', '2026-10-14'] }));
ok('a good save, flips sorted and once each, answered with the days', saved.ok && JSON.stringify(schedule.readSchedule().flips) === '["2026-10-14","2026-10-15"]' &&
  saved.schedule && saved.schedule.days && !('notified' in saved.schedule.saved), JSON.stringify(saved).slice(0, 300));
ok('...keeping what was already notified', Object.keys(schedule.readSchedule().notified).length === 1);

// ── the API ──
const api = require(path.join(proj, '17-api.js'));
const view = api.HANDLERS['/api/schedule']({ ...api.gather(), now: new Date(2026, 9, 9, 10) });
ok('/api/schedule: today, the next school day, the heads-ups', view.type === 'oddEven' && view.today.date === '2026-10-09' && view.today.label === 'Odd' &&
  view.today.classes.map(c => c.period).join() === '1,3' && view.nextSchoolDay.date === '2026-10-13' && view.headsUps[0].kind === 'repeat' && view.headsUps[0].label === 'Odd',
  JSON.stringify(view));
ok('/api/status gives today\'s label', api.HANDLERS['/api/status']({ ...api.gather(), now: new Date(2026, 9, 14, 10) }).scheduleToday === 'Odd');

// ── the page (drawn "now") ──
(async () => {
  const realCal = require(path.join(proj, '33-school-calendar.js'));
  const today = new Date();
  const next = realCal.nextSchoolDay(today);
  const nextKey = realCal.dayKey(next);
  actions.main('saveSchedule', b64({ type: 'oddEven', flips: [nextKey], classes: withClasses.classes }));
  // A feed event this month, so the calendar has a month to draw.
  const todayKey = realCal.dayKey(today);
  fs.writeFileSync(path.join(proj, 'school-calendar.json'), JSON.stringify({ overrides: { '2026-10-12': 'noSchool' },
    ics: { url: 'http://x', fetchedAt: today.toISOString(), events: [{ start: todayKey, end: todayKey, summary: 'Made-up Fair', group: 'madeup fair' }],
      groups: { 'madeup fair': 'Made-up Fair' }, meanings: { 'madeup fair': 'event' } } }));
  fs.writeFileSync(path.join(proj, 'last-collection.json'), JSON.stringify([
    { class: 'Made-up Biology', id: 'b1', type: 'Assignment', title: 'Made-up lab', due_iso: new Date(+today + 3 * 864e5).toISOString() },
  ]));
  T.redraw(proj);
  const errors = [], sent = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.confirm = () => true; w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } }; } });
  await sleep(300);
  const w = dom.window, d = w.document;
  const banner = d.getElementById('schedule-banner');
  ok('a heads-up banner for the flipped day', banner && /Heads-up:.*is flipped: (even instead of odd|odd instead of even)\./.test(banner.textContent.replace(/\s+/g, ' ')),
    banner && banner.textContent.replace(/\s+/g, ' '));
  const line = d.getElementById('schedule-line');
  const flipLine = [...banner.querySelectorAll('.schedule-heads-up')].find(l => /is flipped/.test(l.textContent));
  const others = banner.querySelectorAll('.schedule-heads-up').length - 1;
  flipLine.querySelector('button').click();
  const dismissal = sent.find(m => m.action === 'dismissHeadsUp');
  ok('the heads-up can be dismissed: gone at once, and the app is told which', dismissal && dismissal.arg === `flip:${nextKey}` && !/is flipped/.test(banner.textContent) &&
    banner.querySelectorAll('.schedule-heads-up').length === others && banner.hidden === (others === 0),
    JSON.stringify(dismissal));
  ok('...and remembered: no banner, no notification, the API says so', actions.main('dismissHeadsUp', dismissal.arg).ok &&
    schedule.headsUps(today).find(h => h.kind === 'flip').dismissed === true &&
    !schedule.dueNotifications(new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1, 23)).some(h => h.kind === 'flip') &&
    !/class="schedule-heads-up"><span><b>Heads-up:<\/b> [^<]*is flipped/.test(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8')));
  ok('...and only real heads-ups can be', actions.main('dismissHeadsUp', 'flip:soon').ok === false);
  ok('the next school day\'s classes above the month, marked flipped', line && !line.hidden && /\(flipped\)/.test(line.textContent) && /Made-up Biology/.test(line.textContent), line && line.textContent);
  const pill = d.querySelector('.row[data-id="b1"] .class-next-badge');
  ok('"class tomorrow" (or the day) on a card whose class meets next', pill && /^class /.test(pill.textContent), pill && pill.textContent);

  const setup = d.getElementById('schedule-settings');
  const selects = setup.querySelectorAll('select');
  ok('Settings → Schedule: the kind, a row per class, the flipped days', selects[0].value === 'oddEven' && setup.querySelectorAll('.schedule-class').length === 3 &&
    setup.querySelectorAll('.schedule-flip').length === 1);
  ok('...the classes listed by period, 1 up', [...setup.querySelectorAll('.schedule-period')].map(i => i.value).join() === '1,2,3');
  const decoded = m => JSON.parse(Buffer.from(m.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const last = () => sent.filter(m => m.action === 'saveSchedule').pop();
  const reply = m => w.classdashBridgeResult(m.id, actions.main('saveSchedule', m.arg));
  setup.querySelector('.schedule-class .schedule-days').value = 'B';
  setup.querySelector('.schedule-class .schedule-days').onchange();
  ok('changing a class saves at once', last() && decoded(last()).classes[0].days === 'B', last() && JSON.stringify(decoded(last())));
  reply(last());
  ok('...and says so', /Saved/.test(d.querySelector('.schedule-save-state').textContent));
  const offered = JSON.parse(d.getElementById('schedule-saved').textContent).classes;
  ok('only current classes are offered (not stale, not excluded), with the period from their name',
    JSON.stringify(offered) === JSON.stringify([{ name: 'Made-up Art', period: null }, { name: 'Made-up Biology', period: null },
      { name: 'Made-up Chem Per 4', period: 4 }, { name: 'Made-up Math', period: null }]), JSON.stringify(offered));
  const row = i => d.getElementById('schedule-settings').querySelectorAll('.schedule-class')[i];
  const autoButton = [...d.getElementById('schedule-settings').querySelectorAll('.schedule-class-buttons button')].find(b => /with a period in the name/.test(b.textContent));
  ok('a button adds the classes whose name says their period', autoButton && /Add 1 /.test(autoButton.textContent));
  autoButton.click();
  const chem = decoded(last()).classes.find(c => c.class === 'Made-up Chem Per 4');
  ok('...period 4, so even days', chem && chem.period === 4 && chem.days === 'B', JSON.stringify(chem));
  reply(last());
  row(0).querySelector('.schedule-days').value = 'A';
  row(0).querySelector('.schedule-period').value = '4';
  row(0).querySelector('.schedule-period').onchange();
  ok('changing an odd period to an even one moves its odd-day default to even', decoded(last()).classes[0].days === 'B' && decoded(last()).classes[0].period === 4,
    JSON.stringify(decoded(last()).classes[0]));
  reply(last());
  row(1).querySelector('.schedule-class-name').value = 'Made-up Choir';
  row(1).querySelector('.schedule-class-name').onchange();
  ok('a class with nothing online can be typed in', decoded(last()).classes[1].class === 'Made-up Choir');
  reply(last());
  ok('a period changed out of order is listed in order again', [...d.querySelectorAll('#schedule-settings .schedule-period')].map(i => i.value).join() === '2,3,4,4',
    [...d.querySelectorAll('#schedule-settings .schedule-period')].map(i => i.value).join());
  [...d.getElementById('schedule-settings').querySelectorAll('.schedule-class-buttons button')][0].click();
  const added = decoded(last()).classes.pop();
  ok('Add class picks a class not used yet, with the odd/even default for its period', added.class === 'Made-up Math' && added.period === 5 && added.days === 'A',
    JSON.stringify(added));
  reply(last());
  setup.querySelector('.schedule-flip-date').value = '2027-01-12';
  [...setup.querySelectorAll('.schedule-flip-add button')][0].click();
  ok('adding a flipped day saves it', decoded(last()).flips.includes('2027-01-12'));
  reply(last());
  const labels = d.querySelectorAll('#calendar-view .calendar-day-type');
  const flippedCell = d.querySelector(`#calendar-view .calendar-day[data-date="${nextKey}"]`);
  ok('days in the month have their O/E in the corner, the flipped one marked', labels.length > 10 && [...labels].every(l => /^[OE]$/.test(l.textContent)) &&
    (nextKey.slice(0, 7) !== todayKey.slice(0, 7) || (flippedCell && flippedCell.classList.contains('day-flipped'))), String(labels.length));
  const typeSelect = d.getElementById('schedule-settings').querySelector('select');
  typeSelect.value = 'ab'; typeSelect.onchange();
  ok('switching to A/B saves it', decoded(last()).type === 'ab');
  reply(last());
  const todayIs = d.getElementById('schedule-settings').querySelectorAll('select')[1];
  todayIs.value = 'B'; todayIs.onchange();
  const anchor = decoded(last()).ab;
  ok('...and "today is" sets where it counts from', anchor && anchor.anchor === realCal.dayKey(today) && /^[AB]$/.test(anchor.anchorDay), JSON.stringify(anchor));
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();
})();
