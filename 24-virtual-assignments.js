/**
 * Virtual assignments — reminders the user writes down themselves, not
 * anything read from Classroom, Canvas, or Edpuzzle.
 *
 * ── Why ──
 *
 * "A teacher said something in class and then you forgot it" is a real
 * gap none of the three platforms can ever close — nothing was ever
 * assigned through them, so there's nothing to scrape and no API to
 * call. This is the one kind of assignment ClassDash itself is the
 * source of truth for, not a mirror of something else.
 *
 * ── Why its own file, not folded into last-collection.json ──
 *
 * That file gets overwritten WHOLESALE by every real collection pass
 * (see writeState() in 05-playwright-draft.js) — mixing user-typed data
 * into something a scrape can clobber would be a good way to quietly
 * lose it the next time a check runs. This file is never touched by
 * collection at all; it's read and merged in at display time instead,
 * by both 05-playwright-draft.js (the page, via bucketed()) and
 * 17-api.js (the API, via readAll()/bucketed() too).
 *
 * ── The three states ──
 *
 * done — the user handled it. Kept for a 7-day grace period (in case
 *   that was a misclick) rather than vanishing immediately, then pruned
 *   for good the next time anything reads this file — see readAll().
 * hidden — dismissed without saying it's done (maybe it turned out not
 *   to matter). Stays hidden until explicitly un-hidden — no
 *   expiration, matching how a hidden overdue REAL assignment behaves.
 * deleted — not a state at all, an action: remove(id) actually removes
 *   the entry, immediately and permanently. No undo, unlike the other two.
 *
 * A virtual assignment can be both done AND hidden at once — they're
 * independent flags, not a single three-way switch — though the normal
 * flow through the page only ever sets one at a time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'virtual-assignments.json');

// A week. Long enough to notice and undo an accidental "done" click,
// short enough that finished reminders don't pile up forever the way a
// real completed assignment does (those stay until Classroom itself
// stops reporting them — see toPublic()'s own comment in 17-api.js).
const DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function readRaw() {
  if (!fs.existsSync(FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRaw(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

/**
 * Every read prunes first. Lazy cleanup on read, not a separate timer:
 * this file might go days without anything touching it, and there's no
 * reason to coordinate a cleanup schedule with the collector or the
 * auto-fresh-check timer just to expire a handful of done reminders.
 * Whatever reads next does the pruning, and only rewrites the file if
 * pruning actually removed something.
 */
function readAll() {
  const list = readRaw();
  const now = Date.now();
  const kept = list.filter((v) => {
    if (!v.done || !v.doneAt) return true;
    return now - new Date(v.doneAt).getTime() < DONE_RETENTION_MS;
  });
  if (kept.length !== list.length) writeRaw(kept);
  return kept;
}

function findIndex(list, id) {
  return list.findIndex((v) => v.id === id);
}

/** Shared by create() and edit(): title required, due either a valid
 *  date or falsy (meaning "no due date", not "invalid"). Returns
 *  {ok: false, why} the same shape every other function here does, or
 *  {ok: true, title, className, dueISO} ready to assign directly. */
function validateTitleAndDue({ title, class: className, due }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return { ok: false, why: 'title is required' };

  let dueISO = null;
  if (due) {
    const d = new Date(due);
    if (isNaN(d.getTime())) return { ok: false, why: 'due is not a valid date' };
    dueISO = d.toISOString();
  }

  return {
    ok: true,
    title: cleanTitle,
    className: className ? String(className).trim() || null : null,
    dueISO,
  };
}

/** title required, class and due both optional — a due-less reminder
 *  is exactly the "teacher mentioned it, no actual deadline" case this
 *  whole thing exists for. */
function create({ title, class: className, due }) {
  const v = validateTitleAndDue({ title, class: className, due });
  if (!v.ok) return v;

  const entry = {
    id: 'v-' + crypto.randomBytes(8).toString('hex'),
    title: v.title,
    class: v.className,
    due: v.dueISO,
    createdAt: new Date().toISOString(),
    done: false,
    doneAt: null,
    hidden: false,
  };

  const list = readAll();
  list.push(entry);
  writeRaw(list);
  return { ok: true, entry };
}

/** Title and due follow the same rules create() enforces; class is
 *  always overwritten too (including back to null), not merged — the
 *  edit form always sends the current-or-changed value for all three,
 *  a full snapshot rather than a partial diff, same as saveSettings()
 *  does for the settings panel. */
function edit(id, { title, class: className, due }) {
  const list = readAll();
  const i = findIndex(list, id);
  if (i === -1) return { ok: false, why: 'no such virtual assignment' };

  const v = validateTitleAndDue({ title, class: className, due });
  if (!v.ok) return v;

  list[i].title = v.title;
  list[i].class = v.className;
  list[i].due = v.dueISO;
  writeRaw(list);
  return { ok: true, entry: list[i] };
}

function markDone(id, done) {
  const list = readAll();
  const i = findIndex(list, id);
  if (i === -1) return { ok: false, why: 'no such virtual assignment' };
  list[i].done = done;
  list[i].doneAt = done ? new Date().toISOString() : null;
  writeRaw(list);
  return { ok: true, entry: list[i] };
}

function setHidden(id, hidden) {
  const list = readAll();
  const i = findIndex(list, id);
  if (i === -1) return { ok: false, why: 'no such virtual assignment' };
  list[i].hidden = hidden;
  writeRaw(list);
  return { ok: true, entry: list[i] };
}

/** The only one of the three that's a real deletion, not a flag. */
function remove(id) {
  const list = readAll();
  const i = findIndex(list, id);
  if (i === -1) return { ok: false, why: 'no such virtual assignment' };
  const [removedEntry] = list.splice(i, 1);
  writeRaw(list);
  return { ok: true, entry: removedEntry };
}

/**
 * Converts stored virtual assignments into the shared item shape
 * (toPublic() in 17-api.js, itemCard() in 08-page.js both expect it)
 * and buckets them by due date.
 *
 * Deliberately its own small due-date comparison, not a call into
 * sortIntoBuckets() (05-playwright-draft.js): that function carries a
 * lot of Classroom-specific machinery — placeholder-date detection,
 * missCount/removed escalation for a source that might have under-read,
 * "Completed Assignment" type-string sniffing — none of which applies
 * to something the user typed in and fully controls the lifecycle of
 * directly through done()/setHidden()/remove() above. Reusing that
 * function here would mean fighting its assumptions more than
 * benefiting from sharing code with it.
 *
 * treatUndatedAsUrgent is passed in (not read here) so this stays
 * consistent with the exact same setting real assignments use — same
 * meaning, same knob, not a second one to keep in sync.
 */
function bucketed(now, treatUndatedAsUrgent) {
  const burning = [];
  const later = [];
  const overdue = [];
  const undated = [];
  const done = [];
  const tomorrow = new Date(now.getTime() + 864e5);

  for (const v of readAll()) {
    const item = {
      id: v.id,
      title: v.title,
      class: v.class,
      platform: 'Virtual',
      type: 'Assignment',
      link: null,
      hidden: !!v.hidden,
      // The ORIGINAL due value, not due_at below — due_at gets forced
      // to "tomorrow" by treatUndatedAsUrgent for a reminder that never
      // had a real due date at all. Editing needs to pre-fill with what
      // was actually set, not a display-only stand-in date; see
      // startEditReminder() in 08-page.js.
      rawDue: v.due,
    };

    if (v.done) {
      done.push({ ...item, done: true, due_at: v.due ? new Date(v.due) : null });
      continue;
    }

    let dueAt = v.due ? new Date(v.due) : null;
    let note = null;
    if (!dueAt) {
      if (!treatUndatedAsUrgent) { undated.push(item); continue; }
      dueAt = tomorrow;
      note = 'noDueDateNote';
    }

    const withDue = { ...item, due_at: dueAt, note };
    if (dueAt < now) overdue.push(withDue);
    else if (dueAt - now <= 7 * 864e5) burning.push(withDue);
    else later.push(withDue);
  }

  return { burning, later, overdue, undated, done };
}

module.exports = { FILE, readAll, create, edit, markDone, setHidden, remove, bucketed };
