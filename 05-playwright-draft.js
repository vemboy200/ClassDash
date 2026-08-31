/*
 * School Digest — collects school assignments into one summary.
 * Copyright (C) 2026 Artem
 *
 * Free software: distributed under the terms of the GNU GPL version 3,
 * or (at your option) any later version. Full text in the LICENSE file.
 * Distributed WITHOUT ANY WARRANTY.
 */

/**
 * MAIN FILE: collects assignments, compares against memory, notifies.
 *
 * Goes through Google Classroom classes, reads Canvas and Edpuzzle, puts
 * it all into one summary and shows a notification popup — but only if
 * something new showed up. Runs on a schedule, every ten minutes of the
 * school day.
 *
 * Important: there is NO MODEL here. This is an ordinary program. It can
 * run every hour and won't spend a single token.
 *
 * ── About the name ───────────────────────────────────────────
 *
 * The file is called "draft", and that's a holdover from day one: it
 * really was written blind, with no browser access, as a starting point.
 * It's been working since August 10th, and more than a dozen bugs have
 * been fixed in it since. The name outlived its accuracy — it was never
 * renamed, so as not to break links in the launchd schedule and in two
 * apps. (This whole codebase was later translated from Russian to
 * English for contributors — if you have an existing launchd plist or a
 * native app pointing at the old `05-playwright-черновик.js` filename,
 * it needs updating to `05-playwright-draft.js`.)
 *
 * ── What's nearby ────────────────────────────────────────────
 *
 *   08-page.js          builds the summary page
 *   10/11/12-*.js       Canvas, Edpuzzle, the announcement feed
 *   17-api.js           the home API
 *   18/19-*.js          language and settings
 *
 * ── Setup ────────────────────────────────────────────────────
 *   npm install
 *   npm run setup-browser
 *   cp settings.example.json settings.json   and fill in your own
 *
 * ── First run (sign in by hand, once) ─────────────────────────
 *   node 05-playwright-draft.js --login
 *   A browser window opens. Sign into your school account BY HAND.
 *   Cookies land in ./browser-profile and survive restarts.
 *
 * ── How to run it ────────────────────────────────────────────
 *   node 05-playwright-draft.js               a normal pass
 *   node 05-playwright-draft.js --full        and Edpuzzle too
 *   node 05-playwright-draft.js --redraw      just the page
 *   node 05-playwright-draft.js --language en one-time different language
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── Timestamps in the log ─────────────────────────────────────
//
// The log is written by launchd into runs.log and grows by a few thousand
// lines a week. Twenty thousand lines WITHOUT A SINGLE TIMESTAMP — and
// when figuring out in August why the watchdog cut off 72 passes, the
// time of each one had to be worked out from neighboring entries.
// Expensive and unreliable.
//
// So every line gets a time. The first line of a run gets a date too:
// the log lives for weeks, and without a date "14:22" means nothing.
//
// Multi-line output (the summary, assignment lists) is only tagged on its
// first line: tagging every one would turn readable chunks into a column
// of numbers.
(function timestampLogs() {
  const pad2 = n => String(n).padStart(2, '0');
  const timeStr = () => {
    const t = new Date();
    return `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
  };

  for (const channel of ['log', 'warn', 'error']) {
    const original = console[channel].bind(console);
    console[channel] = (...args) => {
      if (typeof args[0] === 'string') {
        // An empty string stays empty: it's a separator, not a message.
        if (args[0] === '') original(...args);
        else original(`${timeStr()} ${args[0]}`, ...args.slice(1));
      } else {
        original(`${timeStr()}`, ...args);
      }
    };
  }

  // Only print the header if the file was RUN, not loaded as a library:
  // otherwise test runs get cluttered with headers that aren't theirs.
  if (require.main !== module) return;

  const t = new Date();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`RUN ${t.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })}`);
})();

// ── Settings ─────────────────────────────────────────────────

const PROFILE_DIR = path.join(__dirname, 'browser-profile');
const STATE_FILE = path.join(__dirname, 'last-collection.json');

// THERE USED TO BE A SEPARATE NOTIFIER APP HERE.
//
// Напоминалка.app, then briefly SHREK Notifier.app, launched fresh for
// every notification and every page-button click alike. Both jobs now
// live in 16-summary.swift itself: page-button actions go through its
// WKScriptMessageHandler bridge or its napominalka:// Apple Event
// handler, and notifications go through the two paths notify() picks
// between below. One app, one thing to build, one thing to sign.
//
// NAMED IN ENGLISH ON PURPOSE, UNLIKE NOTIFY_FILE/QUIET_FILE/HIDDEN_FILE
// BELOW — nobody sees a data filename, but an app's own name shows up
// in Privacy & Security prompts and notification banners, which is
// exactly what made "Напоминалка" worth fixing and is why this points
// at English from the start.
// /Applications, NOT next to this script. build.sh always installs
// there (Quick Actions and Spotlight only see it from that location —
// see build.sh's own comment on why), and that's the ONE copy the user
// actually launches and leaves running. Pointing this at the local
// project-directory build instead (there usually is one — build.sh
// makes both) would silently defeat isSummaryAppRunning() below: it
// would never recognize the /Applications copy as "already running",
// since they're different file paths, and would launch a second,
// separate process from the local copy instead of reaching the real
// one. That's not hypothetical — it's exactly what happened testing
// this the first time.
const SUMMARY_APP = '/Applications/ClassDash.app';

// The script hands the popup text to the app through this file.
// First line is the title, the rest is the body. The app deletes
// the file right after reading it.
const NOTIFY_FILE = path.join(__dirname, 'уведомление.txt');

// Log: what's already been reported, and on which day. Needed because the
// script runs every 10 minutes, while a due-soon assignment stays due for
// weeks. Without this log, the same popup would show up 48 times a day,
// and people would stop noticing it — meaning the system would be
// completely broken.
const NOTIFY_LOG = path.join(__dirname, 'notification-log.json');

// What was new in the last collection. Needed ONLY for redrawing the page
// without collecting (a language change): freshIds live in the memory of
// a single pass, and without this file the "new" badges would disappear
// on every redraw.
const FRESH_FILE = path.join(__dirname, 'new.json');

// Lock: keeps two collections from running at once.
//
// The browser profile is a folder, and only one Chrome can work with it
// at a time. Starting a second collection on top of a running one crashes
// with "Failed to create SingletonLock: File exists". Caught live: a
// scheduled run started at 10:00, a manual one at 10:01. The same thing
// happens whenever someone clicks "check now".
const LOCK_FILE = path.join(__dirname, '.collection-lock');

// The summary page. Opens when the notification popup is clicked.
// Built by an ordinary program, see 08-page.js — no model is involved,
// so it can be updated every 10 minutes without a second thought.
const PAGE_FILE = path.join(__dirname, 'summary.html');

// The notifier appends assignment ids here when the "not urgent" button
// was clicked on the page. Undated assignments like that stop counting
// as due soon, but don't disappear from the list.
const QUIET_FILE = path.join(__dirname, 'не-срочно.txt');

// The notifier appends ids of overdue assignments removed from the list
// here. Removed with a button on the page, with a confirmation.
// Can be restored from the same place.
const HIDDEN_FILE = path.join(__dirname, 'скрытые.txt');
const { writePage, daysUntil } = require('./08-page.js');
const { collectCanvas } = require('./10-canvas.js');
const { collectEdpuzzle } = require('./11-edpuzzle.js');
const { collectFeed, setFeedEmail } = require('./12-feed.js');
const { t, locale } = require('./18-language.js');
const SETTINGS = require('./19-settings.js').read();

// This used to be channel: 'chrome' directly everywhere — only worked
// with a system-installed Google Chrome, and on other Chromium forks
// (confirmed with Arc) risked touching a person's real, everyday profile.
// The order now is:
//   1. browserPath in settings — if someone set this themselves, it wins;
//   2. this project's own Brave from .browser/, if it's installed
//      (npm run setup-browser) — the safe default, used for nothing else;
//   3. channel: 'chrome' — if neither of those exist.
// Details, and why this matters at all, are in 20-browser.js.
const { isInstalled: ownBrowserInstalled, BINARY: OWN_BROWSER } = require('./20-browser.js');
const { isClassStale, recordActivity } = require('./22-class-activity.js');
const BROWSER = SETTINGS.browserPath
  ? { executablePath: path.resolve(__dirname, SETTINGS.browserPath) }
  : ownBrowserInstalled()
  ? { executablePath: OWN_BROWSER }
  : { channel: 'chrome' };

// Announcement memory is separate from assignment memory: they have a
// different nature — no due dates, never "due soon", but freshness matters.
const STREAM_FILE = path.join(__dirname, 'messages.json');

// "Full summary" hours: the script reminds about everything due soon at
// these hours, even if it's long since known. The rest of the time it
// only reports what's new and stays quiet about the old.
//
// The user's idea, and better than the first version ("first run of the
// day"): this way it's clear when to expect a reminder and when silence
// is normal. 8am — before school, 6pm — in the evening, when there's time
// to sit down.
const DIGEST_HOURS = SETTINGS.summaryHours;

// Account index in Google's multi-login.
// In a normal Chrome the user's school account is the second one (/u/2/),
// but here the profile is dedicated and has exactly one account, hence 0.
const U = SETTINGS.account;

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
const CLASSES_FILE = path.join(__dirname, 'classes.json');

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

// School email. Substituted into links as ?authuser=...
//
// Why: without specifying an account, Google opens the link under
// whichever Google account is the default one, and the school class
// responds with "Class not found" and a Switch account button. Confirmed
// by hand. /u/2/ could be used instead, but that's just a positional
// index — it shifts if an account is added or removed. Email doesn't.
const AUTHUSER = SETTINGS.email;

// An empty Canvas address means "don't read it". Lives at module level
// because it's needed in two places: during collection (don't open a tab)
// and when comparing against memory (treat the source as unread).
// A declaration inside collect() didn't reach the second place — caught
// by running it.
const CANVAS_ENABLED = !!(SETTINGS.canvas || '').trim();

// EXPIRED COOKIES — A FAILURE WORTH SHOUTING ABOUT.
//
// Google eventually signs the profile out (noted from day one: "cookies
// live for weeks, but not forever"). After that EVERY class responds with
// a sign-in page, collection quietly falls back to memory for everything,
// and from outside it looks like "nothing changed" — the summary's there,
// no popups.
//
// That is, the system goes blind SILENTLY. Exactly the failure all of
// this was built to prevent: silence indistinguishable from calm.
// Caught on August 24th: last successful collection at 6pm, sign-in page
// after that.
let COOKIES_EXPIRED = false;

// How long to wait for assignments to show up on a class page.
//
// Noted from day one: "Classroom renders in 25-40 seconds". A measurement
// on August 11th showed otherwise: real classes come back in 3-4 seconds.
// Probably a browser extension was slowing things down back then, not the
// site. Margin is kept anyway: the site is slow and can hang.
const TIMEOUT = SETTINGS.classTimeoutMs;

// A separate, shorter timeout for classes that, as far as memory goes,
// have NEVER had an assignment. A class like that used to wait out a full
// minute for nothing every time — and on its own decided how long the
// whole pass took, since branches run in parallel and the total time
// equals the slowest one.
//
// Measured: AP World 3s, GUSD 4s, Edpuzzle 7s, Canvas 10s,
//           empty class    61s ← the whole pass rode on this one.
//
// It was first set to 30 seconds, then the user rightly pointed out:
// slowing down every single pass all year for the sake of a class that
// never got a single assignment is a bad trade. Real classes come back in
// 3-4 seconds, so eight is plenty of margin.
//
// Risk: if that class's first-ever assignment shows up right as the page
// happens to be slow, it gets missed this time. Not a problem — it'll
// show up ten minutes later on the next run, and from then on the class
// counts as non-empty and gets the full minute.
const EMPTY_TIMEOUT = SETTINGS.emptyTimeoutMs;

// How long a single pass is allowed to run before it's treated as hung
// and cut off.
//
// WHY THIS IS NEEDED AT ALL. On August 13th at 14:22 a run lost its
// internet connection and hung — not crashed, actually hung, forever.
// Individual waits inside it have their own timeouts, but there was no
// overall limit on the pass, and it hung there for 22 hours.
//
// The worst part turned out to be the consequence: launchd won't start a
// new copy while the old one is still alive. It honestly believed work
// was in progress, and every scheduled run that day never happened. The
// system wasn't silent because there was no news — it was silent because
// it wasn't looking, and from outside those look identical.
//
// A normal pass is 17 seconds, a full one with Edpuzzle is about a
// minute. Five minutes is fifteen times that margin: even a very slow day
// won't hit it, and a hung pass will die on its own.
const PASS_LIMIT = SETTINGS.passLimitMs;

// ── Login mode ───────────────────────────────────────────────

async function login() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...BROWSER,               // a real browser, not a stripped-down chromium:
                              // otherwise Google cuts off the login as "not secure"
    headless: false,          // the window has to be visible — a human signs in
    viewport: { width: 1280, height: 900 },
  });
  const classroomPage = await ctx.newPage();
  await classroomPage.goto('https://classroom.google.com/');

  // A second tab for Edpuzzle, opened in the same persistent profile.
  // Edpuzzle doesn't share Google's session — confirmed live: it answers
  // 401 on its own API until someone signs into it directly, even though
  // the Google account in this same profile is already authenticated.
  // There used to be no way to ever sign into it at all.
  const edpuzzlePage = await ctx.newPage();
  await edpuzzlePage.goto('https://edpuzzle.com/');

  console.log('\nTwo tabs opened: sign into your school Google account in one,');
  console.log('and into Edpuzzle in the other (skip the Edpuzzle tab if you');
  console.log('don\'t use it — nothing reads it unless you run --full).');
  console.log('Once you\'re signed in — close the window.\n');

  // Wait for the person to finish. Just keep the process alive.
  await new Promise(resolve => ctx.on('close', resolve));
  console.log('Profile saved to', PROFILE_DIR);
}

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
    let previousCount = -1, stableRounds = 0;
    for (let i = 0; i < 40; i++) {
      const currentCount = await page.evaluate(
        () => document.querySelectorAll('li[data-stream-item-id]').length);
      if (currentCount === previousCount) {
        // Three measurements in a row with no change — call it rendered.
        if (++stableRounds >= 3) break;
      } else {
        stableRounds = 0;
      }
      previousCount = currentCount;
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
      // assignment and aren't visible in the list — getting them would
      // mean opening every assignment individually, 25-40 seconds each.
      // Deferred.
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
                  { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

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
    if (/cookies expired/.test(e.message)) COOKIES_EXPIRED = true;
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
      await fetch('https://classroom.google.com/favicon.ico',
                  { cache: 'no-store', mode: 'no-cors' });
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

// ── Lock against simultaneous runs ────────────────────────────

/**
 * Tries to acquire the lock. Returns false if a collection is already running.
 *
 * The file holds a process id. The check isn't "does the file exist" but
 * "is that process still alive": if the previous collection crashed or
 * got killed, the file would be left behind, and without this check the
 * script would lock itself out forever.
 */
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    let alive = false;
    try {
      // Signal 0 does nothing, it just checks whether the process exists.
      process.kill(pid, 0);
      alive = true;
    } catch { /* no such process — the lock is abandoned */ }

    if (alive) return false;
    console.log(`Lock left over from a crashed run (pid ${pid}), clearing it`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

// ── The main pass ──────────────────────────────────────────────

/**
 * @param onProgress        called after each source is read
 * @param nonEmptyClasses   classes that have ever had assignments
 * @param withEdpuzzle      whether to read Edpuzzle (it needs a visible window)
 */
async function collect(onProgress, nonEmptyClasses = new Set(), withEdpuzzle = false) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...BROWSER,               // the same browser as login mode —
                              // otherwise the cookie profile won't be picked up
    // THE WINDOW IS ONLY SHOWN FOR EDPUZZLE'S SAKE.
    //
    // An invisible browser doesn't work for it: it answers "Error 18"
    // before any sign-in, cookies included. Its protection has been
    // broken many times over for bypassing assignments, so it's
    // suspicious of automation. This does NOT get around that — it just
    // opens a normal window.
    //
    // But the window is expensive: opening it makes macOS switch to
    // Chrome's desktop, yanking you out of fullscreen apps. The "switch
    // to a Space with the app's windows" checkbox does NOT fix this —
    // confirmed, it's off, and the switch happens anyway. It comes from
    // the app activation itself, and macOS has no exception for a single
    // window.
    //
    // So Classroom and Canvas are read invisibly every 10 minutes, and
    // Edpuzzle only during full-summary hours, with a window. Two
    // switches a day instead of forty-eight, and both while the user is
    // already at the computer anyway.
    //
    // Position -3000,-3000 pushes the window off past the corner of the
    // screen, so at least it doesn't sit there in view.
    headless: !withEdpuzzle,
    viewport: withEdpuzzle ? null : { width: 1280, height: 900 },
    args: withEdpuzzle
      ? ['--window-position=-3000,-3000', '--window-size=1280,1000']
      : [],
    // The profile remembers Russian — Chrome picked it up from the system
    // when it was created. Canvas was serving pages in Russian because of
    // it, dates included, like "среда, 10 июня 2026". This header
    // overrides the language for every request. Canvas's own account
    // settings aren't touched: the user's interface on their Chromebook
    // stays Russian.
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  // Every class is read AT THE SAME TIME, each in its own tab.
  //
  // This used to be a sequential loop, and the total time was the sum:
  // three classes at 25-60 seconds each is two and a half minutes, a
  // whole minute of which was one empty class just waiting it out to
  // honestly say "no assignments".
  //
  // Now the total time equals the slowest class, not the sum. The user's idea.
  const startTime = Date.now();
  const completed = [];

  // The network is measured BEFORE the other branches: their timeouts
  // depend on it. It costs a couple seconds and pays for itself on bad
  // internet. This whole part is guarded — not because anything here is
  // especially fragile, but because failing here means never reaching
  // the browser close, and Chrome with a locked profile folder would
  // take down EVERY following run.
  let multiplier = 1;
  let classes = classesFromMemory().filter(c => !EXCLUSIONS.includes(c.name) && !isClassStale(c.name));
  try {
    const probePage = await ctx.newPage();
    await probePage.goto('https://classroom.google.com/', { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    multiplier = await measureNetwork(probePage);

    // The class list is fetched with the same tab — it's already on
    // Classroom, no reason to open a separate one. Done before the
    // branches, because without the list it's unknown how many there
    // will even be.
    classes = await resolveClasses(probePage);
    try { await probePage.close(); } catch { /* already closed — no big deal */ }
  } catch (e) {
    console.warn(`couldn't open a tab to measure (${e.message}) — ` +
                 `using the class list from memory and timeouts with margin`);
    multiplier = 4;
  }

  // Every source: Classroom classes plus Canvas as one extra line.
  // Canvas is read via its API and finishes in seconds, so it doesn't add
  // to the total pass time — it's done before the slowest class anyway.
  // AN EMPTY CANVAS ADDRESS MEANS "DON'T READ IT", NOT "BROKEN".
  //
  // Both the settings and the hint under the gear icon say "empty —
  // Canvas is skipped". There used to be no such check in the code: an
  // empty address went into page.goto('/') and produced "Cannot navigate
  // to invalid URL" — twice (there's a retry) — after which the source
  // counted as broken.
  //
  // Harmless for the user — their address is filled in. But the very
  // first person who downloads this project from GitHub would get a
  // permanent "Could not read: Canvas" banner on their summary instead
  // of an honest "Canvas is off".
  if (!CANVAS_ENABLED) console.log('Canvas is off: no address set in settings');

  const sources = [...classes,
    ...(CANVAS_ENABLED ? [{ id: 'canvas', name: 'Canvas' }] : []),
    ...(withEdpuzzle ? [{ id: 'edpuzzle', name: 'Edpuzzle' }] : [])];

  // Reported the moment a source finishes reading, without waiting for
  // the rest. Thanks to this, the summary page updates after EVERY
  // source, and can be checked without waiting for the whole thing.
  // The user's idea: there's not much point waiting a full minute for a
  // list that's already partly ready after twenty seconds.
  const reportProgress = (result) => {
    // Timing for each branch. Total pass time equals the slowest one, so
    // it's useful to know exactly who's dragging.
    console.log(`  done: ${result.cls.name} — ` +
                `${Math.round((Date.now() - startTime) / 1000)}s, assignments ${result.items.length}`);
    completed.push(result);
    if (!onProgress) return;
    try {
      onProgress({
        items: completed.flatMap(r => r.items),
        reading: completed.map(r => r.cls.name),
        broken: completed.filter(r => !r.ok).map(r => r.cls.name),
        stillReading: sources
          .filter(s => !completed.some(r => r.cls.id === s.id))
          .map(s => s.name),
      });
    } catch (e) {
      // Rendering the page shouldn't take down the collection.
      console.warn('failed to update the page along the way:', e.message);
    }
  };

  const canvasTask = !CANVAS_ENABLED ? null : (async () => {
    console.log('Reading: Canvas');
    // Opening the tab INSIDE the try block, not before it. If it fails
    // outside, the whole Promise.all crashes, taking the browser close
    // with it.
    let page = null;
    let result;
    try {
      page = await ctx.newPage();
      const { items, courses, pending } = await collectCanvas(page);
      console.log(`  Canvas: courses ${courses.length}, assignments ${items.length}` +
                  (pending.length ? `, waiting to publish: ${pending.join(', ')}` : ''));
      result = { cls: { id: 'canvas', name: 'Canvas' }, items, ok: true };
    } catch (e) {
      console.error(`  error on Canvas: ${e.message}`);
      result = { cls: { id: 'canvas', name: 'Canvas' }, items: [], ok: false };
    } finally {
      if (page) { try { await page.close(); } catch {} }
    }
    reportProgress(result);
    return result;
  })();

  const edpuzzleTask = !withEdpuzzle ? null : (async () => {
    console.log('Reading: Edpuzzle');
    let page = null;
    let result;
    try {
      page = await ctx.newPage();
      const { items, classrooms } = await collectEdpuzzle(page);
      console.log(`  Edpuzzle: classes ${classrooms.length}, assignments ${items.length}`);
      result = { cls: { id: 'edpuzzle', name: 'Edpuzzle' }, items, ok: true };
    } catch (e) {
      console.error(`  error on Edpuzzle: ${e.message}`);
      result = { cls: { id: 'edpuzzle', name: 'Edpuzzle' }, items: [], ok: false };
    } finally {
      if (page) { try { await page.close(); } catch {} }
    }
    reportProgress(result);
    return result;
  })();

  const classTasks = classes.map(async (cls) => {
    console.log(`Reading: ${cls.name}`);
    // A class that's never had an assignment gets less time.
    //
    // There was an attempt to always wait the full amount during full
    // checks (8:00, 18:00, the button) — to cover the start of the school
    // year, when every class is empty. The user rejected that: a minute
    // is too expensive, it should always be fast.
    //
    // The trade-off is a deliberate one: if a newly-empty class's first
    // assignment doesn't render in time within 8 seconds, it'll show up
    // on the next run ten minutes later. The cost is a delay, not a loss.
    const timeoutMs = (nonEmptyClasses.has(cls.name) ? TIMEOUT : EMPTY_TIMEOUT) * multiplier;
    let page = null;
    let result;
    try {
      page = await ctx.newPage();
      const items = await scrapeClass(page, cls, timeoutMs);

      // The same class's feed — teacher announcements. Read with the same
      // tab right after the assignments: no reason to open a separate
      // one, and it only takes three seconds.
      let announcements = [];
      try {
        announcements = await collectFeed(page, cls, U);
      } catch (e) {
        console.warn(`  feed for ${cls.name}: ${e.message}`);
      }

      result = { cls, items, announcements, ok: true };
    } catch (e) {
      if (/cookies expired/.test(e.message)) COOKIES_EXPIRED = true;
      console.error(`  error on ${cls.name}: ${e.message}`);
      // ok: false is NOT "the class is empty", it's "the class didn't
      // load". The difference matters — see diffWithPrevious.
      result = { cls, items: [], ok: false };
    } finally {
      if (page) { try { await page.close(); } catch {} }
    }
    reportProgress(result);
    return result;
  });

  // THE BROWSER CLOSES NO MATTER WHAT.
  //
  // `ctx.close()` used to just be the next line after Promise.all — that
  // is, it only ran if everything went smoothly.
  //
  // WHAT THIS ACTUALLY CAUSED (confirmed with a deliberately triggered
  // failure on August 14th): one failing branch took down the ENTIRE
  // pass. Not "one class didn't load" — nothing: no page, no popup, no
  // memory write. Three working sources vanished because of one broken one.
  //
  // And what DIDN'T happen, contrary to the first guess: Chrome with a
  // locked profile did NOT stick around. Playwright kills the browser
  // when node exits, even on an error. A locked profile happens a
  // different way — when the process never exits at all (see PASS_LIMIT).
  //
  // So the actual benefit of this guard is elsewhere: one source failing
  // stays exactly that — one source failing.
  let results;
  try {
    results = await Promise.all(
      [...classTasks, canvasTask, edpuzzleTask].filter(Boolean));
  } finally {
    try {
      await ctx.close();
    } catch (e) {
      console.warn('failed to close the browser:', e.message);
    }
  }
  console.log(`Read in ${Math.round((Date.now() - startTime) / 1000)}s`);

  return {
    all: results.flatMap(r => r.items),
    announcements: results.flatMap(r => r.announcements || []),
    broken: results.filter(r => !r.ok).map(r => r.cls.name),
  };
}

// ── macOS notification ────────────────────────────────────────

/**
 * Shows the popup. Only ever called when there's something to say —
 * otherwise the whole point is lost: a notification that shows up every
 * hour for no reason stops getting noticed within two days.
 *
 * About "stays until dismissed": that's not a command-line option, it's a
 * system setting. System Settings -> Notifications -> find the app the
 * popup shows up under -> "Alerts" style instead of "Banners". A banner
 * leaves on its own after a few seconds, an alert stays on screen until
 * dismissed.
 *
 * Won't show over a fullscreen game — on macOS a fullscreen app gets its
 * own Space, and other windows don't draw there. But the notification
 * will be waiting in Notification Center, so it isn't lost.
 */
function notify(title, subtitle, message) {
  const { execFileSync } = require('child_process');

  if (fs.existsSync(SUMMARY_APP)) {
    try {
      // Three lines: title, subtitle, message. Written before either
      // path below, since both read the same file — see
      // postPendingNotification() in 16-summary.swift.
      fs.writeFileSync(NOTIFY_FILE, `${title}\n${subtitle}\n${message}`);

      // TWO PATHS, BECAUSE macOS TREATS "RUNNING" AND "NOT RUNNING"
      // COMPLETELY DIFFERENTLY FOR A SINGLE-INSTANCE APP.
      //
      // Confirmed directly, the hard way: `open -a ClassDash
      // --args --notify` against an ALREADY-RUNNING instance
      // does nothing at all — no error, no new process, the file just
      // sits there unread. macOS doesn't hand a running single-instance
      // app a fresh set of command-line arguments; --args is only
      // honored on the launch that actually starts the process.
      //
      // Every other action on the page reaches an already-running
      // instance fine, through the SAME napominalka:// scheme, because
      // that's delivered as an Apple Event, not as argv — and Apple
      // Events DO reach a process that's already up. So notifications
      // reuse that exact path when the app is already running, and
      // fall back to a fresh --notify launch only when it isn't.
      if (isSummaryAppRunning()) {
        // -g: don't bring the app to the foreground. Confirmed live
        // that without it, `open` activating the app is enough on its
        // own to trigger applicationDidBecomeActive -> a page reload —
        // exactly the disruption this whole branch exists to avoid.
        // The Apple Event still reaches handleGetURL either way; -g
        // only changes whether opening it also steals focus.
        execFileSync('open', ['-g', 'napominalka://notify']);
      } else {
        execFileSync('open', ['-a', SUMMARY_APP, '--args', '--notify']);
      }
      return;
    } catch (e) {
      console.warn('ClassDash notification failed:', e.message);
    }
  }

  // Fallback: if the app is missing (deleted, never built), show
  // something anyway. Here the text has to be pasted directly into the
  // code, so quotes and backslashes are escaped by hand.
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    execFileSync('osascript', ['-e',
      `display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"`]);
  } catch (e) {
    console.warn('failed to show a notification:', e.message);
  }
}

/** Whether the summary app already has a process running — determines
 *  which of notify()'s two delivery paths actually reaches it.
 *  execFileSync, not a shell string: the path has spaces in it
 *  ("ClassDash.app"), and this way there's no shell quoting
 *  to get right at all. */
function isSummaryAppRunning() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('pgrep', ['-f', path.join(SUMMARY_APP, 'Contents', 'MacOS') + '/'],
      { stdio: 'ignore' });
    return true;
  } catch {
    // pgrep exits non-zero when nothing matches — that's "not running",
    // not a failure worth reporting.
    return false;
  }
}

// ── Date parsing ─────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Turns "Due Aug 25, 8:30 AM" into a real date.
 *
 * Two quirks of Classroom:
 *
 * 1. It only writes the year if it's different from the current one.
 *    "Due Aug 25" means the nearest August 25th.
 *
 * 2. Teachers too lazy to pick "no due date" set a placeholder year like
 *    2031. That's NOT a real due date. But it's not "no date" either:
 *    the assignment is real, the date was just forgotten. Agreed with the
 *    user to treat this as urgent — due tomorrow — so it doesn't get lost.
 */
function parseDue(dueStr, now = new Date()) {
  if (!dueStr) return { at: null, placeholder: false };

  const s = dueStr.replace(/^Due\s+/, '');

  // CLASSROOM WRITES NEAR DUE DATES AS WORDS, NOT AS A DATE.
  //
  // "Due Today", "Due Tomorrow, 8:30 AM", "Due Yesterday", and sometimes
  // just a bare time — "Due 8:00 AM", meaning today. The regex below
  // expects three month letters followed by a digit, so none of these
  // strings matched it: "Today" is three letters, but followed by "ay",
  // not a number.
  //
  // What this caused: `at` came back null, the assignment was treated as
  // "no due date at all", got pushed to "by tomorrow" (or, for
  // "Yesterday", straight into "undated" with no way to tell it had
  // already passed), and got a "not urgent" button. Meaning a real,
  // TODAY deadline sorted BELOW tomorrow's assignments, never landed in
  // "Overdue", and clicking the button dismissed it from view entirely.
  //
  // Caught in an independent check on August 24th against live memory:
  // six out of ten due dates failed to parse, and they were the most
  // urgent assignments. "Yesterday" specifically was found later,
  // reported directly against a real assignment ("Name Poem") that had
  // genuinely passed its due date the day before but showed as having
  // no due date at all — the exact same failure shape, just one word
  // this regex hadn't been taught yet.
  //
  // \b — "not followed by a letter": otherwise "Tomorrowland" would match
  // Tomorrow.
  const wordMatch = s.match(/^(Yesterday|Today|Tomorrow)\b(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  const timeOnlyMatch = wordMatch ? null : s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (wordMatch || timeOnlyMatch) {
    // "Time only" with no date means today.
    const isTomorrow = !!(wordMatch && /^tomorrow$/i.test(wordMatch[1]));
    const isYesterday = !!(wordMatch && /^yesterday$/i.test(wordMatch[1]));
    const dayOffset = isTomorrow ? 1 : isYesterday ? -1 : 0;
    const [hourStr, minuteStr, ampmStr] = wordMatch
      ? [wordMatch[2], wordMatch[3], wordMatch[4]]
      : [timeOnlyMatch[1], timeOnlyMatch[2], timeOnlyMatch[3]];

    // No time given — end of day, same as "Due Aug 26" with no time.
    // For "Yesterday" this also means: however uncertain the exact hour,
    // treating it as end-of-day still correctly lands it in the past —
    // there's no reading of "Due Yesterday" that could mean anything else.
    let hour = hourStr ? parseInt(hourStr, 10) % 12 : 23;
    if (ampmStr && /pm/i.test(ampmStr)) hour += 12;
    const minute = minuteStr ? parseInt(minuteStr, 10) : 59;

    // Date handles rolling over the end of a month on its own in both
    // directions: August 31st + 1 = September 1st, September 1st - 1 =
    // August 31st.
    const at = new Date(now.getFullYear(), now.getMonth(),
                        now.getDate() + dayOffset, hour, minute);
    return { at, placeholder: false };
  }

  const m = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/);
  if (!m) return { at: null, placeholder: false };

  const [, mon, day, year, hh, mm, ampm] = m;
  const month = MONTHS.indexOf(mon);
  if (month < 0) return { at: null, placeholder: false };

  let hours = hh ? parseInt(hh, 10) % 12 : 23;
  if (ampm === 'PM') hours += 12;
  const minutes = mm ? parseInt(mm, 10) : 59;

  let at;
  if (year) {
    at = new Date(parseInt(year, 10), month, parseInt(day, 10), hours, minutes);
  } else {
    // No year — try last year, this year, and next year and pick
    // whichever one is CLOSEST to today, in either direction.
    //
    // Assuming "no year means the current year" doesn't work: on January
    // 5th, an assignment "Due Dec 20" is last December, overdue, not
    // December eleven months from now. This used to only shift forward,
    // and would lie during the New Year's weeks.
    const y = now.getFullYear();
    at = [y - 1, y, y + 1]
      .map(yy => new Date(yy, month, parseInt(day, 10), hours, minutes))
      .reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
  }

  // A placeholder instead of "no due date": more than a year out.
  const placeholder = at - now > 365 * 864e5;
  return { at, placeholder };
}

/** When an assignment is actually due (accounting for placeholder dates). */
function deadline(item, now = new Date()) {
  // Canvas hands back the date already parsed, in machine format
  // (due_iso). No text to parse — but the "2031 instead of no due date"
  // placeholder can happen here too, so the far-future check is shared.
  if (item.due_iso) {
    const at = new Date(item.due_iso);
    if (isNaN(at)) return null;
    if (at - now > 365 * 864e5) return new Date(now.getTime() + 864e5);
    return at;
  }

  const { at, placeholder } = parseDue(item.due, now);
  if (!at) return null;
  if (placeholder) return new Date(now.getTime() + 864e5); // "by tomorrow"
  return at;
}

// ── Sorting into buckets ───────────────────────────────────────

/**
 * Sorts assignments into "due soon / ahead / undated / in the past".
 *
 * Pulled into its own function because it's called twice: along the way
 * during collection (to redraw the page after each class) and at the end.
 */
function sortIntoBuckets(items, now, mutedIds = new Set(), hiddenIds = new Set()) {
  const burning = [], later = [], undated = [], deferred = [], done = [];
  // Overdue items are no longer just counted, they're collected into a list.
  //
  // They used to silently drop out: past++ and that's it. Tolerable for
  // Classroom — its past holds assignments turned in a year or two ago.
  // But Canvas and Edpuzzle only ever return what's NOT turned in, so
  // overdue there means "didn't turn it in and missed it". That deserves
  // shouting about, not silence.
  //
  // The user looked at an example and asked for these to be shown — but
  // UNDER "Due soon", not above it: what's due soon matters more than
  // what's already a lost cause.
  const overdue = [];
  const gone = [];   // removed by the teacher
  let past = 0;
  const tomorrow = new Date(now.getTime() + 864e5);

  for (const x of items) {
    // Removed by the teacher — into its own bucket and nowhere else.
    // It's not due soon, not overdue, not "ahead": the work doesn't exist
    // anymore, only a trace that it once did.
    if (x.removed) { gone.push(x); continue; }

    // TURNED-IN WORK DOESN'T GO IN A DUE-DATE BUCKET.
    //
    // Once turned in, Classroom changes the first line to "Completed
    // Assignment" or "Completed Question". The check below
    // (/assignment|quiz/) says "yes" to that string too, so turned-in
    // work used to keep showing up as due soon right alongside what
    // wasn't turned in — that's still wrong, so it still doesn't reach
    // burning/later/overdue. It USED to be dropped from every bucket
    // entirely, on the reasoning that it's "handled" — but that also
    // made it invisible to a client asking "what's the full picture for
    // this class", API included, with no way to tell "done" apart from
    // "ClassDash just never saw this" from outside. Tagged and kept
    // instead: due_at comes straight from deadline(), not run through
    // the undated/urgency logic below (mutating it to "tomorrow" etc.)
    // — none of that is about anything once it's already turned in.
    if (/^completed\b/i.test(x.type || '')) {
      done.push({ ...x, done: true, due_at: deadline(x, now) });
      continue;
    }

    // Classroom labels the type itself on the first line: Assignment,
    // Quiz assignment, or Material. A material is something to read, an
    // assignment is something to turn in, and their fate in the summary
    // is different.
    const isAssignment = /assignment|quiz/i.test(x.type);

    let due = deadline(x, now);
    let note = null;

    const isPlaceholder = x.due_iso
      ? (new Date(x.due_iso) - now > 365 * 864e5)
      : parseDue(x.due, now).placeholder;
    if (due && isPlaceholder) {
      note = 'placeholderDateNote';
    }

    if (!due) {
      // A material with no date is just a material — show it once and forget it.
      if (!isAssignment) { undated.push(x); continue; }

      // The user clicked "not urgent" on the page — meaning they've seen
      // this assignment and dealt with it. No more panicking about it,
      // but it isn't discarded either: it just sits in its own list.
      // Marked right here: the page needs to tell "manually muted" apart
      // from everything else, and it can't be done by section name — that
      // gets translated, and the logic would fall apart on a language switch.
      if (mutedIds.has(x.id)) { deferred.push({ ...x, muted: true }); continue; }

      // By default, an assignment with no date can't be lost: it still
      // has to be turned in, the teacher just never set a due date, so
      // it's treated as "by tomorrow". SETTINGS.treatUndatedAsUrgent
      // lets that be turned off for anyone who'd rather these behaved
      // exactly like materials instead — shown once, never due soon.
      if (!SETTINGS.treatUndatedAsUrgent) { undated.push(x); continue; }
      due = tomorrow;
      note = 'noDueDateNote';
    }

    if (due < now) {
      past++;
      overdue.push({ ...x, due_at: due, note, hidden: hiddenIds.has(x.id) });
      continue;
    }
    (due - now <= 7 * 864e5 ? burning : later).push({ ...x, due_at: due, note });
  }

  burning.sort((a, b) => a.due_at - b.due_at);
  later.sort((a, b) => a.due_at - b.due_at);
  // Most recently overdue on top: the more recently something was missed,
  // the more it matters.
  overdue.sort((a, b) => b.due_at - a.due_at);

  // Most recently removed on top: if a teacher took something down
  // today, that's more relevant than something removed a month ago.
  gone.sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || '')));

  return { burning, later, undated, deferred, overdue, gone, done, past };
}

/** Assignments the user removed from the overdue list. */
function readHiddenIds() {
  if (!fs.existsSync(HIDDEN_FILE)) return new Set();
  return new Set(
    fs.readFileSync(HIDDEN_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
      // The app gets the id from a URL, where non-Latin characters arrive
      // percent-encoded. Real ids are Latin letters and digits, but this
      // decodes anyway just in case — so a match never depends on that.
      .map(s => { try { return decodeURIComponent(s); } catch { return s; } })
  );
}

/** Reads the list of assignments the user marked "not urgent". */
function readMutedIds() {
  if (!fs.existsSync(QUIET_FILE)) return new Set();
  return new Set(
    fs.readFileSync(QUIET_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
      // Decoded the same way as readHiddenIds: the id arrives from a
      // napominalka:// link, and anything that isn't Latin-and-digits
      // shows up as %D0%BF... Doesn't affect real ids, but keeping both
      // lists behaving the same way avoids them drifting apart somewhere
      // unexpected, someday.
      .map(s => { try { return decodeURIComponent(s); } catch { return s; } })
  );
}

// ── Comparing against the previous run ────────────────────────

/**
 * Compares what was just collected against the previous run and returns
 * what's new.
 *
 * THE SECOND ARGUMENT MATTERS MORE THAN IT LOOKS. It's the list of
 * classes that did NOT load this time (timeout, network, anything).
 *
 * Without it there was a bug, caught on live data on August 11th:
 *   1. GUSD Internships didn't load within a minute, the script skipped it;
 *   2. a truncated list got written to memory — missing that class's 32 assignments;
 *   3. on the next run the class loaded normally;
 *   4. the script compared it against memory and decided all 32 were new;
 *   5. a "32 new" popup out of nowhere.
 *
 * One network hiccup, and a flood. So: assignments belonging to classes
 * that didn't load are pulled from the previous memory and carried over
 * as-is. They don't count as new and don't disappear.
 */
function diffWithPrevious(current, broken = []) {
  let previous = [];
  if (fs.existsSync(STATE_FILE)) {
    try { previous = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }

  // Key — the assignment's internal Classroom id: it doesn't change even
  // if a teacher renames the assignment.
  const key = x => x.id || `${x.class}::${x.title}`;

  // Carries over previous entries for classes that didn't load this time.
  // A SOURCE'S NAME AND THE NAME OF A CLASS INSIDE IT AREN'T THE SAME THING.
  //
  // For Classroom, a source's name and its class's name are the same
  // word, so comparing against x.class was enough. For Canvas and
  // Edpuzzle, "broken" gets the platform's name ("Canvas"), while an
  // assignment's class field holds the course name ("English 9 1 -
  // Kirakosyan - Per 6"). Zero matches, nothing to carry over — and
  // assignments silently fell out of memory, only to come back looking
  // "new" on the next pass. Same trouble as the "32 new" bug, just for
  // the other two platforms, and invisible while they had zero
  // assignments.
  //
  // So both fields get checked. Classroom assignments have no "platform"
  // field at all, so the second condition simply never fires for them.
  const wasUnread = x =>
    broken.includes(x.class) || broken.includes(x.platform);

  // AN ASSIGNMENT MISSING FROM A CLASS THAT DID LOAD ISN'T DROPPED RIGHT AWAY.
  //
  // The guard above catches "the class didn't load". But there's a third
  // case that looks like success: the class loaded and honestly returned
  // an INCOMPLETE list — Classroom didn't finish rendering. The script
  // can't tell that apart from "the teacher deleted the assignments".
  //
  // Caught on live data on August 24th, down to the exact number:
  //   pass N:    GUSD returned 11 assignments instead of 30 → 11 got written to memory
  //   pass N+1:  GUSD returned 30 → 19 look new → a "19 new" popup
  // 30 − 11 = 19. Under-reads aren't rare: AP World Hist returned 1
  // assignment instead of 3 in sixteen out of a hundred and twenty passes.
  //
  // The "three misses in a row" rule: missing once is probably an
  // under-read, keep it. Missing three times running (half an hour) means
  // it was really removed. An under-read is random and doesn't repeat in
  // a row, while a removal is permanent, so three tries tell them apart
  // reliably.
  //
  // A side benefit for Canvas and Edpuzzle: they only return what's not
  // turned in, and a turned-in assignment vanishes from the list. Now it
  // leaves gradually, over half an hour, instead of all at once — which
  // also shows that the submission actually registered.
  const MISSING_THRESHOLD = 3;

  const currentlyPresent = new Set(current.map(key));
  const carriedOver = [];
  const underCounted = [];
  const newlyRemoved = [];

  for (const x of previous) {
    if (currentlyPresent.has(key(x))) continue;   // arrived this time — nothing to ask

    // AN EXCLUDED CLASS ISN'T "UNREAD" — IT'S DELIBERATELY SKIPPED.
    //
    // wasUnread() below is about classes that failed to load or weren't
    // checked this pass (network error, Canvas off, quick-pass Edpuzzle
    // skip) — those get the benefit of the doubt and are carried over
    // untouched. An excluded class was skipped on purpose, forever, so
    // it never gets read again to prove its old assignments are gone.
    // Without this check those assignments fell into the missCount/
    // "removed" dance below instead: three passes later they'd get
    // marked removed:true, and a removed entry is carried over FOREVER
    // (see the removedAt comment below) — so excluding a class never
    // actually made its old assignments go away, they just sat under
    // "removed" permanently. Dropping them here means excluding a class
    // clears it from memory outright, same as if it never existed. If
    // the exclusion is later lifted, the class is read fresh and its
    // current assignments come back looking new — which is correct,
    // there's no way to know what happened while it was excluded.
    if (EXCLUSIONS.includes(x.class)) continue;

    if (wasUnread(x)) { carriedOver.push(x); continue; }

    const missCount = (x.missCount || 0) + 1;
    if (missCount < MISSING_THRESHOLD) {
      carriedOver.push({ ...x, missCount });
      underCounted.push(x);
    } else {
      // WHAT DISAPPEARED GETS MARKED, NOT DROPPED.
      //
      // It used to simply be deleted from memory, and from the outside it
      // looked like "the assignment vanished on its own". Tolerable for
      // one person who remembers what they did. For strangers, a direct
      // loss of trust: the list silently got shorter, with no way to
      // tell whether there was ever real work there.
      //
      // Now the entry stays forever, marked with a date. It's not due
      // soon, doesn't count as new, and doesn't show up in the counters —
      // it just sits there, confirming: this wasn't lost, a teacher took
      // it down.
      //
      // If the assignment comes back, the mark clears itself: what
      // arrives comes from current, and that has neither missCount nor removed.
      newlyRemoved.push(x);
      carriedOver.push({
        ...x,
        missCount,
        removed: true,
        removedAt: x.removedAt || new Date().toISOString(),
      });
    }
  }

  if (broken.length) {
    console.log(`Didn't load: ${broken.join(', ')} — ` +
                `using ${carriedOver.length - underCounted.length} assignments from previous memory`);
  }
  if (underCounted.length) {
    console.log(`Under-read: ${underCounted.length} assignments missing from classes ` +
                `that did load — keeping them in memory (${MISSING_THRESHOLD} misses in a row = removed)`);
  }
  if (newlyRemoved.length) {
    console.log(`Disappeared from Classroom (${MISSING_THRESHOLD} misses in a row), ` +
                `marking as removed: ` + newlyRemoved.map(x => x.title).join(', '));
  }

  // The miss counter resets itself: an assignment that arrives comes from
  // current, and that has no missCount field at all.
  const merged = [...current, ...carriedOver];
  const seen = new Set(previous.map(key));
  const fresh = merged.filter(x => !seen.has(key(x)));

  // MEMORY IS DELIBERATELY NOT WRITTEN HERE, see rememberCollection.
  return { fresh, merged };
}

/**
 * Writes memory of the collected assignments.
 *
 * PULLED OUT SEPARATELY AND CALLED AT THE VERY END — this isn't tidying
 * up for its own sake.
 *
 * Memory used to be saved right inside diffWithPrevious, a hundred lines
 * before the popup. Anything crashing in between, and an assignment would
 * already be marked "seen" without ever getting mentioned. There's no
 * second chance: on the next pass it's no longer new.
 *
 * That's exactly what would have happened on September 1st with the
 * `x.due.replace` bug: the script crashed on the first Canvas assignment
 * with a due date — after memory had already been written.
 *
 * Now a crash leaves memory as yesterday's, and the next pass shows the
 * same thing again. A deliberate trade-off: an extra popup is noise, a
 * missed one is a missed deadline.
 */
function rememberCollection(merged) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
}

/**
 * Redraws `summary.html` from memory, without collecting anything.
 *
 * Everything comes from files: assignments, announcements, and "new"
 * marks. No collection needed — the data's already there, only how it's
 * printed changes.
 */
function redrawPage() {
  const now = new Date();
  const readJsonOrDefault = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };

  const items = readJsonOrDefault(STATE_FILE, []);
  const announcements = readJsonOrDefault(STREAM_FILE, []);
  const freshMarks = readJsonOrDefault(FRESH_FILE, { assignments: [], announcements: [] });

  const { burning, later, undated, deferred, overdue, gone } =
    sortIntoBuckets(items, now, readMutedIds(), readHiddenIds());

  writePage({
    burning, later, undated, deferred, overdue, gone,
    freshIds: new Set(freshMarks.assignments || []),
    broken: [], now,
    announcements,
    freshAnnouncements: new Set(freshMarks.announcements || []),
  }, PAGE_FILE);

  console.log(`Page redrawn (language: ${require('./18-language.js').currentLanguage()})`);
}

// ── Entry point ──────────────────────────────────────────────

// This line means: only run the collection if the file was invoked
// directly (node 05-...js). If something else loads it as a library —
// like date-parsing tests — the main body doesn't run.
// diffWithPrevious is exported for tests: feed it fake memory and check
// that a broken source's assignments get carried over instead of
// dropped. That's exactly how it was caught that the carry-over only
// worked for Classroom.
// sortIntoBuckets, readMutedIds and readHiddenIds are exported for
// 17-api.js: the home API has to count "due soon" exactly the way the
// page does. Copying the logic would be simpler, but it would drift apart
// on the very next edit — and "due soon" is the single most important
// word in this whole thing.
module.exports = {
  parseDue, deadline, detectErrorPage, notify, diffWithPrevious, rememberCollection,
  sortIntoBuckets, readMutedIds, readHiddenIds,
};
if (require.main !== module) return;

(async () => {
  // REDRAW THE PAGE WITHOUT COLLECTING.
  //
  // Needed for changing the language. Language is an interface setting,
  // not a search, and waiting ten minutes for the next collection because
  // of it would be wrong (the user's observation, and it's a fair one).
  // No browser launches here at all: it takes what's already in memory
  // and prints the page again. Half a second instead of a minute.
  if (process.argv.includes('--redraw')) {
    redrawPage();
    return;
  }

  if (process.argv.includes('--login')) {
    await login();
    return;
  }

  if (!acquireLock()) {
    console.log('A collection is already running, skipping this one.');
    return;
  }
  // Release the lock no matter the outcome: a crash or a Ctrl+C.
  process.on('exit', releaseLock);
  process.on('SIGINT', () => process.exit(1));
  process.on('SIGTERM', () => process.exit(1));

  // WATCHDOG: a pass shouldn't be able to run forever (see PASS_LIMIT).
  //
  // unref() means "this timer doesn't keep the program alive". Without
  // it, every normal pass would sit around for the full five minutes
  // instead of finishing in seventeen seconds. It doesn't stop the timer
  // from firing though: as long as the program is alive, so is it.
  const watchdog = setTimeout(() => {
    const limitStr = PASS_LIMIT >= 60000
      ? `${Math.round(PASS_LIMIT / 60000)} min`
      : `${Math.round(PASS_LIMIT / 1000)} s`;
    console.error(`\nPass has been running longer than ${limitStr} — cutting it off. ` +
                  'The lock will clear, the next run will proceed on schedule.');

    // Finish off the browser. A killed node process doesn't close Chrome
    // behind it, and Chrome keeps holding the profile folder — the next
    // run would crash right away with "Failed to create SingletonLock:
    // File exists". Targeted specifically by the profile path, not by
    // Chrome's name, so a person's regular browser isn't touched.
    try {
      require('child_process').execFileSync('pkill', ['-f', `user-data-dir=${PROFILE_DIR}`]);
    } catch { /* nothing to kill — pkill complains, and that's fine */ }

    process.exit(1);
  }, PASS_LIMIT);
  watchdog.unref();

  const now = new Date();

  // Memory from the previous run is needed even BEFORE collecting: while
  // classes are being read, the page shows old data for them, not
  // nothing.
  let memory = [];
  if (fs.existsSync(STATE_FILE)) {
    try { memory = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }

  // The list is re-read on every run: the user might have clicked "not
  // urgent" a minute ago, while the previous collection was still running.
  const mutedIds = readMutedIds();
  const hiddenIds = readHiddenIds();

  // Classes that, as far as memory goes, have ever had an assignment.
  // Everyone else gets a shortened wait — see EMPTY_TIMEOUT.
  const nonEmptyClasses = new Set(memory.map(x => x.class));

  // Whether to read Edpuzzle. It needs a visible window, and that
  // switches desktops — so not every time, only when it makes sense:
  //
  //   - during full-summary hours (8:00 and 18:00): the user is usually at the computer;
  //   - on a manual run (--full): they clicked it themselves, so they're ready.
  //
  // The other 46 runs a day only read Classroom and Canvas, and no window
  // ever appears.
  // ── Whether it's time for the full summary ──
  //
  // Computed HERE, before collecting, not after — because it decides
  // whether to open a visible window for Edpuzzle's sake.
  //
  // THIS USED TO BE `DIGEST_HOURS.includes(now.getHours())`, and that
  // turned out to be an expensive mistake: launchd's schedule has SIX
  // moments inside the 8am hour (8:00, 8:10, … 8:50), and the hour is the
  // same for all six. So the window opened six times in a row, and each
  // time macOS yanked the user over to Chrome's desktop. The notes said
  // "two switches a day", but the log showed seven: six in the morning
  // plus one at 6pm.
  //
  // `notification-log.json` already remembers which day and hour the
  // full summary was shown. That's what this relies on: the summary (and
  // the window with it) is due once per listed hour, not once per run
  // inside it.
  const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  const hour = now.getHours();

  let notifyLog = { digests: {} };
  if (fs.existsSync(NOTIFY_LOG)) {
    try {
      notifyLog = JSON.parse(fs.readFileSync(NOTIFY_LOG, 'utf8'));
      notifyLog.digests = notifyLog.digests || {};
    } catch {}
  }

  const isDigestTime = DIGEST_HOURS.includes(hour) && notifyLog.digests[hour] !== todayStr;
  const manual = process.argv.includes('--full');
  const withEdpuzzle = manual || isDigestTime;
  console.log(withEdpuzzle
    ? `Full check${manual ? ' (run manually)' : ''}: with Edpuzzle, a window will show`
    : 'Quick check: Classroom and Canvas, no window');

  setFeedEmail(AUTHUSER);

  const { all: collected, announcements, broken } = await collect(({ items, reading, broken, stillReading }) => {
    // Add in from memory whatever hasn't been reached yet, on top of
    // what's already been read. Same fix as in diffWithPrevious: a
    // source's name and the class name inside it are different things.
    // Without checking the platform, Canvas assignments would count as
    // "not yet read" even after Canvas was done, and land on the page
    // twice — the fresh ones plus the same ones from memory.
    const fromMemory = memory.filter(
      x => !reading.includes(x.class) && !reading.includes(x.platform));
    const combined = [...items, ...fromMemory];
    const { burning, later, undated, deferred, overdue, gone } =
      sortIntoBuckets(combined, now, mutedIds, hiddenIds);

    // "New" badges aren't set along the way: what's actually new only
    // becomes clear once every class has been read.
    writePage(
      { burning, later, undated, deferred, overdue, gone,
        freshIds: new Set(), broken, reading: stillReading, now },
      PAGE_FILE,
    );
  }, nonEmptyClasses, withEdpuzzle);

  // EVERY CLASS THAT ACTUALLY TURNED UP HERE WAS JUST SEEN ACTIVE.
  //
  // `collected` and `announcements` are collect()'s own return values —
  // freshly fetched THIS pass, not carried over from memory and not
  // from a broken/unread source. That's exactly the signal
  // recordActivity() needs, and the ONLY place it's ever called: a
  // class that's excluded, or already skipped as stale, never appears
  // in either array, so its recorded timestamp simply stays frozen at
  // whatever it truly was — see recordActivity()'s own comment in
  // 22-class-activity.js for why that matters.
  recordActivity([...new Set([
    ...collected.map(x => x.class),
    ...announcements.map(p => p.class),
  ])]);

  // A SOURCE THAT WASN'T READ BEHAVES LIKE A BROKEN ONE: its assignments
  // are pulled from memory and don't count as new.
  //
  // Applies to Edpuzzle in quick mode, and to Canvas when it's turned off
  // by an empty address. Without this there'd be the same trouble as the
  // "32 new" bug, just from the other direction: assignments would fall
  // out of memory, then come back looking new on the next full pass.
  const unread = [
    ...(withEdpuzzle ? [] : ['Edpuzzle']),
    ...(CANVAS_ENABLED ? [] : ['Canvas']),
  ];

  const { fresh, merged: all } = diffWithPrevious(collected, [...broken, ...unread]);
  const freshIds = new Set(fresh.map(x => x.id));

  const { burning, later, undated, deferred, overdue, gone, past } =
    sortIntoBuckets(all, now, mutedIds, hiddenIds);

  // ── Announcements ──
  // Live separately from assignments: they have no due dates, they're
  // never "due soon", but freshness matters. So they get their own memory.
  let messageMemory = [];
  if (fs.existsSync(STREAM_FILE)) {
    try { messageMemory = JSON.parse(fs.readFileSync(STREAM_FILE, 'utf8')); } catch {}
  }
  const seenMessageIds = new Set(messageMemory.map(x => x.id));
  const newAnnouncements = announcements.filter(x => !seenMessageIds.has(x.id));

  // ANNOUNCEMENT MEMORY IS ADDED TO, NOT OVERWRITTEN.
  //
  // For assignments, only classes that didn't load get carried over from
  // memory. That's not enough for announcements: the feed can return not
  // all posts even when the class formally loaded fine. Caught on live
  // data — while the Mac was asleep, the feed returned 17 posts instead
  // of 19, two fell out of memory and came back "new" on the next pass.
  //
  // Announcements, unlike assignments, don't disappear: a teacher almost
  // never deletes one. So old and new are simply merged by id — the
  // freshest version wins, nothing gets lost.
  //
  // EXCEPT for a class on the exclusion list. That's the same case as
  // the EXCLUSIONS check in diffWithPrevious: excluding a class was
  // never going to un-happen, so there's no "did it really disappear"
  // question to ask — its old posts just get dropped here instead of
  // living in messageMemory forever with nothing left to ever clear
  // them out again.
  const merged = new Map(
    messageMemory.filter(x => !EXCLUSIONS.includes(x.class)).map(x => [x.id, x]));
  for (const post of announcements) merged.set(post.id, post);
  const allAnnouncements = [...merged.values()];

  // SORTED BY DATE, freshest on top.
  //
  // Before this the order was meaningless — announcements went by class,
  // and within a class by freshness — meaning a May post from one class
  // could sit above an August one from another.
  //
  // Post dates are text ("Aug 8", "Jun 4"), no year. Parsed with the same
  // parseDue used for assignment due dates: it knows to pick the closest
  // year in either direction, so January posts don't fly off into the future.
  for (const post of allAnnouncements) {
    // COMPUTED ONCE, WHEN A POST IS FIRST SEEN — NOT RECOMPUTED EVERY RUN.
    //
    // This used to run for every post, every pass, including ones
    // already in memory from long ago. Harmless for an absolute date
    // like "Aug 8" (it resolves to the same real day no matter when
    // it's parsed), but Classroom also writes RELATIVE text for recent
    // posts — "Yesterday", a bare time like "10:43 AM" — and that text
    // never changes once stored. Re-parsing "10:43 AM" against a `now`
    // months later reads as "posted at 10:43 AM today", every single
    // time: a months-old post captured while it still said a bare time
    // would sort as freshest on the page forever, and (once this same
    // sortTime becomes the signal skipStaleClasses reads to judge a
    // class's last activity) would make that class look permanently
    // active no matter how long it's actually been quiet.
    if (post.sortTime !== undefined) continue;

    const { at } = parseDue(post.date, now);

    // AN IMPORTANT CORRECTION to the general date-parsing rule.
    //
    // parseDue picks the closest year in EITHER direction — correct for
    // due dates. But an announcement can't be from the future: it's
    // already been written. Without this correction, "Jan 13" would be
    // read as next January (closer than last January) and a January post
    // would end up looking fresher than an August one.
    if (at && at > now) at.setFullYear(at.getFullYear() - 1);

    post.sortTime = at ? at.getTime() : 0;
  }
  allAnnouncements.sort((a, b) => b.sortTime - a.sortTime);
  // Announcement memory is also written at the very end, together with assignments.

  if (announcements.length) {
    console.log(`Announcements in feeds: ${announcements.length}` +
                (newAnnouncements.length ? `, new: ${newAnnouncements.length}` : ''));
  }

  const mark = x => (freshIds.has(x.id) ? ' ← new' : '');
  const dueLine = x => {
    if (x.note) return t(x.note);
    const days = daysUntil(now, x.due_at);

    // Classroom's date arrives as text ("Due Aug 25, 8:30 AM"), while
    // Canvas and Edpuzzle use machine format and have no text field at
    // all. This used to be a plain x.due.replace(...), and the script
    // crashed entirely on the first Canvas assignment with a due date.
    // Found with a decoy assignment; in reality this would have happened
    // on September 1st.
    const text = x.due
      ? x.due.replace(/^Due\s+/, '')
      : x.due_at.toLocaleString(locale(),
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    return `${text} — in ${days} days`;
  };

  // A short due phrase for the popup: "today", "tomorrow", "in 5 days"
  const popupWhen = (due) => {
    const days = daysUntil(now, due);
    if (days < 0) return t('overdueByDays', days * -1);
    if (days === 0) return t('today');
    if (days === 1) return t('tomorrow');
    return t('inDays', days);
  };

  // "1 new", "2 new", "5 new" — otherwise it reads robotic.
  const pluralizeRu = (n, one, few, many) => {
    const h = n % 100;
    if (h >= 11 && h <= 14) return many;
    const l = n % 10;
    return l === 1 ? one : (l >= 2 && l <= 4 ? few : many);
  };

  console.log(`\n${'═'.repeat(60)}`);

  if (burning.length) {
    console.log('\nDUE SOON (a week and closer):');
    for (const x of burning) console.log(`  ${x.title}\n    ${x.class} · ${dueLine(x)}${mark(x)}` +
                                 (x.link ? `\n    ${x.link}` : ''));
  }

  if (later.length) {
    console.log('\nAhead:');
    for (const x of later) console.log(`  ${x.title}\n    ${x.class} · ${dueLine(x)}${mark(x)}` +
                                 (x.link ? `\n    ${x.link}` : ''));
  }

  if (!burning.length && !later.length) {
    console.log('\nNothing with a future due date found.');
  }

  const freshUndated = undated.filter(x => freshIds.has(x.id));
  if (freshUndated.length) {
    console.log('\nNew materials (showing once):');
    for (const x of freshUndated) {
      console.log(`  ${x.title}\n    ${x.class}` + (x.link ? `\n    ${x.link}` : ''));
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total collected: ${all.length} · new: ${fresh.length} · ` +
              `undated: ${undated.length} · past: ${past}`);

  // The page is written on EVERY run, even when there won't be a popup:
  // it needs to be fresh at any moment someone clicks it.
  writePage({
    burning, later, undated, deferred, overdue, gone, freshIds, broken, now,
    announcements: allAnnouncements,
    freshAnnouncements: new Set(newAnnouncements.map(x => x.id)),
  }, PAGE_FILE);
  console.log(`Summary: ${PAGE_FILE}`);

  // Save the marks alongside, so a redraw doesn't lose them.
  try {
    fs.writeFileSync(FRESH_FILE, JSON.stringify({
      assignments: [...freshIds],
      announcements: newAnnouncements.map(x => x.id),
    }));
  } catch { /* didn't write — survivable, only the badges will be missing */ }

  // ── The popup ──
  //
  // The script runs every 10 minutes, while an assignment stays due soon
  // for weeks. Showing what's due soon every single time would mean 48
  // identical popups a day, and within a day people would stop noticing
  // them. Hence two modes:
  //
  //   NORMAL RUN — only what wasn't there before. A new assignment shows
  //     up — say so right away. Nothing new — stay quiet.
  //
  //   FULL SUMMARY (the hours in DIGEST_HOURS) — remind about everything
  //     due soon, even long-known items. Once a day per such hour, not on
  //     every run inside it.
  // todayStr, hour, notifyLog and isDigestTime were computed BEFORE
  // collecting — they decided whether to open the window for Edpuzzle.

  // ── Newly opened courses ──
  //
  // When a teacher publishes a course partway through the year, it can
  // instantly hold two dozen assignments. Technically all of them are
  // "new" — they weren't in memory. But a "20 new" popup is useless:
  // that's not twenty pieces of news, it's one — a course opened.
  //
  // So assignments from a just-opened course don't count toward the
  // "new" counter. The course itself gets its own line, and its
  // assignments quietly go into memory and live a normal life from then
  // on: if they have due dates, they'll land in "Due soon" in their turn.
  const previousClasses = new Set(memory.map(x => x.class));
  const newlyOpenedClasses = memory.length
    ? [...new Set(all.map(x => x.class))].filter(c => !previousClasses.has(c))
    : [];   // the very first run ever — everything's new there, and that's fine

  const notableNew = [...burning, ...later, ...undated]
    .filter(x => freshIds.has(x.id) && !newlyOpenedClasses.includes(x.class));

  if (newlyOpenedClasses.length) {
    for (const c of newlyOpenedClasses) {
      const count = all.filter(x => x.class === c).length;
      console.log(`\nCourse opened: ${c} — assignments ${count}`);
    }
  }

  // A new announcement is just as much a reason to say something as a new
  // assignment. "The quiz is moved" matters more than half the assignment
  // list, and it only lives in the feed. The first run doesn't count —
  // everything looks new there.
  const freshAnnouncements = messageMemory.length ? newAnnouncements : [];

  // EXPIRED COOKIES ARE REPORTED SEPARATELY, AHEAD OF EVERYTHING ELSE.
  //
  // Until signing in again, the system shows yesterday's data and stays
  // quiet. One annoying popup beats a week of silence with missed
  // deadlines. The log doesn't apply here: this isn't a summary, it's a
  // failure, and it needs repeating every time until it's fixed.
  if (COOKIES_EXPIRED) {
    console.log('\nCOOKIES EXPIRED — need to sign in again');
    notify(t('schoolLabel'), t('signInRequired'), t('signInRequiredHint'));
    rememberCollection(all);
    fs.writeFileSync(STREAM_FILE, JSON.stringify(allAnnouncements, null, 2));
    return;
  }

  if (notableNew.length || newlyOpenedClasses.length || freshAnnouncements.length ||
      (isDigestTime && burning.length)) {
    // THE POPUP BODY IS JUST THE TITLE AND DUE DATE. No "class such-and-
    // such, no due date set, treating as by tomorrow" — the previous
    // version ran three lines, impossible to read on the go. Details live
    // on the page, the popup just points there.
    //
    // Takes the NEAREST one by due date: the lists are already sorted by date.
    const candidates = notableNew.length ? notableNew : burning;
    const first = candidates.length
      ? (candidates.find(x => x.due_at) || candidates[0])
      : null;

    // A newly opened course is news on its own, and it outranks a list of assignments.
    let body;
    if (newlyOpenedClasses.length) {
      body = `${t('courseOpened')} ${newlyOpenedClasses[0]}`;
    } else if (freshAnnouncements.length && !notableNew.length) {
      // No new assignments, but a teacher wrote something — show that.
      const post = freshAnnouncements[0];
      body = `${post.author}: ${(post.text || post.title || '').split('\n')[0]}`;
    } else if (first) {
      const due = first.due_at
        ? (first.note ? t('noDueDateSet') : popupWhen(first.due_at))
        : '';
      body = due ? `${first.title} — ${due}` : first.title;
    } else {
      body = t('openDigestHint');
    }

    // Counters moved into the subtitle and are spelled out in words.
    // The previous version, "School · new: 32", the user read as "thirty-
    // two popups" — and they were right, that's exactly how it reads.
    const parts = [];
    if (newlyOpenedClasses.length) {
      parts.push(t('countCourses', newlyOpenedClasses.length));
    }
    if (notableNew.length) parts.push(t('countNew', notableNew.length));
    if (freshAnnouncements.length) {
      parts.push(t('countPosts', freshAnnouncements.length));
    }
    if (isDigestTime && burning.length) parts.push(t('countDue', burning.length));

    notify(t('schoolLabel'), parts.join(', '), body);

    // Logged exactly what was shown. Otherwise the output can't tell
    // apart "a popup went out" from "the script silently decided not
    // to show one", leaving nothing but a guess as to whether it worked.
    console.log(`\nShowed a popup: School · ${parts.join(', ')}`);
    console.log(`                     ${body}`);

  } else {
    console.log(isDigestTime || !DIGEST_HOURS.length
      ? '\nNot showing a popup: nothing new.'
      : `\nNot showing a popup: nothing new, and the full summary is at ${DIGEST_HOURS.join(':00 and ')}:00.`);
  }

  // THE LOG GETS MARKED REGARDLESS OF WHETHER A POPUP WAS SHOWN.
  //
  // The mark used to sit inside the "showed a popup" branch. While a
  // digest hour only meant "show a reminder", that didn't matter. Now it
  // also decides whether to open the Edpuzzle window: if there was
  // nothing due at 8:00 and no mark was left, the same thing would repeat
  // at 8:10 — and the window would open all six times, exactly like
  // before this was fixed.
  //
  // Once a digest hour has passed, it's passed. Anything new that shows
  // up later still gets its own popup the normal way.
  if (isDigestTime) {
    notifyLog.digests[hour] = todayStr;
    try {
      fs.writeFileSync(NOTIFY_LOG, JSON.stringify(notifyLog, null, 2));
    } catch (e) {
      console.warn('failed to write the notification log:', e.message);
    }
  }

  // ── MEMORY IS WRITTEN LAST ──
  //
  // Only now, once the popup has been shown and everything's been logged,
  // can it be said "this has been seen". Everything that could crash has
  // already run. Details are in the comment on rememberCollection.
  rememberCollection(all);
  fs.writeFileSync(STREAM_FILE, JSON.stringify(allAnnouncements, null, 2));
})();

/**
 * ── WHAT CAN BREAK HERE ────────────────────────────────────────
 *
 * A living list: things already tripped over, and things waiting their turn.
 *
 * 1. CLASSROOM'S MARKUP. There's no student API, so assignments are read
 *    off the page. Google changes the layout whenever it wants and warns
 *    no one. Sign of breakage: a class returns zero assignments even
 *    though it has some. Look at the li[data-stream-item-id] selector.
 *
 * 2. COOKIES LIVE FOR WEEKS, BUT NOT FOREVER. When Google signs the
 *    browser out, a "sign-in required" popup shows up — the system used
 *    to silently show yesterday's data in this case instead.
 *    Fix: node 05-playwright-draft.js --login
 *
 * 3. EDPUZZLE'S ASSIGNMENT SHAPE ISN'T CONFIRMED. Not a single assignment
 *    has shown up in Edpuzzle yet, so field names are guessed from a few
 *    likely options. The first real assignment gets printed to the log
 *    in full — that's when to fix it precisely.
 *
 * 4. THE MAC SLEEPING. The watchdog counts real time and doesn't know the
 *    process was frozen: close the laptop, and the pass gets cut off on
 *    waking up. 72 out of 418 passes were lost this way in a week. Not
 *    critical (the next one's ten minutes away), but worth fixing.
 *
 * ── WHAT'S NOT FINISHED ──────────────────────────────────────
 *
 * - TRANSCRIPTS AREN'T WIRED INTO THE COLLECTOR. The 13-transcripts.js and
 *   14-transcript-page.js modules are written and tested on their own
 *   (seven minutes of video transcribed in thirteen seconds, locally).
 *   But they don't run automatically: there isn't a single assignment in
 *   Edpuzzle to test against. The page has an empty section waiting for them.
 *
 * - DeltaMath isn't hooked up at all.
 *
 * - Canvas assignment descriptions are collected into memory, but aren't
 *   shown on the page.
 */
