/**
 * Grade history and grade alerts.
 *
 * Every grade read (Q's own check, and Canvas's and Classroom's during a
 * collection) ends with record(): each class's grade, as gradesView() in
 * 40-grades.js shows it, is compared with the last one kept for it, and a
 * new point is kept only when it changed. That makes grade-history.json a
 * list of changes, not one point per check, so a year fits easily.
 *
 * A series belongs to one place's class ("canvas:US History - Made-up"),
 * not to the class's shown name, so linking classes later or renaming a
 * link doesn't mix two places' numbers. The page draws the series of the
 * grade a class goes by (the one that isn't superseded).
 *
 * The number kept is the one the page shows: the school's percent, or
 * ClassDash's estimate when the teacher hides it (est: true).
 *
 * The changes record() finds are what the alerts are about (Settings →
 * Grades → Grade alerts): every change, only drops, or none. A class's
 * first point is never an alert, it's just where its history starts.
 */
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const FILE = path.join(PROJECT_ROOT, 'grade-history.json');
const KEEP_DAYS = 400;
const KEEP_POINTS = 500;

function readHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return data && typeof data.series === 'object' && data.series ? data : { series: {} };
  } catch {
    return { series: {} };
  }
}

const keyOf = c => `${c.source}:${c.sourceClass || c.class}`;

/** The point for a class's grade right now, or null when there's nothing to keep. */
function pointOf(c, at) {
  const est = (c.percent === null || c.percent === undefined) && c.estimate && typeof c.estimate.percent === 'number';
  const percent = typeof c.percent === 'number' ? c.percent : est ? c.estimate.percent : null;
  const grade = c.grade || null;
  if (percent === null && !grade) return null;
  return { at, percent: percent === null ? null : Math.round(percent * 100) / 100, grade, ...(est ? { est: true } : {}) };
}

const same = (a, b) => a.grade === b.grade && !!a.est === !!b.est &&
  (a.percent === null ? b.percent === null : b.percent !== null && Math.abs(a.percent - b.percent) < 0.01);

/**
 * Keeps a point for every class whose grade changed since its last one,
 * and answers the changes of the grades classes go by:
 * [{ class, source, from, to }]. `view` is gradesView()'s answer.
 */
function record(view, now = new Date()) {
  const data = readHistory();
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString();
  const changes = [];
  let wrote = false;
  for (const c of (view && view.classes) || []) {
    const point = pointOf(c, at);
    if (!point) continue;
    const key = keyOf(c);
    const series = data.series[key] || (data.series[key] = { class: c.class, source: c.source, points: [] });
    series.class = c.class;
    const last = series.points[series.points.length - 1];
    if (last && same(last, point)) continue;
    series.points.push(point);
    series.points = series.points.filter(p => p.at >= cutoff).slice(-KEEP_POINTS);
    wrote = true;
    if (last && !c.superseded) changes.push({ class: c.class, source: c.source, from: last, to: point });
  }
  if (wrote) {
    try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch { /* history just misses this change */ }
  }
  return changes;
}

/** The points of the grade each shown class goes by, by class name. */
function historyByClass(view) {
  const data = readHistory();
  const out = {};
  for (const c of (view && view.classes) || []) {
    if (c.superseded) continue;
    const series = data.series[keyOf(c)];
    if (series && series.points.length) out[c.class] = series.points;
  }
  return out;
}

/** Whether a change is the grade going down: by percent when both have
 *  one, else by letter (A+ best, F worst). */
const LETTERS = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
function isDrop(ch) {
  if (ch.from.percent !== null && ch.to.percent !== null) return ch.to.percent < ch.from.percent;
  const a = LETTERS.indexOf(String(ch.from.grade || '').toUpperCase()), b = LETTERS.indexOf(String(ch.to.grade || '').toUpperCase());
  return a !== -1 && b !== -1 && b < a;
}

/** The changes worth an alert under the setting: 'all', 'drops' or 'off'. */
function alertsFor(changes, mode = 'all') {
  if (mode === 'off') return [];
  return mode === 'drops' ? changes.filter(isDrop) : changes;
}

/** One change in words: "Made-up Biology: 91.2% → 88.4% (B+ → B)". */
function changeText(ch, locale) {
  const num = p => p === null ? null : (p.est ? '~' : '') + p.percent.toLocaleString(locale, { maximumFractionDigits: 2 }) + '%';
  const a = num(ch.from), b = num(ch.to);
  const letters = ch.from.grade !== ch.to.grade && (ch.from.grade || ch.to.grade) ? `${ch.from.grade || '—'} → ${ch.to.grade || '—'}` : '';
  if (a !== null && b !== null && a !== b) return `${ch.class}: ${a} → ${b}${letters ? ` (${letters})` : ''}`;
  return `${ch.class}: ${letters || `${a || '—'} → ${b || '—'}`}`;
}

module.exports = { FILE, readHistory, record, historyByClass, alertsFor, isDrop, changeText };
