/**
 * Google Classroom, as the services bridge (61-services.js) sees it. The only
 * file of it the check calls.
 *
 *   bridge.settings         the settings
 *   bridge.openPage         async () => a tab of ClassDash's signed-in browser (in read)
 *   bridge.browserFailed    the error the browser failed to start with, or null:
 *                           then every class fails with it, and keeps what it had
 *   bridge.log              a line for the check's log (in read)
 *   bridge.previous         last check's items, for the turned-in checks and
 *                           the instructions kept between checks
 *   bridge.nonEmptyClasses  names of classes that have ever had an assignment
 *                           (the others get a shorter wait)
 *   bridge.started(parts)   called once the class list is known, with
 *                           [{ id, name }], so the progress bar has its total
 *   bridge.done(part)       called as each class finishes, with its part (below)
 *
 * Classroom is one service but many classes, each read in its own tab at the
 * same time, and one class can fail while the rest work. So besides the usual
 * shape, read() returns `sources`, one part per class:
 *
 *   { id, name, ok, error, noBrowser, items, announcements }
 *
 * `ok: false` is "this class didn't load", not "this class is empty": the
 * check keeps that class's items from memory. Reading the pages themselves is
 * in 15-classroom.js.
 */

const SITE = 'https://classroom.google.com/';

// Its own switch (classroomEnabled in 19-settings.js): there's nothing to type in.
const enabled = bridge => bridge.settings.classroomEnabled !== false;

// Classroom is only read by loading its pages, so on means a browser.
const browserNeeded = enabled;
const signInNeeded = enabled;

const addresses = bridge => (enabled(bridge) ? [SITE] : []);

async function read(bridge) {
  const cr = require('./15-classroom.js');
  const { collectFeed } = require('./12-feed.js');
  const grades = require('./44-classroom-grades.js');
  const { isClassStale } = require('../../22-class-activity.js');
  const log = bridge.log || (() => {});
  const previous = bridge.previous || [];
  const nonEmpty = bridge.nonEmptyClasses || new Set();
  // How long to wait for assignments to show up on a class page.
  //
  // Noted from day one: "Classroom renders in 25-40 seconds". A measurement
  // on August 11th showed otherwise: real classes come back in 3-4 seconds.
  // Probably a browser extension was slowing things down back then, not the
  // site. Margin is kept anyway: the site is slow and can hang.
  const TIMEOUT = bridge.settings.classTimeoutMs;

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
  const EMPTY_TIMEOUT = bridge.settings.emptyTimeoutMs;

  // The network is measured BEFORE the classes are read: their timeouts
  // depend on it. It costs a couple seconds and pays for itself on bad
  // internet. The class list is fetched with the same tab, before the
  // classes, because without it it's unknown how many there will be. Any
  // failure here falls back to the list from memory and timeouts with
  // margin, rather than ending the read.
  let multiplier = 1;
  let classes = cr.classesFromMemory().filter(c => !cr.EXCLUSIONS.includes(c.name) && !isClassStale(c.name));
  if (!bridge.browserFailed) try {
    const probe = await bridge.openPage();
    await probe.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    multiplier = await cr.measureNetwork(probe);
    classes = await cr.resolveClasses(probe);
    // A renamed class had assignments under its old name.
    for (const [old, now] of cr.RENAMED) if (nonEmpty.has(old)) nonEmpty.add(now);
    try { await probe.close(); } catch { /* already closed — no big deal */ }
  } catch (e) {
    console.warn(`couldn't open a tab to measure (${e.message}) — using the class list from memory and timeouts with margin`);
    multiplier = 4;
  }
  if (bridge.started) bridge.started(classes.map(c => ({ id: c.id, name: c.name })));

  // Teachers and grades are read along the way for a few classes a check,
  // the ones whose turn it is.
  const teacherDue = new Set(cr.classesNeedingTeacher(classes).map(c => c.id));
  const teachersFound = new Map();
  const gradesDue = new Set(grades.classesDue(classes).map(c => c.id));
  const gradesFound = new Map();

  // Every class is read AT THE SAME TIME, each in its own tab: the total
  // time is the slowest class's, not the sum. The user's idea.
  const parts = await Promise.all(classes.map(async (cls) => {
    log(`Reading: ${cls.name}`);
    // A class that's never had an assignment gets less time. If its first
    // one doesn't render in time, it shows up on the next check: the cost
    // is a delay, not a loss.
    const timeoutMs = (nonEmpty.has(cls.name) ? TIMEOUT : EMPTY_TIMEOUT) * multiplier;
    let page = null;
    let part;
    try {
      if (bridge.browserFailed) throw bridge.browserFailed;
      page = await bridge.openPage();
      let items = await cr.scrapeClassChecked(page, cls, timeoutMs, previous);
      // Still on the class's Classwork: its instructions, before the feed.
      try {
        items = await cr.readInstructions(page, items, previous);
      } catch (e) {
        console.warn(`  instructions for ${cls.name}: ${e.message}`);
      }
      // The same class's feed, teacher announcements, with the same tab.
      let announcements = [];
      try {
        announcements = await collectFeed(page, cls, cr.U);
      } catch (e) {
        console.warn(`  feed for ${cls.name}: ${e.message}`);
      }
      if (teacherDue.has(cls.id)) {
        try {
          teachersFound.set(cls.id, await cr.readClassroomTeachers(page, cls));
        } catch (e) {
          console.warn(`  teachers for ${cls.name}: ${e.message}`);
        }
      }
      if (gradesDue.has(cls.id)) {
        try {
          gradesFound.set(cls.id, { name: cls.name, entries: await grades.readClassroomWork(page, cls, { U: cr.U, timeout: TIMEOUT }) });
        } catch (e) {
          console.warn(`  grades for ${cls.name}: ${e.message}`);
        }
      }
      part = { id: cls.id, name: cls.name, ok: true, items, announcements };
    } catch (e) {
      console.error(`  error on ${cls.name}: ${e.message}`);
      part = { id: cls.id, name: cls.name, ok: false, error: e.message, noBrowser: e === bridge.browserFailed, items: [], announcements: [] };
    } finally {
      if (page) { try { await page.close(); } catch {} }
    }
    if (bridge.done) bridge.done(part);
    return part;
  }));

  try {
    cr.saveClassroomTeachers(teachersFound);
    if (teachersFound.size) log(`Teachers looked up: ${[...teachersFound.values()].join(' | ')}`);
  } catch (e) {
    console.warn('failed to save teachers:', e.message);
  }
  try {
    grades.save(gradesFound);
    if (gradesFound.size) log(`Classroom grades read: ${gradesFound.size} class${gradesFound.size === 1 ? '' : 'es'}`);
  } catch (e) {
    console.warn('failed to save Classroom grades:', e.message);
  }

  // Classroom's dot: no browser is the whole of its problem, not one class's.
  const failed = parts.find(p => !p.ok);
  return {
    items: parts.flatMap(p => p.items),
    announcements: parts.flatMap(p => p.announcements),
    status: { ok: !failed, detail: !failed ? null : failed.noBrowser ? failed.error : `${failed.name}: ${failed.error}` },
    sources: parts,
  };
}

/**
 * Discovery (65-discovery.js): does the Google sign-in work for Classroom?
 * Its class list loading, rather than Google's sign-in page, says yes.
 * Only looks.
 */
async function found(bridge) {
  const page = await bridge.openPage();
  try {
    const account = Number(bridge.settings.account) || 0;
    await page.goto(`${SITE}u/${account}/h`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/accounts\.google\.com/.test(page.url())) return false;
    await page.waitForSelector('a[href*="/c/"]', { timeout: 15000 });
    return true;
  } catch {
    return false;
  } finally {
    try { await page.close(); } catch { /* already closed */ }
  }
}

module.exports = { enabled, browserNeeded, signInNeeded, addresses, read, found, SITE };
