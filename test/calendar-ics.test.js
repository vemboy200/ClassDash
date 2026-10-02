// The school calendar's feed (ICS): reading it, what each kind of event
// means, how it adds to the calendar, Settings → Calendar and the month
// view. The feed is made up and served from a local test server.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process'), http = require('http');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);
const { parseIcs, feedUrl } = require(path.join(proj, '34-calendar-ics.js'));
const cal = require(path.join(proj, '33-school-calendar.js'));

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ics = key => key.replace(/-/g, '');
const today = new Date();
const inDays = n => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
// A weekday a few days out, so it's in the next two weeks whatever today is.
let soon = 2; while ([0, 6].includes(inDays(soon).getDay())) soon++;
const SOON = key(inDays(soon)), SOON_NEXT = key(inDays(soon + 1));

const allDay = (start, end, summary, extra = '') =>
  `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${ics(start)}\r\nDTEND;VALUE=DATE:${ics(end)}\r\nSUMMARY:${summary}\r\n${extra}END:VEVENT\r\n`;
const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
  allDay(SOON, SOON_NEXT, 'Banking Day') +
  allDay(key(inDays(soon + 7)), key(inDays(soon + 8)), 'Banking Day') +
  allDay('2026-10-16', '2026-10-17', 'Minimum Day') +
  allDay('2026-10-05', '2026-11-04', 'Application Period') +
  allDay('2026-12-21', '2027-01-02', 'Winter Break') +
  allDay('2026-12-10', '2026-12-11', 'Holiday Concert') +
  allDay('2026-11-06', '2026-11-07', 'Grade Reports Q1') +
  allDay('2027-01-29', '2027-01-30', 'Grade Reports Q2') +
  allDay('2026-10-21', '2026-10-22', 'Cancelled Assembly', 'STATUS:CANCELLED\r\n') +
  // a long title folded onto a second line, escaped commas, a timed event in UTC
  'BEGIN:VEVENT\r\nDTSTART:20261020T190000Z\r\nDTEND:20261020T203000Z\r\nSUMMARY:Back to School Night\\, Gym and \r\n Library\r\nEND:VEVENT\r\n' +
  'BEGIN:VEVENT\r\nDTSTART;TZID=America/Los_Angeles:20261028T180000\r\nSUMMARY:Choir Show\r\nEND:VEVENT\r\n' +
  'END:VCALENDAR\r\n';

(async () => {
  // ── reading the feed ──
  const events = parseIcs(FEED);
  const by = s => events.find(e => e.summary === s);
  ok('every event that isn\'t cancelled is read', events.length === 10 && !by('Cancelled Assembly'), events.map(e => e.summary).join(' | '));
  ok('an all-day event ends the day before its DTEND', by('Minimum Day').start === '2026-10-16' && by('Minimum Day').end === '2026-10-16');
  ok('a multi-day event keeps its whole range', by('Winter Break').start === '2026-12-21' && by('Winter Break').end === '2027-01-01');
  ok('folded lines are joined and escapes undone', !!by('Back to School Night, Gym and Library'));
  const night = by('Back to School Night, Gym and Library');
  ok('a timed UTC event lands on this computer\'s day, and ends that day', night.start === key(new Date(Date.UTC(2026, 9, 20, 19))) && night.end === night.start);
  ok('a timed event with a time zone is taken as written, and no DTEND is one day', by('Choir Show').start === '2026-10-28' && by('Choir Show').end === '2026-10-28');
  ok('webcal:// links are fetched as https://', feedUrl('webcal://example.com/a.ics') === 'https://example.com/a.ics');

  // ── what each kind of event means ──
  const guess = (s, d = 1) => cal.guessIcsMeaning(s, d);
  ok('guesses: minimum day, a break, a holiday', guess('Minimum Day') === 'minimumDay' && guess('Winter Break', 12) === 'noSchool' && guess('Thanksgiving Holiday', 3) === 'noSchool');
  ok('...a holiday concert is still just an event', guess('Holiday Concert') === 'event');
  ok('...banking days and grade reports are events', guess('Banking Day') === 'event' && guess('Grade Reports Q1') === 'event');
  ok('...and a month-long period that isn\'t a break is hidden', guess('Application Period', 31) === 'hide');
  ok('numbered titles are one group', cal.icsGroup('Grade Reports Q1') === cal.icsGroup('Grade Reports Q2'));

  // ── fetching, through the action ──
  let serve = FEED, status = 200;
  const server = http.createServer((req, res) => { res.writeHead(status, { 'content-type': 'text/calendar' }); res.end(serve); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_ = `http://127.0.0.1:${server.address().port}/school.ics`;
  const actions = require(path.join(proj, '21-notifier-actions.js'));
  const set = await actions.main('setCalendarIcs', encodeURIComponent(URL_));
  ok('saving the link fetches the feed at once', set.ok && set.events === 10 && set.calendar.ics.url === URL_, JSON.stringify(set).slice(0, 300));
  const c = cal.readCalendar();
  ok('each title gets a meaning', c.ics.meanings[cal.icsGroup('Banking Day')] === 'event' && c.ics.meanings[cal.icsGroup('Application Period')] === 'hide' &&
    c.ics.meanings[cal.icsGroup('Minimum Day')] === 'minimumDay', JSON.stringify(c.ics.meanings));
  ok('a feed alone is a calendar', cal.hasCalendar());
  ok('a minimum day from the feed', cal.dayInfo('2026-10-16').kind === 'minimumDay' && cal.dayInfo('2026-10-16').label === 'Minimum Day');
  ok('a break from the feed is no school', cal.dayInfo('2026-12-23').kind === 'noSchool' && !cal.isSchoolDay('2026-12-23'));
  ok('events are listed on their day, hidden ones aren\'t', JSON.stringify(cal.dayInfo(SOON).events) === '["Banking Day"]' &&
    cal.dayInfo('2026-10-20').events.indexOf('Application Period') === -1 && cal.dayInfo('2026-10-20').kind === null);
  ok('upcoming events: the next two weeks', JSON.stringify(cal.upcomingEvents(today, 14).map(e => e.summary)).includes('Banking Day'));

  const kept = actions.main('saveCalendar', Buffer.from(JSON.stringify({ icsMeanings: { [cal.icsGroup('Banking Day')]: 'minimumDay' } })).toString('base64'));
  ok('a meaning can be changed', kept.ok && cal.dayInfo(SOON).kind === 'minimumDay' && cal.dayInfo(SOON).events.length === 0);
  serve = FEED.replace('END:VCALENDAR', allDay('2027-03-05', '2027-03-06', 'Banking Day') + 'END:VCALENDAR');
  const again = await actions.main('refreshCalendarIcs', '');
  ok('reading it again picks up new events and keeps the meanings chosen', again.ok && again.events === 11 &&
    cal.dayInfo('2027-03-05').kind === 'minimumDay', JSON.stringify(again).slice(0, 200));
  status = 500;
  const failed = await actions.main('refreshCalendarIcs', '');
  ok('a feed that fails says why, and keeps the last events that worked', !failed.ok && /500/.test(failed.why) &&
    cal.readCalendar().ics.events.length === 11 && /500/.test(cal.readCalendar().ics.error));
  status = 200; serve = '<html>not a calendar</html>';
  ok('a link that isn\'t a calendar says so', /isn't a calendar feed/.test((await actions.main('setCalendarIcs', encodeURIComponent(URL_))).why));
  ok('a link that isn\'t http(s) or webcal is refused', /has to start with/.test((await actions.main('setCalendarIcs', encodeURIComponent('file:///etc/passwd'))).why));
  serve = FEED;
  await actions.main('setCalendarIcs', encodeURIComponent(URL_));
  actions.main('saveCalendar', Buffer.from(JSON.stringify({ icsMeanings: { [cal.icsGroup('Banking Day')]: 'event' } })).toString('base64'));

  ok('the feed isn\'t read again until a day has passed', !cal.icsStale(new Date()) && cal.icsStale(new Date(Date.now() + 21 * 3600e3)));

  // ── with a PDF calendar too ──
  const withPdf = JSON.parse(fs.readFileSync(cal.FILE, 'utf8'));
  withPdf.pdf = { marks: { '2026-10-16': ['X'], '2026-10-19': ['circle'] }, meanings: { X: 'minimumDay', circle: 'noSchool' }, legend: [{ mark: 'circle', text: 'State Holiday' }], months: ['2026-10'] };
  fs.writeFileSync(cal.FILE, JSON.stringify(withPdf));
  ok('the PDF and the feed together: no school beats a minimum day', cal.dayInfo('2026-10-19').kind === 'noSchool' && cal.dayInfo('2026-10-16').kind === 'minimumDay');

  // ── the home API ──
  const api = require(path.join(proj, '17-api.js'));
  const view = api.HANDLERS['/api/calendar']({ ...api.gather(), now: today });
  ok('/api/calendar lists the next two weeks\' events', view.events.some(e => e.summary === 'Banking Day' && e.from === SOON), JSON.stringify(view.events));

  // ── the page ──
  delete withPdf.pdf;
  fs.writeFileSync(cal.FILE, JSON.stringify(withPdf));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: proj });
  const { JSDOM, VirtualConsole } = T.jsdom();
  const errors = [], sent = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/i.test(e.message)) errors.push(String(e.message)); });
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.webkit = { messageHandlers: { classdash: { postMessage: m => sent.push(m) } } }; } });
  await sleep(300);
  const w = dom.window, d = w.document;
  ok('Settings → Calendar has the link and says how it went', d.getElementById('calendar-ics-url').value === URL_ &&
    /10 events, read/.test(d.getElementById('calendar-ics-status').textContent) && !!d.getElementById('calendar-ics-url').closest('#settings-panel'));
  const setup = d.getElementById('calendar-settings-feed');
  const select = group => setup.querySelector(`select[data-group="${cal.icsGroup(group)}"]`);
  ok('one row per kind of event, with its meaning', select('Banking Day').value === 'event' && select('Application Period').value === 'hide' &&
    select('Grade Reports Q1').closest('label').querySelector('.count').textContent === '2');
  ok('a feed with no PDF still shows the month, the events\' months only', d.getElementById('calendar-empty').hidden && !!d.querySelector('.calendar-grid'));
  w.calendarMonth = SOON.slice(0, 7); w.renderCalendar();
  const dayCell = date => d.querySelector(`.calendar-day[data-date="${date}"]`);
  ok('an event\'s day gets a dot, and the event is listed under the month', dayCell(SOON).classList.contains('has-events') &&
    /Banking Day/.test(d.querySelector('.calendar-events').textContent));
  dayCell(SOON).onmouseenter();
  const active = [...d.querySelectorAll('.calendar-events li.active')];
  ok('hovering an event\'s day highlights it in the list', active.length === 1 && /Banking Day/.test(active[0].textContent) &&
    active[0].getAttribute('data-start') === SOON);
  dayCell(SOON).onmouseleave();
  ok('...and leaving lets it go', !d.querySelector('.calendar-events li.active'));
  const item = [...d.querySelectorAll('.calendar-events li')].find(li => li.getAttribute('data-start') === SOON);
  item.onmouseenter();
  ok('hovering an event in the list outlines its day', dayCell(SOON).classList.contains('event-hover') &&
    d.querySelectorAll('.calendar-day.event-hover').length === 1);
  item.onmouseleave();
  w.calendarMonth = '2026-10'; w.renderCalendar();
  ok('a hidden event isn\'t listed, and a minimum day from the feed is colored', !/Application Period/.test((d.querySelector('.calendar-events') || {}).textContent || '') &&
    dayCell('2026-10-16').classList.contains('day-minimumDay'));
  select('Application Period').value = 'event'; select('Application Period').onchange();
  const save = sent.filter(m => m.action === 'saveCalendar').pop();
  const payload = save && JSON.parse(Buffer.from(save.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  ok('changing a meaning saves at once and shows it', payload && payload.icsMeanings[cal.icsGroup('Application Period')] === 'event' &&
    /Application Period/.test(d.querySelector('.calendar-events').textContent));
  d.getElementById('calendar-ics-url').value = '  webcal://example.com/new.ics ';
  w.saveCalendarIcs(d.querySelector('[onclick*="saveCalendarIcs"]'));
  const setMsg = sent.find(m => m.action === 'setCalendarIcs');
  ok('Save link sends the link', setMsg && decodeURIComponent(setMsg.arg) === 'webcal://example.com/new.ics');
  w.classdashBridgeResult(setMsg.id, { ok: false, why: 'the server answered 404', calendar: { read: null, ics: { ...withPdf.ics, error: 'x' }, overrides: {} } });
  ok('...and a failure shows why', /Couldn't read it: the server answered 404/.test(d.getElementById('calendar-ics-status').textContent));
  ok('the page script runs clean', errors.length === 0, errors.join(' | '));
  dom.window.close();
  server.close();
})();
