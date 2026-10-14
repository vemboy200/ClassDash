/**
 * Grades from the school's student information system (Settings → Grades).
 * The first and only provider so far is Aequitas Q ("Q StudentConnection").
 *
 * ── What Q looks like ──
 *
 * Every district runs its own Q, at its own address, and the portal sits on
 * a path, not the root: q.someschool.org/Production/StudentPortal, say. So
 * the whole address has to be typed in, and only the part before /Home/ is
 * kept (someone pasting the page they were on still works).
 *
 * Signing in is a username (or PIN) and a password on <base>/, posted by
 * the page's own script. Q signs a person out after a while of nothing, so
 * there's no session worth keeping: every check signs in fresh, reads, and
 * signs out again. That's also why the password has to be saved at all.
 *
 * After signing in, each area of the portal (Assignments, Marks, …) is an
 * HTML fragment from POST <base>/Home/LoadProfileData/<Area>. Assignments
 * has a table per class (table.tblassign): the caption says the period and
 * the course ("Per: 3  Made-up Biology (1234A)"), and the first header cell
 * holds the current grade — "B+  (88.4%)", then "1st Semester : Current
 * Grade" in bold. A teacher can hide it, and then that cell is empty.
 *
 * Read through a real browser, headless and with an empty profile, not by
 * replaying the requests: the login form fills hidden fields from its own
 * script, and a browser keeps that Q's business. The fragment is fetched
 * from inside the signed-in page, the same as the portal does.
 *
 * ── The password ──
 *
 * On a Mac it lives in the login keychain (service "ClassDash Q grades"),
 * written and read through /usr/bin/security, never in settings.json and
 * never on the page. It's handed to `security -i` on stdin, so it doesn't
 * show up in the list of running processes either. Elsewhere (Windows)
 * there's no keychain to reach from here yet, so it goes in a file of its
 * own, grades-secret.json, readable only by this user.
 *
 * ── Not hammering the school ──
 *
 * At most one check an hour (CHECK_EVERY_MS), counted from the last try,
 * not the last success. And once Q turns the password down, no more tries
 * until the username or password changes: Q locks an account after too
 * many bad tries ("Maximum invalid attempts"), and a check every hour with
 * a stale password would get there.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PROJECT_ROOT } = require('./00-project-root.js');

const FILE = path.join(PROJECT_ROOT, 'grades.json');
const CANVAS_FILE = path.join(PROJECT_ROOT, 'canvas-grades.json');
const SECRET_FILE = path.join(PROJECT_ROOT, 'grades-secret.json');
const LOCK_FILE = path.join(PROJECT_ROOT, 'grades.lock');
const SERVICE = 'ClassDash Q grades';
const ACCOUNT = 'q-password';
const CHECK_EVERY_MS = 60 * 60 * 1000;
const STEP_TIMEOUT_MS = 30000;

const settings = () => require('./19-settings.js').read();

/**
 * The portal's base from whatever was typed: a scheme added if missing, and
 * everything from /Home/ on dropped, along with the query and hash. Null
 * for something that isn't an address. `bare` says nothing came after the
 * host, which the settings page warns about: Q never lives at the root.
 */
function portalBase(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') return null;
  const pathPart = u.pathname.replace(/\/home(\/.*)?$/i, '').replace(/\/+$/, '');
  return { base: u.origin + pathPart, bare: !pathPart };
}

// ── The password store ──

// Inside "…" for `security -i`: a backslash and a quote get a backslash.
const quoted = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function keychainStore(run = execFileSync) {
  return {
    kind: 'keychain',
    get() {
      try { return run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/\n$/, ''); }
      catch { return ''; }
    },
    set(password) {
      run('/usr/bin/security', ['-i'], { input: `add-generic-password -U -s ${quoted(SERVICE)} -a ${quoted(ACCOUNT)} -w ${quoted(password)}\n`, stdio: ['pipe', 'ignore', 'pipe'] });
    },
    clear() {
      try { run('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { stdio: 'ignore' }); } catch { /* wasn't there */ }
    },
  };
}

function fileStore(file = SECRET_FILE) {
  return {
    kind: 'file',
    get() { try { return String(JSON.parse(fs.readFileSync(file, 'utf8')).password || ''); } catch { return ''; } },
    set(password) { fs.writeFileSync(file, JSON.stringify({ password }), { mode: 0o600 }); },
    clear() { try { fs.unlinkSync(file); } catch { /* wasn't there */ } },
  };
}

let storeOverride = null;
// CLASSDASH_GRADES_STORE=file: the tests, which must never touch the real keychain.
const passwordStore = () => storeOverride ||
  (process.platform === 'darwin' && process.env.CLASSDASH_GRADES_STORE !== 'file' ? keychainStore() : fileStore());

/** Saves (or, empty, removes) the Q password. Control characters are refused:
 *  nobody's password has a line break in it, and `security -i` reads lines. */
function savePassword(password) {
  const p = String(password ?? '');
  if (/[\x00-\x1f\x7f]/.test(p)) return { ok: false, why: 'the password has a character it can\'t have' };
  const store = passwordStore();
  try {
    if (p) store.set(p); else store.clear();
  } catch (e) {
    return { ok: false, why: 'couldn\'t save it: ' + String(e.stderr || e.message).split('\n')[0] };
  }
  return { ok: true, saved: !!p, where: store.kind };
}
const hasPassword = () => !!passwordStore().get();

// ── What's saved ──

function readGrades() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { classes: [] }; }
}
function writeGrades(data) { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }

const fingerprint = (...parts) => require('crypto').createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);

/** Whether grades are set up at all: Q picked, an address, a username, and a
 *  saved password. Why not, when not, for the settings page. */
function readiness(s = settings(), havePassword = hasPassword()) {
  if (s.gradesProvider !== 'q') return { ready: false, why: 'off' };
  if (!portalBase(s.gradesAddress)) return { ready: false, why: 'address' };
  if (!String(s.gradesUsername || '').trim()) return { ready: false, why: 'username' };
  if (!havePassword) return { ready: false, why: 'password' };
  return { ready: true };
}

/** Whether an hourly check should sign in now. `force` (Check now) skips the
 *  hour, but never a password Q has already turned down. */
function due(now = Date.now(), { force = false, s = settings(), password = passwordStore().get(), saved = readGrades() } = {}) {
  const ready = readiness(s, !!password);
  if (!ready.ready) return { due: false, why: ready.why };
  if (saved.rejected && saved.rejected === fingerprint(s.gradesUsername.trim(), password, portalBase(s.gradesAddress).base)) return { due: false, why: 'rejected' };
  if (!force && saved.triedAt && now - Date.parse(saved.triedAt) < CHECK_EVERY_MS) return { due: false, why: 'recent' };
  return { due: true };
}

// ── Reading Q ──

/**
 * The current grade per class from the Assignments fragment. Runs in the
 * signed-in page (see read below) and in the tests, so it takes a Document
 * and uses nothing but the DOM.
 */
function parseAssignments(doc) {
  const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const table of doc.querySelectorAll('table.tblassign')) {
    const caption = table.querySelector('caption');
    if (!caption) continue;
    const bold = caption.querySelector('b');
    const course = (bold ? bold.textContent : '').replace(/\s+/g, ' ').trim();
    const codeMatch = course.match(/^(.*?)\s*\(([^()]*)\)$/);
    const name = codeMatch ? codeMatch[1] : course;
    if (!name) continue;
    const periodMatch = own(caption).match(/([0-9A-Za-z]+)\s*$/) || (caption.id || '').match(/_(\w+)$/);
    const cell = table.querySelector('thead tr.tblhdr2 td');
    const gradeText = cell ? own(cell) : '';
    const m = gradeText.match(/^([^()]*?)\s*(?:\(\s*(-?[\d.]+)\s*%?\s*\))?$/);
    const grade = m && m[1].trim() ? m[1].trim() : null;
    const percent = m && m[2] !== undefined && isFinite(parseFloat(m[2])) ? parseFloat(m[2]) : null;
    const termBold = cell && cell.querySelector('b');
    const term = termBold ? termBold.textContent.split(':')[0].replace(/\s+/g, ' ').trim() || null : null;
    // Each assignment, for the Grades center. Columns differ from class to
    // class (Class Avg, Rubric, Scored As… come and go), so they're found by
    // their header's words; anything not known by name is kept under its
    // own header in `extra`. A row Q shows in red is missing work.
    const headerRow = [...table.querySelectorAll('thead tr')].find(tr => tr.querySelector('th'));
    // Q breaks some headers over two lines (Pts<br>Possible), so a <br>
    // counts as a space, and they're matched without spaces anyway.
    const headers = headerRow ? [...headerRow.querySelectorAll('th')].map(th => {
      const box = th.ownerDocument.createElement('div');
      box.innerHTML = th.innerHTML.replace(/<br\s*\/?>/gi, ' ');
      return box.textContent.replace(/\s+/g, ' ').trim();
    }) : [];
    const KNOWN = { datedue: 'due', duedate: 'due', assigned: 'assigned', assignment: 'title', ptspossible: 'possible', pointspossible: 'possible', score: 'score', pctscore: 'percent', comments: 'comment', comment: 'comment' };
    const isoDate = t => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : t || null; };
    const num = t => { const n = parseFloat(String(t).replace(/[%,]/g, '')); return /\d/.test(t) && isFinite(n) ? n : null; };
    const assignments = [];
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children].filter(c => c.tagName === 'TD');
      if (cells.length < headers.length - 1 || !row.querySelector('[id^="descript"]')) continue;
      // The Detail column's cell can span rows; when it doesn't start this
      // row, the cells are one short and line up from the second header.
      const offset = cells.length === headers.length ? 0 : 1;
      const a = { title: null, due: null, assigned: null, possible: null, score: null, percent: null, comment: null, missing: false, extra: {} };
      headers.forEach((h, i) => {
        const cell = cells[i - offset];
        if (!cell || i - offset < 0) return;
        const text = cell.textContent.replace(/\s+/g, ' ').trim();
        const key = KNOWN[h.toLowerCase().replace(/\s/g, '')];
        if (key === 'due' || key === 'assigned') a[key] = isoDate(text);
        else if (key === 'possible' || key === 'percent') a[key] = num(text);
        else if (key === 'score') { a.score = num(text); a.scoreText = text || null; }
        else if (key) a[key] = text || null;
        else if (h && h.toLowerCase() !== 'detail' && text) a.extra[h] = text;
      });
      const id = (row.querySelector('[id^="descript"]').id || '');
      if (!a.title) a.title = row.querySelector('[id^="descript"]').textContent.replace(/\s+/g, ' ').trim();
      a.missing = /missing/i.test(row.className) || [row, ...row.querySelectorAll('[style], font[color]')].some(el =>
        /(^|[^-])color\s*:\s*(red|#f00\b|#ff0000|#c00\b|#cc0000|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\))/i.test(el.getAttribute('style') || '') || /^(red|#f00|#ff0000)$/i.test(el.getAttribute('color') || ''));
      if (!Object.keys(a.extra).length) delete a.extra;
      a.id = id.replace(/^descript/, '') || null;
      assignments.push(a);
    }
    out.push({
      period: periodMatch ? periodMatch[1] : null,
      class: name,
      code: codeMatch ? codeMatch[2].trim() || null : null,
      grade,
      percent,
      term: grade || percent !== null ? term : null,
      assignments,
    });
    // The printer button's class id, for its progress report (read
    // below, and 42-progress-report.js). Not every class has one.
    const printer = table.querySelector('a[href*="OpenProgress"]');
    const progressId = printer && (printer.getAttribute('href').match(/OpenProgress\(\s*['"]?(\d+)/) || [])[1];
    if (progressId) out[out.length - 1].progressId = progressId;
  }
  return out;
}

class Rejected extends Error {}
// Signed in, but Q wants a new password before anything else (an expired
// one). A Rejected too: the same password is never tried again. Setting a
// new one is the person's to do, on Q's own site; ClassDash only says so,
// with Q's own words.
class NewPasswordNeeded extends Rejected {}

/**
 * Runs in the page, after signing in: whether Q is asking for a new
 * password, as { message } (Q's sentence, or null when there's only a form
 * to go by), or null. Only once the sign-in form is gone, so its own
 * "Forgot password?" never counts; links, buttons and field labels don't
 * either. The sentence is the shortest visible text of four words or more
 * that talks about a new, changed or expired password; or else two
 * password boxes showing (new, and again).
 */
function newPasswordMessage() {
  const visible = el => typeof el.checkVisibility === 'function' ? el.checkVisibility() : !el.closest('[hidden]');
  const pin = document.querySelector('#Pin');
  if (pin && visible(pin)) return null;
  const ABOUT = /\b(new|change|reset|update|expired?)\b[^.!?]{0,40}\bpassword\b|\bpassword\b[^.!?]{0,40}\b(expired?|changed?|reset|new|update[ds]?)\b/i;
  const SKIP = 'a, button, label, select, option, script, style, template';
  // An element's words: its visible text, leaving out links, buttons and
  // labels inside it, each piece apart (a form's labels don't run together
  // into something that reads like a sentence).
  const words = el => {
    const parts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      if (!host || host.closest(SKIP) || !visible(host)) continue;
      const t = n.textContent.trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ');
  };
  const boxes = () => [...document.querySelectorAll('input[type="password"]')].filter(visible).length;
  // Most pages never mention a password at all: no need to look closer.
  const all = document.body ? (typeof document.body.innerText === 'string' ? document.body.innerText : document.body.textContent) : '';
  if (!ABOUT.test(all || '')) return boxes() >= 2 ? { message: null } : null;
  let best = null;
  for (const el of document.querySelectorAll('body *')) {
    // Only an element with words of its own can be the sentence.
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest(SKIP) || !visible(el)) continue;
    const text = words(el);
    if (!text || text.length > 300 || text.split(' ').length < 4 || !ABOUT.test(text)) continue;
    if (!best || text.length < best.length) best = text;
  }
  if (best) return { message: best };
  return boxes() >= 2 ? { message: null } : null;
}

function browserOptions(s) {
  if (s.browserPath) return { executablePath: path.resolve(PROJECT_ROOT, s.browserPath) };
  const own = require('./20-browser.js');
  return own.isInstalled() ? { executablePath: own.BINARY } : { channel: 'chrome' };
}

/** Signs in, reads the grades, signs out. Throws Rejected when Q turns the
 *  username or password down, and a plain Error for anything else. */
async function read({ base, username, password, s = settings(), chromium = require('playwright').chromium, now = new Date() }) {
  const browser = await chromium.launch({ ...browserOptions(s), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    await page.goto(base + '/');
    await page.waitForSelector('#Pin');
    await page.fill('#Pin', username);
    await page.fill('#Password', password);
    await page.click('#LoginButton');
    // Either the portal opens, or the login form says why not.
    const outcome = await Promise.race([
      page.waitForURL(/\/Home\/PortalMainPage/i).then(() => 'in'),
      // Any one of them showing: they're all on the page from the start,
      // hidden, and waitForSelector alone would only ever watch the first.
      page.waitForSelector('#loginerrormsg .error >> visible=true').then(() => 'refused'),
      // Signed in, but sent to change the password first.
      page.waitForFunction(newPasswordMessage, null, { polling: 500 }).then(() => 'newPassword'),
    ]);
    if (outcome === 'refused') {
      const msg = await page.$eval('#loginerrormsg', el => [...el.querySelectorAll('.error, #msgmessage')].filter(e => e.offsetParent).map(e => e.textContent.trim()).join(' ')).catch(() => '');
      // Too many tries isn't a wrong password, but it's no reason to keep trying either.
      throw new Rejected(msg || 'Q didn\'t accept the username or password');
    }
    // Or the portal opened with the request on top of it: a moment for it to show.
    if (outcome === 'in') await page.waitForTimeout(1500);
    const asked = await page.evaluate(newPasswordMessage);
    if (asked) {
      await page.goto(base + '/Home/Logout').catch(() => {});
      throw new NewPasswordNeeded(asked.message || 'Q wants a new password');
    }
    // More than one enrollment (two schools, or next year's in spring): Q
    // asks which one. The first is the current one.
    const tile = await page.$('#divSelectStudent .studentTile');
    if (tile && await tile.isVisible()) {
      await Promise.all([page.waitForNavigation(), tile.click()]);
    }
    const classes = await page.evaluate(async ([url, parserSource]) => {
      const res = await fetch(url, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
      if (!res.ok) throw new Error('Q answered ' + res.status + ' for Assignments');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      return (0, eval)('(' + parserSource + ')')(doc);
    }, [base + '/Home/LoadProfileData/Assignments', parseAssignments.toString()]);
    for (const c of classes) {
      const id = c.progressId;
      delete c.progressId;
      if (id) await addReport(page, base, id, c, now);
    }
    await page.goto(base + '/Home/Logout').catch(() => {});
    return classes;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * A class's progress report (42-progress-report.js), while signed in: its
 * terms, then the PDF of the one on today. Adds the whole term's
 * assignments with their categories, and Q's grade and points for that
 * term. Anything going wrong leaves the class as the Assignments page had
 * it: the report is extra, never a reason for a check to fail.
 */
async function addReport(page, base, id, c, now) {
  const report = require('./42-progress-report.js');
  try {
    const terms = await page.evaluate(async ([url, id, parserSource]) => {
      const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams({ id }),
        headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) return [];
      return (0, eval)('(' + parserSource + ')')(new DOMParser().parseFromString(await res.text(), 'text/html'));
    }, [base + '/Home/AssignmentProgRpt', id, report.parseTermList.toString()]);
    const term = report.chooseTerm(terms, now);
    if (!term) return;
    const pdf = await page.evaluate(async url => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return null;
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, `${base}/Home/PrintProgressReport/${term.id}^${term.code}`);
    if (!pdf) return;
    const read = await report.readReportPdf(Buffer.from(pdf, 'base64'));
    if (!read) return;
    c.assignments = report.mergeAssignments(c.assignments, read);
    c.report = {
      term: term.name, from: read.from || term.begin, to: read.to || term.end,
      grade: read.grade || term.grade, percent: read.percent !== null ? read.percent : term.percent,
      earned: read.earned, possible: read.possible, scale: read.scale,
    };
    // A grade the Assignments page hides, the report may still have.
    if (!c.grade && c.percent === null && (c.report.grade || c.report.percent !== null)) {
      Object.assign(c, { grade: c.report.grade, percent: c.report.percent, term: term.name });
    }
  } catch { /* no report for this class this time */ }
}

/**
 * One check, if one's due (or forced): reads Q and saves grades.json. The
 * last good grades stay when a check fails; the failure is saved beside
 * them, for the page to say.
 */
async function check({ force = false, now = new Date(), reader = read } = {}) {
  const s = settings();
  const password = passwordStore().get();
  const saved = readGrades();
  const d = due(now.getTime(), { force, s, password, saved });
  if (!d.due) return { ok: false, skipped: d.why };

  const base = portalBase(s.gradesAddress).base;
  const username = s.gradesUsername.trim();
  const next = { ...saved, triedAt: now.toISOString() };
  delete next.rejected;
  delete next.newPassword;
  try {
    const classes = await reader({ base, username, password, s, now });
    if (!classes.length) throw new Error('signed in, but found no classes under Assignments');
    Object.assign(next, { ok: true, why: null, checkedAt: now.toISOString(), classes });
  } catch (e) {
    next.ok = false;
    next.why = String(e.message || e).split('\n')[0].slice(0, 200);
    if (e instanceof Rejected) next.rejected = fingerprint(username, password, base);
    if (e instanceof NewPasswordNeeded) next.newPassword = true;
  }
  writeGrades(next);
  // Q's dot beside the other platforms' (25-check-status.js).
  require('./25-check-status.js').record('q', next.ok, next.ok ? `${next.classes.length} classes` : next.why);
  return { ok: next.ok, why: next.why, classes: next.ok ? next.classes.length : 0 };
}

// ── Canvas ──
//
// Canvas needs none of the above: its course list (10-canvas.js) asks for
// include[]=total_scores, and the student's enrollment on each course then
// carries the current score and letter grade. So Canvas grades come with
// every check that reads Canvas, by token or by browser, at no extra cost.

/** {grade, percent} from a Canvas course with total_scores, or null when
 *  there's neither (no graded work yet, or the teacher hides the totals). */
function canvasGrade(course) {
  const e = (course.enrollments || []).find(x => /student/i.test(x.type || x.role || ''));
  if (!e) return null;
  const percent = typeof e.computed_current_score === 'number' ? e.computed_current_score : null;
  const grade = e.computed_current_grade ? String(e.computed_current_grade) : null;
  return grade || percent !== null ? { grade, percent } : null;
}

/** One Canvas assignment for the Grades center, from the assignments call
 *  (with include[]=submission) 10-canvas.js already makes. */
function canvasAssignment(a) {
  const sub = a.submission || {};
  const score = typeof sub.score === 'number' ? sub.score : null;
  const possible = typeof a.points_possible === 'number' ? a.points_possible : null;
  return {
    id: String(a.id),
    title: a.name || null,
    due: a.due_at || null,
    assigned: a.created_at || null,
    possible,
    score,
    scoreText: sub.excused ? 'EX' : sub.grade != null && String(sub.grade) !== String(score) ? String(sub.grade) : null,
    percent: score !== null && possible ? Math.round(score / possible * 10000) / 100 : null,
    comment: null,
    missing: !!sub.missing,
    late: !!sub.late,
    excused: !!sub.excused,
    link: a.html_url || null,
    group: a.assignment_group_id != null ? String(a.assignment_group_id) : null,
    omitted: !!a.omit_from_final_grade || a.grading_type === 'not_graded',
  };
}

/** A course's assignment groups, for estimating its grade: whether the
 *  teacher weights them (apply_assignment_group_weights, on the course
 *  list already fetched), each one's weight and its drop rules. */
function canvasWeighting(course, groups) {
  return {
    weighted: !!course.apply_assignment_group_weights,
    groups: groups.map(g => {
      const rules = g.rules || {};
      return {
        id: String(g.id),
        name: g.name || null,
        weight: typeof g.group_weight === 'number' ? g.group_weight : 0,
        dropLowest: rules.drop_lowest || 0,
        dropHighest: rules.drop_highest || 0,
        neverDrop: (rules.never_drop || []).map(String),
      };
    }),
  };
}

/**
 * A grade worked out from the assignments, the way Canvas does it: each
 * group's points after its drop rules, then, for a weighted course, each
 * group's percent times its weight, rescaled over the groups that have
 * graded work (as Canvas's current grade does). Unweighted, it's all the
 * points together. Only graded work counts; excused and omitted work
 * doesn't. An estimate: the teacher can override grades or round, which
 * no list of assignments shows. Null when there's nothing to go on.
 */
function estimateGrade(c) {
  const w = c.weighting;
  if (!w || !Array.isArray(w.groups) || !w.groups.length || !Array.isArray(c.assignments)) return null;
  const counted = c.assignments.filter(a => a.score !== null && a.score !== undefined && !a.excused && !a.omitted);
  const groups = w.groups.map(g => {
    let list = counted.filter(a => a.group === g.id);
    // Drops: the lowest (then highest) by percent, never ones marked never
    // to drop, and never every last one.
    // What each one counts for: Q's points where a report gives them
    // (42-progress-report.js), else its score.
    const pts = a => typeof a.points === 'number' ? a.points : a.score;
    const droppable = list.filter(a => a.possible > 0 && !a.extraCredit && !g.neverDrop.includes(a.id)).sort((x, y) => pts(x) / x.possible - pts(y) / y.possible);
    const keepAtLeast = 1;
    const lowest = Math.max(0, Math.min(g.dropLowest, droppable.length, list.length - keepAtLeast));
    const highest = Math.max(0, Math.min(g.dropHighest, droppable.length - lowest, list.length - keepAtLeast - lowest));
    const dropped = new Set([...droppable.slice(0, lowest), ...droppable.slice(droppable.length - highest)]);
    list = list.filter(a => !dropped.has(a));
    const earned = list.reduce((n, a) => n + pts(a), 0);
    // Extra credit adds points without adding to what's possible.
    const possible = list.reduce((n, a) => n + (a.extraCredit ? 0 : a.possible || 0), 0);
    return { name: g.name, weight: g.weight, graded: list.length, dropped: dropped.size, earned: round2(earned), possible: round2(possible), percent: possible ? round2(earned / possible * 100) : null };
  });
  let percent = null;
  if (w.weighted) {
    const used = groups.filter(g => g.possible > 0 && g.weight > 0);
    const total = used.reduce((n, g) => n + g.weight, 0);
    if (total) percent = used.reduce((n, g) => n + g.weight * (g.earned / g.possible), 0) / total * 100;
  } else {
    const earned = groups.reduce((n, g) => n + g.earned, 0);
    const possible = groups.reduce((n, g) => n + g.possible, 0);
    if (possible) percent = earned / possible * 100;
  }
  return percent === null ? null : { percent: round2(percent), weighted: w.weighted, groups };
}
const round2 = n => Math.round(n * 100) / 100;

function saveCanvasGrades(courses, gradebook = {}, now = new Date(), weights = {}) {
  if (gradebook instanceof Date) { now = gradebook; gradebook = {}; }
  const classes = courses.map(c => ({ class: c.name, ...(canvasGrade(c) || { grade: null, percent: null }),
    ...(gradebook[c.name] ? { assignments: gradebook[c.name].slice(0, 200) } : {}),
    ...(weights[c.name] ? { weighting: weights[c.name] } : {}) }));
  fs.writeFileSync(CANVAS_FILE, JSON.stringify({ checkedAt: now.toISOString(), classes }, null, 2));
}

function readCanvasGrades() {
  try { return JSON.parse(fs.readFileSync(CANVAS_FILE, 'utf8')); } catch { return { classes: [] }; }
}

const periodRank = p => { const n = parseFloat(p); return p == null ? Infinity : isFinite(n) ? n : 1e6; };
const byPeriod = list => list.map((c, i) => [c, i]).sort((a, b) => periodRank(a[0].period) - periodRank(b[0].period) || a[1] - b[1]).map(([c]) => c);

/**
 * Which Canvas classes the grades list leaves out (and which classes
 * Settings → Classes doesn't offer for linking), by the same rules the
 * page's class filter uses (filtersPanel in 08-page.js): excluded ones;
 * with skipStaleClasses, ones gone quiet; with hideInactiveClasses, ones
 * that never had any classwork or announcement. Checked by real name for
 * exclusions and staleness, by linked name for activity.
 */
const categoriesOf = list => [...new Set((list || []).map(a => a.category).filter(Boolean))];

/**
 * A Q class's grade worked out from the category weights the person typed
 * in (Q never shows them), by estimateGrade's same math. Each category's
 * weight must be there for every category with graded work, else there's
 * no estimate (a half-weighted grade would mislead). When the class has a
 * progress report, the estimate says whether it lands on Q's own percent:
 * the way to know the weights typed in are the teacher's.
 */
function typedEstimate(c, weights) {
  if (!weights || !Array.isArray(c.assignments)) return null;
  const cats = categoriesOf(c.assignments.filter(a => a.score !== null && a.score !== undefined && !a.omitted && !a.excused));
  if (!cats.length || cats.some(cat => typeof weights[cat] !== 'number')) return null;
  const est = estimateGrade({
    weighting: { weighted: true, groups: cats.map(cat => ({ id: cat, name: cat, weight: weights[cat], dropLowest: 0, dropHighest: 0, neverDrop: [] })) },
    assignments: c.assignments.map(a => ({ ...a, group: a.category })),
  });
  if (!est) return null;
  const official = c.report && c.report.percent !== null && c.report.percent !== undefined ? c.report.percent : c.percent;
  return { ...est, typed: true, matches: official === null || official === undefined ? null : Math.abs(official - est.percent) < 0.15 };
}

function canvasHiddenTest(s, map, links) {
  const excluded = new Set(s.exclusions || []);
  const { isClassStale } = require('./22-class-activity.js');
  const readJson = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, name), 'utf8')); } catch { return fallback; } };
  let active = null;
  if (s.hideInactiveClasses) {
    active = new Set([...readJson('last-collection.json', []), ...readJson('messages.json', [])].map(x => links.linkedName(x.class, map)));
  }
  return raw => excluded.has(raw) || (s.skipStaleClasses && isClassStale(raw)) || (active && !active.has(links.linkedName(raw, map)));
}

/**
 * A Canvas class's period: the one it has in Settings → Schedule (which goes
 * by linked name), or else the one its name gives away ("P3 Biology").
 */
function canvasPeriodLookup(map, links) {
  const schedule = require('./35-school-schedule.js');
  const given = new Map();
  for (const c of schedule.readSchedule().classes || []) if (c && c.class && c.period != null && c.period !== '') given.set(c.class, String(c.period));
  return raw => {
    const shown = links.linkedName(raw, map);
    if (given.has(shown)) return given.get(shown);
    const fromName = schedule.periodFromName(shown) ?? schedule.periodFromName(raw);
    return fromName === null ? null : String(fromName);
  };
}

/**
 * Grades for the page and the API: Q's (when it's picked), Canvas's
 * (when Canvas is on) and Classroom's, in one list, each saying where it's
 * from, the ones a class doesn't go by marked superseded (ranked). Canvas
 * classes go by their linked name, leave out what the page hides
 * (canvasHiddenTest) and get a period from the schedule or their name.
 * Q's classes have Q's own period, and go by their linked name too when
 * one is linked in Settings → Classes (to its Classroom or Canvas class,
 * say). A linked one keeps Q's own name as `sourceClass`: the typed-in
 * weights are saved under it (qName).
 */
/** The name a class has in Q (or Canvas): what weights are saved under. */
const qName = c => c.sourceClass || c.class;

function gradesView(s = settings(), { assignments = false } = {}) {
  const saved = readGrades();
  const on = s.gradesProvider === 'q';
  const canvasOn = require('./19-settings.js').canvasPlan(s).enabled;
  const canvas = canvasOn ? readCanvasGrades() : { classes: [] };
  const links = require('./29-class-links.js');
  const map = links.linkMap();
  const hidden = canvasHiddenTest(s, map, links);
  const period = canvasPeriodLookup(map, links);
  // Classroom's, while Classroom is read (44-classroom-grades.js); hidden
  // ones left out the same way as Canvas's, and ones with nothing graded
  // yet (no grade to show, unlike a Q or Canvas class whose teacher hid it).
  const classroom = s.classroomEnabled === false ? []
    : require('./44-classroom-grades.js').gradeClasses().filter(c => c.percent !== null && !hidden(c.class));
  return {
    provider: on ? 'q' : 'none',
    checkedAt: on ? saved.checkedAt || null : null,
    triedAt: on ? saved.triedAt || null : null,
    ok: on && saved.triedAt ? saved.ok !== false : null,
    why: on && saved.ok === false ? saved.why || null : null,
    rejected: on && !!saved.rejected,
    // Q wants a new password (`why` is what it said): set on Q's site.
    newPassword: on && !!saved.rejected && !!saved.newPassword,
    canvasCheckedAt: canvasOn ? canvas.checkedAt || null : null,
    classroomCheckedAt: classroom.reduce((t, c) => !t || c.checkedAt > t ? c.checkedAt : t, null),
    // By period, the way a school day goes; ones without a period last.
    classes: ranked(byPeriod([
      ...(on ? saved.classes || [] : []).map(c => ({ source: 'q', period: c.period, class: links.linkedName(c.class, map), ...(map.has(c.class) ? { sourceClass: c.class } : {}), grade: c.grade, percent: c.percent, term: c.term,
        estimate: typedEstimate(c, (s.gradesWeights || {})[c.class]),
        ...(assignments ? { assignments: c.assignments || [], categories: categoriesOf(c.assignments), report: c.report || null } : {}) })),
      ...(canvas.classes || []).filter(c => !hidden(c.class))
        .map(c => {
          const groupName = new Map(((c.weighting && c.weighting.groups) || []).map(g => [g.id, g.name]));
          return { source: 'canvas', period: period(c.class), class: links.linkedName(c.class, map), ...(map.has(c.class) ? { sourceClass: c.class } : {}), grade: c.grade, percent: c.percent, term: null,
            estimate: estimateGrade(c),
            ...(assignments ? { assignments: (c.assignments || []).map(a => ({ ...a, category: groupName.get(a.group) || null })) } : {}) };
        }),
      ...classroom.map(c => ({ source: 'classroom', period: period(c.class), class: links.linkedName(c.class, map), ...(map.has(c.class) ? { sourceClass: c.class } : {}), grade: null, percent: c.percent, term: null,
        estimate: null, ...(assignments ? { assignments: c.assignments } : {}) })),
    ])),
  };
}

/**
 * Which grade a class goes by when more than one place has one (a link of
 * its Q, Canvas and Classroom classes): Q's, where grades are really kept,
 * then Canvas's (the teacher's own total), then Classroom's (points added
 * up). The others stay in the list, marked `superseded`: the Grades center
 * still shows their assignments, the Grades list and /api/classes don't.
 */
const RANK = { q: 0, canvas: 1, classroom: 2 };
function ranked(list) {
  const best = new Map();
  for (const c of list) if (!best.has(c.class) || RANK[c.source] < RANK[best.get(c.class)]) best.set(c.class, c.source);
  return list.map(c => RANK[c.source] > RANK[best.get(c.class)] ? { ...c, superseded: true } : c);
}

// One check at a time: the collector starts one after every check, and
// Check now can land in the middle of one.
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (pid) { try { process.kill(pid, 0); return false; } catch { /* stale */ } }
  } catch { /* no lock */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}
const dropLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };

/** A check of its own, now, in the background (it redraws when done). */
let startCheckNow = () => {
  require('child_process').spawn(process.execPath, [path.join(__dirname, '40-grades.js'), '--now'], { detached: true, stdio: 'ignore' }).unref();
};

module.exports = {
  portalBase, parseAssignments, canvasGrade, canvasAssignment, canvasWeighting, estimateGrade, typedEstimate, qName, canvasHiddenTest, saveCanvasGrades, readCanvasGrades, savePassword, hasPassword, readiness, due, check, read, gradesView, readGrades,
  takeLock, dropLock, keychainStore, fileStore, quoted, Rejected, NewPasswordNeeded, newPasswordMessage, CHECK_EVERY_MS, FILE, SERVICE,
  _setStore: s => { storeOverride = s; },
  startCheckNow: () => startCheckNow(),
  _setStartCheck: f => { startCheckNow = f; },
};

// node 40-grades.js --if-due   after a check (05-playwright-draft.js)
// node 40-grades.js --now      Check now, in Settings → Grades
if (require.main === module && (process.argv.includes('--if-due') || process.argv.includes('--now'))) {
  if (!takeLock()) process.exit(0);
  check({ force: process.argv.includes('--now') }).then(r => {
    if (!r.skipped) {
      console.log(r.ok ? `Grades: ${r.classes} classes` : `Grades not read: ${r.why}`);
      require('child_process').spawnSync(process.execPath, [path.join(__dirname, '05-playwright-draft.js'), r.ok ? '--grades-read' : '--redraw'], { stdio: 'ignore' });
    }
  }).catch(e => console.error('grades check failed:', e.message)).finally(dropLock);
}
