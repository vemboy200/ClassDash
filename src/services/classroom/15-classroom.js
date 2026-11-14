/**
 * Reading Google Classroom: the class list, each class's Classwork (with the
 * turned-in checks and the instructions), its teachers, and how fast the
 * connection is, by loading Classroom's own pages in ClassDash's browser.
 *
 * Moved here unchanged from the collector, 05-playwright-draft.js, which
 * still decides when to read each class (one tab per class, all at once)
 * and what to do with what comes back. services/classroom/index.js is what
 * the services bridge (61-services.js) sees of Classroom.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../00-project-root.js');
const SETTINGS = require('../../19-settings.js').read();
const { isClassStale } = require('../../22-class-activity.js');

// Account index in Google's multi-login (see the collector's own U).
const U = SETTINGS.account;

// How long to wait for a class's assignments to show up (see the
// collector's TIMEOUT, where how it was arrived at is written down).
const TIMEOUT = SETTINGS.classTimeoutMs;

// Set when Classroom answered with Google's sign-in page while reading the
// class list. The collector asks cookiesHaveExpired() after a pass: a
// signed-out profile has to be said out loud, not read as "nothing new".
let cookiesExpired = false;
const cookiesHaveExpired = () => cookiesExpired;

// ── The class list ────────────────────────────────────────────
//
// THE LIST IS NOT TYPED IN BY HAND, IT'S FETCHED EVERY TIME.
//
// This used to hold three hand-typed ids. That worked exactly until the
// school year started: teachers open new classes, and the script kept
// visiting the same three old ones, cheerfully reporting "new: 0". The
// worst kind of failure — silence that looks like everything's fine.
//
// The rule was picked by the cost of being wrong, the user's idea:
//   allowlist — forget to add a class, an assignment vanishes silently;
//   blocklist — forget to add an exclusion, one extra class gets read.
// The second mistake costs seconds, the first costs a deadline. So
// everything is read except exclusions. The same principle already works
// in Canvas.
const CLASSES_FILE = path.join(PROJECT_ROOT, 'classes.json');

// Classes that don't need reading. CURRENTLY EMPTY, and that's not an
// oversight: last year's ones (Ethnic Studies, Español) were already
// archived by Google, and they're gone from the class list page — checked
// August 13th, it returns exactly three classes. The user confirmed the
// same count in their own browser.
//
// Add a class here by name if one starts getting in the way:
//   const EXCLUSIONS = ['Class name exactly as in Classroom'];
const EXCLUSIONS = SETTINGS.exclusions;

// A fallback list for the very first run, when classes.json doesn't exist
// yet and the class list page never opened. Not needed after that: the
// last successfully read list lives in classes.json.
// DELIBERATELY EMPTY. This used to hold the original user's actual class
// ids — which is personal data: it reveals where someone goes to school
// and what they're studying. Not appropriate for a repository.
//
// An empty list breaks nothing: it's only relevant in exactly one case —
// the very first run, when classes.json doesn't exist yet AND the list
// page failed to load. Then the pass honestly reads nothing, and next
// time the list gets fetched from the site and written to classes.json.
const CLASSES_FALLBACK = [];

// Classes renamed by their teacher this pass (old -> new name), for the
// copies of the old data this process read before it knew.
const classRenames = require('../../43-class-renames.js');
const RENAMED = new Map();

// School email. Substituted into links as ?authuser=...
//
// Why: without specifying an account, Google opens the link under
// whichever Google account is the default one, and the school class
// responds with "Class not found" and a Switch account button. Confirmed
// by hand. /u/2/ could be used instead, but that's just a positional
// index — it shifts if an account is added or removed. Email doesn't.
const AUTHUSER = SETTINGS.email;

// ── Error page detection ──────────────────────────────────────

/**
 * Checks whether Classroom showed an error page instead of a class.
 *
 * IT MATTERS EXACTLY HOW THIS IS DONE. It's tempting to write
 * `if (pageText.includes('Class not found'))` — and that would be a
 * slow-motion landmine: some day a teacher will name an assignment
 * "What to do when a class not found", and the script would decide
 * access is broken.
 *
 * So there are two conditions at once, and both are narrow:
 *
 *   1. An EXACT match, only against the <h1> heading. Not "contains", but
 *      "the whole heading text equals". An assignment's title lives in
 *      the list, not the page heading, so it can never trip this.
 *   2. Exactly zero assignments on the page. A real class page with an
 *      error-looking heading (if that's even possible) would have some.
 *
 * Both conditions matching by accident is not possible.
 */
const ERROR_HEADINGS = [
  'Class not found',        // confirmed live: a nonexistent id, or a
                            // class the current account can't see.
                            // A Switch account button sits right next to it.
];

async function detectErrorPage(page) {
  return await page.evaluate((headings) => {
    if (document.querySelectorAll('li[data-stream-item-id]').length > 0) return null;
    const h1 = [...document.querySelectorAll('h1')].map(e => (e.textContent || '').trim());
    return h1.find(t => headings.includes(t)) || null;
  }, ERROR_HEADINGS);
}

// ── Collecting assignments from one class ────────────────────

async function scrapeClass(page, cls, timeoutMs = TIMEOUT) {
  const url = `https://classroom.google.com/u/${U}/w/${cls.id}/t/all`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

  // Cookies expire. If Google redirected us to sign-in, silently
  // collecting nothing is worse than failing loudly.
  if (page.url().includes('accounts.google.com')) {
    throw new Error('cookies expired, need to sign in again: node 05-playwright-draft.js --login');
  }

  // THIS IS THE WHOLE POINT OF ALL OF THIS.
  // Not a blind sleep, but waiting for a specific element.
  // If it hasn't shown up in a minute, it's really empty, not just slow
  // to load.
  //
  // Important: it has to wait specifically for li[data-stream-item-id].
  // Waiting on [role="listitem"] doesn't work — Stream/Classwork/People
  // menu items match that too, they appear instantly, and the wait ends
  // before the actual assignments arrive.
  try {
    await page.waitForSelector('li[data-stream-item-id]', { timeout: timeoutMs });

    // GETTING THE FIRST ASSIGNMENT ISN'T ENOUGH. Classroom renders the
    // list in gradually, and reading it right away gets a partial chunk.
    //
    // Caught on August 11th: after switching to reading in parallel,
    // three tabs started loading at once, each one slower, and a
    // collection grabbed 21 assignments instead of 38. Worse — the
    // missing 17 would come back on the next run looking new.
    //
    // So it waits until the assignment count stops growing.
    //
    // AND UNTIL THE CARDS' TEXT STOPS CHANGING, NOT JUST THEIR NUMBER.
    // Caught on September 30th: turned-in work read as not turned in on
    // some passes and showed up as overdue, then was fine again ten
    // minutes later. The best guess is that "Completed" is filled into a
    // card a moment after the card itself appears, so a steady count
    // isn't a finished page. The text is compared whole, so any late
    // change resets the wait.
    let previousText = null, stableRounds = 0;
    for (let i = 0; i < 40; i++) {
      const currentText = await page.evaluate(
        () => [...document.querySelectorAll('li[data-stream-item-id]')]
          .map(el => el.innerText || '').join('\u0001'));
      if (currentText === previousText) {
        // Three measurements in a row with no change — call it rendered.
        if (++stableRounds >= 3) break;
      } else {
        stableRounds = 0;
      }
      previousText = currentText;
      await page.waitForTimeout(500);
    }
  } catch {
    // No assignments — but why? Two options: the class is really empty,
    // or Classroom showed an error page. Silently returning "empty" in
    // the second case is exactly what's feared: the script would
    // cheerfully stay quiet while deadlines pile up.
    const errorHeading = await detectErrorPage(page);
    if (errorHeading) {
      throw new Error(`Classroom responded "${errorHeading}" — check the class id and account`);
    }
    console.warn(`  ${cls.name}: no assignments showed up in ${timeoutMs / 1000}s`);
    return [];
  }

  return await page.evaluate(({ className, classId, authuser }) => {
    // The data-stream-item-id attribute sits on several nested nodes of
    // one assignment, so only li elements are taken — that's the outer wrapper.
    const items = [...document.querySelectorAll('li[data-stream-item-id]')];

    return items.map(el => {
      const lines = (el.innerText || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        // drop interface chrome: icon names and the "⋮" button's label.
        // live_help was added on August 24th: it's an icon name, and
        // without it, it ended up as the assignment's TITLE — an
        // "Overdue" card was showing up with the heading "live_help".
        //
        // Only things actually seen with your own eyes should be added
        // here. Adding "quiz" or "class" too would be a trap: it would
        // erase an assignment a teacher genuinely named that.
        .filter(l => !['more_vert', 'More options', 'assignment', 'book',
                       'assignment_ind', 'help_outline', 'live_help'].includes(l));

      // First line is the type (Assignment / Material / Quiz assignment),
      // then the title, then the due date.
      const type = lines[0] || '';
      const dated = l => l.startsWith('Due') || l.startsWith('Posted');
      const title = lines.slice(1).find(l => !dated(l)) || '';

      // The link has to be BUILT, not found: there's no <a> tag inside
      // the assignment, Classroom expands it in place via JS.
      //
      // Confirmed by hand: both classId and the assignment's id are
      // base64 of a plain number, and a working address looks like this:
      //   classroom.google.com/c/<classId>/a/<id in base64>/details
      // For materials the same address redirects itself to /m/.
      //
      // The account is specified by email (?authuser=), not the /u/N/
      // number: that number is different per browser and shifts when
      // accounts are added, email doesn't.
      //
      // Attachments (Google Docs and the like) live inside the
      // assignment and aren't visible in the list. The instructions are
      // read separately (readInstructions), by opening each item in place.
      const id = el.getAttribute('data-stream-item-id');
      const link = id
        ? `https://classroom.google.com/c/${classId}/a/${btoa(id)}/details` +
          `?authuser=${encodeURIComponent(authuser)}`
        : null;

      return {
        class: className,
        id,
        type,
        title,
        link,
        due: lines.find(l => l.startsWith('Due')) || null,
        posted: lines.find(l => l.startsWith('Posted')) || null,
      };
    }).filter(x => x.title);
  }, { className: cls.name, classId: cls.id, authuser: AUTHUSER });
}

// ── Turned-in work that reads as not turned in ────────────────
//
// Caught on September 30th: on some passes, a handful of assignments
// the user had turned in on time read as plain "Assignment" instead of
// "Completed Assignment", so they landed in overdue (6, then 12 of
// them), and ten minutes later they were fine again. Nothing had
// changed on Classroom's side; the read was wrong.
//
// Three layers, cheapest first:
//   1. scrapeClass waits for the cards' text to settle, not just their count.
//   2. If 2 or more, or all, of a class's turned-in assignments suddenly
//      read as not turned in, the class is read once more before
//      believing it (the user's idea: a whole batch flipping at once is
//      the tell). The read with fewer flips wins.
//   3. Whatever still flips, even one assignment, stays turned in until
//      TURNED_IN_THRESHOLD reads in a row say otherwise. Unsubmitting, or
//      a teacher returning the work, is real and permanent, and still
//      shows up, half an hour later. Same idea as MISSING_THRESHOLD.
//
// Classroom only: Canvas and Edpuzzle never return turned-in work at all,
// so there's no "Completed" to lose.
const TURNED_IN_THRESHOLD = 3;
const TURNED_IN_LOG = path.join(PROJECT_ROOT, 'turned-in-log.txt');
const isTurnedIn = x => /^completed\b/i.test(x.type || '');

/** Ids of this read's items that were turned in last time and aren't now. */
function flippedFromTurnedIn(items, previous) {
  const before = new Map(previous.filter(x => !x.platform).map(x => [x.id, x]));
  return items
    .filter(x => x.id && !isTurnedIn(x) && before.has(x.id) && isTurnedIn(before.get(x.id)))
    .map(x => x.id);
}

/** Worth a second read: 2 or more flipped, or every turned-in one did. */
function looksMisread(items, previous, className) {
  const flipped = flippedFromTurnedIn(items, previous);
  if (!flipped.length) return false;
  const present = new Set(items.map(x => x.id));
  const wasTurnedIn = previous.filter(x => !x.platform && x.class === className &&
                                           isTurnedIn(x) && present.has(x.id)).length;
  return flipped.length >= 2 || flipped.length === wasTurnedIn;
}

/**
 * Layer 3: keeps a flipped assignment turned in (last read's type, with
 * a turnedInMisses count) until TURNED_IN_THRESHOLD reads in a row agree
 * it isn't. A read that says "Completed" again comes from the page and
 * has no count, so the count resets itself.
 */
function keepTurnedIn(items, previous) {
  const before = new Map(previous.filter(x => !x.platform).map(x => [x.id, x]));
  let held = 0, released = 0;
  const out = items.map(x => {
    const old = x.id && before.get(x.id);
    if (!old || isTurnedIn(x) || !isTurnedIn(old)) return x;
    const turnedInMisses = (old.turnedInMisses || 0) + 1;
    if (turnedInMisses >= TURNED_IN_THRESHOLD) { released++; return x; }
    held++;
    return { ...x, type: old.type, turnedInMisses };
  });
  return { items: out, held, released };
}

/** One line per event, counts and the class only. Kept to the last 500 lines. */
function logTurnedIn(line) {
  try {
    let lines = [];
    try { lines = fs.readFileSync(TURNED_IN_LOG, 'utf8').split('\n').filter(Boolean); } catch {}
    lines.push(`${new Date().toISOString()}  ${line}`);
    fs.writeFileSync(TURNED_IN_LOG, lines.slice(-500).join('\n') + '\n');
  } catch { /* a log that can't be written isn't worth failing a pass over */ }
  console.log(`  ${line}`);
}

/**
 * Reads a class, and if turned-in work came back looking not turned in,
 * applies layers 2 and 3. `previous` is memory from the last pass.
 */
async function scrapeClassChecked(page, cls, timeoutMs, previous) {
  let items = await scrapeClass(page, cls, timeoutMs);
  if (looksMisread(items, previous, cls.name)) {
    const first = flippedFromTurnedIn(items, previous).length;
    const again = await scrapeClass(page, cls, timeoutMs);
    const second = flippedFromTurnedIn(again, previous).length;
    if (second < first) items = again;
    logTurnedIn(`${cls.name}: ${first} turned-in read as not turned in, re-read says ${second}` +
                (second < first ? ' (using the re-read)' : ''));
  }
  const kept = keepTurnedIn(items, previous);
  if (kept.held) logTurnedIn(`${cls.name}: kept ${kept.held} as turned in (not yet ${TURNED_IN_THRESHOLD} reads in a row)`);
  if (kept.released) logTurnedIn(`${cls.name}: ${kept.released} no longer turned in (${TURNED_IN_THRESHOLD} reads in a row)`);
  return kept.items;
}


// ── Classroom instructions ────────────────────────────────────
//
// What the teacher wrote on an assignment, for the AI (get_assignment) and
// the card's Instructions drop-down: the same `description` Canvas items
// carry. Classwork's list doesn't show it, but clicking an item opens it in
// place, and there it is: about half a second each, where opening each
// assignment's own page is 25-40. Checked live on 2026-10-30 on two real
// classes (counts only): every item opened, and with no instructions the
// first line there is "Posted <date>", which isn't instructions.
//
// Instructions rarely change, so each is kept between passes and read again
// only after INSTRUCTIONS_REFRESH_MS (not-turned-in work only), at most
// INSTRUCTIONS_PER_PASS per class per pass, not-turned-in and never-read
// first: a class's first pass after this doesn't take a minute longer.
const INSTRUCTIONS_PER_PASS = 12;
const INSTRUCTIONS_REFRESH_MS = 2 * 24 * 3600 * 1000;
const INSTRUCTIONS_LENGTH = 4000;

/** Runs in the page: opens one Classwork item, reads its instructions, closes it. */
async function readInstructionsInPage(id) {
  const li = [...document.querySelectorAll('li[data-stream-item-id]')].find(el => el.getAttribute('data-stream-item-id') === id);
  const header = li && li.querySelector('[role="button"][aria-expanded]');
  if (!header) return { ok: false };
  const wasOpen = header.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) header.click();
  // Open at once, filled in a moment later: read once its text has stayed
  // the same for three looks in a row (3 s at most).
  let box = null, last = null, same = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    box = li.querySelector('[expanded-item-id]');
    const now = box && header.getAttribute('aria-expanded') === 'true' ? (box.innerText || '') : null;
    if (now !== null && now === last) { if (++same >= 3) break; } else same = 0;
    last = now;
  }
  const opened = box && header.getAttribute('aria-expanded') === 'true';
  let text = null;
  if (opened) {
    // The first span with text that isn't part of a widget (attachments,
    // the View link and comments are all inside jscontroller ones), looked
    // at only up to the opened part: everything above it is widgets.
    const inWidget = n => { for (let p = n; p && p !== box; p = p.parentElement) if (p.matches('[jscontroller], button, a, [role="button"]')) return true; return false; };
    const el = [...box.querySelectorAll('span')].find(sp => {
      const t = (sp.textContent || '').trim();
      return t && !inWidget(sp) && !(/^(Posted|Edited)\b/.test(t) && t.length < 60);
    });
    if (el) {
      // Line breaks and lists kept; a link as "its words (its address)".
      const out = [];
      const walk = n => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { out.push(c.textContent); continue; }
          if (c.nodeType !== 1) continue;
          const tag = c.tagName.toLowerCase();
          if (tag === 'br') out.push('\n');
          else if (tag === 'a' && c.href) {
            const words = (c.textContent || '').trim();
            out.push(words && words !== c.href ? `${words} (${c.href})` : c.href);
          } else {
            const block = ['div', 'p', 'li', 'ul', 'ol'].includes(tag);
            if (block) out.push('\n');
            if (tag === 'li') out.push('- ');
            walk(c);
            if (block) out.push('\n');
          }
        }
      };
      walk(el);
      text = out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || null;
    }
  }
  if (!wasOpen && header.getAttribute('aria-expanded') === 'true') header.click();
  return { ok: !!opened, text };
}

/**
 * Gives a class's items their instructions: kept from last pass, read now
 * where they're missing or old. The page must be on the class's Classwork.
 */
async function readInstructions(page, items, previous, now = Date.now()) {
  const before = new Map(previous.filter(x => !x.platform && x.id).map(x => [x.id, x]));
  const out = items.map(x => {
    const old = before.get(x.id);
    return old && old.descriptionAt ? { ...x, description: old.description || null, descriptionAt: old.descriptionAt } : x;
  });
  const due = out
    .filter(x => x.id && (!x.descriptionAt || (!isTurnedIn(x) && now - Date.parse(x.descriptionAt) > INSTRUCTIONS_REFRESH_MS)))
    .sort((a, b) => (isTurnedIn(a) - isTurnedIn(b)) || (!!a.descriptionAt - !!b.descriptionAt))
    .slice(0, INSTRUCTIONS_PER_PASS);
  let read = 0;
  for (const x of due) {
    let r;
    try { r = await page.evaluate(readInstructionsInPage, x.id); } catch { break; }
    if (!r.ok) continue;
    x.description = r.text ? (r.text.length > INSTRUCTIONS_LENGTH ? r.text.slice(0, INSTRUCTIONS_LENGTH) + '…' : r.text) : null;
    x.descriptionAt = new Date(now).toISOString();
    read++;
  }
  if (read) console.log(`  instructions read: ${read}`);
  return out;
}

// ── Where the class list comes from ───────────────────────────

/**
 * Reads the class list off classroom.google.com/u/N/h.
 *
 * THE NAME IS TAKEN FROM aria-label, NOT FROM THE LINK'S TEXT.
 * aria-label is a screen-reader label, and the name sits in it clean:
 * "AP World Summer Prep. - 2026". The visible text arrives with junk —
 * "A\nAP World Summer Prep. - 2026", where the first letter is the
 * class's icon circle.
 *
 * Each card has two links to the same class: the card itself and "Open
 * your work for …". The second one is discarded, or the class name would
 * become an English phrase about opening work.
 */
async function getClasses(page) {
  await page.goto(`https://classroom.google.com/u/${U}/h`,
                  { waitUntil: 'domcontentloaded', timeout: Math.min(TIMEOUT, 30000) });

  if (page.url().includes('accounts.google.com')) {
    throw new Error('cookies expired, need to sign in again: node 05-playwright-draft.js --login');
  }

  await page.waitForSelector('a[href*="/c/"]', { timeout: 30000 });

  // Same trap as with the assignment list: Classroom renders the cards
  // in gradually, and the first link showing up doesn't mean they've all
  // arrived. Wait until the count stops growing.
  let previousCount = -1, stableRounds = 0;
  for (let i = 0; i < 30; i++) {
    const currentCount = await page.evaluate(
      () => document.querySelectorAll('a[href*="/c/"]').length);
    if (currentCount === previousCount) { if (++stableRounds >= 3) break; } else stableRounds = 0;
    previousCount = currentCount;
    await page.waitForTimeout(500);
  }

  return await page.evaluate(() => {
    const labels = new Map();   // id -> name from aria-label
    const texts = new Map();    // id -> fallback name from the link's text

    for (const a of document.querySelectorAll('a[href*="/c/"]')) {
      const m = (a.getAttribute('href') || '').match(/\/c\/([A-Za-z0-9_-]+)/);
      if (!m) continue;
      const id = m[1];

      const label = (a.getAttribute('aria-label') || '').trim();
      if (label && !/^Open your work for/i.test(label) && !labels.has(id)) {
        labels.set(id, label.replace(/\s+/g, ' '));
      }

      // Fallback: the longest line of visible text.
      // Short ones are the icon's letter and button labels.
      if (!texts.has(id)) {
        const lines = (a.innerText || '').split('\n')
          .map(s => s.trim()).filter(s => s.length > 2);
        if (lines.length) {
          texts.set(id, lines.sort((a, b) => b.length - a.length)[0]);
        }
      }
    }

    const all = new Set([...labels.keys(), ...texts.keys()]);
    return [...all].map(id => ({ id, name: labels.get(id) || texts.get(id) || id }));
  });
}

// ── Teachers ──────────────────────────────────────────────────
//
// The class list page doesn't show teachers any more (it became a to-do
// list), so they come from each class's People page (/r/<id>/sort-last-name),
// ~5 s a class. Teachers rarely change, so a class is looked up at most once
// a week, a few per pass, and the answer is kept in classes.json, where the
// page and the API already read a `teacher` field (Canvas fills its own).
const TEACHER_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const TEACHER_LOOKUPS_PER_PASS = 3;

/** Runs in the page. The first region of the People page is the teachers
 *  (a heading, then one list item each); the name is an item's first text.
 *  Matched by structure, not by Google's generated class names or wording. */
function teacherNamesFromPeoplePage() {
  const heading = document.querySelector('main h2, [role="main"] h2');
  const region = heading && heading.closest('[role="region"]');
  if (!region) return null;
  const names = [];
  // Only the teachers' own list items: each one's options menu ("Email",
  // "Remove") is a list of its own inside it.
  for (const li of region.querySelectorAll('li')) {
    if (li.parentElement.closest('li')) continue;
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (!text || text.includes('@')) continue;
      if (!n.parentElement.closest('[role="tooltip"], [role="menu"], button')) { names.push(text); break; }
    }
  }
  return names;
}

async function readClassroomTeachers(page, cls) {
  await page.goto(`https://classroom.google.com/u/${U}/r/${cls.id}/sort-last-name`,
                  { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForSelector('main [role="region"] li', { timeout: 20000 });
  const names = await page.evaluate(teacherNamesFromPeoplePage);
  if (!names) throw new Error('no teacher list on the People page');
  return [...new Set(names)].join(', ');
}

/** Which classes to look up this pass: never looked up, or over a week ago. */
function classesNeedingTeacher(classes, now = Date.now()) {
  return classes
    .filter(c => !c.teacherAt || now - Date.parse(c.teacherAt) > TEACHER_REFRESH_MS)
    .slice(0, TEACHER_LOOKUPS_PER_PASS);
}

/** A freshly read class list keeps what's already known about each class's teacher. */
function withKnownTeachers(found, previous) {
  const byId = new Map(previous.map(c => [c.id, c]));
  return found.map(c => {
    const known = byId.get(c.id);
    return known && known.teacherAt ? { ...c, teacher: known.teacher, teacherAt: known.teacherAt } : c;
  });
}

/** Writes this pass's lookups (id -> "A, B") into classes.json. */
function saveClassroomTeachers(found, now = new Date()) {
  if (!found.size) return;
  const list = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
  for (const c of list) {
    if (!found.has(c.id)) continue;
    c.teacher = found.get(c.id);
    c.teacherAt = now.toISOString();
  }
  fs.writeFileSync(CLASSES_FILE, JSON.stringify(list, null, 2));
}

/** The last class list that was read successfully. */
function classesFromMemory() {
  if (fs.existsSync(CLASSES_FILE)) {
    try {
      const list = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
      if (Array.isArray(list) && list.length) return list;
    } catch {}
  }
  return CLASSES_FALLBACK;
}

/**
 * The class list to use for this pass.
 *
 * AN EMPTY RESULT DOESN'T MEAN "THERE ARE NO CLASSES". The page could
 * have failed to load, the network could have blipped, cookies could
 * have expired. Trusting an empty result would make the script go quiet
 * for the whole day, thinking there's nowhere to study — exactly the
 * failure all of this was built to prevent. So on any failure, the last
 * list that was read successfully gets used instead.
 */
async function resolveClasses(page) {
  let found = [];
  try {
    found = await getClasses(page);
  } catch (e) {
    if (/cookies expired/.test(e.message)) cookiesExpired = true;
    console.warn(`  class list didn't load (${e.message}) — using the previous one`);
  }

  if (!found.length) {
    const previous = classesFromMemory();
    console.log(`Classes: ${previous.length} (from memory, the list page didn't respond)`);
    return previous.filter(c => !EXCLUSIONS.includes(c.name) && !isClassStale(c.name));
  }

  // Remembered BEFORE subtracting exclusions: an exclusion is a decision
  // to "not read this", not "this class doesn't exist". It gets filtered
  // out of the list below — so the class comes back the moment the
  // exclusion line is removed. Same reasoning applies to a stale class:
  // it comes back on its own the moment it has real activity again,
  // since classLastActivity() only ever looks forward from whatever it
  // reads in memory.
  // A class a teacher renamed keeps its id: everything saved under the old
  // name follows it (43-class-renames.js), before anything below or the
  // pass itself goes by name. EXCLUSIONS is this process's copy of the
  // setting, so it follows in place too.
  const renames = classRenames.renamesBetween(classesFromMemory(), found);
  if (renames.size) {
    try {
      classRenames.followRenames(renames);
      EXCLUSIONS.splice(0, EXCLUSIONS.length, ...EXCLUSIONS.map(n => renames.get(n) || n));
      for (const [old, now] of renames) RENAMED.set(old, now);
      console.log(`  renamed by the teacher: ${renames.size} class${renames.size === 1 ? '' : 'es'}`);
    } catch (e) {
      console.warn(`  couldn't follow a class rename (${e.message})`);
    }
  }
  found = withKnownTeachers(found, classesFromMemory());
  fs.writeFileSync(CLASSES_FILE, JSON.stringify(found, null, 2));

  const stale = found.filter(c => !EXCLUSIONS.includes(c.name) && isClassStale(c.name));
  const selected = found.filter(c => !EXCLUSIONS.includes(c.name) && !isClassStale(c.name));
  console.log(`Classes: ${selected.length}` +
    (EXCLUSIONS.length ? ` (skipping by the exclusion list: ${EXCLUSIONS.join(', ')})` : '') +
    (stale.length ? ` (skipping stale: ${stale.map(c => c.name).join(', ')})` : ''));
  return selected;
}

// ── Network measurement ───────────────────────────────────────

/**
 * Quickly estimates how good the internet is right now, and returns a
 * multiplier for every wait timeout.
 *
 * Why: the thresholds are tuned for a good connection (8 seconds for an
 * empty class, 60 for a normal one). On bad internet, eight seconds won't
 * even be enough for a real class — the script would decide there are no
 * assignments when there are. The user's idea.
 *
 * The measurement is deliberately crude: precision isn't needed here,
 * just an order of magnitude. Pulls a small file from Google itself and
 * times how long that took.
 */
async function measureNetwork(page) {
  try {
    const ms = await page.evaluate(async () => {
      const t = performance.now();
      // With a limit: on a bad connection this can otherwise wait for minutes.
      await fetch('https://classroom.google.com/favicon.ico',
                  { cache: 'no-store', mode: 'no-cors', signal: AbortSignal.timeout(10000) });
      return Math.round(performance.now() - t);
    });

    // Thresholds by eye. The first one was raised to 800ms after a
    // measurement on a real connection: 518ms is normal home internet,
    // not slow, no reason to double the timeouts over it.
    const multiplier = ms < 800 ? 1 : (ms < 2000 ? 2 : 4);
    console.log(`Connection: ${ms}ms — timeouts ×${multiplier}`);
    return multiplier;
  } catch (e) {
    // Couldn't even measure it — assume the connection is bad.
    console.warn('Network measurement failed, using ×4 margin:', e.message);
    return 4;
  }
}

module.exports = {
  U, AUTHUSER, CLASSES_FILE, EXCLUSIONS, RENAMED, classRenames, cookiesHaveExpired,
  detectErrorPage, scrapeClass, scrapeClassChecked,
  flippedFromTurnedIn, looksMisread, keepTurnedIn, TURNED_IN_THRESHOLD, TURNED_IN_LOG,
  readInstructions, readInstructionsInPage,
  getClasses, teacherNamesFromPeoplePage, readClassroomTeachers, classesNeedingTeacher,
  withKnownTeachers, saveClassroomTeachers, classesFromMemory, resolveClasses,
  measureNetwork,
};
