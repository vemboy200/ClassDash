/**
 * Collects assignments from Edpuzzle.
 *
 * ── How it differs from the other two ──
 *
 * Edpuzzle won't work with an invisible browser. In headless mode it
 * answers "Error 18" before any sign-in even happens — cookies included.
 * Makes sense: its protection gets broken regularly for bypassing
 * assignments, and it's suspicious of automation.
 *
 * This does NOT get around that. It just opens a real window of a real
 * browser under the user's own account and reads their own assignment
 * list. Answers to in-video questions aren't touched — an agreement from
 * day one, not up for revisiting. If Edpuzzle ever locks things down
 * harder, this backs off rather than fighting it.
 *
 * So the window doesn't get in the way, it opens off-screen
 * (--window-position=-3000,-3000 in 05-...js). Confirmed: Edpuzzle accepts
 * a window like that, and Classroom isn't bothered by it either.
 *
 * ── Endpoints, learned by watching the site itself ──
 *
 *   /api/v3/users/me                    — who am I, need my id
 *   /api/v3/classrooms/active           — my classes
 *   /api/v3/learning/assignment_learners/users/<uid>/classrooms/<cid>
 *       ?status[]=not-started&status[]=in-progress&isUpcoming=<bool>&cursor=0
 *
 * The value status[]=completed gets rejected by the site — not on its
 * allowed list. Not needed anyway: no reason to show completed work.
 *
 * ── Caution: an assignment's shape hasn't been confirmed yet ──
 *
 * At the time this was written, there were no assignments in any class —
 * the response came back an empty list. So fields are read under several
 * possible names, and the shape of the FIRST real assignment gets printed
 * to the log — to fix it precisely instead of continuing to guess.
 */

const SITE = 'https://edpuzzle.com';

/** The first non-empty value out of several possible field names. */
function field(obj, ...names) {
  for (const name of names) {
    const parts = name.split('.');
    let v = obj;
    for (const p of parts) v = (v && typeof v === 'object') ? v[p] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

async function collectEdpuzzle(page) {
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Give the page a moment to come alive: without it, requests go out
  // before the app has set the headers it needs.
  await page.waitForTimeout(5000);

  const raw = await page.evaluate(async () => {
    const j = async (u) => {
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Edpuzzle responded ${r.status} to ${u}`);
      return await r.json();
    };

    const me = await j('/api/v3/users/me');
    const uid = me._id;

    const response = await j('/api/v3/classrooms/active');
    const classrooms = response.classrooms || response || [];

    const collected = [];
    for (const c of classrooms) {
      // Two passes: due soon, and everything else.
      for (const upcoming of [true, false]) {
        const list = await j(
          `/api/v3/learning/assignment_learners/users/${uid}/classrooms/${c._id}` +
          `?status[]=not-started&status[]=in-progress&isUpcoming=${upcoming}&cursor=0`);
        const items = Array.isArray(list) ? list : (list.items || list.assignments || []);
        for (const item of items) collected.push({ className: c.name, item });
      }
    }
    return { collected, classrooms: classrooms.map(c => c.name) };
  });

  const items = [];
  let shapeShown = false;

  for (const { className, item } of raw.collected) {
    // The first real assignment gets printed in full: its shape isn't
    // confirmed, and this is the only way to learn the real field names.
    if (!shapeShown) {
      console.log('  Edpuzzle: first assignment\'s shape (check and fix if needed):');
      console.log('   ', JSON.stringify(item).slice(0, 900));
      shapeShown = true;
    }

    const assignment = field(item, 'assignment', 'media') || item;
    const id = field(item, '_id', 'id', 'assignment._id');
    const dueRaw = field(item, 'dueDate', 'assignment.dueDate', 'deadline', 'endDate');
    const title = field(assignment, 'title', 'name', 'media.title') || 'Edpuzzle assignment';

    // THE DATE MIGHT COME BACK WRONG, AND THAT'S NOT A REASON TO CRASH THE
    // WHOLE SOURCE.
    //
    // The assignment shape isn't confirmed (there were no assignments to
    // check), so the due date is read from several field names, guessing.
    // This used to be new Date(dueRaw).toISOString(), and on an
    // unrecognized string that throws RangeError: Invalid time value —
    // taking down the ENTIRE Edpuzzle source, not just one assignment
    // with a bad date.
    const parsedDue = dueRaw ? new Date(dueRaw) : null;
    const validDue = parsedDue && !isNaN(parsedDue.getTime());
    if (dueRaw && !validDue) {
      console.warn(`  Edpuzzle: couldn't parse due date "${dueRaw}" for "${title}" — treating as no due date`);
    }

    // Without an id the assignment isn't dropped, but it doesn't get a
    // made-up key either. This used to be `edpuzzle-${id}`, and with
    // id === null EVERY assignment got the same key "edpuzzle-null" —
    // they'd merge into one when compared against memory. diffWithPrevious
    // knows how to handle an empty id: there's a fallback key of
    // "class::title".
    if (!id) console.warn(`  Edpuzzle: assignment "${title}" has no id — matching by title instead`);

    items.push({
      platform: 'Edpuzzle',
      class: className,
      id: id ? `edpuzzle-${id}` : null,
      type: 'Assignment',
      title,
      link: id ? `${SITE}/assignments/${id}/watch` : SITE,
      due_iso: validDue ? parsedDue.toISOString() : null,
      due: null,
      posted: field(item, 'createdAt', 'assignment.createdAt'),
    });
  }

  // MERGE DUPLICATES.
  //
  // The list is pulled in two passes: isUpcoming=true and isUpcoming=false.
  // If an assignment lands in both, it would go into memory TWICE: that
  // would report "2 new" for one assignment and two identical cards on
  // the page. Neither current nor the final result get de-duplicated
  // anywhere else, so it happens here, at the source.
  const byKey = new Map();
  for (const a of items) byKey.set(a.id || `${a.class}::${a.title}`, a);
  const deduped = [...byKey.values()];

  return { items: deduped, classrooms: raw.classrooms };
}

module.exports = { collectEdpuzzle, SITE };
