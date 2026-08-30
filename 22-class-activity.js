/**
 * "Has this class gone quiet?" — shared between Classroom's own class
 * resolution and Canvas's course filtering.
 *
 * ITS OWN FILE, NOT PART OF 05-playwright-draft.js, ON PURPOSE.
 *
 * Both 05-playwright-draft.js and 10-canvas.js need this, and
 * 05-playwright-draft.js already requires 10-canvas.js (to run its
 * collection) — putting this logic in either of those two files would
 * mean the other circularly requiring it back, which Node tolerates but
 * only by handing back a half-initialized module depending on exactly
 * where in each file the require() line sits relative to the export.
 * A third, leaf file both of them can safely require avoids the whole
 * question.
 *
 * ── Why this exists at all ──
 *
 * Edpuzzle has its own real updatedAt per classroom, straight from its
 * API — see 11-edpuzzle.js, which uses that directly and doesn't need
 * any of this. Classroom and Canvas don't hand back anything like it:
 * a course listing is just a name and an id, nothing about when it was
 * last actually active. So staleness there has to be judged from this
 * project's OWN memory of what it's ever seen for that class instead.
 *
 * ── Why its own file, not last-collection.json / messages.json ──
 *
 * The first version of this read the shared assignment/announcement
 * memory directly — reasonable-looking, since that memory already
 * knows the most recent thing seen per class. It was wrong: that
 * memory is also where the exclusions purge lives (an excluded class's
 * entries get deleted outright — see diffWithPrevious's own comment on
 * EXCLUDED CLASSES) and where the "3 misses = removed" decay lives.
 * Neither of those was written with staleness in mind, but both write
 * to the exact data staleness was reading — so excluding a class would
 * silently reset ITS staleness signal to "no data" too, as a side
 * effect nobody intended. It happened to still behave sensibly today,
 * but only by coincidence: any future change to purging or decay could
 * just as easily have broken staleness detection along with it,
 * without anyone touching this file at all.
 *
 * This file keeps its OWN record instead — updated in exactly one
 * place (recordActivity, called from 05-playwright-draft.js right
 * after a class is actually read) and never touched by exclusions,
 * hide/quiet, or decay. A class that stops being fetched (excluded, or
 * already stale) simply stops getting new entries, which is exactly
 * the right behavior — its last-known activity stays frozen at
 * whatever it truly was, undisturbed by anything else in the system.
 */

const fs = require('fs');
const path = require('path');

const ACTIVITY_FILE = path.join(__dirname, 'class-activity.json');

function readActivity() {
  if (!fs.existsSync(ACTIVITY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Records that these classes were just seen active, right now. Called
 * once per collection pass, from 05-playwright-draft.js, with every
 * class name that actually turned up in this pass's results — never
 * called for a class that wasn't read (an excluded one, or one already
 * skipped as stale), which is exactly what keeps a stale class's
 * timestamp frozen instead of drifting.
 */
function recordActivity(classNames, when = Date.now()) {
  if (!classNames || !classNames.length) return;
  const activity = readActivity();
  for (const name of classNames) {
    if (name) activity[name] = when;
  }
  try {
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(activity, null, 2));
  } catch { /* not fatal — staleness just won't have moved this pass */ }
}

/**
 * The most recent moment this project has ever recorded a class as
 * active. Returns null when there's no entry at all: a class that's
 * brand new, or one this file has simply never been told about yet.
 * null is deliberately treated as "not stale" by isClassStale below —
 * no signal should never be read as "definitely gone quiet".
 */
function classLastActivity(className) {
  const activity = readActivity();
  const t = activity[className];
  return typeof t === 'number' ? t : null;
}

/**
 * Whether a class should be treated as stale right now, per the
 * skipStaleClasses/staleMonths settings — read fresh each call, not
 * cached, since a class can be checked from more than one collector in
 * the same pass and a setting change should apply to all of them alike.
 */
function isClassStale(className) {
  const settings = require('./19-settings.js').read();
  if (!settings.skipStaleClasses) return false;

  const latest = classLastActivity(className);
  if (latest === null) return false;

  const staleBefore = Date.now() - settings.staleMonths * 30 * 864e5;
  return latest < staleBefore;
}

module.exports = { classLastActivity, isClassStale, recordActivity };
