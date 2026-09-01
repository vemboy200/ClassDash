/**
 * Home API: serves what's been collected over the local network, like an
 * ordinary web API.
 *
 * ── Why ──
 *
 * Right now the data lives in two places: JSON files and the
 * `summary.html` page. Only the script itself and a person's own eyes can
 * read them. The API opens them up for ANYTHING: a phone, a watch, a
 * second computer, someone else's program, a smart home setup.
 *
 * No collecting happens IN THIS FILE. It only reads files the main script
 * already collected, and sorts them with the same `sortIntoBuckets()`
 * function the summary page uses. The logic is deliberately not
 * duplicated: it would drift apart on the first edit, and "due soon" is
 * the single most important word in the whole thing.
 *
 * It's not read-only overall, though — HANDLERS above are, but
 * WRITE_HANDLERS below can hide/unhide an assignment, mark one not
 * urgent and back, change a display setting, or start a collection pass
 * (quick or full). Every one of those calls straight into
 * 21-notifier-actions.js's main() — the exact same dispatcher
 * 16-summary.swift's own bridge calls for a click on the actual page, not
 * a second implementation that could drift from it.
 *
 * ── Running it ──
 *
 *   node 17-api.js               this computer only (127.0.0.1:8734)
 *   node 17-api.js --network     visible to the whole home network
 *   node 17-api.js --port 9000   a different port
 *
 * First run generates api-cert.pem, api-key.pem and api-token.txt
 * next to this file (gitignored, unique to this install) and prints the
 * token and the certificate's fingerprint once. A client needs both: the
 * token as "Authorization: Bearer <token>" on every request, and the
 * fingerprint pinned instead of trusting a real CA — there isn't one for
 * a private home address, so the certificate is self-signed. Neither is
 * ever regenerated automatically; a client that already has them would
 * silently be locked out if they changed underneath it.
 *
 * ── READ THIS BEFORE USING "--network" ──
 *
 * By default the server listens on 127.0.0.1 — meaning "only me". No one
 * on the network can reach it, not even from the computer next door.
 *
 * The --network flag lifts that restriction, and then homework, teacher
 * announcements, and email-bearing links become reachable — encrypted and
 * token-gated, but reachable — by any device on the network, including a
 * school wifi if the laptop ever ends up there. That now includes
 * WRITE_HANDLERS below too: anyone with the token can hide an
 * assignment, change a display setting, or start a check — the same
 * things the token already lets them read out.
 *
 * That's why localhost is the default and not the other way around:
 * opening it wider should be a deliberate choice, and accidentally
 * broadcasting your own schedule to the whole class shouldn't happen on
 * its own.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  sortIntoBuckets, readMutedIds, readHiddenIds,
} = require('./05-playwright-draft.js');
const { t, currentLanguage } = require('./18-language.js');
// The calendar-day counter lives in 08-page: no circular dependency,
// 17 already pulls in 05, and 05 pulls in 08. allKnownClasses is the
// same merged-across-Classroom/Canvas/Edpuzzle class list the settings
// panel's exclusions checklist uses — classRoster() below reuses it
// rather than re-reading classes.json/canvas-classes.json/
// edpuzzle-classes.json a second, possibly-inconsistent way.
const { daysUntil, allKnownClasses, knownClassStatus } = require('./08-page.js');
const { isClassStale } = require('./22-class-activity.js');
// Cert/token generation, the running-process pid file, and the auth
// check itself all live in their own leaf module — 21-notifier-actions.js
// needs the exact same logic (starting/stopping this server, rolling the
// token) without requiring this whole file. See 23-api-security.js's own
// comment for why generation specifically can't just happen lazily here.
const {
  ensureCert, certFingerprint, ensureToken, currentToken, isAuthorized,
  writePid, clearPid,
} = require('./23-api-security.js');
// The exact same dispatcher 16-summary.swift's bridge calls for a click
// on the page itself — hiding an assignment from here and hiding it from
// the actual window run through identical code, not two implementations
// that could drift. See the WRITE_HANDLERS comment below for the one
// case (apiEnabled/apiNetwork) that's deliberately NOT reachable this way.
const notifierActions = require('./21-notifier-actions.js');
const virtualAssignments = require('./24-virtual-assignments.js');
const { checkStatus } = require('./25-check-status.js');

const STATE_FILE = path.join(__dirname, 'last-collection.json');
const STREAM_FILE = path.join(__dirname, 'messages.json');
const CERT_FILE = path.join(__dirname, 'api-cert.pem');
const KEY_FILE = path.join(__dirname, 'api-key.pem');

const DEFAULT_PORT = require('./19-settings.js').read().apiPort;

/** Reads a json file. Missing or broken — an empty list, not a crash. */
function readJson(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * Prepares the response: the same buckets as on the summary page.
 *
 * Files are read on EVERY request, not once at startup. Collection runs
 * every ten minutes and rewrites them; a server that cached data at
 * startup would keep serving yesterday's and never admit it.
 */
function gather() {
  const items = readJson(STATE_FILE);
  const announcements = readJson(STREAM_FILE);
  const now = new Date();

  const { burning, later, undated, deferred, overdue, gone, done } =
    sortIntoBuckets(items, now, readMutedIds(), readHiddenIds());

  // The last-collection timestamp comes from the file's own mtime, not
  // this process's clock: if the script has been silent for three days,
  // that needs to be visible from outside.
  const collectedAt = fs.existsSync(STATE_FILE)
    ? fs.statSync(STATE_FILE).mtime
    : null;

  return { items, announcements, burning, later, undated, deferred,
           overdue, gone, done, now, collectedAt };
}

/**
 * An assignment, outward-facing: no internal fields, plus days-until-due
 * and a `tags` array.
 *
 * hidden/muted/done/removed all used to mean "leave this out of the
 * response" (hidden and done outright, one via a filter on the way out,
 * the other by never entering a bucket at all) or "no way to tell from
 * outside" (muted was never exposed through the API at all). That's the
 * server deciding what a client is and isn't allowed to know about its
 * own data. Now everything goes out; `tags` is how a client tells them
 * apart instead — filter, display differently, or ignore, its call, not
 * this server's.
 */
function toPublic(x, now) {
  const tags = [];
  if (x.hidden) tags.push('hidden');
  if (x.muted) tags.push('muted');
  if (x.done) tags.push('done');
  if (x.removed) tags.push('removed');
  return {
    id: x.id,
    title: x.title,
    class: x.class,
    platform: x.platform || 'Google Classroom',
    type: x.type || null,
    link: x.link || null,
    due: x.due_at ? x.due_at.toISOString() : null,
    daysUntilDue: x.due_at ? daysUntil(now, x.due_at) : null,
    // note is stored as a key ("noDueDateNote"), given out as text.
    note: x.note ? t(x.note) : null,
    tags,
  };
}

/**
 * Every known class — merged across Classroom, Canvas and Edpuzzle via
 * allKnownClasses(), not just Classroom's own classes.json — with its
 * current due-soon/ahead/overdue counts.
 *
 * A class with nothing currently due only appears here if
 * `showEmptyClasses` is on — same setting, same meaning, as the "show
 * classes with nothing due" toggle in the settings panel: without it, a
 * class HA has never heard anything due for just isn't in this list at
 * all, exactly like it wouldn't be in the page's own class filter.
 * `hideInactiveClasses` narrows that further the same way it does
 * there too — a class that's never once had an assignment or
 * announcement recorded, at all, isn't "currently quiet", it's
 * genuinely nothing, and stays out even with showEmptyClasses on. An
 * excluded class is left out unconditionally either way: it isn't
 * being read at all, so a permanent zero next to it would misrepresent
 * "not tracked" as "currently quiet" — same carve-out the page's own
 * filter makes, see its own comment in 08-page.js.
 *
 * This is deliberately NOT a re-implementation of that filter's exact
 * counting (which folds in materials and removed/muted items too, for
 * a different purpose — how many CARDS show on the page). The three
 * counts here match exactly what a client would already get by asking
 * /api/due-soon, /api/ahead and /api/overdue and grouping by class —
 * this handle just saves it the trouble, and adds the classes those
 * three would never mention at all.
 *
 * Every entry also carries `status`: `"known"` (the platform still
 * lists this class) or `"orphaned"` (it doesn't anymore — a real class
 * transfer, or a class hidden on Classroom's own side with no way to
 * actually leave it — but old data for it is still around). Lets a
 * client filter these out itself instead of an orphaned class looking
 * identical to a real one.
 */
function classRoster(d) {
  const countByClass = (list) => {
    const counts = new Map();
    for (const x of list) counts.set(x.class, (counts.get(x.class) || 0) + 1);
    return counts;
  };
  const dueSoonByClass = countByClass(d.burning);
  const aheadByClass = countByClass(d.later);
  const overdueByClass = countByClass(d.overdue.filter(x => !x.hidden));

  const present = new Set([
    ...dueSoonByClass.keys(), ...aheadByClass.keys(), ...overdueByClass.keys(),
  ]);
  // "known" — this platform's own current listing still has the class.
  // "orphaned" — it doesn't anymore (a real class transfer, or hiding a
  // class on Classroom's own side with no way to actually leave it),
  // but old data for it is still sitting in last-collection.json. A
  // client can't otherwise tell one from the other: both just look like
  // an ordinary class in this list. Caught live — exactly this
  // ambiguity is what flooded a Home Assistant integration with an
  // entity for a class the student had genuinely moved on from.
  const classStatus = knownClassStatus();
  const statusFor = (name) => classStatus.get(name) || 'known';
  const roster = [...present].map(name => ({
    name,
    dueSoon: dueSoonByClass.get(name) || 0,
    ahead: aheadByClass.get(name) || 0,
    overdue: overdueByClass.get(name) || 0,
    status: statusFor(name),
  }));

  const settings = require('./19-settings.js').read();
  if (settings.showEmptyClasses) {
    const excluded = new Set(settings.exclusions);
    const hideInactive = settings.hideInactiveClasses;
    // d.items/d.announcements are the FULL history (straight off
    // last-collection.json/messages.json), not the page's own
    // display-bucketed allItems — a stricter, more literal "has this
    // class ever had anything at all" than that comment even asks for.
    const everHadClasswork = hideInactive ? new Set(d.items.map(x => x.class)) : null;
    const everHadAnnouncement = hideInactive ? new Set(d.announcements.map(p => p.class)) : null;
    // Same carve-out as the page's own filter (see filtersPanel's own
    // comment in 08-page.js): skipStaleClasses means "skip it", not
    // "keep listing it with a permanent zero" — separate from
    // hideInactiveClasses, since a stale class usually DID have real
    // history once, it's just gone quiet since. Same isClassStale() the
    // fetch-skip decision itself uses, so this list and what's actually
    // being fetched can never disagree.
    const skipStale = settings.skipStaleClasses;

    for (const name of allKnownClasses()) {
      if (present.has(name) || excluded.has(name)) continue;
      if (hideInactive && !everHadClasswork.has(name) && !everHadAnnouncement.has(name)) continue;
      if (skipStale && isClassStale(name)) continue;
      roster.push({ name, dueSoon: 0, ahead: 0, overdue: 0, status: statusFor(name) });
    }
  }

  return roster.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const HANDLERS = {
  '/api/status': (d) => ({
    collectedAt: d.collectedAt ? d.collectedAt.toISOString() : null,
    minutesAgo: d.collectedAt ? Math.round((d.now - d.collectedAt) / 60000) : null,
    // allKnownClasses().length, not readJson(CLASSES_FILE).length: the
    // old count was Classroom-only, same gap /api/classes itself had.
    // Deliberately NOT classRoster(d).length — that count depends on
    // showEmptyClasses, and this field means "how many classes does
    // ClassDash know about, full stop", not "...that currently have
    // something due", which would make an existing client's total
    // silently shrink and grow with a setting it doesn't know about.
    classes: allKnownClasses().length,
    total: d.items.length,
    dueSoon: d.burning.length,
    // Still the actionable count, not the raw bucket size: a hidden
    // overdue item was dismissed on purpose, so it shouldn't move a
    // number a client might badge/notify on. /api/overdue the LIST,
    // right below, is a different question — "what's actually there,
    // tagged" — and answers it without this filter.
    overdue: d.overdue.filter(x => !x.hidden).length,
    ahead: d.later.length,
    announcements: d.announcements.length,
    removed: d.gone.length,
    done: d.done.length,
    language: currentLanguage(),
  }),

  '/api/due-soon': (d) => d.burning.map(x => toPublic(x, d.now)),
  '/api/ahead': (d) => d.later.map(x => toPublic(x, d.now)),
  // No longer filters hidden ones out — tagged instead (see toPublic's
  // own comment). A client that wants the old behavior filters on
  // tags.includes('hidden') itself; one that doesn't now actually gets
  // to see what it's asking for.
  '/api/overdue': (d) => d.overdue.map(x => toPublic(x, d.now)),

  // Turned-in work, its own handle — same reasoning as /api/removed
  // just below: it's not "what needs doing", so it doesn't belong mixed
  // into /api/assignments, but it's real data and deserves a real
  // handle instead of just vanishing.
  '/api/done': (d) => d.done.map(x => toPublic(x, d.now)),

  '/api/assignments': (d) => [...d.burning, ...d.later, ...d.overdue]
    .map(x => toPublic(x, d.now)),

  '/api/announcements': (d) => d.announcements.map(p => ({
    id: p.id,
    class: p.class,
    author: p.author || null,
    date: p.date || null,
    title: p.title || null,
    text: p.text || null,
    link: p.link || null,
  })),

  // Removed by the teacher — its own handle, not part of the general
  // list: these aren't about what needs doing, they're about what happened.
  '/api/removed': (d) => d.gone.map(x => ({
    ...toPublic(x, d.now),
    removedAt: x.removedAt || null,
  })),

  '/api/classes': (d) => classRoster(d),

  // Per-platform "did the last check actually work?" — ok/problem/
  // unknown, see 25-check-status.js's own header comment for the full
  // reasoning. Its own handle, not folded into /api/status: that one's
  // shape is depended on by existing clients (the counts an integration
  // might already be polling), and this is a genuinely different kind
  // of question — not "what's due", but "is the pipeline itself healthy
  // right now" — so it gets a handle of its own instead of risking a
  // shape change on the one that's already relied on.
  '/api/check-status': () => checkStatus(),

  // Virtual assignments — reminders the user typed in themselves, not
  // read from any platform. See 24-virtual-assignments.js's own header
  // comment for what these are. bucketed() already returns the shared
  // item shape (due_at as a Date, hidden/done flags) toPublic() expects,
  // so this is a straight reuse, not a second rendering path — a done
  // one comes back tagged "done", a hidden one tagged "hidden", exactly
  // like a real assignment's would.
  '/api/virtual': (d) => {
    const { treatUndatedAsUrgent } = require('./19-settings.js').read();
    const { burning, later, overdue, undated, done } =
      virtualAssignments.bucketed(d.now, treatUndatedAsUrgent);
    return [...overdue, ...burning, ...later, ...undated, ...done]
      .map(x => toPublic(x, d.now));
  },
};

/** Reads and parses a POST body as JSON. Capped well above anything a
 *  real write handle here needs (an id, a settings object) — a client
 *  that's careless or hostile shouldn't be able to hold a connection
 *  open streaming megabytes at a handle that only ever reads a few
 *  hundred bytes. An empty body resolves to {}: /api/reload and
 *  /api/check don't need one at all. */
function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('invalid JSON body: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

/** Turns a plain settings object into the same base64url-encoded-JSON
 *  shape 08-page.js's own toBase64Url() builds client-side for the
 *  settings panel's save button. applyBatch() (19-settings.js) only
 *  understands that one shape — reusing it here, rather than writing a
 *  second whitelist/validation path just for the API, means the two
 *  can't quietly drift apart the next time either one changes. */
function toConfigChunk(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Write handles. Everything in HANDLERS above only reads; every one of
 * these changes something, and every one of them is the exact same code
 * a click on the actual page runs — see notifierActions above.
 *
 * POST only, enforced in start() below: a GET that changes something is
 * the kind of thing that fires by accident (a browser prefetch, a link
 * preview, a stray bookmark), so none of these are reachable that way.
 *
 * /api/hide and /api/unhide both encodeURIComponent the id before
 * handing it to 'hide'/'unhide' — matches what 08-page.js's own hide
 * link does before that same id reaches скрытые.txt, so an id hidden
 * from here and one hidden from the actual window end up stored
 * identically. /api/mute and /api/unmute deliberately DON'T encode —
 * the page's own "not urgent" link doesn't either (see 08-page.js), so
 * this matches THAT convention instead.
 */
const WRITE_HANDLERS = {
  '/api/hide': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('hide', encodeURIComponent(body.id)) };
  },
  '/api/unhide': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('unhide', encodeURIComponent(body.id)) };
  },
  '/api/mute': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('quiet', body.id) };
  },
  '/api/unmute': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('unquiet', body.id) };
  },
  '/api/settings': (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, body: { error: 'expected a JSON object of settings' } };
    }
    // NOT reachable through here, on purpose. Changing apiEnabled or
    // apiNetwork stops and restarts THIS SAME PROCESS — safe from the
    // settings panel, where a separate, short-lived CLI process does
    // the stopping while the long-running app just redraws once it's
    // back. Unsafe from inside this server's own request handler: it
    // would be asked to signal itself mid-response. Traced through
    // stopApiServer()'s wait loop to confirm — it polls its OWN pid
    // with process.kill(pid, 0), which trivially keeps succeeding
    // because the process answering that check is the same one still
    // synchronously running this very request, so it can never observe
    // itself as gone. It stalls out the full 2-second deadline and then
    // SIGKILLs itself, before this response could ever go out.
    if ('apiEnabled' in body || 'apiNetwork' in body) {
      return {
        status: 400,
        body: { error: 'apiEnabled and apiNetwork can\'t be changed through the API — use the settings panel in the app' },
      };
    }
    const result = notifierActions.main('config', toConfigChunk(body));
    return { status: result.ok ? 200 : 400, body: result };
  },
  // Same two-tier fetch the app itself offers: reload is the quick pass
  // (Classroom + Canvas, ~17s), check is the full one (~1 minute,
  // Edpuzzle included). Both just START the pass and answer right away
  // — neither waits for it to finish. /api/status's collectedAt and
  // minutesAgo are how a client finds out when it actually has.
  '/api/reload': () => ({ status: 200, body: notifierActions.main('reload', '') }),
  '/api/check': () => ({ status: 200, body: notifierActions.main('check', '') }),

  // Virtual assignments — write side. Same dispatcher
  // (notifierActions.main) the page's own Reminders section uses, so
  // creating/completing/hiding/deleting one through the API and doing
  // the same thing by hand on the page are the exact same code path.
  '/api/virtual/create': (body) => {
    if (!body || typeof body.title !== 'string' || !body.title.trim()) {
      return { status: 400, body: { error: 'expected a JSON body: {"title": "...", "class": "...", "due": "..."}  — class and due are both optional' } };
    }
    // toConfigChunk — same base64url-JSON encoding /api/settings uses,
    // just carrying {title, class, due} instead of a settings batch.
    const result = notifierActions.main('virtualCreate', toConfigChunk({
      title: body.title, class: body.class || null, due: body.due || null,
    }));
    return { status: result.ok ? 200 : 400, body: result };
  },
  '/api/virtual/edit': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "...", "title": "...", "class": "...", "due": "..."}' } };
    }
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { status: 400, body: { error: 'title is required' } };
    }
    const result = notifierActions.main('virtualEdit', toConfigChunk({
      id: body.id, title: body.title, class: body.class || null, due: body.due || null,
    }));
    return { status: result.ok ? 200 : 400, body: result };
  },
  '/api/virtual/done': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('virtualDone', body.id) };
  },
  '/api/virtual/undone': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('virtualUndone', body.id) };
  },
  '/api/virtual/hide': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('virtualHide', body.id) };
  },
  '/api/virtual/unhide': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('virtualUnhide', body.id) };
  },
  // The one genuinely irreversible write handle in this whole API —
  // every other one here (hide, mute, this same file's own done/hide)
  // has an undo. This doesn't, on purpose: it mirrors remove() in
  // 24-virtual-assignments.js exactly, which is a real deletion, not a
  // flag — see that file's own comment on why "deleted" is an action
  // and not a third state alongside done/hidden.
  '/api/virtual/delete': (body) => {
    if (!body || typeof body.id !== 'string' || !body.id) {
      return { status: 400, body: { error: 'expected a JSON body: {"id": "..."}' } };
    }
    return { status: 200, body: notifierActions.main('virtualDelete', body.id) };
  },
};

/** Root: a list of handles, so no one has to dig through the source for addresses. */
function index() {
  return {
    what: 'School digest home API',
    handles: [...Object.keys(HANDLERS), '/api/stream'],
    writes: Object.keys(WRITE_HANDLERS),
    note: 'The handles above are read-only. Everything under "writes" ' +
      'changes something and needs POST with a JSON body and ' +
      '"Content-Type: application/json" — see CONTRIBUTING.md. Every ' +
      'request, either way, needs "Authorization: Bearer <token>" — ' +
      'see api-token.txt.',
  };
}

/** Everything every handle returns, bundled into one object — what
 *  /api/stream pushes. One combined shape rather than one stream per
 *  handle: a client that wants push doesn't get to pick and choose,
 *  it gets the whole picture each time, same as loading the page does. */
function snapshot() {
  const d = gather();
  const out = {};
  for (const [name, handler] of Object.entries(HANDLERS)) {
    out[name.replace(/^\/api\//, '')] = handler(d);
  }
  return out;
}

// ── Push, for /api/stream ──
//
// Watches the two files a collection pass actually rewrites, rather than
// the collector telling this process anything directly — there's no
// coupling between the two beyond files, same as everywhere else in this
// project, and it means the API doesn't care whether the collector is
// running right now, was launched five minutes ago, or isn't running at
// all yet.
//
// fs.watch fires more than once for a single write on some platforms
// (temp-file-then-rename is a common pattern that trips it), so this
// debounces before actually reacting. And a collection pass that changed
// NOTHING still rewrites both files (a fresh timestamp, same content) —
// so what actually decides whether to push is a plain equality check
// against the last snapshot sent, not "a file changed at all".
let sseClients = [];
let lastBroadcast = null;

function broadcastIfChanged() {
  let data;
  try {
    data = snapshot();
  } catch (e) {
    console.error('snapshot failed, not broadcasting:', e.message);
    return;
  }
  // collectedAt/minutesAgo drift on their own, every single collection
  // pass, even one that fetched nothing new — the file still gets
  // rewritten with a fresh mtime. Comparing the raw snapshot against
  // that would mean this never actually stays quiet, so the comparison
  // is done with them zeroed out. The real values still go out in what's
  // actually sent, so a client still knows how fresh this is.
  const comparable = JSON.stringify({
    ...data,
    status: { ...data.status, collectedAt: null, minutesAgo: null },
  });
  if (comparable === lastBroadcast) return;
  lastBroadcast = comparable;
  const payload = JSON.stringify(data);
  for (const res of sseClients) res.write(`event: update\ndata: ${payload}\n\n`);
}

function watchForChanges() {
  let timer = null;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(broadcastIfChanged, 400);
  };
  // Watching the files, not the directory: STATE_FILE/STREAM_FILE may not
  // exist yet on a fresh install (no collection has run), and fs.watch
  // throws immediately on a path that isn't there. Falls back to polling
  // every 5s until the file shows up, then switches to the real watch.
  for (const file of [STATE_FILE, STREAM_FILE]) {
    const tryWatch = () => {
      if (!fs.existsSync(file)) { setTimeout(tryWatch, 5000); return; }
      try {
        fs.watch(file, debounced);
      } catch (e) {
        console.error(`could not watch ${file}, push disabled for it:`, e.message);
      }
    };
    tryWatch();
  }
}

// ── Heartbeat, separate from broadcastIfChanged() above ──
//
// broadcastIfChanged() only pushes when something actually differs — on
// purpose, so the common case (checked, found nothing new) doesn't push
// every ten minutes. Correct for the data itself, but it leaves a
// push-only client (see CONTRIBUTING.md's Home API section — that's the
// whole design of the Home Assistant integration this was built for) no
// way to tell "still checking, genuinely nothing new" apart from
// "stopped running an hour ago". Both look identical to a client that
// only ever hears about real changes.
//
// A heartbeat closes that gap without giving push-only up. Its own
// event name, its own timer, sent regardless of whether a collection
// pass changed anything — a client tells it apart from a real update by
// the SSE event name alone (`event: heartbeat` vs `event: update`), and
// treats it as a freshness signal, not new data. Carries only
// /api/status — the counts and timestamps, not a repeat of everything
// the real update event already sends.
const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute

function sendHeartbeat() {
  if (!sseClients.length) return; // no one listening — nothing to compute
  let status;
  try {
    status = HANDLERS['/api/status'](gather());
  } catch (e) {
    console.error('heartbeat: could not gather status, skipping this one:', e.message);
    return;
  }
  const payload = JSON.stringify(status);
  for (const res of sseClients) res.write(`event: heartbeat\ndata: ${payload}\n\n`);
}

function start() {
  const args = process.argv;
  const onNetwork = args.includes('--network');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 && args[portIndex + 1]
    ? Number(args[portIndex + 1]) : DEFAULT_PORT;
  const host = onNetwork ? '0.0.0.0' : '127.0.0.1';

  // Idempotent — 21-notifier-actions.js already generates these before
  // ever spawning this process, but `node 17-api.js` run by hand
  // (still fully supported, see the file's own top comment) needs this
  // to happen somewhere, and there's no harm calling it twice.
  try {
    ensureCert();
    ensureToken();
  } catch (e) {
    console.error('Could not generate a TLS certificate (is openssl on PATH?):', e.message);
    process.exit(1);
  }

  const server = https.createServer({
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  }, (req, res) => {
    // Strip "?whatever": an address with a query string should still work.
    //
    // And DECODE IT. Handles are named in Latin now, but this used to
    // matter a lot back when they were Russian: over the network the
    // address arrives percent-encoded. Without decodeURIComponent no
    // handle would ever match — confirmed on a live server right after
    // writing this. The same trap that bit the id in the old
    // "not-urgent.txt" file.
    const raw = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    let urlPath = raw;
    try { urlPath = decodeURIComponent(raw); } catch { /* broken encoding — look up as-is */ }

    // Allow reading this from pages in a browser: without it, a page of
    // your own on your phone would run into the cross-origin block.
    res.setHeader('Access-Control-Allow-Origin', '*');

    const respond = (status, body) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(status).end(JSON.stringify(body, null, 2));
    };

    // A browser's own CORS preflight for a POST write handle — answered
    // BEFORE the token check, not after. A preflight OPTIONS deliberately
    // never carries the Authorization header (that's the whole point of
    // it — the browser is asking permission before it sends anything real),
    // so checking it here would fail every single preflight and the real
    // POST behind it would never even get sent.
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204).end();
      return;
    }

    // EVERY route needs the token, root included — this API only exists
    // to read out (and now write) personal data, so there's no handle
    // worth leaving open just for discoverability.
    if (!isAuthorized(req)) {
      return respond(401, { error: 'missing or wrong bearer token' });
    }

    const writeHandler = WRITE_HANDLERS[urlPath];
    if (writeHandler) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return respond(405, { error: 'this handle changes something — POST only' });
      }
      readJsonBody(req)
        .then((body) => {
          const result = writeHandler(body);
          respond(result.status, result.body);
        })
        .catch((e) => respond(400, { error: e.message }));
      return;
    }

    // Everything past here only reads — reject anything but GET the same
    // way the write handles above reject anything but POST, rather than
    // silently treating a POST to a read handle as if it meant something.
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return respond(405, { error: 'this handle only reads — GET only' });
    }

    if (urlPath === '/') return respond(200, index());

    if (urlPath === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Sends the current state immediately, THEN only again on change —
      // a client that just connected shouldn't have to wait for the next
      // collection pass to find out anything at all.
      res.write(`event: update\ndata: ${JSON.stringify(snapshot())}\n\n`);
      sseClients.push(res);
      req.on('close', () => { sseClients = sseClients.filter(r => r !== res); });
      return;
    }

    const handler = HANDLERS[urlPath];
    if (!handler) {
      return respond(404, {
        error: 'no such handle',
        handles: Object.keys(HANDLERS),
        writes: Object.keys(WRITE_HANDLERS),
      });
    }

    try {
      respond(200, handler(gather()));
    } catch (e) {
      // One handle crashing shouldn't take the server down: it runs for
      // hours at a time, and an error might come from a broken file that
      // the next collection will overwrite anyway.
      console.error(`error on ${urlPath}: ${e.message}`);
      respond(500, { error: e.message });
    }
  });

  // A port already in use is usually a forgotten previous run. Print one
  // clear line instead of a twenty-line stack: whoever sees it should
  // know exactly what to do.
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use — probably already running.`);
      console.error(`See who: lsof -i :${port}`);
      console.error(`Kill the old one: pkill -f 17-api.js`);
      console.error(`Or pick another port: node 17-api.js --port ${port + 1}`);
      process.exit(1);
    }
    throw e;
  });

  server.listen(port, host, () => {
    // Written AFTER listen succeeds, not before — a pid file for a
    // process that then immediately died on EADDRINUSE (see the error
    // handler above) would tell 21-notifier-actions.js this server is
    // running when the real one never even started.
    writePid();
    console.log(`Home API listening on https://${host}:${port}`);
    console.log(`Bearer token (needed on every request): ${currentToken()}`);
    console.log(`Certificate fingerprint (pin this, don't trust it blind): ${certFingerprint()}`);
    if (onNetwork) {
      const addresses = Object.values(os.networkInterfaces()).flat()
        .filter(iface => iface && iface.family === 'IPv4' && !iface.internal)
        .map(iface => iface.address);
      console.log(`VISIBLE TO THE WHOLE NETWORK. Addresses: ${addresses.join(', ') || 'none found'}`);
      console.log('Encrypted and token-gated, but still only open this to a network you trust.');
    } else {
      console.log('This computer only. For the home network: --network');
    }
    console.log(`Handles: ${Object.keys(HANDLERS).join(' ')} /api/stream`);
    console.log(`Writes (POST): ${Object.keys(WRITE_HANDLERS).join(' ')}`);
    watchForChanges();
    // .unref() — this timer alone shouldn't be what keeps the process
    // alive; the HTTPS server already does that on its own.
    setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
  });

  // The settings-panel toggle stops this process with SIGTERM (see
  // stopApiServer() in 21-notifier-actions.js) — without a handler, the
  // default behavior still exits, but skips this and leaves the pid file
  // behind, which would make isServerRunning() think a dead process is
  // still the API right up until something happens to check its pid and
  // find it gone. Cleaning up here means that never has a chance to lie.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { clearPid(); process.exit(0); });
  }
}

module.exports = { HANDLERS, WRITE_HANDLERS, gather, toPublic, snapshot };
if (require.main === module) start();
