/**
 * Collects assignments from Canvas, through its REST API.
 * https://canvas.instructure.com/doc/api/
 *
 * Canvas hands data back from an address meant for programs, not people —
 * a ready-made list — which means:
 *
 *   - courses do NOT need to be typed in by hand, the list arrives on its own;
 *   - interface language doesn't matter, dates arrive in machine form;
 *   - the markup can change however it likes, it's none of our business;
 *   - it runs in seconds, not a minute.
 *
 * ── Two ways to sign in, one way to read ──
 *
 * The requests are the same either way; what differs is who they're sent as.
 *
 *   ACCESS TOKEN (settings.canvasToken, with canvasApiEnabled on). Canvas →
 *   Account → Settings → "New Access Token". Every request carries it in an
 *   `Authorization: Bearer` header — the documented way for a program to act
 *   as a student. No browser, no cookies, no redirects, nothing to wait for.
 *   The catch is its lifetime: Canvas (or the school) caps how long a token
 *   lives, so it stops working after a while and has to be made again. It is
 *   revoked from that same Settings page.
 *
 *   BROWSER SESSION (canvasSsoEnabled). Requests go out from inside an open
 *   Canvas page of the browser profile, with the same cookies a normal
 *   browser would have — which is what makes a school whose Canvas sits
 *   behind Google single sign-on work with no token at all. The cost:
 *   waiting out the school's sign-in redirect chain, and needing the profile
 *   signed in (it expires like any session, and the person has to sign in
 *   again).
 *
 * With both on and a token filled in, the token is the way and the browser
 * session is the FALLBACK for when the token fails (see collectCanvasPlanned
 * below) — with a note, so the person still hears the token stopped working.
 *
 * ── The token is a credential ──
 *
 * It acts as the person, for everything they can do in Canvas. This file
 * only ever sends GET requests. It is never logged or put in an error
 * message — those land in check-status.json, the home API's
 * /api/check-status and the diagnostics log — and it only goes over https
 * (or to a Canvas on this same computer, for development).
 *
 * ── About language ──
 * The browser profile remembers Russian (Chrome picked it up from the
 * system), and Canvas was serving pages in Russian: "со сроком сдачи
 * среда, 10 июня 2026". The Accept-Language header in 05-...js overrides
 * that for the browser way. Canvas's own settings aren't touched by this —
 * the user's actual interface stays Russian.
 */

const fs = require('fs');
const path = require('path');

// The school's Canvas address comes from settings: every school has its own.
//
// NORMALIZED HERE, NOT LEFT RAW — confirmed live: someone typing just
// "theirschool.instructure.com" (no scheme, the way you'd type it into
// an actual browser's address bar, which quietly assumes https:// for
// you) crashed page.goto() outright with "Cannot navigate to invalid
// URL", and fetch() can't parse it either. It also broke the
// startsWith(SITE) checks below more quietly: page.url() always includes
// a scheme, so a schemeless SITE could never match it. And someone pasting
// the address of the page they were on ("…/calendar", "…/courses/123")
// would get API requests built on top of that path. Only the origin
// matters — the API always lives at its root — so that's all that's kept.
function normalizeCanvasSite(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { return new URL(withScheme).origin; } catch { return withScheme.replace(/\/+$/, ''); }
}
const SITE = normalizeCanvasSite(require('./19-settings.js').read().canvas);
const TOKEN = String(require('./19-settings.js').read().canvasToken || '').trim();
const { isClassStale } = require('./22-class-activity.js');

// The last successfully read list of active courses. Written here, not
// just returned, so the settings page can list every known Canvas course
// in the exclusions picker and (with showEmptyClasses on) the class
// filter — the same reason Classroom's own class list lives in
// classes.json.
const CLASSES_FILE = path.join(__dirname, 'canvas-classes.json');

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

const REQUEST_TIMEOUT_MS = 30000;

// An error a retry can't fix — a missing or refused token — so the wrapper
// below doesn't wait three seconds just to hear the same thing again.
function fatal(message) {
  const e = new Error(message);
  e.fatal = true;
  return e;
}

/**
 * A request to the API from inside the already-open Canvas page (the
 * browser way). Canvas guards against forgery by prepending `while(1);`
 * before the JSON — that junk has to be trimmed off, or parsing crashes.
 */
async function askViaPage(page, apiPath) {
  const text = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Canvas responded ${r.status} to ${u}`);
    return await r.text();
  }, SITE + apiPath);
  return JSON.parse(text.replace(/^while\(1\);?/, ''));
}

/**
 * One GET to the API with the access token. A token request doesn't get
 * the `while(1);` prefix, but trimming it costs nothing and keeps parsing
 * safe either way.
 *
 * Errors name the path, never the token, and never the whole address.
 */
async function askWithToken(apiPath) {
  let res;
  try {
    res = await fetch(SITE + apiPath, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // e.message alone is a bare "fetch failed"; the reason is in e.cause.
    const why = (e.cause && (e.cause.code || e.cause.message)) || e.name || 'network error';
    throw new Error(`couldn't reach Canvas (${why})`);
  }
  if (res.status === 401) {
    throw fatal('Canvas refused the access token (expired or deleted?) — make a new one in ' +
                'Canvas → Account → Settings and paste it into ClassDash settings');
  }
  if (!res.ok) throw new Error(`Canvas responded ${res.status} to ${apiPath}`);
  return JSON.parse((await res.text()).replace(/^while\(1\);?/, ''));
}

/**
 * Collects assignments from every course.
 *
 * @param page  an open tab of the signed-in browser profile — used only
 *              for the browser way, and null for the API way
 * @param way   'api' (the access token) or 'browser' (the signed-in session)
 * @returns {{items: Array, courses: Array, pending: Array}}
 *   items    — assignments in the shared format, same as Classroom's
 *   courses  — which ones were actually gone through
 *   pending  — courses the teacher hasn't published yet
 */
/**
 * A wrapper with one retry.
 *
 * The browser way's sign-in redirect chain is unpredictable in timing: no
 * matter how long you wait, it sometimes lurches at the worst possible
 * moment. One retry is cheaper than a missed Canvas collection. Not for a
 * token problem, which a retry can't fix.
 */
async function collectCanvas(page, way) {
  try {
    return await collectCanvasOnce(page, way);
  } catch (e) {
    if (e.fatal) throw e;
    console.warn(`  Canvas: first attempt failed (${e.message}), retrying`);
    await new Promise(r => setTimeout(r, 3000));
    return await collectCanvasOnce(page, way);
  }
}

/**
 * Reads Canvas the way the settings say (see canvasPlan in 19-settings.js).
 *
 *   api on and filled in   the API first; if that fails and the browser way
 *                          is allowed, the browser way as a FALLBACK
 *   otherwise              the browser way, if it's allowed
 *
 * A successful fallback comes back with a `note` saying why it was needed:
 * it's a success, but the person needs to hear that the token stopped
 * working (they'd otherwise never find out, and the browser session that's
 * carrying things expires too), so the status panel shows the note.
 *
 * @param plan      {api, sso} from canvasPlan()
 * @param openPage  async () => an open tab of the signed-in browser profile,
 *                  launching the browser first if it isn't running yet —
 *                  only called when the browser way is actually used, so a
 *                  working token never starts a browser
 */
async function collectCanvasPlanned(plan, openPage) {
  const WAY_API = 'API (access token)', WAY_BROWSER = 'Google sign-in';
  const viaBrowser = async () => {
    const page = await openPage();
    try {
      return await collectCanvas(page, 'browser');
    } finally {
      try { await page.close(); } catch { /* already closed */ }
    }
  };

  // What the result carries about HOW it was read, for the status panel and
  // /api/check-status: `way` is 'api' or 'browser'; `fallback` is true only
  // when the API was the plan and the browser sign-in carried it; `detail`
  // says which in words. The names match the two rows in Settings.
  const via = (result, way, extra = {}) => {
    result.way = way;
    result.detail = `Method: ${way === 'api' ? WAY_API : WAY_BROWSER}`;
    return Object.assign(result, extra);
  };

  if (plan.api) {
    try {
      return via(await collectCanvas(null, 'api'), 'api');
    } catch (apiError) {
      if (!plan.sso) throw apiError;
      console.warn(`  Canvas: the access token didn't work (${apiError.message}) — trying the browser sign-in`);
      try {
        const result = await viaBrowser();
        const note = `the access token didn't work (${apiError.message}) — read through the browser sign-in instead`;
        return via(result, 'browser', {
          note,
          fallback: true,
          detail: `Fallback: the ${WAY_API} didn't work (${apiError.message}), so ${WAY_BROWSER} was used instead`,
        });
      } catch (browserError) {
        throw new Error(`${apiError.message}; and the browser sign-in didn't work either: ${browserError.message}`);
      }
    }
  }
  if (plan.sso) return via(await viaBrowser(), 'browser');
  throw fatal('Canvas is on, but neither way of reading it is: fill in the access token, ' +
              'or switch on Canvas Google sign-in');
}

async function collectCanvasOnce(page, way) {
  if (way === 'api') {
    if (!TOKEN) {
      throw fatal('Canvas needs an access token — make one in Canvas → Account → ' +
                  'Settings → New Access Token and paste it into ClassDash settings');
    }
    // The token would travel with every request, so only over https (a
    // Canvas running on this same computer, for development, is the one
    // exception).
    const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.docker)(:|\/|$)/i.test(SITE);
    if (!/^https:\/\//i.test(SITE) && !local) {
      throw fatal('the Canvas address needs to be https:// — the access token is sent with every request');
    }
    return await readCanvas(askWithToken);
  }
  if (way !== 'browser') throw new Error(`unknown way of reading Canvas: ${way}`);

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
  return await readCanvas(apiPath => askViaPage(page, apiPath));
}

/** A course's teachers as one line, "A, B" — or '' when Canvas didn't say. */
function teacherNames(course) {
  const list = Array.isArray(course.teachers) ? course.teachers : [];
  return [...new Set(list.map(t => String((t && t.display_name) || '').trim()).filter(Boolean))].join(', ');
}

/** Everything after signing in: the same for both ways, given a function
 *  that asks the API for a path. */
async function readCanvas(ask) {
  // state[]=unpublished — so unopened courses are visible too.
  // English 9 is exactly that right now: the school year hasn't started,
  // the teacher hasn't published it. Worth knowing about — so we notice
  // the moment it opens.
  // include[]=term — the course's term dates come along with it. The
  // interface never shows them at all, but they're needed here to tell
  // last year's courses apart from this year's.
  // include[]=teachers — each course's teachers' display names, for the
  // teacher line on the page and the API. It's the same call, so it costs
  // nothing extra.
  const all = await ask(
    '/api/v1/courses?enrollment_state=active&state[]=unpublished&state[]=available' +
    '&include[]=term&include[]=teachers&per_page=100');

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

  const availableNow = all.filter(c => c.workflow_state === 'available' && !hasEnded(c));

  // isClassStale() reads THIS PROJECT'S OWN memory (the most recent
  // assignment/announcement it's ever recorded for the class) rather
  // than anything Canvas hands back directly — Canvas has no per-course
  // "last activity" of its own to check the way Edpuzzle's updatedAt
  // does. See 22-class-activity.js for the full reasoning, shared with
  // Classroom's own resolveClasses().
  const stale = availableNow.filter(c => isClassStale(c.name)).map(c => c.name);
  const active = availableNow.filter(c => !isClassStale(c.name));
  const lastYear = all.filter(c => c.workflow_state === 'available' && hasEnded(c))
    .map(c => c.name);

  if (stale.length) {
    console.log(`  Canvas: skipping stale courses: ${stale.join(', ')}`);
  }

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
    const assignments = await ask(
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

    // Pages — Canvas's equivalent of a Classroom Material: something for
    // a student to read, nothing to turn in, no due date. Same shared
    // shape as Classroom's own materials (type: 'Material', due: null),
    // which is what routes them into "undated" in sortIntoBuckets and
    // "New materials" on the page — no separate handling needed anywhere
    // else in the pipeline, that behavior falls out for free.
    //
    // TURNS OUT THE LIST ENDPOINT DOES NOT FILTER THIS FOR US.
    //
    // The assumption was that, like the assignments call above, this
    // would only ever come back with what the signed-in account can
    // actually see — Classroom's own scrape only ever sees what's
    // rendered for the logged-in user, so the same was expected here.
    // Wrong: caught live, unpublished pages (`published: false`) showing
    // up in the response and landing on the summary page as materials —
    // teacher drafts a student was never meant to see yet. `published`
    // is explicitly checked instead of trusted away by omission: an
    // account without manage-content rights on some course may not get
    // the field back at all (`undefined`), and that has to still mean
    // "show it" — only a literal `false` means "not yet published,
    // leave it out".
    // A COURSE CAN HAVE THE PAGES TOOL TURNED OFF ENTIRELY.
    //
    // Unlike Assignments, Pages is an optional course navigation item —
    // a teacher can disable it, and the endpoint then 404s outright
    // rather than returning an empty list. Caught live: one course
    // without Pages enabled threw here, which — unwrapped — killed
    // collectCanvasOnce() for every course in that pass, not just this
    // one, and (once check-status.json started actually recording the
    // real error instead of the whole thing just silently retrying)
    // showed up as Canvas going "problem" every single pass. A course
    // missing Pages isn't a real failure, it's just a course without
    // that feature — skip pages for it and keep going.
    let pages = [];
    try {
      pages = await ask(`/api/v1/courses/${course.id}/pages?per_page=100`);
    } catch (e) {
      console.warn(`  Canvas: no Pages for ${course.name} (${e.message})`);
    }

    for (const p of pages) {
      if (p.published === false) continue;
      items.push({
        platform: 'Canvas',
        class: course.name,
        // Same collision reasoning as assignments above, plus its own
        // "page" tag: a course's assignment and page ids are independent
        // counters too, and could otherwise collide with each other.
        id: `canvas-page-${p.page_id}`,
        type: 'Material',
        title: p.title,
        link: p.html_url,
        due_iso: null,
        due: null,
        posted: p.created_at || null,
      });
    }
  }

  const courses = active.map(c => c.name);
  try {
    // availableNow, NOT active/courses: remembered before subtracting
    // staleness, same reasoning as Classroom's own CLASSES_FILE write —
    // a stale course is a decision to stop reading it, not proof it
    // doesn't exist, and it needs to keep showing up in the exclusions
    // picker so it's still something a person can see and act on.
    //
    // The teacher rides along with the name. A course that comes back
    // without one this time keeps the one it had: teachers don't leave a
    // course between two checks, a response missing them does happen.
    const before = new Map();
    try {
      for (const c of JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'))) {
        if (c && c.name && c.teacher) before.set(c.name, c.teacher);
      }
    } catch { /* first run, or unreadable: nothing to keep */ }
    fs.writeFileSync(CLASSES_FILE, JSON.stringify(availableNow.map(c => {
      const teacher = teacherNames(c) || before.get(c.name);
      return teacher ? { name: c.name, teacher } : { name: c.name };
    }), null, 2));
  } catch { /* couldn't write it — the exclusions/filter UI just won't list Canvas courses this time */ }

  return { items, courses, pending };
}

module.exports = { collectCanvas, collectCanvasPlanned, SITE };
