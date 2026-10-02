// Reads a school calendar PDF: month grids whose days carry marks (a
// circle, a slash, a triangle drawn over the number, or an X or * after
// it), plus a legend saying what each mark means.
//
// THE MARKS AREN'T TEXT. The day numbers and month titles are real text,
// each with its own position, but a circle around "7" is a drawn shape: a
// program reading only the text sees "7" and nothing else. So this walks
// the page's drawing operations too, sorts each shape into circle, slash
// or triangle by its outline, and puts it on the day number it sits on.
// A shape that sits on no day is a legend candidate, read together with
// the text beside it.
//
// What each mark means is only guessed from the legend: the page's Calendar
// section shows it for the user to set, and any day can be changed there.
// See 33-school-calendar.js for what's saved.
//
// PDF.js (pdfjs-dist) does the PDF parsing. It's an ES module, so it's
// loaded with import() the first time a PDF is read, never at startup.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const MONTH_TITLE = /^([A-Za-z]+),?\s+(\d{4})$/;
const DAY = /^(\d{1,2})([X*])?$/;
const SHARED_DAYS = /^(\d{1,2})\s*\/\s*(\d{1,2})$/;   // "24/31": two days in one cell
const SUFFIXES = ['X', '*'];

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const dir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const build = path.join(dir, 'legacy', 'build');
    // While loading, PDF.js says (on stdout, via console.log) that it can't
    // draw pages without @napi-rs/canvas. Nothing here draws a page, and
    // stdout is where the actions script answers, so those lines are dropped.
    const log = console.log;
    console.log = (...args) => {
      if (!/^Warning: Cannot (load "@napi-rs\/canvas"|polyfill)/.test(String(args[0]))) log(...args);
    };
    pdfjsPromise = import(pathToFileURL(path.join(build, 'pdf.min.mjs')).href).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(build, 'pdf.worker.min.mjs')).href;
      return { pdfjs, dir };
    }).finally(() => { console.log = log; });
  }
  return pdfjsPromise;
}

const pad = n => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ── Shapes ──

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Every path drawn on the page, in page coordinates: its points and how many curves it has. */
function pathsOf(opList, OPS) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let k = 0; k < opList.fnArray.length; k++) {
    const fn = opList.fnArray[k], args = opList.argsArray[k];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    // A form (a drawing reused like a stamp, common for a whole page made in
    // another program) brings its own matrix, for everything inside it.
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.constructPath) {
      const [ops, coords] = args;
      let c = 0, curves = 0, rects = 0, pieces = 0;
      const points = [];
      for (const op of ops) {
        if (op === OPS.moveTo || op === OPS.lineTo) { points.push(apply(ctm, coords[c], coords[c + 1])); c += 2; if (op === OPS.moveTo) pieces++; }
        else if (op === OPS.curveTo) { points.push(apply(ctm, coords[c + 4], coords[c + 5])); c += 6; curves++; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { points.push(apply(ctm, coords[c + 2], coords[c + 3])); c += 4; curves++; }
        else if (op === OPS.rectangle) { c += 4; rects++; }
      }
      if (points.length && !rects) out.push({ points, curves, pieces });
    }
  }
  return out;
}

/**
 * circle, slash, triangle or null, for one path. `cell` is the distance
 * between neighboring day numbers, so the size limits follow the PDF's scale.
 *
 *   circle    drawn with curves (a circle or ellipse is 4 Bézier curves)
 *   slash     a single diagonal line, or a thin filled sliver along one
 *   triangle  three corners, filling about half its box
 */
function classify(p, cell) {
  const xs = p.points.map(q => q[0]), ys = p.points.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  const shape = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, x1, y0, y1 };
  if (w > 1.6 * cell || h > 1.6 * cell || Math.max(w, h) < 0.35 * cell) return null;
  if (p.curves >= 3) return (w > 0.3 * cell && h > 0.3 * cell) ? { ...shape, kind: 'circle' } : null;
  if (p.curves || p.pieces > 1) return null;   // several separate strokes: hatching, not a mark
  if (w < 0.3 * cell || h < 0.3 * cell) return null;   // an underline or a box edge, not a mark
  const corners = cornersOf(p.points, w * h);
  if (corners.length === 2) return { ...shape, kind: 'slash' };
  const fill = areaOf(corners) / (w * h);
  if (fill < 0.3) return { ...shape, kind: 'slash' };
  if (corners.length === 3 && fill < 0.7) return { ...shape, kind: 'triangle' };
  return null;
}

const triArea = ([ax, ay], [bx, by], [cx, cy]) => Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;

function areaOf(corners) {
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % corners.length];
    area += ax * by - bx * ay;
  }
  return Math.abs(area) / 2;
}

/** The outline's real corners: repeated points and points along a straight edge dropped. */
function cornersOf(points, boxArea) {
  let corners = [];
  for (const [x, y] of points) {
    if (!corners.some(([a, b]) => Math.abs(a - x) < 0.5 && Math.abs(b - y) < 0.5)) corners.push([x, y]);
  }
  for (let changed = true; changed && corners.length > 2;) {
    changed = false;
    for (let i = 0; i < corners.length; i++) {
      const prev = corners[(i + corners.length - 1) % corners.length], next = corners[(i + 1) % corners.length];
      if (triArea(prev, corners[i], next) < 0.02 * boxArea) { corners.splice(i, 1); changed = true; break; }
    }
  }
  return corners;
}

// ── Text ──

function textItems(content) {
  return content.items
    .filter(i => i.str && i.str.trim())
    .map(i => {
      const x = i.transform[4], y = i.transform[5];
      const h = i.height || Math.abs(i.transform[3]) || 10;
      return { s: i.str.trim(), x, y, w: i.width, h, cx: x + i.width / 2, cy: y + h / 2 };
    });
}

/**
 * PDF.js joins text that sits close together into one item, so a row can
 * come out as "20X 21". Each day in it gets its share of the item's width,
 * by its place in the string. Anything that isn't all day numbers is left
 * alone.
 */
function splitRun(t) {
  const tokens = [...t.s.matchAll(/\S+/g)];
  if (tokens.length < 2 || !tokens.every(k => DAY.test(k[0]))) return [];
  const per = t.w / t.s.length;
  return tokens.map(k => {
    const [, num, suffix] = DAY.exec(k[0]);
    const x = t.x + k.index * per, w = k[0].length * per;
    return { ...t, s: k[0], x, w, cx: x + w / 2, nums: [+num], suffix: suffix || '' };
  });
}

/**
 * The legend text beside a mark: the words that start just right of it,
 * running on while the gaps between them stay small, plus a second line
 * that starts where the first did. A big gap means something else (a note
 * further along the same line, like a count of school days), not the legend.
 */
function legendText(mark, items, cell, otherMarks) {
  const stopAt = Math.min(...otherMarks.filter(o => o.x0 > mark.x1 && Math.abs(o.cy - mark.cy) < cell).map(o => o.x0), Infinity);
  const near = items.filter(t => t.x >= mark.x1 - 1 && t.x < Math.min(stopAt, mark.x1 + 8 * cell) && Math.abs(t.cy - mark.cy) <= 1.1 * cell)
    .sort((a, b) => b.cy - a.cy);
  const lines = [];
  for (const t of near) {
    const line = lines.find(l => Math.abs(l[0].cy - t.cy) <= Math.max(2, 0.4 * t.h));
    if (line) line.push(t); else lines.push([t]);
  }
  const words = [];
  let startX = null;
  for (const line of lines.slice(0, 3)) {
    line.sort((a, b) => a.x - b.x);
    const first = startX === null
      ? line.find(t => t.x - mark.x1 <= 1.5 * cell)
      : line.find(t => Math.abs(t.x - startX) <= cell);
    if (!first) continue;
    if (startX === null) startX = first.x;
    let prev = first;
    words.push(first.s);
    for (const t of line.slice(line.indexOf(first) + 1)) {
      if (t.x - (prev.x + prev.w) > Math.max(prev.h, 0.6 * cell)) break;
      words.push(t.s);
      prev = t;
    }
    if (words.length && lines.indexOf(line) >= 1) break;   // two lines at most
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** A month name, full or cut short ("Sept", "Oct."), as 0-11, or -1. */
function monthIndex(word) {
  const w = String(word).toLowerCase().replace(/[.,]/g, '');
  if (w.length < 3) return -1;
  return MONTHS.findIndex(m => m === w || (m.startsWith(w) && w.length >= 3) || (w === 'sept' && m === 'september'));
}

/**
 * The month titles on a page, with their year. A title is usually one text
 * item ("July, 2026"), but it can come as two ("July," and "2026"), or as
 * just the month, with the school year written once at the top
 * ("2027-2028"): then July to December are the first year, January to June
 * the second.
 */
function monthTitles(items) {
  const titles = [];
  const schoolYear = items.map(t => /\b(20\d\d)\s*[-–—\/]\s*(?:20)?(\d\d)\b/.exec(t.s)).find(Boolean);
  for (const t of items) {
    let m = MONTH_TITLE.exec(t.s);
    if (m && monthIndex(m[1]) !== -1) { titles.push({ ...t, month: monthIndex(m[1]), year: +m[2] }); continue; }
    m = /^([A-Za-z]+)\.?,?$/.exec(t.s);
    if (!m || monthIndex(m[1]) === -1) continue;
    const month = monthIndex(m[1]);
    const next = items.find(o => o !== t && /^\d{4}$/.test(o.s) && Math.abs(o.cy - t.cy) < t.h / 2 &&
      o.x >= t.x + t.w - 1 && o.x - (t.x + t.w) < 3 * t.h);
    if (next) titles.push({ ...t, w: next.x + next.w - t.x, cx: (t.x + next.x + next.w) / 2, month, year: +next.s });
    else if (schoolYear) titles.push({ ...t, month, year: month >= 6 ? +schoolYear[1] : +schoolYear[1] + 1 });
  }
  return titles;
}

/** Each day number's month: the nearest title above it, in its column, within a month box's height. */
function placeDays(numbers, titles, cell) {
  const placed = [];
  for (const n of numbers) {
    let best = null;
    for (const t of titles) {
      const above = t.cy - n.cy;
      if (above <= 0 || above > 9 * cell || Math.abs(n.cx - t.cx) > 4.5 * cell) continue;
      if (!best || above < best.cy - n.cy) best = t;
    }
    if (best) placed.push({ n, title: best });
  }
  return placed;
}

function readPage(content, opList, OPS, out, stats) {
  const items = textItems(content);
  let titles = monthTitles(items);
  stats.textItems = items.length;
  if (!titles.length) { stats.sample = items.slice(0, 40).map(t => t.s.replace(/[A-Za-z]/g, 'a').replace(/\d/g, '9')); return; }

  // Day numbers, each split into one entry per day ("24/31" is two).
  const numbers = [];
  for (const t of items) {
    let m;
    if ((m = DAY.exec(t.s))) numbers.push({ ...t, nums: [+m[1]], suffix: m[2] || '' });
    else if ((m = SHARED_DAYS.exec(t.s))) numbers.push({ ...t, nums: [+m[1], +m[2]], suffix: '' });
    else numbers.push(...splitRun(t));
  }
  // The spacing between neighboring day numbers sets the scale for everything else.
  const gaps = numbers.map(a => Math.min(...numbers.filter(b => b !== a)
    .map(b => Math.hypot(a.cx - b.cx, a.cy - b.cy)).filter(d => d > 1)));
  const cell = median(gaps.filter(Number.isFinite)) || 20;

  // A title with hardly any days under it is a stray word ("March" in a
  // sentence), not a month box: it's dropped and the days placed again.
  let placed = placeDays(numbers, titles, cell);
  const real = titles.filter(t => placed.filter(p => p.title === t).length >= 20);
  if (real.length < titles.length) { titles = real; placed = placeDays(numbers, titles, cell); }
  stats.titles = titles.map(t => `${t.year}-${pad(t.month + 1)}`);
  stats.dayNumbers = numbers.length;

  const days = [];
  for (const { n, title: best } of placed) {
    for (const d of n.nums) {
      if (d < 1 || d > daysIn(best.year, best.month)) {
        out.warnings.push(`${MONTHS[best.month]} ${best.year} has a day number ${d}, which it can't have; left out`);
        continue;
      }
      days.push({ date: isoDate(best.year, best.month, d), cx: n.cx, cy: n.cy, suffix: n.suffix });
    }
  }
  stats.daysPlaced = days.length;
  for (const t of titles) {
    const key = `${t.year}-${pad(t.month + 1)}`;
    if (!out.months.includes(key)) out.months.push(key);
  }

  const addMark = (date, kind) => {
    const list = (out.marks[date] ||= []);
    if (!list.includes(kind)) list.push(kind);   // a mark drawn twice counts once
  };
  for (const d of days) if (d.suffix) addMark(d.date, d.suffix);

  const shapes = pathsOf(opList, OPS).map(p => classify(p, cell)).filter(Boolean);
  stats.shapes = shapes.reduce((o, sh) => { o[sh.kind] = (o[sh.kind] || 0) + 1; return o; }, {});
  const loose = [];
  for (const s of shapes) {
    let best = null, bestDist = Infinity;
    for (const d of days) {
      const dist = Math.hypot(d.cx - s.cx, d.cy - s.cy);
      if (dist < bestDist) { best = d; bestDist = dist; }
    }
    if (best && bestDist <= 0.6 * cell) {
      // A shared cell ("24/31"): the mark is on every day in it.
      for (const d of days) if (Math.abs(d.cx - best.cx) < 1 && Math.abs(d.cy - best.cy) < 1) addMark(d.date, s.kind);
    } else {
      loose.push(s);
    }
  }

  // The legend: loose shapes, plus an X or * standing on its own, each read
  // with the text to its right. The first one found for a mark wins.
  const symbols = items.filter(t => SUFFIXES.includes(t.s))
    .map(t => ({ kind: t.s, x0: t.x, x1: t.x + t.w, cx: t.cx, cy: t.cy }));
  const candidates = [...loose, ...symbols];
  const words = items.filter(t => !SUFFIXES.includes(t.s) && !DAY.test(t.s) && !titles.some(ti => ti.x === t.x && ti.y === t.y));
  for (const c of candidates) {
    if (out.legend.some(l => l.mark === c.kind)) continue;
    out.legend.push({ mark: c.kind, text: legendText(c, words, cell, candidates.filter(o => o !== c)) });
  }
  out.name = pageHeading(items, titles);
}

/**
 * The page's heading (often the school's name): the biggest text above the
 * month grids. Shown when choosing between pages, so a PDF with a calendar
 * per school can say which is which.
 */
function pageHeading(items, titles) {
  const top = Math.max(...titles.map(t => t.cy));
  const above = items.filter(t => t.cy > top + t.h && !/^\d+$/.test(t.s));
  if (!above.length) return '';
  const biggest = Math.max(...above.map(t => t.h));
  return above.filter(t => t.h >= 0.8 * biggest)
    .sort((a, b) => (Math.abs(a.cy - b.cy) > 2 ? b.cy - a.cy : a.x - b.x))
    .map(t => t.s).join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const overlaps = (a, b) => a.months.some(m => b.months.includes(m));

/**
 * Which pages to use when nothing's been chosen: the first, plus any page
 * for other months (a PDF with a page per school year). A page for the same
 * months as one already used is another calendar for the same year (another
 * school's, say), so it's left for the user to pick instead.
 */
function defaultPages(pages) {
  const chosen = [];
  for (const p of pages) if (!chosen.some(c => overlaps(c, p))) chosen.push(p);
  return chosen.map(p => p.page);
}

/** The chosen pages as one calendar: { months, marks, legend, warnings }. */
function combinePages(pages, selected) {
  const out = { months: [], marks: {}, legend: [], warnings: [] };
  for (const p of pages.filter(pg => selected.includes(pg.page))) {
    for (const m of p.months) if (!out.months.includes(m)) out.months.push(m);
    for (const [date, marks] of Object.entries(p.marks)) {
      const list = (out.marks[date] ||= []);
      for (const m of marks) if (!list.includes(m)) list.push(m);
    }
    for (const l of p.legend) if (!out.legend.some(o => o.mark === l.mark)) out.legend.push(l);
    out.warnings.push(...p.warnings);
  }
  out.months.sort();
  return out;
}

/**
 * readCalendarPdf(file) →
 *   { ok: true, pages: [{ page, name, months, marks, legend, warnings }, …],
 *     selected: [1], …and the selected pages combined (combinePages):
 *     months: ['2026-07', …], marks: { '2026-07-03': ['circle'], … },
 *     legend: [{ mark: 'circle', text: 'State Holiday' }, …], warnings: [] }
 *   { ok: false, why: 'unreadable' | 'noText' | 'noMonths', error? }
 *
 * Each page with month grids is its own calendar; defaultPages() says which
 * are used until the user picks. Marks are 'circle', 'slash', 'triangle', 'X'
 * and '*'.
 */
async function readCalendarPdf(file, options = {}) {
  let doc;
  try {
    const { pdfjs, dir } = await loadPdfjs();
    doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(file)),
      cMapUrl: path.join(dir, 'cmaps') + path.sep,
      cMapPacked: true,
      verbosity: 0,
      isEvalSupported: false,
    }).promise;
    const calendars = [];
    const pageStats = [];
    let anyText = false;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      if (content.items.some(i => i.str && i.str.trim())) anyText = true;
      const one = { page: n, name: '', months: [], marks: {}, legend: [], warnings: [] };
      const stats = { page: n };
      readPage(content, await page.getOperatorList(), pdfjs.OPS, one, stats);
      pageStats.push(stats);
      if (one.months.length) { one.months.sort(); calendars.push(one); }
    }
    const extra = options.diagnose ? { pageStats } : {};
    if (!anyText) return { ok: false, why: 'noText', ...extra };
    if (!calendars.length) return { ok: false, why: 'noMonths', ...extra };
    const selected = defaultPages(calendars);
    return { ok: true, pages: calendars, selected, ...combinePages(calendars, selected), ...extra };
  } catch (e) {
    return { ok: false, why: 'unreadable', error: String(e && e.message || e) };
  } finally {
    if (doc) doc.destroy().catch(() => {});
  }
}

module.exports = { readCalendarPdf, classify, monthIndex, defaultPages, combinePages };

// node 32-calendar-pdf.js --diagnose calendar.pdf
//
// For a PDF that reads wrong: what was found on each page (how many text
// items, which months, how many day numbers and marks), with no names or
// event text. A page where no month was found shows the shape of its first
// text items instead, letters as "a" and digits as "9".
if (require.main === module) {
  const [flag, file] = process.argv.slice(2);
  if (flag !== '--diagnose' || !file) {
    console.log('usage: node 32-calendar-pdf.js --diagnose calendar.pdf');
    process.exit(1);
  }
  readCalendarPdf(file, { diagnose: true }).then(r => {
    console.log(r.ok ? `read: ${r.pages.length} page(s) with calendars, using page ${r.selected.join(', ')}: ${r.months.length} months, ${Object.keys(r.marks).length} days marked, ${r.warnings.length} warnings`
      : `not read: ${r.why}${r.error ? ' (' + r.error + ')' : ''}`);
    for (const p of r.pageStats || []) {
      console.log(`page ${p.page}: ${p.textItems || 0} text items` +
        (p.titles ? `, months ${p.titles.join(' ') || 'none'}, ${p.dayNumbers} day numbers, ${p.daysPlaced} placed, shapes ${JSON.stringify(p.shapes || {})}` : ', no month titles'));
      if (p.sample && p.sample.length) console.log('  first text items: ' + p.sample.join(' | '));
    }
  });
}
