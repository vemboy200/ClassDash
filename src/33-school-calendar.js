// The school calendar: which days are no-school days and which are
// minimum days, from a calendar PDF (read by 32-calendar-pdf.js), plus any
// day the user changed by hand in the page's Calendar section.
//
// Stored in school-calendar.json:
//   { pdf: { importedAt, file, pages: [{ page, name, months, marks, legend, warnings }],
//            selected: [page, …], meanings: { mark: 'noSchool' | 'minimumDay' | 'ignore' },
//            days: { mark: 'odd' | 'even' | 'A' | 'B' | 'flip' } (see SCHEDULE_DAYS),
//            …and the selected pages combined: months, marks: { date: [mark, …] }, legend, warnings },
//     ics: { url, fetchedAt, error, events: [{ start, end, summary, group }],
//            groups: { group: name }, meanings: { group: 'noSchool' | 'minimumDay' | 'event' | 'hide' },
//            days: { group: 'odd' | 'even' | 'A' | 'B' | 'flip' } },
//     overrides: { date: 'noSchool' | 'minimumDay' | 'normal' } }
//
// The PDF's marks are kept as they were read, page by page, with what each
// mark means next to them, so changing a meaning or the pages used later
// never needs the PDF again. A PDF can hold a calendar per school for the
// same year: only the selected pages count (see defaultPages() in
// 32-calendar-pdf.js for which are used until the user picks).
// A calendar feed (ICS, 34-calendar-ics.js) adds its events: each event
// title (grouped, so every "Banking Day" is one) means no school, a minimum
// day, just an event to show, or nothing (hidden). A day is the stronger of
// what the PDF and the feed say; the user's own changes (overrides) always win.
//
// A PDF is saved as soon as it's read, with meanings guessed from its
// legend, and every change on the page is saved as it's made: nothing waits
// on a Save button that a closed panel or a reload could lose.
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const FILE = path.join(PROJECT_ROOT, 'school-calendar.json');

const KINDS = ['noSchool', 'minimumDay'];
const MEANINGS = [...KINDS, 'ignore'];
const ICS_MEANINGS = [...KINDS, 'event', 'hide'];
// A SECOND, SEPARATE CHOICE per mark and per kind of event: which day of
// the class schedule (35-school-schedule.js) the day is. Separate because
// one event can be both ("Even Day. Also MINIMUM Day" is a minimum day AND
// an even day). 'odd'/'even' and 'A'/'B' say what the day IS: on a day that
// would be the other one, that's a flipped day, and on one that already is,
// nothing changes. 'flip' is for calendars that just say "flipped".
// Stored as pdf.days { mark: … } and ics.days { group: … }; none = no key.
const SCHEDULE_DAYS = ['odd', 'even', 'A', 'B', 'flip'];
const FLIP_WORDS = /\bflip(ped)?\b|\bswitch(ed)? day\b|\bday swap\b/;

/** Which schedule day a legend line or event title names, or ''. */
function guessScheduleDay(text) {
  const t = String(text || '');
  if (/\beven[- ]day\b/i.test(t)) return 'even';
  if (/\bodd[- ]day\b/i.test(t)) return 'odd';
  // Capital A or B only: "a day of service" isn't an A day.
  const ab = t.match(/\b([AB])[- ]Day\b/);
  if (ab) return ab[1];
  if (FLIP_WORDS.test(t.toLowerCase())) return 'flip';
  return '';
}

/** A day's schedule day from the calendar: 'A' (odd or A), 'B' (even or B),
 *  'flip', or '' — with today's earlier 'flip' meaning (before the second
 *  choice existed) still read as a flip. */
function scheduleDayOf(meaning, day) {
  if (meaning === 'flip' || day === 'flip') return 'flip';
  if (day === 'odd' || day === 'A') return 'A';
  if (day === 'even' || day === 'B') return 'B';
  return '';
}
const MARKS = ['circle', 'slash', 'triangle', 'X', '*'];

const pad = n => String(n).padStart(2, '0');
/** A Date's local calendar day, as YYYY-MM-DD. */
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Read once per change of the file: the bucketing asks for every
// undated assignment, many times per page.
let cache = { mtime: null, cal: {} };
function readCalendar() {
  let mtime = null;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { return {}; }
  if (cache.mtime !== mtime) {
    const cal = readJson(FILE);
    cache = { mtime, cal: cal && typeof cal === 'object' ? cal : {} };
  }
  return cache.cal;
}

function writeCalendar(cal) {
  fs.writeFileSync(FILE, JSON.stringify(cal, null, 2));
  cache = { mtime: null, cal: {} };
}

/**
 * What each mark probably means, from the legend's own words. Only a
 * suggestion: the user picks the real meaning in the page's Calendar section.
 */
function guessMeanings(legend = []) {
  const out = {};
  for (const { mark, text } of legend) {
    const t = String(text || '').toLowerCase();
    if (/minimum|early (dismissal|release)|half day|short(ened)? day/.test(t)) out[mark] = 'minimumDay';
    else if (/holiday|no school|not in attendance|break|recess|vacation|closed/.test(t)) out[mark] = 'noSchool';
    else out[mark] = 'ignore';
  }
  return out;
}

// combinePages and defaultPages come from the reader, which loads PDF.js
// only when a PDF is read, so this costs nothing at startup.
const { combinePages, defaultPages } = require('./32-calendar-pdf.js');

/**
 * Saves a freshly read PDF as the calendar, replacing any earlier one (and
 * the days changed by hand on it), with meanings guessed from its legend.
 */
function importRead(read, file) {
  const pages = read.pages || [];
  const meanings = guessMeanings(pages.flatMap(p => p.legend));
  const days = {};
  for (const { mark, text } of pages.flatMap(p => p.legend)) {
    const day = guessScheduleDay(text);
    if (day && !(mark in days)) days[mark] = day;
  }
  for (const p of pages) {
    for (const days of Object.values(p.marks)) {
      for (const m of days) if (!(m in meanings)) meanings[m] = 'ignore';
    }
  }
  const selected = read.selected || defaultPages(pages);
  const cal = readCalendar();
  cal.pdf = {
    importedAt: new Date().toISOString(),
    file: file ? path.basename(file) : '',
    pages,
    selected,
    meanings,
    days,
    ...combinePages(pages, selected),
  };
  cal.overrides = {};
  writeCalendar(cal);
  return cal;
}

/**
 * Saves the user's choices on the saved calendar:
 *   { meanings: { mark: kind | 'ignore' }, icsMeanings: { group: kind | 'event' | 'hide' },
 *     overrides: { date: kind | 'normal' }, pages: [page, …] }
 * Meanings are merged in; overrides and pages, when sent, replace the old ones.
 */
function saveChoices(choices = {}) {
  const cal = readCalendar();
  if (!hasCalendar(cal)) return { ok: false, why: 'no calendar yet: read a PDF or add a feed first' };
  if (cal.pdf && cal.pdf.marks) {
    const meanings = { ...cal.pdf.meanings };
    for (const [mark, kind] of Object.entries(choices.meanings || {})) {
      if (mark in meanings && MEANINGS.includes(kind)) meanings[mark] = kind;
    }
    const days = { ...cal.pdf.days };
    for (const [mark, day] of Object.entries(choices.days || {})) {
      if (!(mark in meanings)) continue;
      if (SCHEDULE_DAYS.includes(day)) days[mark] = day; else if (day === '') delete days[mark];
    }
    cal.pdf = { ...cal.pdf, meanings, days };
  }
  if (cal.ics && (choices.icsMeanings || choices.icsDays)) {
    const meanings = { ...cal.ics.meanings };
    for (const [group, kind] of Object.entries(choices.icsMeanings || {})) {
      if (group in meanings && ICS_MEANINGS.includes(kind)) meanings[group] = kind;
    }
    const days = { ...cal.ics.days };
    for (const [group, day] of Object.entries(choices.icsDays || {})) {
      if (!(group in meanings)) continue;
      if (SCHEDULE_DAYS.includes(day)) days[group] = day; else if (day === '') delete days[group];
    }
    cal.ics = { ...cal.ics, meanings, days };
  }
  if (Array.isArray(choices.pages) && cal.pdf && cal.pdf.pages) {
    const known = cal.pdf.pages.map(p => p.page);
    const selected = choices.pages.map(Number).filter(n => known.includes(n));
    if (!selected.length) return { ok: false, why: 'pick at least one page' };
    cal.pdf = { ...cal.pdf, selected, ...combinePages(cal.pdf.pages, selected) };
  }
  if (choices.overrides) cal.overrides = cleanOverrides(choices.overrides);
  writeCalendar(cal);
  return { ok: true };
}

function cleanOverrides(raw) {
  const out = {};
  for (const [date, kind] of Object.entries(raw || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && [...KINDS, 'normal'].includes(kind)) out[date] = kind;
  }
  return out;
}

/** Forgets the PDF and any days changed by hand (the feed stays). */
function clearCalendar() {
  const cal = readCalendar();
  delete cal.pdf;
  delete cal.overrides;
  writeCalendar(cal);
  return { ok: true };
}

// ── The feed (ICS) ──

/** The group an event title belongs to: "Grade Reports Q1" and "Grade Reports Q2" are one. */
function icsGroup(summary) {
  return String(summary || '').toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z\u00c0-\u024f\u0400-\u04ff]+/g, ' ').trim() || '(untitled)';
}

/**
 * What an event title probably means. A school event with "holiday" in its
 * name (a holiday concert) is still just an event; anything longer than a
 * week that isn't a break (an application period, say) is hidden.
 */
function guessIcsMeaning(summary, days) {
  const t = String(summary || '').toLowerCase();
  if (/minimum day|early (dismissal|release)|half day/.test(t)) return 'minimumDay';
  if (/no school|no classes|school closed|recess|vacation|\bbreak\b|non[- ]student|staff (development|dev)|teacher (work|prep)|in-service|furlough/.test(t)) return 'noSchool';
  if (/holiday/.test(t) && !/concert|party|program|show|sale|drive|celebration|festival|fair/.test(t)) return 'noSchool';
  if (days > 7) return 'hide';
  // Just a schedule day ("Even Day", "B Day"): the schedule shows it, so
  // it isn't listed as an event too.
  if (guessScheduleDay(summary)) return 'hide';
  return 'event';
}

const spanDays = e => Math.round((fromKey(e.end) - fromKey(e.start)) / 864e5) + 1;

/**
 * Saves a fetched feed: its link, its events (a year back to two ahead), and
 * a meaning for every event title, keeping the ones already chosen.
 */
function saveIcs(url, events, now = new Date()) {
  const cal = readCalendar();
  const from = dayKey(addDays(now, -366)), to = dayKey(addDays(now, 731));
  const kept = events.filter(e => e.end >= from && e.start <= to).map(e => ({ ...e, group: icsGroup(e.summary) }));
  const old = (cal.ics && cal.ics.meanings) || {};
  const oldDays = (cal.ics && cal.ics.days) || {};
  const meanings = {}, groups = {}, days = {};
  for (const e of kept) {
    if (e.group in groups) continue;
    groups[e.group] = e.summary;
    // A kind already picked is kept. The schedule day is kept too once it
    // exists; a kind of event saved before there was one gets it guessed,
    // so an "Even Day" already in the feed picks it up on the next fetch.
    const legacyFlip = old[e.group] === 'flip';
    meanings[e.group] = (!legacyFlip && old[e.group]) || guessIcsMeaning(e.summary, spanDays(e));
    const day = e.group in oldDays ? oldDays[e.group] : legacyFlip ? 'flip' : guessScheduleDay(e.summary);
    if (day) days[e.group] = day;
  }
  cal.ics = { url, fetchedAt: now.toISOString(), error: '', events: kept, groups, meanings, days };
  writeCalendar(cal);
  return cal;
}

/** Remembers that fetching the feed failed, keeping the last events that worked. */
function saveIcsError(url, why, now = new Date()) {
  const cal = readCalendar();
  cal.ics = { events: [], groups: {}, meanings: {}, ...cal.ics, url, error: why, failedAt: now.toISOString() };
  writeCalendar(cal);
  return cal;
}

/** Fetches the feed again and saves what came back: { ok, events } or { ok: false, why }. */
async function refreshFeed(url = (readCalendar().ics || {}).url) {
  const result = await require('./34-calendar-ics.js').fetchIcs(url);
  if (result.ok) saveIcs(url, result.events);
  else saveIcsError(url, result.why);
  return result.ok ? { ok: true, events: result.events.length } : { ok: false, why: result.why };
}

/** Forgets the feed. */
function clearIcs() {
  const cal = readCalendar();
  delete cal.ics;
  writeCalendar(cal);
  return { ok: true };
}

/** Whether the feed is due for its once-a-day refresh. */
function icsStale(now = new Date(), cal = readCalendar()) {
  if (!cal.ics || !cal.ics.url) return false;
  const last = Date.parse(cal.ics.failedAt && (!cal.ics.fetchedAt || cal.ics.failedAt > cal.ics.fetchedAt) ? cal.ics.failedAt : cal.ics.fetchedAt || 0);
  return !last || now - last > 20 * 3600e3;
}

// The feed's events by day, built once per read of the file.
const byDayCache = new WeakMap();
function icsOn(key, cal) {
  if (!cal.ics || !cal.ics.events) return [];
  let index = byDayCache.get(cal);
  if (!index) {
    index = {};
    for (const e of cal.ics.events) {
      for (let d = fromKey(e.start), n = 0; dayKey(d) <= e.end && n < 400; d = addDays(d, 1), n++) {
        (index[dayKey(d)] ||= []).push(e);
      }
    }
    byDayCache.set(cal, index);
  }
  return index[key] || [];
}

/**
 * The days the calendar ties to the class schedule, PDF and feed alike:
 * { flips: Set of keys marked just "flipped", set: { key: 'A' | 'B' } for
 * days marked odd/A or even/B }. The class schedule (dayTypes) works out
 * which of the set days are flips.
 */
function markedDays(cal = readCalendar()) {
  const flips = new Set(), set = {};
  const note = (key, day) => { if (day === 'flip') flips.add(key); else if (day) set[key] = day; };
  const pdf = cal.pdf;
  if (pdf && pdf.marks) {
    for (const [key, marks] of Object.entries(pdf.marks)) {
      for (const m of marks) note(key, scheduleDayOf((pdf.meanings || {})[m], (pdf.days || {})[m]));
    }
  }
  if (cal.ics && cal.ics.events) {
    for (const e of cal.ics.events) {
      const day = scheduleDayOf((cal.ics.meanings || {})[e.group], (cal.ics.days || {})[e.group]);
      if (!day) continue;
      for (let d = fromKey(e.start), n = 0; dayKey(d) <= e.end && n < 400; d = addDays(d, 1), n++) note(dayKey(d), day);
    }
  }
  return { flips, set };
}

function legendLabel(pdf, mark) {
  const entry = (pdf.legend || []).find(l => l.mark === mark);
  return entry && entry.text ? entry.text : '';
}

/**
 * One day: { date, kind: 'noSchool' | 'minimumDay' | null, label, events,
 *   scheduleDay: 'A' (odd or A) | 'B' (even or B) | 'flip' | null }.
 * No school beats a minimum day, from the PDF or the feed alike; events are
 * the titles of the feed's events that are just events.
 */
function dayInfo(date, cal = readCalendar()) {
  const key = typeof date === 'string' ? date : dayKey(date);
  let kind = null, label = '';
  const pdf = cal.pdf;
  const found = [];
  let scheduleDay = '';
  if (pdf && pdf.marks && pdf.marks[key]) {
    for (const m of pdf.marks[key]) {
      scheduleDay = scheduleDayOf((pdf.meanings || {})[m], (pdf.days || {})[m]) || scheduleDay;
      found.push({ kind: (pdf.meanings || {})[m], label: legendLabel(pdf, m) });
    }
  }
  const events = [];
  for (const e of icsOn(key, cal)) {
    const meaning = (cal.ics.meanings || {})[e.group];
    scheduleDay = scheduleDayOf(meaning, (cal.ics.days || {})[e.group]) || scheduleDay;
    if (meaning === 'event') events.push(e.summary);
    else found.push({ kind: meaning, label: e.summary });
  }
  for (const want of KINDS) {
    const hit = found.find(f => f.kind === want);
    if (hit) { kind = want; label = hit.label; break; }
  }
  const override = (cal.overrides || {})[key];
  if (override) { kind = override === 'normal' ? null : override; label = ''; }
  return { date: key, kind, label, events, scheduleDay: scheduleDay || null };
}

function hasCalendar(cal = readCalendar()) {
  return !!((cal.pdf && cal.pdf.marks) || (cal.ics && cal.ics.events && cal.ics.events.length));
}

/** A weekday that isn't a no-school day. Without a calendar, every weekday. */
function isSchoolDay(date, cal = readCalendar()) {
  const d = typeof date === 'string' ? fromKey(date) : date;
  return !isWeekend(d) && dayInfo(d, cal).kind !== 'noSchool';
}

/** The first school day after `from` (a Date). Gives up after 120 days. */
function nextSchoolDay(from, cal = readCalendar()) {
  for (let i = 1; i <= 120; i++) {
    const d = addDays(from, i);
    if (isSchoolDay(d, cal)) return d;
  }
  return addDays(from, 1);
}

/**
 * Where an assignment with no due date goes when it's treated as "by
 * tomorrow": the next school day, at the same time of day. With no calendar
 * saved, exactly 24 hours ahead, as it always was.
 */
function placeholderDue(now = new Date(), cal = readCalendar()) {
  if (!hasCalendar(cal)) return new Date(now.getTime() + 864e5);
  const d = nextSchoolDay(now, cal);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return d;
}

/**
 * No-school and minimum days from today through `days` ahead, with runs
 * of the same kind and label joined (a weekend inside a break doesn't
 * split it): [{ from, to, kind, label }].
 */
function upcoming(now = new Date(), days = 14, cal = readCalendar()) {
  const out = [];
  if (!hasCalendar(cal)) return out;
  let lastWeekday = null;
  for (let i = 0; i <= days; i++) {
    const d = addDays(now, i);
    if (isWeekend(d)) continue;
    const info = dayInfo(d, cal);
    const prev = out[out.length - 1];
    if (info.kind) {
      if (prev && lastWeekday && prev.to === dayKey(lastWeekday) && prev.kind === info.kind && prev.label === info.label) {
        prev.to = info.date;
      } else {
        out.push({ from: info.date, to: info.date, kind: info.kind, label: info.label });
      }
    }
    lastWeekday = d;
  }
  return out;
}

/**
 * The feed's events (the ones that are just events) from today through
 * `days` ahead: [{ from, to, summary }], a multi-day one starting today at
 * the earliest.
 */
function upcomingEvents(now = new Date(), days = 14, cal = readCalendar()) {
  if (!cal.ics || !cal.ics.events) return [];
  const from = dayKey(now), to = dayKey(addDays(now, days));
  return cal.ics.events
    .filter(e => (cal.ics.meanings || {})[e.group] === 'event' && e.end >= from && e.start <= to)
    .map(e => ({ from: e.start < from ? from : e.start, to: e.end, summary: e.summary }));
}

module.exports = {
  FILE, KINDS, MEANINGS, ICS_MEANINGS, MARKS,
  readCalendar, guessMeanings, importRead, saveChoices, clearCalendar,
  icsGroup, guessIcsMeaning, saveIcs, saveIcsError, refreshFeed, clearIcs, icsStale,
  SCHEDULE_DAYS, guessScheduleDay, markedDays,
  dayInfo, hasCalendar, isSchoolDay, nextSchoolDay, placeholderDue, upcoming, upcomingEvents, dayKey,
};
