// The school calendar: which days are no-school days and which are
// minimum days, from a calendar PDF (read by 32-calendar-pdf.js), plus any
// day the user changed by hand in the page's Calendar section.
//
// Stored in school-calendar.json:
//   { pdf: { importedAt, file, pages: [{ page, name, months, marks, legend, warnings }],
//            selected: [page, …], meanings: { mark: 'noSchool' | 'minimumDay' | 'ignore' },
//            …and the selected pages combined: months, marks: { date: [mark, …] }, legend, warnings },
//     overrides: { date: 'noSchool' | 'minimumDay' | 'normal' } }
//
// The PDF's marks are kept as they were read, page by page, with what each
// mark means next to them, so changing a meaning or the pages used later
// never needs the PDF again. A PDF can hold a calendar per school for the
// same year: only the selected pages count (see defaultPages() in
// 32-calendar-pdf.js for which are used until the user picks).
// The user's own changes (overrides) always win over the PDF.
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
    ...combinePages(pages, selected),
  };
  cal.overrides = {};
  writeCalendar(cal);
  return cal;
}

/**
 * Saves the user's choices on the saved calendar:
 *   { meanings: { mark: kind | 'ignore' }, overrides: { date: kind | 'normal' },
 *     pages: [page, …] }
 * Meanings are merged in; overrides and pages, when sent, replace the old ones.
 */
function saveChoices(choices = {}) {
  const cal = readCalendar();
  if (!cal.pdf || !cal.pdf.marks) return { ok: false, why: 'no calendar yet: read a PDF first' };
  const meanings = { ...cal.pdf.meanings };
  for (const [mark, kind] of Object.entries(choices.meanings || {})) {
    if (mark in meanings && MEANINGS.includes(kind)) meanings[mark] = kind;
  }
  cal.pdf = { ...cal.pdf, meanings };
  if (Array.isArray(choices.pages) && cal.pdf.pages) {
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

/** Forgets the PDF and any days changed by hand. */
function clearCalendar() {
  const cal = readCalendar();
  delete cal.pdf;
  delete cal.overrides;
  writeCalendar(cal);
  return { ok: true };
}

function legendLabel(pdf, mark) {
  const entry = (pdf.legend || []).find(l => l.mark === mark);
  return entry && entry.text ? entry.text : '';
}

/**
 * One day: { date, kind: 'noSchool' | 'minimumDay' | null, label }.
 * A no-school mark beats a minimum-day mark on the same day.
 */
function dayInfo(date, cal = readCalendar()) {
  const key = typeof date === 'string' ? date : dayKey(date);
  let kind = null, label = '';
  const pdf = cal.pdf;
  if (pdf && pdf.marks && pdf.marks[key]) {
    for (const want of KINDS) {
      const mark = pdf.marks[key].find(m => (pdf.meanings || {})[m] === want);
      if (mark) { kind = want; label = legendLabel(pdf, mark); break; }
    }
  }
  const override = (cal.overrides || {})[key];
  if (override) { kind = override === 'normal' ? null : override; label = ''; }
  return { date: key, kind, label };
}

function hasCalendar(cal = readCalendar()) {
  return !!(cal.pdf && cal.pdf.marks);
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

module.exports = {
  FILE, KINDS, MEANINGS, MARKS,
  readCalendar, guessMeanings, importRead, saveChoices, clearCalendar,
  dayInfo, hasCalendar, isSchoolDay, nextSchoolDay, placeholderDue, upcoming, dayKey,
};
