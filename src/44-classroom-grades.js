// Google Classroom grades: each class's "View your work" page.
//
// The to-do list the collector reads (/w/<id>/t/all) has no scores, but
// its "View your work" link opens the student's own work in that class,
// one entry per assignment, with the same ids as the to-do list's cards.
// An entry's text is its title, "Due …", a status ("Turned in", "Not
// turned in", "Assigned", "Missing", "Done late"…), and once it's graded,
// the score as a line of its own followed by "/<points possible>". It's
// matched by that structure, not by Google's generated class names.
//
// The link only works clicked from inside the page: opened directly it
// lands on the class stream. And the page changes in place: the to-do
// list's cards stay in the document after the click, hidden, sometimes
// the very same elements as the work entries with the same ids. So what
// counts is what's visible (checkVisibility), not which element it is.
// Caught on the first real read: marking the old cards hid real entries.
//
// Read at most once an hour per class (REFRESH_MS), from the collection
// pass's own tab for that class, and kept in classroom-grades.json by
// class id. A class's grade is its points added up (Classroom shows
// students no overall grade here); Q's, where a class has one, comes
// first everywhere (40-grades.js gradesView).
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const FILE = path.join(PROJECT_ROOT, 'classroom-grades.json');
const REFRESH_MS = 60 * 60 * 1000;
const PER_PASS = 4;

/**
 * Runs in the page. Each work entry: { id, title, due, status, score,
 * possible }, score and possible null until graded. Only visible ones
 * with more than one line (a hidden card's text comes out as one line).
 */
function workEntriesFromPage() {
  const STATUS = /^(Turned in|Not turned in|Assigned|Missing|Done late|Turned in late|Returned|Excused|Graded|Handed in|Done)$/i;
  const linesOf = el => {
    if (typeof el.innerText === 'string') return el.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    // No layout (a test's DOM): each text node is a line.
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = n.textContent.trim(); if (t) out.push(t); }
    return out;
  };
  const num = s => { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : null; };
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll('[data-stream-item-id]')) {
    if (el.parentElement && el.parentElement.closest('[data-stream-item-id]')) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    const id = el.getAttribute('data-stream-item-id');
    if (!id || seen.has(id)) continue;
    const lines = linesOf(el);
    if (lines.length < 2) continue;
    seen.add(id);
    let score = null, possible = null;
    for (let i = 1; i < lines.length; i++) {
      const slash = lines[i].match(/^\/\s*(\d+(?:[.,]\d+)?)$/);
      if (slash && /^\d+(?:[.,]\d+)?$/.test(lines[i - 1])) { score = num(lines[i - 1]); possible = num(slash[1]); break; }
      const both = lines[i].match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
      if (both) { score = num(both[1]); possible = num(both[2]); break; }
    }
    out.push({
      id,
      title: lines[0],
      due: lines.find(l => /^Due\b/.test(l)) || null,
      status: lines.find(l => STATUS.test(l)) || null,
      score,
      possible,
    });
  }
  return out;
}

/** Opens a class's "View your work" from its to-do list and reads it. */
async function readClassroomWork(page, cls, { U, timeout }) {
  await page.goto(`https://classroom.google.com/u/${U}/w/${cls.id}/t/all`, { waitUntil: 'domcontentloaded', timeout });
  if (page.url().includes('accounts.google.com')) throw new Error('cookies expired');
  await page.waitForSelector('a[href*="/sp/"]', { timeout: 30000 });
  await page.locator('a[href*="/sp/"]').first().click();
  await page.waitForURL(/\/sp\//, { timeout: 20000 });
  // Entries arrive bit by bit, like the to-do list: read until the same
  // answer comes back three times running (an empty class settles too).
  let previous = null, steady = 0, entries = [];
  for (let i = 0; i < 40 && steady < 3; i++) {
    await page.waitForTimeout(500);
    entries = await page.evaluate(workEntriesFromPage);
    const now = JSON.stringify(entries);
    steady = now === previous && (entries.length || i >= 10) ? steady + 1 : 0;
    previous = now;
  }
  return entries;
}

function readAll() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return d && typeof d.classes === 'object' && d.classes ? d : { classes: {} };
  } catch { return { classes: {} }; }
}

/** Which classes to read this pass: never read, or over an hour ago. */
function classesDue(classes, now = Date.now(), saved = readAll()) {
  return classes
    .filter(c => { const s = saved.classes[c.id]; return !s || !s.checkedAt || now - Date.parse(s.checkedAt) > REFRESH_MS; })
    .slice(0, PER_PASS);
}

/** Saves this pass's reads (class id -> { name, entries }). */
function save(found, now = new Date()) {
  if (!found.size) return;
  const all = readAll();
  for (const [id, { name, entries }] of found) all.classes[id] = { name, checkedAt: now.toISOString(), assignments: entries };
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

/** A class's points added up over its graded work: { earned, possible, percent }. */
function pointsOf(assignments) {
  const graded = (assignments || []).filter(a => typeof a.score === 'number' && typeof a.possible === 'number' && a.possible > 0);
  const earned = graded.reduce((n, a) => n + a.score, 0);
  const possible = graded.reduce((n, a) => n + a.possible, 0);
  return { graded: graded.length, earned, possible, percent: possible ? Math.round(earned / possible * 10000) / 100 : null };
}

/**
 * Classroom's classes for the grades list: the ones still in classes.json
 * (so a class left behind isn't graded forever), by their current name,
 * shaped like Canvas's (40-grades.js gradesView).
 */
function gradeClasses(known = readClassList()) {
  const saved = readAll();
  const out = [];
  for (const c of known) {
    const s = saved.classes[c.id];
    if (!s) continue;
    const points = pointsOf(s.assignments);
    out.push({
      class: c.name,
      checkedAt: s.checkedAt,
      percent: points.percent,
      assignments: (s.assignments || []).map(a => ({
        title: a.title,
        due: dueDate(a.due),
        score: a.score,
        possible: a.possible,
        percent: typeof a.score === 'number' && a.possible ? Math.round(a.score / a.possible * 10000) / 100 : null,
        missing: /^missing$/i.test(a.status || ''),
        late: /late/i.test(a.status || ''),
        excused: /^excused$/i.test(a.status || ''),
        status: a.status || null,
        scoreText: null,
        link: null,
      })),
    });
  }
  return out;
}

function readClassList() {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'classes.json'), 'utf8')); } catch { return []; }
}

/** "Due Sep 12, 11:59 PM" -> "2026-09-12", or null. Classroom leaves the
 *  year out only for this calendar year's dates ("Due Dec 1, 2025"). */
function dueDate(text, now = new Date()) {
  const m = String(text || '').match(/^Due\s+([A-Z][a-z]{2})\w*\s+(\d{1,2})(?:,\s*(\d{4}))?/);
  if (!m) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]);
  if (month < 0) return null;
  const year = m[3] ? Number(m[3]) : now.getFullYear();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

module.exports = { FILE, REFRESH_MS, workEntriesFromPage, readClassroomWork, readAll, classesDue, save, pointsOf, gradeClasses, dueDate };
