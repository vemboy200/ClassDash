/**
 * Homework in announcements: some teachers post homework as a class
 * announcement instead of an assignment, so it never shows up as due.
 * This reads announcements with the AI picked in Settings → AI (37-ai.js)
 * and turns the homework it finds into reminders (24-virtual-assignments.js).
 *
 * ── The steps, per announcement ──
 *
 *   1. AI: the model gets the announcement's text, its class name and the
 *      day it was posted, and answers with the work it asks
 *      for: a short title and a due date (it works out "Friday" from the
 *      posting day). One announcement per request: Apple's on-device model
 *      only reads a little at a time.
 *   2. Plain logic from here on. The reminder's class is the announcement's
 *      own class (as shown, so class links count); the due date has to be
 *      a real date near the posting day, or there's none.
 *   3. Conflict check: dropped if the same work is already there, an
 *      assignment or reminder in the same class with a similar title.
 *   4. AI again, for the same work worded differently: each draft that's
 *      left is compared with that class's list one title at a time ("are
 *      these the same work?"); a yes drops it.
 *   5. Kept: a reminder marked as from that announcement, linking to it.
 *
 * ── Which announcements ──
 *
 * Automatically (--new, started after each check by 05-playwright-draft.js
 * when AI is on): only announcements that arrived after AI was turned on,
 * each once. The ones already there when it was turned on are recorded as
 * known (seedKnown, from the config action), so a backlog isn't sent off
 * in one go. A forced scan (Settings → AI, the aiScan action) reads the
 * ones the person ticks, scanned before or not.
 *
 * ── What's kept ──
 *
 * ai-scan.json: { known: [ids], scanned: { id: { at, found, kept, error? } } }.
 * Nothing of the announcement's text: that's in messages.json already. One
 * scan at a time (ai-scan.lock): a second one started meanwhile just stops.
 */
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const STATE_FILE = path.join(PROJECT_ROOT, 'ai-scan.json');
const LOCK_FILE = path.join(PROJECT_ROOT, 'ai-scan.lock');
const STREAM_FILE = path.join(PROJECT_ROOT, 'messages.json');

const SYSTEM = [
  'You read one announcement a teacher posted to a class and list the work it asks students to do, hand in or bring by a date: homework, reading, a worksheet, studying for a test or quiz, a project step.',
  'Answer with JSON only, no other text: {"items": [{"title": "...", "when": "...", "due": "YYYY-MM-DD"}]}.',
  'title: a short to-do, under 80 characters, in the language of the announcement.',
  'when: the words in the announcement that say when it is due, copied exactly ("Friday", "tomorrow", "by Oct 12"), or null.',
  'due: that date, worked out from the day it was posted using the list of days given. Use null when it gives no date.',
  'An empty list when it asks for nothing: news, a grade posted, a reminder of an event with nothing to prepare, a greeting.',
  'Never invent work that is not in the announcement.',
].join('\n');

// The same work worded differently ("Lab goggles" and "bring your safety
// glasses"): plain logic can't tell, and a small model asked to skip
// what's on a whole list doesn't either (Apple's skipped the wrong ones).
// Asked about one pair at a time, it answered right every time.
const SAME_SYSTEM = 'A student has a to-do list. Say whether two to-dos are the same piece of work, worded differently. Different chapters, pages or numbers are different work. Answer only "yes" or "no".';
const MAX_COMPARE = 10;

const MAX_ITEMS = 5;
const MAX_TEXT = 4000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readState() {
  const s = readJson(STATE_FILE, {});
  return { known: Array.isArray(s.known) ? s.known : [], scanned: s.scanned && typeof s.scanned === 'object' ? s.scanned : {} };
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function announcements() {
  const list = readJson(STREAM_FILE, []);
  return Array.isArray(list) ? list.filter(a => a && a.id && (a.text || a.title)) : [];
}

/**
 * Records every announcement there now as known, so the automatic scan
 * only reads ones that come after. Called when AI is turned on.
 */
function seedKnown() {
  const state = readState();
  const known = new Set(state.known);
  for (const a of announcements()) known.add(a.id);
  state.known = [...known];
  writeState(state);
  return state.known.length;
}

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const postedAt = a => new Date(a.sortTime || Date.parse(a.date) || Date.now());

// The two weeks after the posting day, weekday by weekday: small models
// get "Thursday" wrong when they have to count, and right when they can look.
function promptFor(a, className) {
  const posted = postedAt(a);
  const weekday = d => d.toLocaleDateString('en-US', { weekday: 'long' });
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(posted.getFullYear(), posted.getMonth(), posted.getDate() + i);
    days.push(`${weekday(d)} ${dayKey(d)}`);
  }
  const text = [a.title, a.text].filter(Boolean).join('\n').slice(0, MAX_TEXT);
  return `Class: ${className}\nPosted: ${weekday(posted)} ${dayKey(posted)}\nThe days after: ${days.join(', ')}\nAnnouncement:\n${text}`;
}

/**
 * What a draft gets compared with: the same class's work, due nearest the
 * draft's due day (or the posting day) first, undated ones after, at most
 * MAX_COMPARE.
 */
function compareList(draft, others, posted) {
  const around = (draft.due && !isNaN(draft.due) ? draft.due : posted).getTime();
  const dated = o => o.due && !isNaN(o.due);
  const mine = others.filter(o => o.class === draft.class && o.title);
  return [...mine.filter(dated).sort((x, y) => Math.abs(x.due - around) - Math.abs(y.due - around)), ...mine.filter(o => !dated(o))].slice(0, MAX_COMPARE);
}

/**
 * The item on the list the model says is the same work as the draft, or
 * null. A failed or unclear answer counts as no: at worst a duplicate,
 * never homework left out.
 */
async function sameWork(draft, others, posted, complete) {
  for (const o of compareList(draft, others, posted)) {
    const clean = t => String(t).replace(/\s+/g, ' ').slice(0, 120);
    const answer = await complete({ system: SAME_SYSTEM, prompt: `New: ${clean(draft.title)}\nOn the list: ${clean(o.title)}`, maxTokens: 5 });
    if (answer.ok && /^\W*yes\b/i.test(answer.text)) return o;
  }
  return null;
}

/**
 * What the model answered, as checked items: [{ title, due: Date|null }].
 * Tolerates a ```json fence or words around the JSON; anything unusable
 * is left out rather than guessed at. A due date has to be a real date
 * from a week before the posting day to four months after it (a wrong
 * year, say, becomes no due date). Due at the end of that day.
 */
function parseItems(text, posted) {
  // {"items": [...]} as asked, or just the list (Apple's model sometimes
  // answers that way), whichever comes first.
  const t = String(text || '');
  const brace = t.indexOf('{'), bracket = t.indexOf('[');
  const asList = bracket !== -1 && (brace === -1 || bracket < brace);
  const start = asList ? bracket : brace;
  const end = asList ? t.lastIndexOf(']') : t.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  let json;
  try { json = JSON.parse(t.slice(start, end + 1)); } catch { return null; }
  const items = Array.isArray(json) ? json : json && Array.isArray(json.items) ? json.items : null;
  if (!items) return null;
  const out = [];
  for (const it of items.slice(0, MAX_ITEMS)) {
    const title = String((it && it.title) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) continue;
    // The words first (worked out here, the same way every time), the
    // model's own date only when they can't be read.
    let due = resolveWhen(it && it.when, posted);
    const m = String((it && it.due) || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!due && m) due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59);
    if (due) {
      const days = (due - posted) / 864e5;
      if (isNaN(due) || days < -7 || days > 122 || (m && !resolveWhen(it && it.when, posted) && due.getDate() !== Number(m[3]))) due = null;
    }
    out.push({ title, due });
  }
  return out;
}

/**
 * Whether a found item is about something the announcement actually says:
 * at least one real word of its title (not "study", "finish" and the like,
 * which fit any homework) appears in the text. Small models sometimes
 * invent work for an announcement that asks for none; this drops that.
 */
const GENERIC = new Set(['study', 'finish', 'complete', 'do', 'bring', 'read', 'review', 'work', 'homework', 'hw', 'assignment', 'turn', 'submit', 'prepare', 'practice', 'test', 'quiz', 'class', 'pages', 'page', 'due']);
function grounded(title, text) {
  const inText = words(text);
  for (const w of words(title)) if (!GENERIC.has(w) && w.length > 2 && inText.has(w)) return true;
  // Titles made only of those words ("Study for the quiz"): fine when the
  // announcement says them too.
  const own = [...words(title)];
  return own.length > 0 && own.every(w => inText.has(w));
}

const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The date in words like "Friday", "tomorrow", "next Wednesday", "Oct 12"
 * or "10/12", from the day the announcement was posted, due at the end of
 * that day; null when there's no date in them. A weekday is the first one
 * after the posting day ("next Wednesday" too: posted on a Friday, that's
 * five days later, not twelve). A month and day before the posting day is
 * next year's.
 */
function resolveWhen(when, posted) {
  const w = String(when || '').toLowerCase();
  if (!w) return null;
  const at = (y, mo, d) => new Date(y, mo, d, 23, 59);
  const p = posted;
  if (/\b(today|tonight)\b/.test(w)) return at(p.getFullYear(), p.getMonth(), p.getDate());
  if (/\btomorrow\b/.test(w)) return at(p.getFullYear(), p.getMonth(), p.getDate() + 1);
  let m = w.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return at(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dated = (mo, d) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    let x = at(p.getFullYear(), mo, d);
    if (x.getDate() !== d) return null;
    if ((x - p) / 864e5 < -7) x = at(p.getFullYear() + 1, mo, d);
    return x;
  };
  m = w.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m && MONTHS[m[1].slice(0, m[1] === 'sept' ? 4 : 3)] !== undefined) return dated(MONTHS[m[1].slice(0, m[1] === 'sept' ? 4 : 3)], Number(m[2]));
  m = w.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/);
  if (m && MONTHS[m[2].slice(0, 3)] !== undefined) return dated(MONTHS[m[2].slice(0, 3)], Number(m[1]));
  m = w.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m) return dated(Number(m[1]) - 1, Number(m[2]));
  for (const word of w.split(/[^a-z]+/)) {
    if (WEEKDAYS[word] === undefined) continue;
    const ahead = ((WEEKDAYS[word] - p.getDay()) + 7) % 7 || 7;
    return at(p.getFullYear(), p.getMonth(), p.getDate() + ahead);
  }
  return null;
}

// ── conflicts ──

const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'our', 'due', 'are', 'from', 'this', 'that', 'into', 'on', 'of', 'to', 'a', 'an', 'in']);
const words = s => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w)));

/** Whether two titles name the same work: one inside the other, or most words shared. */
function similar(a, b) {
  const x = String(a || '').toLowerCase().trim(), y = String(b || '').toLowerCase().trim();
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const A = words(x), B = words(y);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

/** Everything already there to compare with: assignments and reminders, by class as shown. */
function existing() {
  const out = [];
  try {
    const g = require('./17-api.js').gather();
    for (const key of ['burning', 'later', 'undated', 'deferred', 'overdue', 'done']) {
      for (const x of g[key] || []) out.push({ class: x.class, title: x.title, due: x.due_at instanceof Date ? x.due_at : (x.due_iso ? new Date(x.due_iso) : null) });
    }
  } catch { /* nothing to compare with is still a scan */ }
  for (const v of require('./24-virtual-assignments.js').readAll()) {
    out.push({ class: v.class, title: v.title, due: v.due ? new Date(v.due) : null });
  }
  return out;
}

/**
 * The reason a draft is already there, or null. A similar title only: two
 * different pieces of work can be due the same day.
 */
function conflict(draft, others) {
  for (const o of others) {
    if (!o.class || o.class !== draft.class) continue;
    if (similar(o.title, draft.title)) return 'same title';
  }
  return null;
}

// ── the scan ──

function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); return false; } catch { /* stale */ } }
  } catch { /* none */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}
const dropLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };

/** Announcements the automatic scan would read: neither known nor scanned. */
// The automatic scan's limits, should "new" ever be wrong again (a forced
// scan once wrote the state file before anything was recorded as known,
// and the next check read the whole backlog, 98 announcements, one model
// call after another): only posts from the last week, where homework can
// still be due, and at most ten a run (the rest wait for the next check).
const NEW_MAX_AGE_DAYS = 7;
const NEW_MAX_PER_RUN = 10;

function isNew(a, state, known, now = Date.now()) {
  return !known.has(a.id) && !state.scanned[a.id] && (now - postedAt(a)) / 864e5 <= NEW_MAX_AGE_DAYS;
}

function pendingNew(now = Date.now()) {
  if (!fs.existsSync(STATE_FILE)) return [];
  const state = readState();
  const known = new Set(state.known);
  return announcements().filter(a => isNew(a, state, known, now)).map(a => a.id);
}

/**
 * Scans announcements. { ids } scans those (forced, scanned before or
 * not); { newOnly: true } scans the ones neither known nor scanned.
 * Resolves { ok, scanned, kept: [{title, class, due}], dropped, failed, why? }.
 * `deps.complete` stands in for 37-ai.js's in tests.
 */
async function scan({ ids, newOnly } = {}, deps = {}) {
  const settings = deps.settings || require('./19-settings.js').read();
  if (!settings.aiProvider || settings.aiProvider === 'none') return { ok: false, why: 'AI is off' };
  // AI turned on before this existed, so nothing was recorded as known:
  // what's here is the backlog, and only what comes after is new.
  // Before any scan writes the state file, forced ones included: otherwise
  // the file exists with only the forced ones in it, and the next check
  // takes everything else for new.
  if (!fs.existsSync(STATE_FILE)) {
    seedKnown();
    if (newOnly) return { ok: true, scanned: 0, kept: [], dropped: 0, failed: 0 };
  }
  if (!takeLock()) return { ok: false, why: 'a scan is already running' };
  try {
    const complete = deps.complete || ((ask) => require('./37-ai.js').complete(ask, settings));
    const linkedName = require('./29-class-links.js').linkedName;
    const virtual = require('./24-virtual-assignments.js');
    const state = readState();
    const known = new Set(state.known);
    const all = announcements();
    const wanted = ids ? new Set(ids) : null;
    const todo = wanted ? all.filter(a => wanted.has(a.id)) : newOnly ? all.filter(a => isNew(a, state, known, deps.now || Date.now())).sort((x, y) => postedAt(y) - postedAt(x)).slice(0, NEW_MAX_PER_RUN) : [];

    const result = { ok: true, scanned: 0, kept: [], dropped: 0, failed: 0 };
    const others = existing();
    for (const a of todo) {
      const className = linkedName(a.class);
      const answer = await complete({ system: SYSTEM, prompt: promptFor(a, className), maxTokens: 600 });
      const record = { at: new Date().toISOString(), found: 0, kept: 0 };
      const items = answer.ok ? parseItems(answer.text, postedAt(a)) : null;
      if (!items) {
        record.error = answer.ok ? 'the answer wasn\'t understood' : answer.why;
        result.failed++;
        result.why = record.error;
      } else {
        const text = [a.title, a.text].filter(Boolean).join(' ');
        record.found = items.length;
        for (const it of items) {
          if (!grounded(it.title, text)) { result.dropped++; continue; }
          const draft = { title: it.title, class: className, due: it.due };
          if (conflict(draft, others)) { result.dropped++; continue; }
          if (await sameWork(draft, others, postedAt(a), complete)) { result.dropped++; continue; }
          const made = virtual.create({ title: draft.title, class: draft.class, due: draft.due ? draft.due.toISOString() : null,
            from: { announcement: a.id, link: a.link || null } });
          if (!made.ok) continue;
          others.push(draft);
          record.kept++;
          result.kept.push({ title: draft.title, class: draft.class, due: draft.due ? draft.due.toISOString() : null });
        }
      }
      state.scanned[a.id] = record;
      known.add(a.id);
      result.scanned++;
      writeState({ known: [...known], scanned: state.scanned });
    }
    return result;
  } finally {
    dropLock();
  }
}

/** For Settings → AI's list: every announcement, newest first, with what a scan found.
 *  None with Google Classroom off: announcements are Classroom's, and a
 *  leftover one isn't shown anywhere else either. */
function listForPage() {
  if (require('./19-settings.js').read().classroomEnabled === false) return [];
  const state = readState();
  return announcements()
    .sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))
    .map(a => ({ id: a.id, class: a.class, date: a.date || '', text: String(a.title || a.text || '').replace(/\s+/g, ' ').slice(0, 140),
      scanned: state.scanned[a.id] || null }));
}

module.exports = { SYSTEM, NEW_MAX_AGE_DAYS, NEW_MAX_PER_RUN, readState, seedKnown, pendingNew, promptFor, SAME_SYSTEM, compareList, sameWork, parseItems, resolveWhen, grounded, similar, conflict, scan, listForPage, STATE_FILE };

// `node 38-announcement-scan.js --new`: the automatic scan after a check.
// Redraws the page when it added reminders, so they show at once.
if (require.main === module && process.argv.includes('--new')) {
  scan({ newOnly: true }).then(r => {
    console.log(JSON.stringify({ ...r, kept: r.kept ? r.kept.length : 0 }));
    if (r.kept && r.kept.length) {
      require('child_process').spawnSync(process.execPath, [path.join(__dirname, '05-playwright-draft.js'), '--redraw'], { stdio: 'ignore' });
    }
  });
}
