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
 * project's OWN memory of what it's ever seen for that class instead —
 * the most recent announcement, or the most recent assignment/material.
 */

const fs = require('fs');
const path = require('path');

const STREAM_FILE = path.join(__dirname, 'messages.json');
const STATE_FILE = path.join(__dirname, 'last-collection.json');

/**
 * The most recent moment this project has ever recorded ANY activity —
 * an announcement or an assignment/material — for a given class.
 *
 * Returns null when there's no dated signal at all: a class that's
 * brand new, or one whose only activity so far is a kind this can't
 * date (Classroom's own `posted` is almost always null — the site
 * doesn't reliably expose when an assignment was created, only when
 * it's due, and a due date says nothing about whether the CLASS is
 * still active). null is deliberately treated as "not stale" by
 * isClassStale below: no signal should never be read as "definitely
 * gone quiet".
 */
function classLastActivity(className) {
  let latest = null;

  if (fs.existsSync(STREAM_FILE)) {
    try {
      const messages = JSON.parse(fs.readFileSync(STREAM_FILE, 'utf8'));
      for (const m of messages) {
        // sortTime is a real, already-resolved timestamp (ms since
        // epoch) computed ONCE when the post was first seen — see the
        // comment where it's set in 05-playwright-draft.js for why it
        // must not be recomputed here from the post's own raw date
        // text. A post whose date text was relative ("Yesterday", a
        // bare time) would otherwise look freshly posted no matter how
        // old it actually is.
        if (m.class === className && typeof m.sortTime === 'number' && m.sortTime > 0) {
          if (latest === null || m.sortTime > latest) latest = m.sortTime;
        }
      }
    } catch { /* no memory yet, or it's unreadable — no signal from here */ }
  }

  if (fs.existsSync(STATE_FILE)) {
    try {
      const items = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      for (const x of items) {
        // Canvas's `posted` is a.created_at, a real ISO timestamp from
        // Canvas's own API — always safe to parse directly, unlike
        // Classroom's scraped announcement text.
        if (x.class !== className || !x.posted) continue;
        const t = Date.parse(x.posted);
        if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
      }
    } catch { /* no memory yet, or it's unreadable — no signal from here */ }
  }

  return latest;
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

module.exports = { classLastActivity, isClassStale };
