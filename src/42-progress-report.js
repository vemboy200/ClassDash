/**
 * Q's Student Progress Report: the PDF behind the printer button beside a
 * class's grade on the Assignments page. What it has that the Assignments
 * page doesn't: every assignment in the term (the page shows about two
 * weeks), each one's category, the term's points, the grade even where the
 * page hides it, and the class's grading scale. What it doesn't have:
 * category weights. Those, where a teacher uses them, come from the person
 * (gradesWeights, see 41-grades-center.js).
 *
 * ── Getting it ──
 *
 * The printer button (OpenProgress(id)) posts id to Home/AssignmentProgRpt,
 * which answers with a list of terms (5 Week Progress, 1st Quarter, 1st
 * Semester…), each with its dates, grade, and a link
 * PrintProgress2(id, 'Q1') that opens Home/PrintProgressReport/id^Q1: the
 * PDF. 40-grades.js fetches both inside the signed-in page; this file reads
 * them. Not every class has the button.
 *
 * ── Reading it ──
 *
 * The PDF is text with positions, no table structure: a header row (Due
 * Date, Category, Assignment, Max, Score, Pct, EC NG) and then lines. A
 * line starting with a date starts an assignment; one without carries on
 * the one above (long categories and titles wrap). Each word goes to the
 * column whose header it sits under. PDF.js joins nearby text into one
 * item ("10.0 100.0%"), so items are split into words first, with each
 * word's place estimated from its share of the item's width.
 */
const fs = require('fs');
const path = require('path');

/** The term list AssignmentProgRpt answers with, from a parsed document.
 *  Self-contained (no outside names), so it can run inside Q's page. */
function parseTermList(doc) {
  const iso = t => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t || ''); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  const out = [];
  for (const tr of doc.querySelectorAll('#tbltermlist tbody tr')) {
    const cells = [...tr.querySelectorAll('td')];
    const link = tr.querySelector('a[href*="PrintProgress2"]');
    const m = link && /PrintProgress2\(\s*['"]?(\d+)['"]?\s*,\s*['"]([^'"]+)['"]\s*\)/.exec(link.getAttribute('href'));
    if (!m || cells.length < 4) continue;
    const gradeText = cells[3].textContent.replace(/\s+/g, ' ').trim();
    const g = /^([^()]*?)\s*(?:\(\s*(-?[\d.]+)\s*%?\s*\))?$/.exec(gradeText);
    out.push({
      name: cells[0].textContent.replace(/\s+/g, ' ').trim(),
      begin: iso(cells[1].textContent),
      end: iso(cells[2].textContent),
      grade: g && g[1].trim() ? g[1].trim() : null,
      percent: g && g[2] !== undefined && isFinite(parseFloat(g[2])) ? parseFloat(g[2]) : null,
      id: m[1],
      code: m[2],
    });
  }
  return out;
}

/** Which term to read: one that's on today, the longest (the semester,
 *  the one Q's own Current Grade is for, with the most work in it); else
 *  the one that ended last. */
function chooseTerm(terms, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  const span = t => (Date.parse(t.end) - Date.parse(t.begin)) || 0;
  const on = terms.filter(t => t.begin && t.end && t.begin <= day && day <= t.end).sort((a, b) => span(b) - span(a));
  if (on.length) return on[0];
  const ended = terms.filter(t => t.end && t.end < day).sort((a, b) => b.end.localeCompare(a.end));
  return ended[0] || terms[0] || null;
}

const iso = t => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const num = t => { const n = parseFloat(String(t).replace(/[%,]/g, '')); return /^-?[\d,]*\.?\d+%?$/.test(t) && isFinite(n) ? n : null; };

// Each text item split into words, each with its estimated x. Letters
// vary in width, so a word's place from the left drifts along a long
// title; digits don't (in the fonts reports use, every digit is the same
// width), so numbers at the end of an item ("Made-up Lab 10.0 10.0
// 100.0%") are placed back from its right end instead, which is exact.
const NUMBER_WIDTH = { '.': 0.278, ',': 0.278, ' ': 0.278, '%': 0.889, '-': 0.333 };
const widthOf = t => [...t].reduce((n, ch) => n + (/\d/.test(ch) ? 0.556 : NUMBER_WIDTH[ch] ?? 0.556), 0);
function words(items) {
  const out = [];
  for (const it of items) {
    const per = it.s.length ? it.w / it.s.length : 0;
    for (const m of it.s.matchAll(/\S+/g)) {
      const rest = it.s.slice(m.index).replace(/\s+$/, '');
      const x = it.size && /^[\d.,%\s-]+$/.test(rest) ? it.x + it.w - widthOf(rest) * it.size : it.x + m.index * per;
      out.push({ s: m[0], x, y: it.y });
    }
  }
  return out;
}
// Lines, top to bottom: words within 2 points of the same height.
function lines(ws) {
  const rows = [];
  for (const w of [...ws].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r.y - w.y) <= 2);
    if (row) row.words.push(w); else rows.push({ y: w.y, words: [w] });
  }
  for (const r of rows) { r.words.sort((a, b) => a.x - b.x); r.text = r.words.map(w => w.s).join(' '); }
  return rows;
}

/** The assignment table's columns, from its header line. */
function columns(header) {
  const at = re => { const w = header.words.find(x => re.test(x.s)); return w ? w.x : null; };
  const due = at(/^Due$/i), category = at(/^Category$/i), title = at(/^Assignment$/i), score = at(/^Score$/i), pct = at(/^Pct$/i);
  if (due === null || title === null || score === null) return null;
  // Max (points possible) has no fixed name we rely on: it's the header
  // word between Assignment and Score. EC and NG follow Pct.
  const possibleWord = header.words.find(w => w.x > title + 1 && w.x < score - 1);
  // Some classes add a Class Avg column at the end: the class's average,
  // never the student's own score.
  const classWord = header.words.find((w, i) => /^Class$/i.test(w.s) && header.words[i + 1] && /^Avg/i.test(header.words[i + 1].s));
  const classAvg = classWord ? classWord.x : null;
  const flags = header.words.filter(w => pct !== null && w.x > pct + 1 && (classAvg === null || w.x < classAvg - 1));
  return {
    due, category, title, score, pct, classAvg,
    possible: possibleWord ? possibleWord.x : null,
    ec: (flags.find(w => /^EC$/i.test(w.s)) || {}).x ?? null,
    ng: (flags.find(w => /^NG$/i.test(w.s)) || {}).x ?? null,
  };
}

function readTable(rows, cols) {
  const textCols = [['due', cols.due], ['category', cols.category], ['title', cols.title]].filter(([, x]) => x !== null).sort((a, b) => a[1] - b[1]);
  const numericFrom = Math.min(...[cols.possible, cols.score].filter(x => x !== null)) - 15;
  const out = [];
  let cur = null;
  for (const row of rows) {
    const first = row.words[0];
    const startsRow = first && first.x < (cols.category ?? cols.title) - 10 && iso(first.s);
    if (startsRow) {
      cur = { due: iso(first.s), category: '', title: '', possible: null, score: null, percent: null, extraCredit: false, notGraded: false, dropped: false, comment: '' };
      out.push(cur);
    }
    if (!cur) continue;
    // A line under a row that starts a little right of where its title
    // starts is the teacher's comment ("5 Points", "< Assignment Dropped >"),
    // not more of the title, which wraps from the same place.
    if (!startsRow && cur.titleX !== undefined && first.x >= cur.titleX + 3 && first.x < numericFrom) {
      const said = row.words.filter(w => w.x < numericFrom).map(w => w.s).join(' ');
      if (/^<\s*Assignment Dropped\s*>$/i.test(said)) cur.dropped = true;
      else cur.comment = cur.comment ? cur.comment + ' ' + said : said;
      continue;
    }
    for (const w of row.words.slice(startsRow ? 1 : 0)) {
      if (cols.ignoreFrom !== undefined && w.x >= cols.ignoreFrom) continue;
      if (cols.classAvg !== null && cols.classAvg !== undefined && w.x >= cols.classAvg - 25) continue;
      if (w.x >= numericFrom) {
        if (/%$/.test(w.s) && num(w.s) !== null) { cur.percent = num(w.s); continue; }
        if (num(w.s) !== null && w.x < (cols.pct ?? Infinity) - 3) {
          // Nearest of Max and Score.
          const toScore = Math.abs(w.x - cols.score), toMax = cols.possible === null ? Infinity : Math.abs(w.x - cols.possible);
          if (toMax < toScore && cur.possible === null) cur.possible = num(w.s); else cur.score = num(w.s);
          continue;
        }
        if (cols.pct !== null && w.x > cols.pct + 3 && !/%$/.test(w.s)) {
          const toEc = cols.ec === null ? Infinity : Math.abs(w.x - cols.ec), toNg = cols.ng === null ? Infinity : Math.abs(w.x - cols.ng);
          if (toEc < toNg) cur.extraCredit = true; else if (toNg < Infinity) cur.notGraded = true;
          continue;
        }
      }
      // Text: the last text column whose header starts at or left of it.
      let col = textCols[0][0];
      for (const [name, x] of textCols) if (w.x + 6 >= x) col = name;
      if (col === 'due') col = textCols[1] ? textCols[1][0] : 'title';
      if (col === 'title' && cur.titleX === undefined) cur.titleX = w.x;
      cur[col] = cur[col] ? cur[col] + ' ' + w.s : w.s;
    }
  }
  for (const a of out) { a.category = a.category || null; a.title = a.title || null; a.comment = a.comment || null; delete a.titleX; }
  return out;
}

/** Reads a progress report PDF's text into its grade, points, assignments,
 *  missing work and scale. Null when it isn't one. */
function parseReport(pages) {
  const all = pages.flatMap((items, p) => lines(words(items)).map(l => ({ ...l, page: p })));
  const text = all.map(l => l.text).join('\n');
  const g = /Grade:\s*([A-Z][A-Za-z+-]*)?\s*\(\s*(-?[\d.]+)\s*%\s*\)\s*\(\s*Pts:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)\s*\)/.exec(text);
  const range = /Assignments\s+From:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  const report = {
    grade: g && g[1] ? g[1] : null,
    percent: g ? parseFloat(g[2]) : null,
    earned: g ? parseFloat(g[3]) : null,
    possible: g ? parseFloat(g[4]) : null,
    from: range ? iso(range[1]) : null,
    to: range ? iso(range[2]) : null,
    assignments: [],
    missing: [],
    scale: [],
  };
  // The assignment table runs from its header to the EC/NG legend or the
  // Missing Scores table, across pages (a header repeats on each page).
  const isHeader = l => /\bDue Date\b/.test(l.text) && /\bAssignment\b/.test(l.text) && /\bScore\b/.test(l.text);
  const isMissingHead = l => /Missing Scores:/i.test(l.text);
  const ends = l => isMissingHead(l) || /=\s*Extra Credit/i.test(l.text) || /Scale:/i.test(l.text);
  let cols = null, body = [];
  const flush = () => { if (cols) report.assignments.push(...readTable(body, cols)); body = []; };
  let inTable = false, inMissing = false, missingCols = null, missingBody = [];
  for (const l of all) {
    if (isMissingHead(l)) {
      flush(); inTable = false; inMissing = true;
      // Due Date, Category, Assignment, and a last column (a note) left out.
      const head = l.words.filter(w => !/^(Missing|Scores:)$/i.test(w.s));
      const title = head.find(w => /^Assignment$/i.test(w.s));
      const after = title ? head.find(w => w.x > title.x + 1) : null;
      missingCols = columns({ words: [...head.filter(w => w !== after), { s: 'Score', x: 1e9 }] });
      if (missingCols) { missingCols.possible = null; missingCols.ignoreFrom = after ? after.x - 6 : Infinity; }
      continue;
    }
    if (isHeader(l)) { flush(); cols = columns(l); inTable = !!cols; inMissing = false; continue; }
    if (inTable && ends(l)) { flush(); inTable = false; }
    if (inMissing && (/of Missing Assignments/i.test(l.text) || /Summary for:/i.test(l.text) || /Scale:/i.test(l.text))) inMissing = false;
    if (inTable) body.push(l);
    else if (inMissing && !/^</.test(l.text)) missingBody.push(l);
  }
  flush();
  if (missingCols) report.missing = readTable(missingBody, missingCols).map(a => ({ due: a.due, category: a.category, title: a.title }));
  // The grading scale: the lines after "Scale:", a letter and a number.
  const scaleAt = all.findIndex(l => /Scale:/i.test(l.text));
  if (scaleAt >= 0) {
    for (const l of all.slice(scaleAt + 1)) {
      const m = /^([A-Z][+-]?)\s+(-?[\d.]+)$/.exec(l.text);
      if (!m) { if (report.scale.length) break; continue; }
      report.scale.push({ letter: m[1], min: parseFloat(m[2]) });
    }
  }
  return g || report.assignments.length ? report : null;
}

/** A scale is only used as percent cutoffs when it looks like them (a GPA
 *  scale, 4.0 for an A, isn't). */
const scaleCutoffs = scale => Array.isArray(scale) && scale.length > 1 && Math.max(...scale.map(s => s.min)) > 50
  ? [...scale].sort((a, b) => b.min - a.min) : null;
function letterFor(percent, scale) {
  const cut = scaleCutoffs(scale);
  if (!cut || percent === null || percent === undefined) return null;
  const hit = cut.find(s => percent >= s.min);
  return hit ? hit.letter : cut[cut.length - 1].letter;
}

/** Reads a progress report PDF (bytes) with PDF.js. */
async function readReportPdf(bytes) {
  const { loadPdfjs } = require('./32-calendar-pdf.js');
  const { pdfjs, dir } = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: path.join(dir, 'cmaps') + path.sep, cMapPacked: true, verbosity: 0, isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5] + (doc.numPages - n) * 10000, w: i.width, size: Math.hypot(i.transform[0], i.transform[1]) })));
    }
    return parseReport(pages);
  } finally {
    doc.destroy().catch(() => {});
  }
}

/**
 * The page's assignments with the report's put together: the report's
 * list (the whole term, with categories) is the base; each one takes the
 * page's comment, assigned date and missing flag when the page has it too
 * (same due date and title), and the page's ones the report doesn't have
 * (newer than the report, or outside its term) are kept as they are.
 */
function mergeAssignments(page = [], report) {
  if (!report || !report.assignments.length) return page;
  const key = (due, title) => `${String(due || '').slice(0, 10)}|${String(title || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
  const fromPage = new Map(page.map(a => [key(a.due, a.title), a]));
  // The missing table's titles can wrap differently, so a row there
  // matches by due date and the start of its title.
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isMissing = r => report.missing.some(m => m.due === r.due && m.title && r.title && (norm(r.title).startsWith(norm(m.title)) || norm(m.title).startsWith(norm(r.title))));
  const used = new Set();
  const merged = report.assignments.map((r, i) => {
    const k = key(r.due, r.title);
    const p = fromPage.get(k);
    if (p) used.add(k);
    return {
      ...(p || {}),
      title: r.title || (p && p.title) || null,
      due: r.due,
      assigned: p ? p.assigned : null,
      category: r.category,
      possible: r.possible !== null ? r.possible : p ? p.possible : null,
      score: r.score !== null ? r.score : p ? p.score : null,
      scoreText: p && p.scoreText ? p.scoreText : r.score !== null ? String(r.score) : null,
      percent: r.percent !== null ? r.percent : p ? p.percent : null,
      comment: p && p.comment ? p.comment : r.comment || null,
      missing: (p && p.missing) || isMissing(r),
      ...(r.extraCredit ? { extraCredit: true } : {}),
      // Q's own points come from each one's percent times its points
      // possible; where the Score column says something else (a rubric
      // score, say), that's what counts.
      ...(r.percent !== null && r.possible && r.score !== null && Math.abs(r.percent * r.possible / 100 - r.score) > 0.01 ? { points: Math.round(r.percent * r.possible) / 100 } : {}),
      ...(r.notGraded || r.dropped ? { omitted: true } : {}),
      ...(r.dropped ? { dropped: true } : {}),
      id: p && p.id ? p.id : `report-${i}`,
    };
  });
  return [...merged, ...page.filter(a => !used.has(key(a.due, a.title)))];
}

module.exports = { parseTermList, chooseTerm, parseReport, readReportPdf, mergeAssignments, scaleCutoffs, letterFor, _words: words, _lines: lines };
