// The class schedule: which classes meet on which school day, for schools
// whose days rotate.
//
// Three kinds (Settings → Schedule):
//   daily    the same classes every school day, by period
//   ab       school days alternate A, B, A, B (no-school days skipped)
//   oddEven  the date decides: odd dates are one set of classes, even the other
//
// Stored in school-schedule.json:
//   { type: 'none' | 'daily' | 'ab' | 'oddEven',
//     ab: { anchor: 'YYYY-MM-DD', anchorDay: 'A' | 'B', flipMode: 'day' | 'shift' },
//     flips: ['YYYY-MM-DD', …],
//     classes: [{ class, period, days: 'all' | 'A' | 'B' }],
//     notified: { 'flip:YYYY-MM-DD' | 'repeat:YYYY-MM-DD': iso } }
//
// Odd/even uses the same A/B inside: A is odd, B is even.
//
// A FLIPPED DAY is one the school swaps (a B day on what would be an A
// day). With odd/even, only that date swaps: the next date decides itself.
// With A/B it depends on the school, so it's a setting: 'day' swaps only
// that day, 'shift' restarts the alternation from it, so every later day
// swaps too.
//
// Two things are worth a heads-up the day before (see headsUps), as a
// notification and a banner: a flipped day, and with odd/even a school day
// that's the same as the one before it (the 31st then the 1st, or a
// holiday in between), which makes it easy to bring the wrong work.
//
// Which days are school days comes from the school calendar
// (33-school-calendar.js): weekdays without one.
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');
const calendar = require('./33-school-calendar.js');
const { dayKey, isSchoolDay, nextSchoolDay } = calendar;

const FILE = path.join(PROJECT_ROOT, 'school-schedule.json');
const TYPES = ['none', 'daily', 'ab', 'oddEven'];
const DAYS = ['all', 'A', 'B'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The notification window opens at this hour on the last school day before
// the day in question: after school, the evening before.
const NOTICE_HOUR = 15;

const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const other = day => (day === 'A' ? 'B' : 'A');
const asDate = date => (typeof date === 'string' ? fromKey(date) : new Date(date.getFullYear(), date.getMonth(), date.getDate()));

function emptySchedule() {
  return { type: 'none', ab: { anchor: null, anchorDay: 'A', flipMode: 'day' }, flips: [], classes: [], notified: {} };
}

function readSchedule() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* none yet */ }
  const base = emptySchedule();
  if (!saved || typeof saved !== 'object') return base;
  return { ...base, ...saved, ab: { ...base.ab, ...(saved.ab || {}) } };
}

function writeSchedule(sched) {
  fs.writeFileSync(FILE, JSON.stringify(sched, null, 2));
}

const validDate = v => typeof v === 'string' && DATE.test(v) && dayKey(fromKey(v)) === v;

/**
 * Saves what the page sends: any of { type, ab: {anchor, anchorDay,
 * flipMode}, flips, classes }. What's sent replaces what was there; a field
 * that doesn't check out refuses the whole save, so nothing half-saves.
 */
function saveSchedule(choices = {}) {
  const sched = readSchedule();
  if ('type' in choices) {
    if (!TYPES.includes(choices.type)) return { ok: false, why: 'unknown schedule type' };
    sched.type = choices.type;
  }
  if ('ab' in choices) {
    const ab = choices.ab || {};
    if ('anchor' in ab && ab.anchor !== null && !validDate(ab.anchor)) return { ok: false, why: 'bad date for the A/B start' };
    if ('anchorDay' in ab && !['A', 'B'].includes(ab.anchorDay)) return { ok: false, why: 'the A/B start has to be A or B' };
    if ('flipMode' in ab && !['day', 'shift'].includes(ab.flipMode)) return { ok: false, why: 'unknown flip mode' };
    sched.ab = { ...sched.ab, ...ab };
  }
  if ('flips' in choices) {
    if (!Array.isArray(choices.flips) || choices.flips.length > 400 || !choices.flips.every(validDate)) return { ok: false, why: 'bad flipped days' };
    sched.flips = [...new Set(choices.flips)].sort();
  }
  if ('classes' in choices) {
    const list = choices.classes;
    const fine = c => c && typeof c.class === 'string' && c.class.trim() && c.class.length <= 200 && DAYS.includes(c.days) &&
      (c.period === null || (Number.isInteger(c.period) && c.period >= 0 && c.period <= 20));
    if (!Array.isArray(list) || list.length > 60 || !list.every(fine)) return { ok: false, why: 'bad class list' };
    // Kept in period order (no period last), the way the page lists them.
    const order = c => (c.period === null ? 99 : c.period);
    sched.classes = list.map(c => ({ class: c.class.trim(), period: c.period, days: c.days }))
      .map((c, i) => [c, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map(([c]) => c);
  }
  writeSchedule(sched);
  return { ok: true };
}

/**
 * The period a class name gives away, or null: "P1", "Per 2", "Per. 3",
 * "Pd 4", "Period 5", "(P6)", "3rd period". "AP" or "Chap" don't count,
 * and neither does a number standing alone ("Biology 1").
 */
function periodFromName(name) {
  const text = String(name || '');
  const m = /(?:^|[^a-z])(?:p|pd|per|period)\.?\s*(\d{1,2})(?!\d)/i.exec(text) ||
    /(?:^|[^0-9])(\d{1,2})(?:st|nd|rd|th)\s+period\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= 20 ? n : null;
}

/** The school day before `date`, or null within 60 days. */
function previousSchoolDay(date, cal) {
  for (let i = 1; i <= 60; i++) {
    const d = addDays(asDate(date), -i);
    if (isSchoolDay(d, cal)) return d;
  }
  return null;
}

/**
 * A and B for every school day from `from` to `to` (Dates or keys), as
 * { 'YYYY-MM-DD': { day, flipped } }. Walked once, so a whole year costs
 * one pass, not one per day.
 */
function dayTypes(from, to, sched = readSchedule(), cal = calendar.readCalendar()) {
  const out = {};
  const start = asDate(from), end = asDate(to);
  if (start > end || !['ab', 'oddEven'].includes(sched.type)) return out;
  const flips = new Set(sched.flips || []);

  if (sched.type === 'oddEven') {
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!isSchoolDay(d, cal)) continue;
      const key = dayKey(d), flipped = flips.has(key);
      const base = d.getDate() % 2 === 1 ? 'A' : 'B';
      out[key] = { day: flipped ? other(base) : base, flipped };
    }
    return out;
  }

  // A/B: counted in school days from the anchor, the day the user said
  // what today is. The anchor's own day is the real one, flip or not.
  const ab = sched.ab || {};
  if (!validDate(ab.anchor)) return out;
  const anchor = fromKey(ab.anchor);
  const shift = ab.flipMode === 'shift';
  // In 'day' mode a flipped anchor's real day is the swap of its phase.
  const phase = !shift && flips.has(ab.anchor) && isSchoolDay(anchor, cal) ? other(ab.anchorDay) : ab.anchorDay;
  const at = (d, steps, toggles) => {
    const key = dayKey(d), flipped = flips.has(key);
    let day = steps % 2 === 0 ? phase : other(phase);
    if (toggles % 2 === 1) day = other(day);
    if (!shift && flipped) day = other(day);
    return { day, flipped };
  };
  // Forward: school days in [anchor, d) are the steps; with 'shift', each
  // flip in (anchor, d] toggles from there on.
  let steps = 0, toggles = 0;
  for (let d = anchor; d <= end; d = addDays(d, 1)) {
    if (!isSchoolDay(d, cal)) continue;
    if (shift && flips.has(dayKey(d)) && d > anchor) toggles++;
    if (d >= start) out[dayKey(d)] = at(d, steps, toggles);
    steps++;
  }
  // Backward: school days in [d, anchor) are the steps; with 'shift', each
  // flip in (d, anchor] toggles.
  steps = 0; toggles = 0;
  let after = null;   // the school day after d, walking back
  if (shift && flips.has(ab.anchor) && isSchoolDay(anchor, cal)) toggles++;
  for (let d = addDays(anchor, -1); d >= start; d = addDays(d, -1)) {
    if (!isSchoolDay(d, cal)) continue;
    if (shift && after && flips.has(dayKey(after)) && after < anchor) toggles++;
    steps++;
    out[dayKey(d)] = at(d, steps, toggles);
    after = d;
  }
  return out;
}

/** The day type of one date: { day, flipped } or null (not a school day, or
 *  the schedule doesn't rotate). */
function dayType(date, sched = readSchedule(), cal = calendar.readCalendar()) {
  return dayTypes(date, date, sched, cal)[dayKey(asDate(date))] || null;
}

/** The classes meeting on a date, by period. */
function classesOn(date, sched = readSchedule(), cal = calendar.readCalendar()) {
  if (sched.type === 'none' || !isSchoolDay(asDate(date), cal)) return [];
  let list = sched.classes || [];
  if (sched.type !== 'daily') {
    const type = dayType(date, sched, cal);
    if (!type) return [];
    list = list.filter(c => c.days === 'all' || c.days === type.day);
  }
  const order = c => (c.period === null || c.period === undefined ? 99 : c.period);
  return [...list].sort((a, b) => order(a) - order(b));
}

/**
 * Heads-ups for today (if it's a school day) and the next school day:
 *   { kind: 'flip', date, day }               the school flipped that day
 *   { kind: 'repeat', date, day, previous }   odd/even: the same as the school
 *                                             day before it (31st → 1st, a holiday)
 */
function headsUps(now = new Date(), sched = readSchedule(), cal = calendar.readCalendar()) {
  if (!['ab', 'oddEven'].includes(sched.type)) return [];
  const targets = [];
  if (isSchoolDay(now, cal)) targets.push(asDate(now));
  targets.push(nextSchoolDay(now, cal));
  const out = [];
  for (const target of targets) {
    const type = dayType(target, sched, cal);
    if (!type) continue;
    const date = dayKey(target);
    if (type.flipped) out.push({ kind: 'flip', date, day: type.day });
    if (sched.type === 'oddEven') {
      const before = previousSchoolDay(target, cal);
      const was = before && dayType(before, sched, cal);
      if (was && was.day === type.day) out.push({ kind: 'repeat', date, day: type.day, previous: dayKey(before) });
    }
  }
  return out;
}

/**
 * The next school day's heads-ups that are due a notification and haven't
 * had one: the window opens at 3 PM on the school day before it (so on a
 * weekend, Friday's window is already open for Monday).
 */
function dueNotifications(now = new Date(), sched = readSchedule(), cal = calendar.readCalendar()) {
  const next = nextSchoolDay(now, cal);
  const before = previousSchoolDay(next, cal);
  if (before) {
    const opens = new Date(before.getFullYear(), before.getMonth(), before.getDate(), NOTICE_HOUR);
    if (now < opens) return [];
  }
  const notified = sched.notified || {};
  return headsUps(now, sched, cal).filter(h => h.date === dayKey(next) && !notified[`${h.kind}:${h.date}`]);
}

/** Records heads-ups as notified, so each one goes out once. Old entries
 *  (over 60 days) are dropped. */
function markNotified(list, now = new Date()) {
  if (!list.length) return;
  const sched = readSchedule();
  const keep = {};
  const cutoff = dayKey(addDays(now, -60));
  for (const [k, v] of Object.entries(sched.notified || {})) if (k.split(':')[1] >= cutoff) keep[k] = v;
  for (const h of list) keep[`${h.kind}:${h.date}`] = now.toISOString();
  sched.notified = keep;
  writeSchedule(sched);
}

/** One day for the page and the API. */
function dayView(date, sched, cal) {
  const type = dayType(date, sched, cal);
  return {
    date: dayKey(asDate(date)),
    schoolDay: isSchoolDay(asDate(date), cal),
    day: type ? type.day : null,
    flipped: type ? type.flipped : false,
    classes: classesOn(date, sched, cal).map(c => ({ class: c.class, period: c.period })),
  };
}

/** Today, the next school day and the heads-ups, for the page and /api/schedule. */
function scheduleView(now = new Date(), sched = readSchedule(), cal = calendar.readCalendar()) {
  return {
    type: sched.type,
    today: dayView(now, sched, cal),
    next: dayView(nextSchoolDay(now, cal), sched, cal),
    headsUps: headsUps(now, sched, cal),
  };
}

/** What the page needs: the saved schedule (without the notification
 *  record), each school day's A/B around today, and scheduleView. */
function schedulePayload(now = new Date()) {
  const sched = readSchedule();
  const cal = calendar.readCalendar();
  const { notified, ...saved } = sched;
  return { saved, days: dayTypes(addDays(now, -200), addDays(now, 400), sched, cal), view: scheduleView(now, sched, cal) };
}

module.exports = {
  FILE, TYPES, readSchedule, saveSchedule, periodFromName, dayTypes, dayType, classesOn, previousSchoolDay,
  headsUps, dueNotifications, markNotified, scheduleView, schedulePayload,
};
