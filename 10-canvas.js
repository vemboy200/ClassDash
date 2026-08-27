/**
 * Collects assignments from Canvas.
 *
 * BUILT FUNDAMENTALLY DIFFERENTLY FROM CLASSROOM, and that's for the better.
 *
 * Classroom has to be watched with actual eyes: wait for the page to
 * finish rendering, guess at selectors, catch things that didn't fully
 * load. Got burned by that twice already.
 *
 * Canvas has an API — an address the site hands data back from not as a
 * page for a human, but as a ready-made list for a program. Which means:
 *
 *   - courses do NOT need to be typed in by hand, the list arrives on its own;
 *   - interface language doesn't matter, dates arrive in machine form;
 *   - the markup can change however it likes, it's none of our business;
 *   - it runs in seconds, not a minute.
 *
 * No access token needed: requests go out from inside the already-open
 * page, with the same cookies a normal browser would have. Confirmed —
 * status 200.
 *
 * ── About language ──
 * The browser profile remembers Russian (Chrome picked it up from the
 * system), and Canvas was serving pages in Russian: "со сроком сдачи
 * среда, 10 июня 2026". The Accept-Language header in 05-...js overrides
 * that. Canvas's own settings aren't touched by this — the user's actual
 * interface stays Russian.
 */

// The school's Canvas address comes from settings: every school has its own.
const SITE = require('./19-settings.js').read().canvas;

// How much to truncate an assignment's description to. The user asked
// for these to be kept around for later — to eventually show right on
// the summary page.
//
// Not worth storing in full: Canvas returns HTML with markup like
// data-start="186", and one assignment can run several screens. So it's
// cleaned down to plain text and capped: four thousand characters is
// plenty for any school assignment, with room to spare.
const DESCRIPTION_LENGTH = 4000;

/**
 * Description HTML -> readable text.
 * Paragraphs and list items become line breaks, so an assignment's
 * structure doesn't turn into a mush of run-together sentences.
 */
function cleanDescription(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > DESCRIPTION_LENGTH
    ? text.slice(0, DESCRIPTION_LENGTH) + '…'
    : text;
}

/**
 * A request to the API from inside the already-open Canvas page.
 * Canvas guards against forgery by prepending `while(1);` before the
 * JSON — that junk has to be trimmed off, or parsing crashes.
 */
async function ask(page, apiPath) {
  const text = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Canvas responded ${r.status} to ${u}`);
    return await r.text();
  }, SITE + apiPath);
  return JSON.parse(text.replace(/^while\(1\);?/, ''));
}

/**
 * Collects assignments from every course.
 *
 * @returns {{items: Array, courses: Array, pending: Array}}
 *   items    — assignments in the shared format, same as Classroom's
 *   courses  — which ones were actually gone through
 *   pending  — courses the teacher hasn't published yet
 */
/**
 * A wrapper with one retry.
 *
 * The sign-in redirect chain is unpredictable in timing: no matter how
 * long you wait, it sometimes lurches at the worst possible moment. One
 * retry is cheaper than a missed Canvas collection.
 */
async function collectCanvas(page) {
  try {
    return await collectCanvasOnce(page);
  } catch (e) {
    console.warn(`  Canvas: first attempt failed (${e.message}), retrying`);
    await page.waitForTimeout(3000);
    return await collectCanvasOnce(page);
  }
}

async function collectCanvasOnce(page) {
  // Open the site: API requests have to go out from its own page, or the
  // cookies won't be attached.
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // WAIT UNTIL THE SIGN-IN CHAIN FINISHES.
  //
  // On arrival, Canvas redirects to the school's own sign-in page
  // (pdx.login.instructure.com) and comes back already signed in. The API
  // can't be queried in the middle of that chain for two reasons: the
  // request would go out from the wrong origin and get blocked as
  // cross-site ("Failed to fetch"), or the page could navigate away mid-
  // request ("Execution context was destroyed"). Both caught live on
  // August 11th, once things switched to a visible window — with an
  // invisible one the chain ran faster and never got caught.
  //
  // So instead of waiting for "we're on the right address", it waits for
  // "the address stopped changing".
  let lastUrl = null, steady = 0;
  for (let i = 0; i < 45; i++) {
    const current = page.url();
    steady = (current === lastUrl) ? steady + 1 : 0;
    lastUrl = current;
    // Three seconds with no navigation and we're on Canvas — safe to ask.
    if (steady >= 3 && current.startsWith(SITE)) break;
    await page.waitForTimeout(1000);
  }
  if (!page.url().startsWith(SITE)) {
    throw new Error(`stuck on sign-in (${page.url()}) — Canvas may need signing into again`);
  }

  // state[]=unpublished — so unopened courses are visible too.
  // English 9 is exactly that right now: the school year hasn't started,
  // the teacher hasn't published it. Worth knowing about — so we notice
  // the moment it opens.
  // include[]=term — the course's term dates come along with it. The
  // interface never shows them at all, but they're needed here to tell
  // last year's courses apart from this year's.
  const all = await ask(page,
    '/api/v1/courses?enrollment_state=active&state[]=unpublished&state[]=available' +
    '&include[]=term&per_page=100');

  const now = Date.now();

  // A course counts if it's published AND its term hasn't ended yet.
  //
  // Why by date and not a hardcoded name list: the list would go stale by
  // June, and the rule would need rewriting every year. This way it
  // handles itself.
  //
  // Confirmed on live data: "2025-2026 Tech Lit"'s term ended June 11th,
  // 2026 — last school year, and three of its unturned-in assignments
  // were pretending to be due soon.
  //
  // If there's no term date at all (the school never filled it in) — the
  // course is kept: better an extra assignment than a missed one.
  const hasEnded = c => {
    const end = c.term && c.term.end_at ? new Date(c.term.end_at).getTime() : null;
    return end !== null && end < now;
  };

  const active = all.filter(c => c.workflow_state === 'available' && !hasEnded(c));
  const lastYear = all.filter(c => c.workflow_state === 'available' && hasEnded(c))
    .map(c => c.name);

  // Unpublished courses. There are plenty: the school sets up the whole
  // school year at once, and teachers often never open them, working
  // through Classroom instead. No assignments are visible in them, but
  // it's worth knowing they exist — so the moment one opens gets noticed.
  const pending = all.filter(c => c.workflow_state !== 'available').map(c => c.name);

  if (lastYear.length) {
    console.log(`  Canvas: skipping last year's courses: ${lastYear.join(', ')}`);
  }

  const items = [];
  for (const course of active) {
    // include[]=submission — to know whether it's already turned in.
    // No reason to show turned-in work as due soon.
    const assignments = await ask(page,
      `/api/v1/courses/${course.id}/assignments` +
      '?include[]=submission&per_page=100&order_by=due_at');

    for (const a of assignments) {
      const submitted = a.submission &&
        (a.submission.submitted_at || a.submission.workflow_state === 'graded');
      if (submitted) continue;

      items.push({
        platform: 'Canvas',
        class: course.name,
        // The prefix is required: Canvas ids and Classroom ids are
        // numbered independently and will eventually collide. Without a
        // prefix, one assignment would overwrite another when compared
        // against the previous run.
        id: `canvas-${a.id}`,
        type: 'Assignment',
        title: a.name,
        link: a.html_url,
        // A ready-made machine date — no need to parse text.
        due_iso: a.due_at || null,
        due: null,
        posted: a.created_at || null,
        // Kept for later: show the description right on the page without
        // opening Canvas. The user's request.
        description: cleanDescription(a.description),
      });
    }
  }

  return { items, courses: active.map(c => c.name), pending };
}

module.exports = { collectCanvas, SITE };
