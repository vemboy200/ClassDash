/*
 * School Digest — collects school assignments into one summary.
 * Copyright (C) 2026 Artem
 *
 * Free software: distributed under the terms of the GNU AGPL version 3,
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
 *   node 05-playwright-draft.js --grades-read after Q's grades are read: history, alerts, the page
 *   node 05-playwright-draft.js --language en one-time different language
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

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

const PROFILE_DIR = path.join(PROJECT_ROOT, 'browser-profile');
const STATE_FILE = path.join(PROJECT_ROOT, 'last-collection.json');

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
const NOTIFY_FILE = path.join(PROJECT_ROOT, 'уведомление.txt');

// Log: what's already been reported, and on which day. Needed because the
// script runs every 10 minutes, while a due-soon assignment stays due for
// weeks. Without this log, the same popup would show up 48 times a day,
// and people would stop noticing it — meaning the system would be
// completely broken.
const NOTIFY_LOG = path.join(PROJECT_ROOT, 'notification-log.json');

// What was new in the last collection. Needed ONLY for redrawing the page
// without collecting (a language change): freshIds live in the memory of
// a single pass, and without this file the "new" badges would disappear
// on every redraw.
const FRESH_FILE = path.join(PROJECT_ROOT, 'new.json');

// Lock: keeps two collections from running at once.
//
// The browser profile is a folder, and only one Chrome can work with it
// at a time. Starting a second collection on top of a running one crashes
// with "Failed to create SingletonLock: File exists". Caught live: a
// scheduled run started at 10:00, a manual one at 10:01. The same thing
// happens whenever someone clicks "check now".
const LOCK_FILE = path.join(PROJECT_ROOT, '.collection-lock');

// The summary page. Opens when the notification popup is clicked.
// Built by an ordinary program, see 08-page.js — no model is involved,
// so it can be updated every 10 minutes without a second thought.
const PAGE_FILE = path.join(PROJECT_ROOT, 'summary.html');

// The notifier appends assignment ids here when the "not urgent" button
// was clicked on the page. Undated assignments like that stop counting
// as due soon, but don't disappear from the list.
const QUIET_FILE = path.join(PROJECT_ROOT, 'не-срочно.txt');

// The notifier appends ids of overdue assignments removed from the list
// here. Removed with a button on the page, with a confirmation.
// Can be restored from the same place.
const HIDDEN_FILE = path.join(PROJECT_ROOT, 'скрытые.txt');

// Ids of closed Canvas assignments deleted from the page for good. Unlike
// hidden ones they're gone from everywhere, page and API, and there's no
// restoring them.
const DELETED_FILE = path.join(PROJECT_ROOT, 'deleted-assignments.txt');
const { writePage, daysUntil, headsUpText } = require('./08-page.js');
// Canvas goes through the services bridge (61-services.js): its index.js is
// the only file of it this calls, with CANVAS_BRIDGE (see below).
const SERVICES = require('./61-services.js');
const CANVAS = SERVICES.load('canvas');
const { setFeedEmail } = require('./services/classroom/12-feed.js');
const { t, locale } = require('./18-language.js');
const SETTINGS = require('./19-settings.js').read();

// Development aid, off unless explicitly configured — see
// 27-diagnostics-forward.js's own header comment. Placed right after
// SETTINGS itself since that's all it needs; a no-op the moment
// diagnosticsForwardUrl is empty, which is the default. Every process
// that loads this file gets it — both the interactive --login path
// and the ordinary scheduled collection pass, since a real bug has
// shown up in either one this same week.
require('./27-diagnostics-forward.js').install();

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
const { recordActivity } = require('./22-class-activity.js');
const { record: recordCheckStatus } = require('./25-check-status.js');
const live = require('./28-live-state.js');
const schoolCalendar = require('./33-school-calendar.js');
const { placeholderDue } = schoolCalendar;
const BROWSER = SETTINGS.browserPath
  ? { executablePath: path.resolve(PROJECT_ROOT, SETTINGS.browserPath) }
  : ownBrowserInstalled()
  ? { executablePath: OWN_BROWSER }
  : { channel: 'chrome' };

// Announcement memory is separate from assignment memory: they have a
// different nature — no due dates, never "due soon", but freshness matters.
const STREAM_FILE = path.join(PROJECT_ROOT, 'messages.json');

// "Full summary" hours: the script reminds about everything due soon at
// these hours, even if it's long since known. The rest of the time it
// only reports what's new and stays quiet about the old.
//
// The user's idea, and better than the first version ("first run of the
// day"): this way it's clear when to expect a reminder and when silence
// is normal. 8am — before school, 6pm — in the evening, when there's time
// to sit down.
const DIGEST_HOURS = SETTINGS.summaryHours;

// ── The class list ────────────────────────────────────────────
//
// Read, along with everything else about reading Classroom, in
// services/classroom/15-classroom.js. EXCLUSIONS and RENAMED are its own
// (the same array and Map), since a class rename found while listing the
// classes changes both.
const {
  AUTHUSER, EXCLUSIONS, RENAMED, classRenames,
  detectErrorPage, scrapeClassChecked, readInstructions,
  classesNeedingTeacher, saveClassroomTeachers, resolveClasses,
  teacherNamesFromPeoplePage, withKnownTeachers, flippedFromTurnedIn, looksMisread, keepTurnedIn,
  TURNED_IN_THRESHOLD, TURNED_IN_LOG, readInstructionsInPage,
} = require('./services/classroom/15-classroom.js');

// An empty Canvas address means "don't read it". Lives at module level
// because it's needed in two places: during collection (don't open a tab)
// and when comparing against memory (treat the source as unread).
// A declaration inside collect() didn't reach the second place — caught
// by running it.
//
// HOW it's read (the access token, the browser sign-in, or the token with
// the sign-in as its fallback) is Canvas's own business: see plan() in
// services/canvas/index.js. This only asks it the questions the check needs
// answered (on? needs the browser? where is it?) through the bridge object,
// which read() also gets, with a way to open a browser tab added.
const CANVAS_BRIDGE = { domain: 'canvas', settings: SETTINGS };
const CANVAS_ENABLED = !!CANVAS && CANVAS.enabled(CANVAS_BRIDGE);
// The sign-in way is the plan (not just a fallback): the check needs a browser for it.
const CANVAS_NEEDS_BROWSER = CANVAS_ENABLED && CANVAS.browserNeeded(CANVAS_BRIDGE);

// Google Classroom can be turned off (see classroomEnabled in
// 19-settings.js), which — with Edpuzzle off and Canvas on a token — leaves
// nothing that needs a browser. Asked through the bridge, like Canvas
// (services/classroom/index.js); reading it is still done here.
const CLASSROOM = SERVICES.load('classroom');
const CLASSROOM_BRIDGE = { domain: 'classroom', settings: SETTINGS };
const CLASSROOM_ENABLED = !!CLASSROOM && CLASSROOM.enabled(CLASSROOM_BRIDGE);

/**
 * Does this pass have anything to read that needs a browser?
 *
 *   Classroom   always (it's read by loading its pages)
 *   Edpuzzle    when this pass includes it (a full check; see withEdpuzzle)
 *   Canvas      only when the browser is its way: no token in use. As the
 *               FALLBACK behind a working token it doesn't count — the
 *               browser is launched then only if the token actually fails
 *               (see canvasBrowser() in collect)
 *
 * When the answer is no — a Canvas-only school on a token — the pass never
 * launches a browser at all: no window, nothing to install, nothing to
 * sign into.
 */
function browserNeeded(withEdpuzzle, fullCheck = withEdpuzzle) {
  return (CLASSROOM_ENABLED && CLASSROOM.browserNeeded(CLASSROOM_BRIDGE)) || withEdpuzzle ||
         customInCheck(fullCheck).some(customNeedsBrowser) ||
         CANVAS_NEEDS_BROWSER;
}

// Same module-level reasoning as CANVAS_ENABLED above: needed both when
// deciding withEdpuzzle (don't open the tab, don't open the visible
// window it requires) and when comparing against memory (treat it as
// unread, same as Canvas being off — see the `unread` array further
// down). Unlike CANVAS_ENABLED this isn't inferred from a blank field;
// there's nothing to type in for Edpuzzle, so it's its own real toggle.
// Through the services bridge, like Canvas (services/edpuzzle/index.js).
const EDPUZZLE = SERVICES.load('edpuzzle');
const EDPUZZLE_BRIDGE = { domain: 'edpuzzle', settings: SETTINGS };
const EDPUZZLE_ENABLED = !!EDPUZZLE && EDPUZZLE.enabled(EDPUZZLE_BRIDGE);
// A service whose browser class is "visible" (Edpuzzle, from its manifest)
// opens a window, so it's only read in a full check: see withEdpuzzle.
const EDPUZZLE_VISIBLE = SERVICES.list().some(m => m.domain === 'edpuzzle' && m.browser_class === 'visible');

// Custom services: the project's own custom_services/<domain>/ (see
// 61-services.js), read in the check like Canvas, each as a source of its
// own. One marked "runs": "background" is read after the check instead, by
// startBackgroundServices. What a custom service reads is tagged with its
// name as the platform (unless it says otherwise), the way Canvas's and
// Edpuzzle's are, so a failed read keeps its items from memory, and its ids
// get its domain in front so they can't collide with anyone else's.
//
// Its name is the English one: a platform tag is kept in memory, and
// switching the page's language mustn't make its items look new.
const CUSTOM = SERVICES.list().filter(m => m.custom && m.runs !== 'background').map(m => {
  const bridge = { domain: m.domain, settings: SETTINGS };
  const service = SERVICES.load(m.domain);
  let on = false;
  try {
    on = !!service && typeof service.read === 'function' && (!service.enabled || !!service.enabled(bridge));
  } catch (e) {
    console.warn(`custom service "${m.domain}": enabled() failed (${e.message}), so it's off`);
  }
  if (service && typeof service.read !== 'function') console.warn(`custom service "${m.domain}" has no read(), so it's off`);
  return { manifest: m, service, bridge, name: SERVICES.nameOf(m, 'en'), on };
});
// How long a custom service's read() may take before it counts as failed,
// so one that hangs can't hold up the whole check until PASS_LIMIT.
const CUSTOM_READ_LIMIT_MS = 2 * 60 * 1000;

/** The custom services this check reads: on, and a "visible" one only in a
 *  full check, like Edpuzzle. */
function customInCheck(fullCheck) {
  return CUSTOM.filter(c => c.on && (c.manifest.browser_class !== 'visible' || fullCheck));
}

/** Whether a custom service needs the browser in this check, from its
 *  browser class: "optional" ones are asked (browserNeeded). */
function customNeedsBrowser(c) {
  const cls = c.manifest.browser_class;
  if (cls === 'background' || cls === 'visible') return true;
  if (cls !== 'optional') return false;
  try { return !!(c.service.browserNeeded && c.service.browserNeeded(c.bridge)); } catch { return false; }
}

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

/**
 * The sign-in window: `which` is a row of Settings → Sign-ins (64-sign-ins.js),
 * "google" or a service with its own sign-in ("edpuzzle"), and only its
 * pages open. Without one (an app from before Settings → Sign-ins, or
 * `npm run login`), every sign-in in use opens, a tab each.
 */
async function login(which = '') {
  const pages = require('./64-sign-ins.js').pagesFor(which, SETTINGS);
  if (!pages.length) {
    console.log(which
      ? `Nothing to sign into for "${which}": no service that's on uses it.`
      : 'Nothing to sign into: no service that\'s on signs in through the browser (Canvas on an access token doesn\'t).');
    return;
  }
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...BROWSER,               // a real browser, not a stripped-down chromium:
                              // otherwise Google cuts off the login as "not secure"
    headless: false,          // the window has to be visible — a human signs in
    viewport: { width: 1280, height: 900 },
  });
  // Noted beside failed check launches (63-browser-health.js): whether the
  // sign-in window opens while checks can't start is half of telling why.
  require('./63-browser-health.js').note(`the sign-in window opened${which ? ` (${which})` : ''}`);
  // Each in its own tab, in the same profile, so each sign-in is kept
  // (Playwright's persistent context keeps cookies for the whole profile).
  // Opening the service itself rather than a bare sign-in page: it sends
  // you to sign in, and lands signed in once you have, which is the proof.
  for (const url of pages) {
    try {
      const page = await ctx.newPage();
      await page.goto(url);
    } catch (e) {
      console.warn(`couldn't open ${url}: ${e.message}`);
    }
  }
  console.log(`\n${pages.length === 1 ? 'A tab' : `${pages.length} tabs`} opened: sign in` +
    (pages.length === 1 ? '' : ' in each') + '. Once you\'re signed in, close the window, or click Done in ClassDash.\n');

  // "Done" in ClassDash's own dialog asks this to finish by writing a
  // file (a signal wouldn't reach it on Windows): the window closes, and
  // the profile is saved with it.
  const finishFlag = path.join(PROJECT_ROOT, 'login-finish-request.txt');
  try { fs.unlinkSync(finishFlag); } catch { /* nothing stale to clear */ }
  const finishPoll = setInterval(() => {
    if (!fs.existsSync(finishFlag)) return;
    try { fs.unlinkSync(finishFlag); } catch { /* fine either way */ }
    ctx.close().catch(() => {});
  }, 500);

  // Wait for the person to finish — either by closing the window
  // themselves, or by the poll above closing it on the wrapper's behalf.
  await new Promise(resolve => ctx.on('close', resolve));
  clearInterval(finishPoll);
  console.log('Profile saved to', PROFILE_DIR);

  // Then look for services this sign-in works with (65-discovery.js), in a
  // process of its own: whoever started this one may be waiting for it to end.
  try {
    require('child_process').spawn(process.execPath, [__filename, '--discover', ...(which ? [which] : [])],
      { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { console.warn('not looking for services:', e.message); }
}

/**
 * Tries the services a sign-in could work for and aren't set up yet
 * (65-discovery.js), in a headless browser on the same profile, and redraws
 * the page so Settings → Services offers what was found. Takes the check's
 * lock: the profile can only be open in one browser at a time.
 */
async function discover(which) {
  const discovery = require('./65-discovery.js');
  if (!discovery.candidates(which, SETTINGS).length) {
    console.log('No service to look for: every one this sign-in could work for is set up or ignored.');
    return;
  }
  if (!acquireLock()) {
    console.log('A check is running: not looking for services now (Look again in Settings → Sign-ins).');
    return;
  }
  let ctx = null;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...BROWSER, headless: true, viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    console.log(`Looking for services${which ? ` for the ${which} sign-in` : ''}:`);
    const found = await discovery.run(which, SETTINGS, () => ctx.newPage(), console.log);
    console.log(found.length ? `Found: ${found.join(', ')}` : 'Nothing new found.');
  } catch (e) {
    console.warn('looking for services failed:', String(e.message).split('\n')[0]);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    releaseLock();
  }
  redrawPage();
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
/**
 * Launches the browser for a collection — and if it can't, says WHY where a
 * person will see it.
 *
 * Without this a launch failure (no browser installed or chosen, a locked
 * profile) was an unhandled rejection: the process died, nothing was
 * recorded, and the status dots just stayed as they were, so from outside
 * it looked like nothing had happened. Now every source that needed the
 * browser this pass is marked as a problem with the reason, which is what
 * the dots and the home API's /api/check-status show — then it fails the
 * same way it always did.
 *
 * Which sources needed it is the same question browserNeeded() answers:
 * Classroom, Edpuzzle in a full check, and Canvas when it has no token
 * (which is also the case worth spelling out, since a token needs none).
 */
/**
 * Kills whatever's left of the browser this pass opened, keyed by its
 * profile path so a person's own everyday browser is never touched.
 *
 * Node exiting normally closes Playwright's browser along with it — this
 * is only for when node is forced to exit while the browser is still
 * mid-request (the watchdog below, a manual Stop, or Ctrl+C): without it,
 * Chrome keeps holding the profile folder and the next run crashes right
 * away with "Failed to create SingletonLock: File exists".
 *
 * MAC/LINUX ONLY. pkill isn't a Windows command, and there's no
 * equivalent here yet — a forced stop on Windows may leave Chrome or
 * Brave running and the profile folder locked, the same way this exact
 * gap already existed for the watchdog before Stop existed. Exported so
 * 21-notifier-actions.js's stopCheck can call it too, right after asking
 * the collector process itself to end.
 */
function killLeftoverBrowser() {
  try {
    require('child_process').execFileSync('pkill', ['-f', `user-data-dir=${PROFILE_DIR}`]);
  } catch { /* nothing to kill, or pkill isn't here (Windows) — either way, fine */ }
}

async function launchForCollection(withEdpuzzle, options) {
  // Failures in a row are counted, with the whole error kept, and lead to a
  // server restart and then a request to sign in (63-browser-health.js).
  const health = require('./63-browser-health.js');
  try {
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, options);
    health.worked();
    return ctx;
  } catch (e) {
    // A restart only when a server is running for this project: the checks
    // are its children. With none (a check run by hand), restartApi would
    // start one.
    const step = health.failed(e.message, new Date(), { canRestart: require('./23-api-security.js').isServerRunning() });
    const reason = String(e.message).split('\n')[0];
    const message = `couldn't start a browser (${reason}) — ` + (health.restarted()
      ? 'restarting ClassDash\'s server didn\'t help: sign in again in Settings → Sign-ins, or choose a browser in Settings → Services → Setup'
      : 'set one up in Settings → Services → Setup (Choose Browser…)') + (CANVAS_NEEDS_BROWSER
        ? ', or give Canvas an access token, which needs no browser' : '');
    console.error(message);
    if (step === 'restart') {
      // The way the menu bar's Restart Server does it. This check runs on
      // its own (detached), so the restart doesn't end it.
      try {
        require('child_process').spawn(process.execPath, [path.join(__dirname, '21-notifier-actions.js'), 'restartApi'],
          { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true }).unref();
        console.error('the browser failed to start several times in a row: restarting the home API server');
      } catch (err) { console.warn('server restart not started:', err.message); }
    }
    if (step === 'signIn') notify(t('schoolLabel'), t('browserStuck'), t('browserStuckHint'));
    if (CLASSROOM_ENABLED) recordCheckStatus('classroom', false, message);
    if (withEdpuzzle) recordCheckStatus('edpuzzle', false, message);
    if (CANVAS_NEEDS_BROWSER) recordCheckStatus('canvas', false, message);
    throw new Error(message);
  }
}

async function collect(onProgress, nonEmptyClasses = new Set(), withEdpuzzle = false, fullCheck = withEdpuzzle) {
  // No browser at all when nothing here needs one (see browserNeeded).
  const useBrowser = browserNeeded(withEdpuzzle, fullCheck);
  const customs = customInCheck(fullCheck);
  // A window, when anything in this check needs one (see below).
  const headed = withEdpuzzle || customs.some(c => c.manifest.browser_class === 'visible');
  const launchOptions = {
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
    headless: !headed,
    viewport: headed ? null : { width: 1280, height: 900 },
    args: headed
      ? ['--window-position=-3000,-3000', '--window-size=1280,1000']
      : [],
    // The profile remembers Russian — Chrome picked it up from the system
    // when it was created. Canvas was serving pages in Russian because of
    // it, dates included, like "среда, 10 июня 2026". This header
    // overrides the language for every request. Canvas's own account
    // settings aren't touched: the user's interface on their Chromebook
    // stays Russian.
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  };
  // A browser that won't start fails only what needed it. It used to end the
  // whole check, so for two days in November nothing updated at all: Canvas
  // on its token and Q's grades included, neither of which needs a browser.
  // Now each source that needed one fails with the reason (launchForCollection
  // has already recorded it) and keeps what it had, and everything else is read.
  let ctx = null, launchFailed = null;
  if (useBrowser) {
    try { ctx = await launchForCollection(withEdpuzzle, launchOptions); } catch (e) { launchFailed = e; }
  }
  const newPage = async () => { if (!ctx) throw launchFailed; return ctx.newPage(); };

  // A browser launched only when Canvas's FALLBACK needs one and none is
  // open: a working access token never gets here, so a Canvas-only school on
  // a token still runs with no browser most of the time. If a browser is
  // already open for something else it's simply reused, and one that just
  // failed to start isn't tried twice.
  let lateCtx = null;
  const canvasBrowser = async () => {
    if (launchFailed) throw launchFailed;
    return ctx || (lateCtx = lateCtx || await launchForCollection(false, launchOptions));
  };

  // Every source is read AT THE SAME TIME: Classroom (each class in its own
  // tab, see its read()), Canvas and Edpuzzle. The total time is the slowest
  // one's, not the sum. The user's idea.
  const startTime = Date.now();
  const completed = [];

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
  if (!CANVAS_ENABLED) console.log('Canvas is off: no address set in settings, or both ways of reading it are switched off');

  // Classroom's classes are added at the front once its read() has listed
  // them (started, below).
  const sources = [
    ...(CANVAS_ENABLED ? [{ id: 'canvas', name: 'Canvas' }] : []),
    ...(withEdpuzzle ? [{ id: 'edpuzzle', name: 'Edpuzzle' }] : []),
    ...customs.map(c => ({ id: c.manifest.domain, name: c.name }))];

  // The page's progress bar goes from "starting" to a real 0 of N (and N
  // grows by Classroom's classes once they're listed). Canvas and Edpuzzle count as a step each, since
  // they take real time; the bar is honest about the work, not just about
  // how many classes there are.
  live.setProgress(0, sources.length);

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
    live.setProgress(completed.length, sources.length);
    if (!onProgress) return;
    try {
      onProgress({
        progress: { done: completed.length, total: sources.length },
        announcements: completed.flatMap(r => r.announcements || []),
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
    // The tab is opened INSIDE the try block (by Canvas's read(), only
    // when the browser way is used): if opening it fails outside, the whole
    // Promise.all crashes, taking the browser close with it. With an
    // access token there's no tab at all: the API is asked directly.
    let result;
    try {
      const { items, status } = SERVICES.result(await CANVAS.read(
        { ...CANVAS_BRIDGE, openPage: async () => (await canvasBrowser()).newPage(), log: console.log }));
      result = { cls: { id: 'canvas', name: 'Canvas' }, items, ok: status.ok, detail: status.detail, fallback: status.fallback };
    } catch (e) {
      console.error(`  error on Canvas: ${e.message}`);
      result = { cls: { id: 'canvas', name: 'Canvas' }, items: [], ok: false, error: e.message };
    }
    reportProgress(result);
    return result;
  })();

  const edpuzzleTask = !withEdpuzzle ? null : (async () => {
    console.log('Reading: Edpuzzle');
    let result;
    try {
      const { items, status } = SERVICES.result(await EDPUZZLE.read({ ...EDPUZZLE_BRIDGE, openPage: newPage, log: console.log }));
      result = { cls: { id: 'edpuzzle', name: 'Edpuzzle' }, items, ok: status.ok };
    } catch (e) {
      console.error(`  error on Edpuzzle: ${e.message}`);
      result = { cls: { id: 'edpuzzle', name: 'Edpuzzle' }, items: [], ok: false, error: e.message };
    }
    reportProgress(result);
    return result;
  })();

  // Last pass's memory, for catching turned-in work that reads as not
  // turned in, and for the instructions kept between passes.
  let previousItems = [];
  try { previousItems = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}

  // Classroom, through the bridge (services/classroom/index.js): it lists the
  // classes, then reads every one AT THE SAME TIME, each in its own tab, and
  // reports each class as it finishes. One class failing is that class
  // failing: its part says so and the rest are read.
  const classroomTask = !CLASSROOM_ENABLED ? null : (async () => {
    const asPart = p => ({ cls: { id: p.id, name: p.name }, items: p.items, announcements: p.announcements,
                           ok: p.ok, error: p.error, noBrowser: p.noBrowser });
    let parts = [];
    try {
      const r = SERVICES.result(await CLASSROOM.read({
        ...CLASSROOM_BRIDGE, openPage: newPage, browserFailed: launchFailed, log: console.log,
        previous: previousItems, nonEmptyClasses,
        started: classes => { sources.unshift(...classes); live.setProgress(completed.length, sources.length); },
        done: part => reportProgress(asPart(part)),
      }));
      parts = r.sources;
    } catch (e) {
      // read() handles each class's failure itself; this is it failing as a
      // whole, which leaves every class as it was.
      console.error(`  error on Classroom: ${e.message}`);
    }
    const cr = require('./services/classroom/15-classroom.js');
    if (cr.cookiesHaveExpired() || parts.some(p => /cookies expired/.test(p.error || ''))) COOKIES_EXPIRED = true;
    return parts.map(asPart);
  })();

  // Custom services, each a source of its own like Canvas. A read() that
  // throws, or takes longer than CUSTOM_READ_LIMIT_MS, is that service
  // failing, never the check.
  const customTasks = customs.map(c => (async () => {
    const domain = c.manifest.domain;
    console.log(`Reading: ${c.name}`);
    let result, timer;
    try {
      const limit = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`took longer than ${CUSTOM_READ_LIMIT_MS / 1000} s`)), CUSTOM_READ_LIMIT_MS);
      });
      const r = SERVICES.result(await Promise.race([c.service.read({ ...c.bridge, openPage: newPage, log: console.log }), limit]));
      const items = r.items.filter(x => x && typeof x === 'object' && x.title).map(x => ({
        ...x,
        class: x.class || c.name,
        platform: x.platform || c.name,
        id: `${domain}-${x.id || x.title}`,
      }));
      console.log(`  ${c.name}: items ${items.length}`);
      result = { cls: { id: domain, name: c.name }, custom: true, items, ok: r.status.ok, detail: r.status.detail, fallback: r.status.fallback };
    } catch (e) {
      console.error(`  error on ${c.name}: ${e.message}`);
      result = { cls: { id: domain, name: c.name }, custom: true, items: [], ok: false, error: String(e.message).split('\n')[0].slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
    reportProgress(result);
    return result;
  })());

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
    results = (await Promise.all(
      [classroomTask, canvasTask, edpuzzleTask, ...customTasks].filter(Boolean))).flat();
  } finally {
    for (const open of [ctx, lateCtx]) {
      try {
        if (open) await open.close();
      } catch (e) {
        console.warn('failed to close the browser:', e.message);
      }
    }
  }
  console.log(`Read in ${Math.round((Date.now() - startTime) / 1000)}s`);

  return {
    all: results.flatMap(r => r.items),
    announcements: results.flatMap(r => r.announcements || []),
    broken: results.filter(r => !r.ok).map(r => r.cls.name),
    // Raw per-task results, `cls`/`items`/`ok`/`error` and all — kept
    // alongside `broken` rather than replacing it, since `broken` is a
    // flat name list other code already depends on (diffWithPrevious's
    // wasUnread, the unread array). This is for 25-check-status.js:
    // recording a per-platform status needs to tell "Canvas failed"
    // apart from "some Classroom class failed" (broken mixes both into
    // one array of names) and wants the actual error message, which
    // broken never carried at all.
    results,
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

  // Tests: the notification goes into this file instead of on screen, so a
  // test run never shows one from the real app installed on the machine.
  if (process.env.CLASSDASH_NOTIFY_TO) {
    fs.appendFileSync(process.env.CLASSDASH_NOTIFY_TO, JSON.stringify({ title, subtitle, message }) + '\n');
    return;
  }

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
    if (at - now > 365 * 864e5) return placeholderDue(now);
    return at;
  }

  const { at, placeholder } = parseDue(item.due, now);
  if (!at) return null;
  if (placeholder) return placeholderDue(now); // "by tomorrow" (the next school day)
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
  // Edpuzzle turned off means treated as gone entirely, not just "stop
  // fetching new ones" — an old Edpuzzle item already sitting in memory
  // from before the toggle was flipped gets filtered out right here,
  // the one choke point both the page and the home API bucket through
  // (see this function's own comment above), so neither has its own
  // separate filter to keep in sync. Settings are read fresh on every
  // call, not cached at module load like CANVAS_ENABLED/EDPUZZLE_ENABLED
  // are — the home API runs as one long-lived process, and a toggle
  // flipped from the settings panel has to take effect on the next
  // request, not just after the server restarts.
  if (require('./19-settings.js').read().edpuzzleEnabled === false) {
    items = items.filter(x => x.platform !== 'Edpuzzle');
  }
  // The same for Classroom — its items are the ones with no platform tag.
  if (require('./19-settings.js').read().classroomEnabled === false) {
    items = items.filter(x => x.platform);
  }
  // Assignments linked on the page become one item here, before anything is
  // bucketed (see 31-assignment-links.js).
  const deletedIds = readDeletedIds();
  if (deletedIds.size) items = items.filter(x => !deletedIds.has(x.id));
  const assignmentLinks = require('./31-assignment-links.js');
  items = assignmentLinks.mergeLinked(items, assignmentLinks.readLinks(), x => deadline(x, now));

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
  // "By tomorrow" means the next school day once a school calendar is saved.
  const tomorrow = placeholderDue(now);

  for (const x of items) {
    // Removed by the teacher — into its own bucket and nowhere else.
    // It's not due soon, not overdue, not "ahead": the work doesn't exist
    // anymore, only a trace that it once did.
    if (x.removed) { gone.push(x); continue; }

    // A linked assignment with every part handed in.
    if (x.allDone) {
      done.push({ ...x, done: true, due_at: deadline(x, now) });
      continue;
    }

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

    // LOCKED CANVAS WORK (see lockOf in 10-canvas.js). Nothing can be done
    // with it yet, so it waits in "ahead" whatever its due date says, and
    // never counts as due soon; once it opens, the next check finds it
    // unlocked and it's bucketed like anything else. Closed work (its
    // "available until" date passed) can't be turned in anymore: that's
    // missed work, so it goes with the overdue, marked closed.
    const lock = lockState(x, now);
    if (lock && lock.why === 'closed') {
      const due = deadline(x, now);
      past++;
      overdue.push({ ...x, due_at: due && due < now ? due : lock.at, locked: lock, hidden: hiddenIds.has(x.id) });
      continue;
    }
    if (lock) {
      later.push({ ...x, due_at: deadline(x, now), locked: lock });
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
  // Locked work can have no due date: then it sorts by when it opens, and
  // after everything dated if it doesn't say.
  const laterKey = x => +(x.due_at || (x.locked && x.locked.at) || 864e13);
  later.sort((a, b) => laterKey(a) - laterKey(b));
  // Most recently overdue on top: the more recently something was missed,
  // the more it matters.
  overdue.sort((a, b) => b.due_at - a.due_at);

  // Most recently removed on top: if a teacher took something down
  // today, that's more relevant than something removed a month ago.
  gone.sort((a, b) => String(b.removedAt || '').localeCompare(String(a.removedAt || '')));

  return { burning, later, undated, deferred, overdue, gone, done, past };
}

/**
 * A Canvas item's lock as of `now`, or null when it can be worked on:
 *   { why: 'opens', at }    its "available from" date is still ahead
 *   { why: 'closed', at }   its "available until" date has passed
 *   { why: 'module', module }  earlier work in a module comes first
 *   { why: 'locked' }       locked, Canvas didn't say why
 * An "available from" date that has passed since the check means it's open.
 */
function lockState(x, now) {
  if (!x.lock) return null;
  const date = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };
  const unlockAt = date(x.lock.unlockAt), lockAt = date(x.lock.lockAt);
  if (unlockAt && unlockAt > now) return { why: 'opens', at: unlockAt };
  if (lockAt && lockAt <= now) return { why: 'closed', at: lockAt };
  if (x.lock.module) return { why: 'module', module: x.lock.module };
  if (unlockAt) return null;
  return { why: 'locked' };
}

/** Assignments deleted for good (closed Canvas work), see DELETED_FILE. */
function readDeletedIds() {
  if (!fs.existsSync(DELETED_FILE)) return new Set();
  return new Set(fs.readFileSync(DELETED_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    .map(s => { try { return decodeURIComponent(s); } catch { return s; } }));
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

    // Classroom turned off is the same kind of deliberate: its assignments
    // (the ones with no platform tag) are never read again, so they leave
    // memory now instead of being carried, then "removed", forever.
    if (!CLASSROOM_ENABLED && !x.platform) continue;

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
  // Announcements come from Classroom only.
  const announcements = CLASSROOM_ENABLED ? readJsonOrDefault(STREAM_FILE, []) : [];
  const freshMarks = readJsonOrDefault(FRESH_FILE, { assignments: [], announcements: [] });

  const { burning, later, undated, deferred, overdue, gone } =
    sortIntoBuckets(items, now, readMutedIds(), readHiddenIds());

  writePage({
    burning, later, undated, deferred, overdue, gone, items,
    freshIds: new Set(freshMarks.assignments || []),
    broken: [], now,
    announcements,
    freshAnnouncements: new Set(freshMarks.announcements || []),
  }, PAGE_FILE);

  console.log(`Page redrawn (language: ${require('./18-language.js').currentLanguage()})`);
}

/**
 * Gives every announcement a sortTime, once, when it's first seen. Shared by
 * the final write and the in-progress ones, so a post reads the same way in
 * both.
 */
function stampAnnouncementTimes(posts, now) {
  for (const post of posts) {
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
}

/**
 * The announcements the page shows WHILE a collection is still running: what
 * memory holds from the last run (minus classes now excluded), with the posts
 * already read this pass laid over it, newest first. The final write does the
 * same merge once every class is in; without this the in-progress pages
 * showed no announcements at all until then, and the whole column emptied
 * for the length of every check.
 */
function announcementsForProgress(memoryPosts, freshPosts, now) {
  const merged = new Map(
    memoryPosts.filter(x => !EXCLUSIONS.includes(x.class)).map(x => [x.id, x]));
  for (const post of freshPosts) merged.set(post.id, post);
  const posts = [...merged.values()];
  stampAnnouncementTimes(posts, now);
  return posts.sort((a, b) => b.sortTime - a.sortTime);
}

/**
 * The assignments the page shows WHILE a collection is still running: what
 * has been read so far, plus memory for everything not read yet.
 *
 * A source that finished but FAILED counts as not read. It comes back with no
 * items, and memory for it must stay on the page — the final write carries a
 * broken source over from memory (see diffWithPrevious), and the page written
 * along the way has to agree. It didn't: every class and platform that had
 * reported in, failed or not, was dropped from memory here, so a Canvas or
 * class read that failed made all its assignments vanish from the page until
 * the last write of the pass — or for good, when the pass never got that far.
 *
 * @param memory     last run's assignments
 * @param readItems  what the sources that reported in returned
 * @param reported   names of every source that reported in, failed or not
 * @param broken     names of the ones among them that failed
 */
function assignmentsForProgress(memory, readItems, reported, broken) {
  const read = reported.filter(name => !broken.includes(name));
  const fromMemory = memory.filter(x => !read.includes(x.class) && !read.includes(x.platform));
  return [...readItems, ...fromMemory];
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
  sortIntoBuckets, readMutedIds, readHiddenIds, readDeletedIds, lockState, DELETED_FILE, announcementsForProgress, assignmentsForProgress,
  LOCK_FILE, PROFILE_DIR, killLeftoverBrowser,
  teacherNamesFromPeoplePage, classesNeedingTeacher, withKnownTeachers, saveClassroomTeachers, resolveClasses,
  flippedFromTurnedIn, looksMisread, keepTurnedIn, scrapeClassChecked, TURNED_IN_THRESHOLD, TURNED_IN_LOG,
  readInstructions, readInstructionsInPage,
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
    // After Stop (21-notifier-actions.js): the stopped run could still write a
    // draft over this until it's gone. Not waited for forever, though.
    const stopped = process.argv.find(a => a.startsWith('--after-pid='));
    if (stopped) {
      const pid = Number(stopped.split('=')[1]);
      for (let waited = 0; waited < 2000 && pid > 0; waited += 50) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    redrawPage();
    return;
  }

  // After Q's own grade check (40-grades.js, and Check now): keep the new
  // grades in the history, alert on changes, then redraw.
  if (process.argv.includes('--grades-read')) {
    recordGradeChanges();
    redrawPage();
    return;
  }

  if (process.argv.includes('--login')) {
    // Which sign-in (a row of Settings → Sign-ins), if one follows.
    const which = process.argv[process.argv.indexOf('--login') + 1] || '';
    await login(/^[a-z0-9_]+$/.test(which) ? which : '');
    return;
  }

  if (process.argv.includes('--discover')) {
    const which = process.argv[process.argv.indexOf('--discover') + 1] || '';
    await discover(/^[a-z0-9_]+$/.test(which) ? which : '');
    return;
  }

  if (!acquireLock()) {
    console.log('A collection is already running, skipping this one.');
    return;
  }
  // Release the lock no matter the outcome: a crash or a Ctrl+C.
  process.on('exit', releaseLock);
  // Tells an open page a collection is running, so it can show a progress
  // bar (see 28-live-state.js). Ended on 'exit' like the lock, for the same
  // reason: whatever way this dies, the page shouldn't keep showing a bar.
  live.startRun(PROJECT_ROOT);
  process.on('exit', live.endRun);
  // Same cleanup as the watchdog below, for the same reason: node exiting
  // normally closes Playwright's browser along with it, but a forced exit
  // while it's mid-request doesn't (see killLeftoverBrowser's own comment).
  // A manual Stop (see 21-notifier-actions.js's stopCheck) sends this same
  // signal from outside.
  process.on('SIGINT', () => { killLeftoverBrowser(); process.exit(1); });
  process.on('SIGTERM', () => { killLeftoverBrowser(); process.exit(1); });

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
    killLeftoverBrowser();
    process.exit(1);
  }, PASS_LIMIT);
  watchdog.unref();

  // Nothing to reach, so no browser and nothing read: what's here stays as it is,
  // and the page says why (see 60-network-check.js).
  const networkCheck = require('./60-network-check.js');
  const places = [
    ...(CLASSROOM_ENABLED ? CLASSROOM.addresses(CLASSROOM_BRIDGE) : []),
    ...(CANVAS_ENABLED ? CANVAS.addresses(CANVAS_BRIDGE) : []),
    ...(EDPUZZLE_ENABLED && process.argv.includes('--full') ? EDPUZZLE.addresses(EDPUZZLE_BRIDGE) : []),
    ...customInCheck(process.argv.includes('--full')).flatMap(c => {
      try { return c.service.addresses ? c.service.addresses(c.bridge) : []; } catch { return []; }
    }),
  ];
  if (places.length && !await networkCheck.online(places)) {
    console.error(`Check not run: ${networkCheck.NO_INTERNET}`);
    if (CLASSROOM_ENABLED) recordCheckStatus('classroom', false, networkCheck.NO_INTERNET);
    if (CANVAS_ENABLED) recordCheckStatus('canvas', false, networkCheck.NO_INTERNET);
    if (EDPUZZLE_ENABLED && process.argv.includes('--full')) recordCheckStatus('edpuzzle', false, networkCheck.NO_INTERNET);
    for (const c of customInCheck(process.argv.includes('--full'))) recordCheckStatus(c.manifest.domain, false, networkCheck.NO_INTERNET);
    live.endRun();
    redrawPage();
    process.exitCode = 1;
    return;
  }

  const now = new Date();

  // Memory from the previous run is needed even BEFORE collecting: while
  // classes are being read, the page shows old data for them, not
  // nothing.
  let memory = [];
  if (fs.existsSync(STATE_FILE)) {
    try { memory = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }

  // The same for announcements: the in-progress pages show last run's posts
  // for classes not yet read, on top of the ones that have been.
  let announcementMemory = [];
  if (CLASSROOM_ENABLED && fs.existsSync(STREAM_FILE)) {
    try { announcementMemory = JSON.parse(fs.readFileSync(STREAM_FILE, 'utf8')); } catch {}
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
  // EDPUZZLE_ENABLED overrides both triggers, manual included — turning
  // it off means "don't fetch it", not "don't fetch it unless someone
  // clicks the button", see that constant's own comment above.
  const withEdpuzzle = EDPUZZLE_ENABLED && (!EDPUZZLE_VISIBLE || manual || isDigestTime);
  console.log(withEdpuzzle
    ? `Full check${manual ? ' (run manually)' : ''}: with Edpuzzle, a window will show`
    : !EDPUZZLE_ENABLED && (manual || isDigestTime)
      ? 'Quick check: Classroom and Canvas, no window (Edpuzzle disabled in settings)'
      : 'Quick check: Classroom and Canvas, no window');

  setFeedEmail(AUTHUSER);

  const { all: collected, announcements, broken, results: taskResults } = await collect(({ items, reading, broken, stillReading, progress, announcements: readSoFar }) => {
    // Add in from memory whatever hasn't been reached yet (or failed), on
    // top of what's already been read. A source's name and the class name
    // inside it are different things, as in diffWithPrevious: without
    // checking the platform, Canvas assignments would count as "not yet
    // read" even after Canvas was done, and land on the page twice.
    classRenames.renameIn(memory, RENAMED);
    classRenames.renameIn(announcementMemory, RENAMED);
    const combined = assignmentsForProgress(memory, items, reading, broken);
    const { burning, later, undated, deferred, overdue, gone } =
      sortIntoBuckets(combined, now, mutedIds, hiddenIds);

    // "New" badges aren't set along the way: what's actually new only
    // becomes clear once every class has been read.
    writePage(
      { burning, later, undated, deferred, overdue, gone, items: combined,
        freshIds: new Set(), broken, reading: stillReading, progress, now,
        announcements: announcementsForProgress(announcementMemory, readSoFar || [], now) },
      PAGE_FILE,
    );
  }, nonEmptyClasses, withEdpuzzle, manual || isDigestTime);

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
  //
  // "COMPLETED" ITEMS DON'T COUNT AS ACTIVITY. Classroom keeps a turned-
  // in assignment sitting in the class's own stream forever — it comes
  // back in `collected` on every single pass, indefinitely, for as long
  // as the class page is read at all. Counting that as "just seen
  // active" made skipStaleClasses effectively never fire for any class
  // that had ever had even one submitted assignment: its activity
  // timestamp kept getting refreshed to right now, pass after pass,
  // months after the last thing a teacher actually posted. Caught live
  // — a school club's Classroom, quiet for months except old completed
  // signup forms Classroom still renders, was never going stale.
  recordActivity([...new Set([
    ...collected.filter(x => !/^completed\b/i.test(x.type || '')).map(x => x.class),
    ...announcements.map(p => p.class),
  ])]);

  // PER-PLATFORM STATUS — "did the last check actually work?"
  //
  // Canvas and Edpuzzle are single tasks each, so their own result
  // (found by matching taskResults's fixed 'Canvas'/'Edpuzzle' cls.id —
  // set literally in collect() itself, never a real class's id) speaks
  // for the whole platform directly. Classroom is different: it's N
  // independent per-class tasks, not one — "ok" here means every class
  // that was actually read this pass loaded cleanly; one bad class is
  // enough to call the whole platform "problem", since that's exactly
  // the signal someone reaching for a status page wants (something's
  // wrong, go look), not an average across classes that mostly worked.
  //
  // Neither is called at all for a platform that wasn't attempted this
  // pass (Canvas off, or Edpuzzle outside a full check) — its entry
  // just stays whatever it last was, see 25-check-status.js's own
  // comment on why that's fine.
  const classroomResults = taskResults.filter(r => r.cls.id !== 'canvas' && r.cls.id !== 'edpuzzle' && !r.custom);
  if (classroomResults.length) {
    const failed = classroomResults.find(r => !r.ok);
    // No browser is the whole of Classroom's problem, not one class's.
    recordCheckStatus('classroom', !failed, !failed ? null : failed.noBrowser ? failed.error : `${failed.cls.name}: ${failed.error}`);
  }
  const canvasResult = taskResults.find(r => r.cls.id === 'canvas');
  // Canvas says which way it was read. When the access token failed and the
  // browser sign-in carried it, that's "fallback" (a yellow dot), not "ok":
  // nothing is missing, but the token needs a look. The detail says why.
  if (canvasResult) {
    recordCheckStatus('canvas', canvasResult.ok, canvasResult.error || canvasResult.detail,
      { fallback: canvasResult.fallback });
  }
  const edpuzzleResult = taskResults.find(r => r.cls.id === 'edpuzzle');
  if (edpuzzleResult) recordCheckStatus('edpuzzle', edpuzzleResult.ok, edpuzzleResult.error);
  for (const r of taskResults.filter(x => x.custom)) recordCheckStatus(r.cls.id, r.ok, r.error || r.detail, { fallback: r.fallback });

  // A sign-in that just ran out gets one notification, however many
  // services use it, and none on the checks after that until it has worked
  // again (64-sign-ins.js alerts). It used to be one on every check.
  try {
    require('./64-sign-ins.js').alerts(require('./25-check-status.js').checkStatus(),
      name => notify(t('schoolLabel'), t('signInOutTitle', name), t('signInOutHint', name)));
  } catch (e) { console.warn('sign-in alerts skipped:', e.message); }

  // The school calendar's feed, once a day, so a new event (a snow day, a
  // changed minimum day) shows up without anyone saving the link again.
  const CALENDAR = SERVICES.load('calendar');
  if (CALENDAR && CALENDAR.due({ domain: 'calendar', settings: SETTINGS, saved: SERVICES.savedFor('calendar') }, now)) {
    const feed = await schoolCalendar.refreshFeed();
    console.log(feed.ok ? `Calendar feed: ${feed.events} events` : `Calendar feed not read: ${feed.why}`);
  }

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
    // A custom service that's off, or "visible" outside a full check.
    ...CUSTOM.filter(c => !customInCheck(manual || isDigestTime).includes(c)).map(c => c.name),
  ];

  const { fresh, merged: all } = diffWithPrevious(collected, [...broken, ...unread]);
  const freshIds = new Set(fresh.map(x => x.id));

  const { burning, later, undated, deferred, overdue, gone, past } =
    sortIntoBuckets(all, now, mutedIds, hiddenIds);

  // ── Announcements ──
  // Live separately from assignments: they have no due dates, they're
  // never "due soon", but freshness matters. So they get their own memory.
  let messageMemory = [];
  if (CLASSROOM_ENABLED && fs.existsSync(STREAM_FILE)) {
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
  stampAnnouncementTimes(allAnnouncements, now);
  allAnnouncements.sort((a, b) => b.sortTime - a.sortTime);
  // Photos only for each class's newest posts (39-announcement-photos.js).
  try {
    const deleted = require('./services/classroom/39-announcement-photos.js').prune(allAnnouncements);
    if (deleted) console.log(`Announcement photos deleted: ${deleted}`);
  } catch (e) { console.warn('announcement photos not pruned:', e.message); }
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

  // RECORD WHAT THIS PASS ACTUALLY READ WITH, BEFORE THE PAGE IS WRITTEN.
  //
  // Exclusions and the Canvas address only take effect through a
  // collection, and the page compares them against this record to decide
  // whether to show "some settings need a fresh check" (see
  // pendingFetchKeys in 19-settings.js). It has to land before the page
  // below, or the page this very pass writes would still carry the
  // notice it just cleared. SETTINGS is what was read when this process
  // started, not whatever the file says by now, so a setting changed
  // mid-pass correctly stays pending. Not when the cookies expired: that
  // pass reached nothing, so nothing was applied.
  if (!COOKIES_EXPIRED) {
    try {
      require('./19-settings.js').markApplied({
        exclusions: EXCLUSIONS, canvas: SETTINGS.canvas, canvasToken: SETTINGS.canvasToken,
        classroomEnabled: SETTINGS.classroomEnabled,
        canvasApiEnabled: SETTINGS.canvasApiEnabled, canvasSsoEnabled: SETTINGS.canvasSsoEnabled,
      });
    } catch (e) {
      console.warn('failed to record the applied settings:', e.message);
    }
  }

  // Canvas's and Classroom's grades were just read: into the history (and
  // an alert for a change) before the page draws it.
  recordGradeChanges();

  // The page is written on EVERY run, even when there won't be a popup:
  // it needs to be fresh at any moment someone clicks it.
  writePage({
    burning, later, undated, deferred, overdue, gone, freshIds, broken, now,
    items: all,
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
  // Read before the class list said which classes were renamed.
  classRenames.renameIn(memory, RENAMED);
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
    // Said once, by the sign-in alerts above, not on every check.
    console.log('\nCOOKIES EXPIRED — need to sign in again');
    rememberCollection(all);
    fs.writeFileSync(STREAM_FILE, JSON.stringify(allAnnouncements, null, 2));
    // Q is its own sign-in, unaffected by Google's having run out.
    startBackgroundServices();
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

  // SCHEDULE HEADS-UPS (Settings → Schedule): a flipped day, or with
  // odd/even a day that's the same as the one before it. Their own popup,
  // once each, from 3 PM the school day before (see dueNotifications in
  // 35-school-schedule.js). Not tied to anything being new.
  try {
    const schedule = require('./35-school-schedule.js');
    const due = schedule.dueNotifications(new Date());
    for (const h of due) {
      const text = headsUpText(h);
      notify(t('schoolLabel'), t('headsUpTitle'), text);
      console.log(`\nShowed a schedule heads-up: ${text}`);
    }
    schedule.markNotified(due);
  } catch (e) {
    console.warn('schedule heads-up failed:', e.message);
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
  startAnnouncementScan();
  startBackgroundServices();
})();

/**
 * Grade history and alerts (45-grade-history.js): each class's grade as the
 * page shows it is compared with the last one kept, a change is kept, and
 * (Settings → Grades → Grade alerts) a notification says what changed. Up
 * to three classes in the notification; the rest are on the page. Never a
 * reason for a check to fail.
 */
function recordGradeChanges() {
  try {
    const history = require('./45-grade-history.js');
    const s = require('./19-settings.js').read();
    const changes = history.record(require('./services/q/40-grades.js').gradesView(s));
    const alerts = history.alertsFor(changes, s.gradeAlerts);
    if (!alerts.length) return;
    const lines = alerts.map(ch => history.changeText(ch, locale()));
    const body = lines.slice(0, 3).join('\n') + (lines.length > 3 ? '\n' + t('gradeAlertMore', lines.length - 3) : '');
    notify(t('schoolLabel'), t('gradeAlertTitle', alerts.length), body);
    console.log(`\nShowed a grade alert: ${alerts.length} ${alerts.length === 1 ? 'class' : 'classes'}`);
  } catch (e) {
    console.warn('grade history not recorded:', e.message);
  }
}

/**
 * Services whose manifest says "runs": "background" (Q, which signs in to its
 * portal with a browser of its own): each one is started in a process of its
 * own (62-service-run.js), never a reason for the check to fail or wait. Each
 * decides itself whether it's due (Q: once an hour).
 */
function startBackgroundServices() {
  try {
    const run = require('./62-service-run.js');
    for (const m of SERVICES.list()) if (m.runs === 'background') run.startInBackground(m.domain);
  } catch (e) {
    console.warn('background services not started:', e.message);
  }
}

/**
 * With AI on, new announcements are read for homework once a check has
 * saved them (38-announcement-scan.js). In a process of its own, detached:
 * a local model can take a while per announcement, and the check is done.
 * Only started when there's something new, and never a reason for the
 * check to fail.
 */
function startAnnouncementScan() {
  try {
    if (!SETTINGS.aiProvider || SETTINGS.aiProvider === 'none') return;
    if (!require('./37-ai.js').scanAllowed(SETTINGS.aiProvider)) return;
    const scanner = require('./38-announcement-scan.js');
    if (fs.existsSync(scanner.STATE_FILE) && !scanner.pendingNew().length) return;
    const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '38-announcement-scan.js'), '--new'],
      { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    console.log('announcement scan started');
  } catch (e) {
    console.warn('announcement scan not started:', e.message);
  }
}

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
