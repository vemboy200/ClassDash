/**
 * Settings, all in one place.
 *
 * ── Why ──
 *
 * Before this, the school email, the Canvas address, and the wait timeouts
 * were written directly into the code, across four different files. While
 * the system lived on one laptop, that hurt nobody. But you can't publish
 * something like that: a stranger downloads the project and gets the
 * original user's email and class ids, and to run it themselves they'd
 * have to go edit the source.
 *
 * Now everything personal lives in `settings.json`, with `settings.example.json`
 * next to it — empty fields, safe to check into the repo.
 *
 * ── How to change it ──
 *
 *   through the gear icon on the summary page (easiest)
 *   node 19-settings.js --set email kto@to.net
 *   node 19-settings.js            (no args — prints current settings)
 *   by hand in settings.json
 *
 * ── Why the file might not exist ──
 *
 * And that's FINE. No file — defaults are used, the system still works.
 * Settings shouldn't be the thing nothing runs without: someone who just
 * downloaded the project should see it alive, not a list of errors.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'settings.json');
const EXAMPLE = path.join(__dirname, 'settings.example.json');

/**
 * Default values. This is also the whole list of what can be configured
 * at all: a key not in this list can't be set from outside either.
 *
 * The `allowed` check isn't for show. Values arrive from the page via a
 * napominalka:// link — that is, from outside. Without a key whitelist,
 * anything could be written there under any name.
 */
const DEFAULTS = {
  // School email. Gets substituted into links as ?authuser=
  // Without it Google opens the class under the personal account and
  // says "Class not found" — confirmed by hand.
  email: '',

  // Account index in Google's multi-login inside the Playwright profile.
  // The profile is dedicated and has one account in it, hence 0.
  account: 0,

  // School Canvas address. Empty — Canvas isn't read at all.
  canvas: '',

  // The two ways of reading Canvas, each with its own switch. Both on by
  // default, which is what makes existing installs (an address, no token)
  // keep reading exactly as before with no migration:
  //   canvasApiEnabled  — with an access token filled in, Canvas is read
  //                       through the API: no browser, no sign-in.
  //   canvasSsoEnabled  — Canvas is read through the browser's signed-in
  //                       session (the Google single sign-on way). With the
  //                       API on AND filled in, this is only the FALLBACK,
  //                       used when the API can't be read (a token that has
  //                       expired, say); otherwise it's the way.
  // Both need the address above. See canvasPlan() below.
  canvasApiEnabled: true,
  canvasSsoEnabled: true,

  // Canvas access token — Canvas → Account → Settings → "New Access Token".
  // What ClassDash signs in to Canvas's API with (10-canvas.js). It acts as
  // the person for everything they can do in Canvas, so it's a credential:
  // masked in the panel, never logged, never copied into another file (the
  // "what was applied" record below keeps only a fingerprint of it).
  canvasToken: '',

  // Interface language: ru or en.
  language: 'ru',

  // Full-summary hours: reminds about everything on fire at these hours.
  summaryHours: [8, 18],

  // Classes that don't need reading. By name, as in Classroom.
  exclusions: [],

  // Wait timeouts, milliseconds.
  classTimeoutMs: 60000,   // a normal class
  emptyTimeoutMs: 8000,    // a class that never had any assignments
  passLimitMs: 300000,     // longer than this — treated as hung and aborted

  // Home API port.
  apiPort: 8734,

  // Whether Google Classroom is read at all. On by default: it's what this
  // project started as, and everyone who set it up before this existed has
  // it. Turning it off is what lets a school that only uses Canvas run with
  // NO BROWSER at all — Classroom and Edpuzzle are the two sources that
  // can't be read without one (Canvas can, with an access token), so with
  // both off and a token set there's nothing left to launch one for. The
  // school email then has no use either. See browserNeeded() in
  // 05-playwright-draft.js.
  classroomEnabled: true,

  // The little key shown beside each filter (and the shortcut in the header
  // buttons' tooltips) for the keyboard shortcuts in 08-page.js. Only the
  // hints: the shortcuts themselves work either way.
  showKeyHints: true,

  // Off by default — this is the actual opt-in for 17-api.js. Even
  // read-only, it's real personal data (school, teachers, assignment
  // text) reachable over the network, so it shouldn't start just because
  // the project is installed. Toggling this on/off from the settings
  // panel starts or stops the server itself — see startApiServer()/
  // stopApiServer() in 21-notifier-actions.js — not just whether it
  // WOULD run if launched by hand.
  apiEnabled: false,

  // TRUE by default — unlike apiEnabled itself, which stays off until
  // someone deliberately turns the whole API on. This is the actual
  // --network flag, deciding whether 17-api.js binds 127.0.0.1 (this
  // computer only) or 0.0.0.0 (reachable from anything on the LAN — a
  // phone, a Home Assistant box on a different device). Localhost-only
  // as the default here would make apiEnabled mostly pointless for its
  // main real use case: something like Home Assistant runs on a
  // DIFFERENT device almost by definition, and a 127.0.0.1-bound server
  // refuses every connection that doesn't originate on the same
  // machine, no matter what address the client tries. The actual
  // security boundary here is TLS + the bearer token (see
  // 23-api-security.js), not which interface the socket happens to be
  // bound to — so defaulting this closed wouldn't really be protecting
  // anything, just making the one thing people turn this on FOR not
  // work out of the box. Previously there was no toggle for this at
  // all: the settings-panel apiEnabled switch never passed --network no
  // matter what, and reaching it from another device required running
  // `node 17-api.js --network` by hand, outside the app entirely.
  // Confirmed live: a Home Assistant integration pointed at this
  // computer's LAN address got nothing back until this was set.
  apiNetwork: true,

  // Path to the browser executable — override only. Empty (default) —
  // uses this project's own Brave from .browser/ if it's installed
  // (npm run setup-browser), otherwise the system's Google Chrome.
  // Do NOT point this at a browser you use every day: see 20-browser.js
  // for why that can cost you your cookies and extensions.
  browserPath: '',

  // An assignment with no due date at all still needs doing, so by
  // default it's treated as due tomorrow — see the comment in
  // sortIntoBuckets in 05-playwright-draft.js for why. Set this to false
  // to instead treat undated assignments like materials: shown once,
  // never marked as due soon.
  treatUndatedAsUrgent: true,

  // A class with no announcement and no assignment/material in
  // staleMonths, across ANY platform, gets treated as stale and skipped
  // going forward — the same idea Edpuzzle's own updatedAt check
  // started as (archiving a course on Classroom's side does nothing to
  // Edpuzzle's own class list, which keeps reporting it active
  // indefinitely — confirmed live, an actually-archived class's
  // updatedAt sat untouched for 11+ months while a real one updated
  // same-day), generalized: Classroom and Canvas classes go quiet for
  // the same real-world reason (the class ended, or was never really
  // active), they just don't have Edpuzzle's own native updatedAt field
  // to check, so staleness there is judged from this project's own
  // memory of what it's ever seen for that class instead — see
  // classLastActivity() in 05-playwright-draft.js.
  skipStaleClasses: true,

  // How long a class can go quiet before skipStaleClasses treats it as
  // stale. 1–12 months; the settings panel's slider enforces that range,
  // this default (3) matches what was previously hardcoded.
  staleMonths: 3,

  // Off by default: a class this project has NEVER recorded a single
  // announcement or assignment/material for (not "quiet for a while" —
  // genuinely nothing, ever) still gets listed by showEmptyClasses,
  // which can't tell "always been empty" apart from "quiet for now".
  // This is purely about what showEmptyClasses's fill-in shows — it
  // doesn't skip fetching the class the way skipStaleClasses does,
  // since a class with zero history yet might just be brand new.
  hideInactiveClasses: false,

  // Off by default: the class filter only ever lists classes that
  // currently have something due, overdue, or removed — a class with
  // nothing outstanding just doesn't appear. Turn this on to always list
  // every known class (Classroom, Canvas, and Edpuzzle) with a 0 next to
  // the ones with nothing going on, instead of them disappearing.
  showEmptyClasses: false,

  // Automatic fresh checks — the app's own scheduler (see
  // setupAutoFreshCheck() in 16-summary.swift), NOT the collector's own
  // every-10-minutes cron. 0 disables auto-fresh-checking for that
  // state entirely. Both off by default: a fresh check opens a visible
  // Edpuzzle browser window and takes about a minute, so this is
  // opt-in, not something that starts popping up windows the moment
  // someone updates.
  //
  // Two separate numbers because a fresh check firing on its own has a
  // real cost only while someone might actually be at the machine —
  // freshCheckAwakeMinutes (display on) can stay conservative or off,
  // freshCheckAsleepMinutes (display asleep — nobody there to
  // interrupt) can be much shorter without it mattering. "Asleep" here
  // means the DISPLAY specifically, not full system sleep — see that
  // function's own comment for why.
  freshCheckAwakeMinutes: 0,
  freshCheckAsleepMinutes: 0,

  // TRUE by default — unlike the two minute settings above, which
  // default OFF. Once someone has actually turned auto-fresh-checking
  // on for either state, running it only while plugged in is the safer
  // posture: it means a laptop can never have this feature quietly
  // draining its battery, without needing to think about it or tune
  // the interval down to compensate. Checked via IOKit's power-source
  // API (isOnACPower() in 16-summary.swift), not device-model-sniffed
  // — a desktop with no battery at all always reads as "on AC" from
  // that API, so this is a genuine no-op there, never something that
  // needs turning off just because the machine happens to be a Mac mini.
  freshCheckOnlyWhenCharging: true,

  // TRUE by default — Edpuzzle collection is opt-OUT, not opt-in,
  // unlike Canvas (which is naturally off until an address is typed
  // in). At some schools every Edpuzzle assignment a teacher posts also
  // gets announced through Google Classroom, making Edpuzzle itself
  // redundant to actually fetch — and fetching it isn't free: it's the
  // one platform that needs a real, visible browser window (see
  // 11-edpuzzle.js), so turning this off also means a full check no
  // longer ever needs to switch desktops. Turning it off here overrides
  // BOTH triggers that would otherwise read it — the twice-daily digest
  // hours and a manual Fresh check alike (see withEdpuzzle in
  // 05-playwright-draft.js) — since "I don't need Edpuzzle" means just
  // that, not "except when I click the button myself".
  edpuzzleEnabled: true,

  // Diagnostics forwarding — purely a development aid, off by default
  // (empty URL) and deliberately NOT exposed in the settings panel UI:
  // nothing an ordinary user needs to see or toggle, just two raw
  // settings.json fields a developer sets by hand (or `node
  // 19-settings.js --set`, or a direct /api/settings call) when they
  // want a specific install's own console output showing up on another
  // computer's ClassDash in real time — see 27-diagnostics-forward.js
  // and /api/diagnostics/logs in 17-api.js. diagnosticsForwardUrl is
  // the OTHER computer's own Home API address (e.g.
  // https://192.168.1.50:8734); diagnosticsForwardToken is THAT
  // computer's bearer token, not this one's — a separate credential
  // this install needs to authenticate itself as an outbound client,
  // same as any other Home API caller would.
  diagnosticsForwardUrl: '',
  diagnosticsForwardToken: '',

  // The two view toggles at the bottom of the filter panel ("show muted
  // and hidden", "show removed"). They lived only in the page's DOM, so
  // every refresh — including the automatic one when the app comes back
  // to the front — put them back to off. Stored here, not in the
  // browser's own storage: the page is a file:// document, where that
  // storage isn't reliably kept across launches, while this file is.
  // Not shown in the settings panel — the toggles themselves are the UI.
  filterShowHidden: false,
  filterShowRemoved: false,

  // Which class / type / due-range boxes in the filter panel are UNCHECKED.
  // The unchecked ones, not the checked ones, on purpose: the options on
  // offer change with the data (a new class appears, a range empties), and
  // "everything is on unless you turned it off" is the only shape that
  // still means the right thing when they do — a class that shows up next
  // week starts checked, instead of silently missing from a saved list of
  // what was checked. See the filterState kind in validate() below.
  filterUnchecked: { cls: [], type: [], days: [] },
};

const TYPES = {
  email: 'string', canvas: 'string', canvasToken: 'token', language: 'language',
  account: 'number', classTimeoutMs: 'number', emptyTimeoutMs: 'number',
  treatUndatedAsUrgent: 'boolean', skipStaleClasses: 'boolean',
  showEmptyClasses: 'boolean', hideInactiveClasses: 'boolean',
  apiEnabled: 'boolean', apiNetwork: 'boolean',
  staleMonths: 'staleMonths',
  passLimitMs: 'number', apiPort: 'number',
  freshCheckAwakeMinutes: 'freshCheckInterval', freshCheckAsleepMinutes: 'freshCheckInterval',
  freshCheckOnlyWhenCharging: 'boolean', edpuzzleEnabled: 'boolean', classroomEnabled: 'boolean',
  canvasApiEnabled: 'boolean', canvasSsoEnabled: 'boolean', showKeyHints: 'boolean',
  summaryHours: 'numbers', exclusions: 'strings', browserPath: 'string',
  diagnosticsForwardUrl: 'string', diagnosticsForwardToken: 'string',
  filterShowHidden: 'boolean', filterShowRemoved: 'boolean',
  filterUnchecked: 'filterState',
};

function read() {
  const result = { ...DEFAULTS };
  if (!fs.existsSync(FILE)) return result;
  try {
    const own = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const key of Object.keys(DEFAULTS)) {
      if (own[key] !== undefined && own[key] !== null) result[key] = own[key];
    }
  } catch (e) {
    // A broken file shouldn't stop the collection run: say so and carry
    // on with defaults. Staying silent here isn't an option — the person
    // will be left guessing why their edit didn't take effect.
    console.warn(`couldn't parse settings.json (${e.message}) — falling back to defaults`);
  }
  return result;
}

/**
 * Validates and coerces a value into its proper shape.
 * Returns {ok, value} or {ok: false, why}.
 */
function validate(key, raw) {
  if (!(key in DEFAULTS)) return { ok: false, why: `no such setting: ${key}` };
  const kind = TYPES[key];

  if (kind === 'filterState') {
    // {cls: [...], type: [...], days: [...]} — each a list of the values
    // left unchecked. Anything else is refused rather than trimmed: this
    // arrives from the page, and the caps keep a broken or hostile one
    // from making settings.json enormous. A string is parsed first so
    // `--set filterUnchecked '{"cls":[]}'` works from the command line.
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch { return { ok: false, why: 'needs to be JSON like {"cls":[],"type":[],"days":[]}' }; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, why: 'needs to be an object of lists' };
    }
    const out = { cls: [], type: [], days: [] };
    for (const group of Object.keys(out)) {
      const list = obj[group] === undefined ? [] : obj[group];
      if (!Array.isArray(list) || list.length > 500 ||
          list.some(v => typeof v !== 'string' || v.length > 300)) {
        return { ok: false, why: group + ' needs to be a list of up to 500 short strings' };
      }
      out[group] = list;
    }
    return { ok: true, value: out };
  }
  if (kind === 'staleMonths') {
    // A whole number of months, 1–12 — matching the settings panel's
    // own slider exactly, so nothing outside what the UI can even
    // produce gets silently accepted from some other caller.
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 12) {
      return { ok: false, why: 'needs to be a whole number of months, 1 to 12' };
    }
    return { ok: true, value: n };
  }
  if (kind === 'freshCheckInterval') {
    // 0 (off) or at least 10 minutes — nothing in between. A Fresh
    // check opens a real browser window and takes about a minute on
    // its own; a plain 'number' here used to accept literally any
    // positive value, including something like 5. Confirmed live: 5
    // minutes, sustained for a few hours while the display was asleep,
    // meant a full Chromium-based browser launch and teardown roughly
    // every 5-8 minutes around the clock — real memory pressure into
    // swap and a pile of leftover Brave helper processes, bad enough
    // the user had to force-quit them by hand. 10 minutes leaves real
    // margin over that ~1-minute runtime instead of asking the
    // previous launch to barely finish before the next one starts.
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, why: 'needs to be a number' };
    if (n > 0 && n < 10) return { ok: false, why: 'needs to be 0 (off) or at least 10 minutes' };
    return { ok: true, value: n };
  }
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, why: 'needs to be a number' };
    return { ok: true, value: n };
  }
  if (kind === 'token') {
    // Trimmed like every string, and refused if anything is left inside
    // that isn't part of a token: a token is one unbroken run of characters,
    // so a space or a line break means more than the token got pasted (a
    // whole sentence of instructions, say), and sending that as a header
    // would just fail in a confusing way later.
    const t = String(raw).trim();
    if (/\s/.test(t)) return { ok: false, why: 'a token has no spaces or line breaks — paste just the token' };
    return { ok: true, value: t };
  }
  if (kind === 'language') {
    const l = String(raw).trim().toLowerCase();
    if (l !== 'ru' && l !== 'en') return { ok: false, why: 'language is ru or en' };
    return { ok: true, value: l };
  }
  if (kind === 'boolean') {
    if (raw === true || raw === false) return { ok: true, value: raw };
    const b = String(raw).trim().toLowerCase();
    if (b === 'true' || b === '1') return { ok: true, value: true };
    if (b === 'false' || b === '0') return { ok: true, value: false };
    return { ok: false, why: 'needs to be true or false' };
  }
  if (kind === 'numbers') {
    // This kind only describes "full-summary hours", so the check is
    // hour-shaped: an integer from 0 to 23.
    //
    // This used to be a plain Number.isFinite check, and an empty field
    // produced NOT an empty list but [0]: "".split(/[,\s]+/) returns [""],
    // and Number("") is zero. So clearing the field to turn reminders off
    // instead produced a summary at midnight — when launchd doesn't even
    // run anyway. Silent failure, no explanation.
    //
    // Empty pieces get dropped BEFORE Number(): they're exactly what turned
    // an empty field into zero. This also catches typos: "25" and "morning"
    // used to be accepted silently.
    const parts = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
      .map(p => String(p).trim()).filter(p => p !== '');
    const numbers = parts.map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 23);
    if (parts.length && !numbers.length) return { ok: false, why: 'hours run from 0 to 23' };
    return { ok: true, value: numbers };
  }
  if (kind === 'strings') {
    const parts = Array.isArray(raw) ? raw : String(raw).split(/\s*[,;]\s*/);
    return { ok: true, value: parts.map(s => String(s).trim()).filter(Boolean) };
  }
  return { ok: true, value: String(raw).trim() };
}

// ── What the last collection actually used ──
//
// Two settings only take effect when the next collection runs: which
// classes are skipped (exclusions) and where Canvas lives (canvas). Saving
// them changes settings.json at once, but nothing on the page — the
// collection is what purges an excluded class's data or starts reading a
// new Canvas. So the page needs to know when the file and the data have
// drifted apart, to offer a fresh check instead of leaving the person
// wondering why the class is still there.
//
// The collection records what it READ at the start (not what the file says
// by the time it finishes), and "pending" is just the difference. A
// difference, not a flag set on save, so putting a setting back the way it
// was makes the notice go away by itself, and a setting changed while a
// collection is mid-run correctly stays pending.
const APPLIED_FILE = path.join(__dirname, 'fetch-applied.json');
const FETCH_AFFECTING = ['exclusions', 'canvas', 'canvasToken', 'classroomEnabled',
                         'canvasApiEnabled', 'canvasSsoEnabled'];

// Settings that are secrets. The record of what a collection used is a file
// of its own, and a token has no business being copied into a second place
// — so for these the record keeps a fingerprint, and comparing works on
// fingerprints. An empty value fingerprints to the empty string, which is
// also what an older record without the key reads as, so nobody gets a
// "needs a fresh check" notice the day they update.
const SECRET_KEYS = ['canvasToken'];
const fingerprint = v => {
  const t = String(v || '').trim();
  return t ? require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 16) : '';
};
// What the record holds for a value — and so what a current value is
// compared as: for a secret, the fingerprint on both sides.
const recordable = (key, v) => SECRET_KEYS.includes(key) ? fingerprint(v) : v;

// Compared as values: the order exclusions were ticked in doesn't matter,
// nor does stray whitespace around an address.
const normalizeForCompare = (key, v) =>
  key === 'exclusions' ? [...(v || [])].sort()
    // Not `v || ''`: that would read false as empty, and a switch turned off
    // has to differ from the default of on.
    : (v === undefined || v === null ? '' : String(v)).trim();

function readApplied() {
  try {
    const own = JSON.parse(fs.readFileSync(APPLIED_FILE, 'utf8'));
    const out = {};
    for (const key of FETCH_AFFECTING) out[key] = own[key] !== undefined ? own[key] : recordable(key, DEFAULTS[key]);
    return out;
  } catch { return null; }
}

/** Called by the collection once it has really read with these values. */
function markApplied(values) {
  const out = {};
  for (const key of FETCH_AFFECTING) out[key] = recordable(key, values[key]);
  fs.writeFileSync(APPLIED_FILE, JSON.stringify(out, null, 2));
}

// A project that has never recorded a collection has nothing to compare
// against, and a page that treated "no record" as "everything pending"
// would nag every existing install the day it updates. So the record is
// started from the file as it is BEFORE the first change — which is what
// the last collection used, as far as anyone can tell.
function seedApplied(current) {
  if (fs.existsSync(APPLIED_FILE)) return;
  try { markApplied(current); } catch { /* not fatal: no notice, same as before this existed */ }
}

/** The fetch-affecting settings as the collected data reflects them. */
function appliedFetchSettings(settings = read()) {
  return readApplied() || settings;
}

/** Which of them differ from what the last collection used. */
function pendingFetchKeys(settings = read()) {
  const applied = readApplied();
  if (!applied) return [];
  return FETCH_AFFECTING.filter(key =>
    JSON.stringify(normalizeForCompare(key, recordable(key, settings[key]))) !==
    JSON.stringify(normalizeForCompare(key, applied[key])));
}

function write(key, raw) {
  const v = validate(key, raw);
  if (!v.ok) return v;

  const current = read();
  seedApplied(current);
  current[key] = v.value;
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return { ok: true, value: v.value };
}

/**
 * How Canvas is read, from the address, the two switches and the token —
 * the one place that decides, so the collection, the login flow, the
 * status dots and the settings page can't disagree.
 *
 *   enabled  there's an address and at least one way switched on
 *   api      the access token WILL be used: switched on and filled in
 *   sso      the browser session is allowed: as the fallback when `api`,
 *            otherwise as the way
 *
 * Takes a settings object because callers ask about different ones: the
 * file as it is now, or what the last collection actually used.
 */
function canvasPlan(settings = read()) {
  const address = !!String(settings.canvas || '').trim();
  const apiOn = settings.canvasApiEnabled !== false;
  const sso = settings.canvasSsoEnabled !== false;
  const api = apiOn && !!String(settings.canvasToken || '').trim();
  // Off is off all the way down, so no caller has to remember to check
  // `enabled` before trusting the other two.
  if (!address || !(apiOn || sso)) return { enabled: false, api: false, sso: false };
  return { enabled: true, api, sso };
}

/** Example for the repository: same keys, nothing personal. */
function writeExample() {
  const example = { ...DEFAULTS };
  example.email = 'your.school@email.example';
  example.canvas = 'https://your-school.instructure.com';
  fs.writeFileSync(EXAMPLE, JSON.stringify(example, null, 2));
  return EXAMPLE;
}

/**
 * Applies a batch of settings that arrived from the summary page.
 *
 * ── Why a batch, and why base64 ──
 *
 * The page can't write to disk, so it calls the notifier through a
 * napominalka:// link — the same way "not urgent" and "hide" do. But
 * those only carried one short id, while this one carries an email, a
 * school address, and a list of exclusions: slashes, colons, commas, an
 * at-sign. In a URL, all of that means something and falls apart.
 *
 * base64 turns the batch into a harmless run of letters — one single
 * chunk, nothing to split apart. This isn't encryption and hides nothing:
 * anyone can decode it. The only job is getting the URL there in one piece.
 *
 * ── What gets checked here ──
 *
 * EVERYTHING. Values arrive from outside, from a URL, so:
 *   - does it even parse as JSON;
 *   - is the key on the whitelist (unknown ones are silently dropped);
 *   - does the value fit its kind (a number as a number, a language from
 *     the two known ones).
 *
 * The notifier passes the chunk through in quotes (`quoted form of`), so a
 * shell command can't be smuggled in through it. Parsing happens here,
 * where real JSON exists for that, not in AppleScript.
 */
function applyBatch(chunk) {
  let parsed;
  try {
    // base64url -> regular base64: "+" and "/" mean something in a URL,
    // so the page sends them as "-" and "_" instead.
    const normal = String(chunk).replace(/-/g, '+').replace(/_/g, '/');
    parsed = JSON.parse(Buffer.from(normal, 'base64').toString('utf8'));
  } catch (e) {
    return { ok: false, why: 'could not parse: ' + e.message };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, why: 'expected a set of settings' };
  }

  const accepted = [];
  const changed = [];
  const rejected = [];
  const current = read();
  seedApplied(current);

  for (const [key, value] of Object.entries(parsed)) {
    const v = validate(key, value);
    if (!v.ok) { rejected.push(`${key}: ${v.why}`); continue; }
    accepted.push(key);
    // THE PAGE SENDS A FULL SNAPSHOT, NOT A DIFF.
    //
    // Every save includes every field on the settings panel, whether
    // the user touched it or not — so `accepted` alone can't tell
    // "this was written" apart from "this was already exactly this and
    // got written again". A caller that needs to know what actually
    // changed (21-notifier-actions.js decides whether a browser needs
    // launching based on it) needs THIS instead. Compared as JSON, not
    // ===, because these can be arrays (exclusions) where two separate
    // instances with the same contents are never === in JS.
    if (JSON.stringify(current[key]) !== JSON.stringify(v.value)) changed.push(key);
    current[key] = v.value;
  }

  if (accepted.length) fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return { ok: accepted.length > 0, accepted, changed, rejected };
}

module.exports = { read, write, validate, writeExample, applyBatch,
                   markApplied, appliedFetchSettings, pendingFetchKeys, canvasPlan,
                   DEFAULTS, TYPES, FILE };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--set' && args[1]) {
    const result = write(args[1], args.slice(2).join(' '));
    if (result.ok) console.log(`${args[1]} = ${JSON.stringify(result.value)}`);
    else { console.error(result.why); process.exit(1); }

  } else if (args[0] === '--from-url' && args[1]) {
    const result = applyBatch(args[1]);
    if (result.accepted && result.accepted.length) console.log('accepted: ' + result.accepted.join(', '));
    if (result.rejected && result.rejected.length) console.error('rejected: ' + result.rejected.join('; '));
    if (!result.ok) { console.error(result.why || 'nothing accepted'); process.exit(1); }

  } else if (args[0] === '--example') {
    console.log('written', writeExample());

  } else {
    console.log(JSON.stringify(read(), null, 2));
  }
}
