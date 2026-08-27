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

  // Path to the browser executable — override only. Empty (default) —
  // uses this project's own Brave from .browser/ if it's installed
  // (npm run setup-browser), otherwise the system's Google Chrome.
  // Do NOT point this at a browser you use every day: see 20-browser.js
  // for why that can cost you your cookies and extensions.
  browserPath: '',
};

const TYPES = {
  email: 'string', canvas: 'string', language: 'language',
  account: 'number', classTimeoutMs: 'number', emptyTimeoutMs: 'number',
  passLimitMs: 'number', apiPort: 'number',
  summaryHours: 'numbers', exclusions: 'strings', browserPath: 'string',
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

  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, why: 'needs to be a number' };
    return { ok: true, value: n };
  }
  if (kind === 'language') {
    const l = String(raw).trim().toLowerCase();
    if (l !== 'ru' && l !== 'en') return { ok: false, why: 'language is ru or en' };
    return { ok: true, value: l };
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

function write(key, raw) {
  const v = validate(key, raw);
  if (!v.ok) return v;

  const current = read();
  current[key] = v.value;
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return { ok: true, value: v.value };
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
  const rejected = [];
  const current = read();

  for (const [key, value] of Object.entries(parsed)) {
    const v = validate(key, value);
    if (v.ok) { current[key] = v.value; accepted.push(key); }
    else rejected.push(`${key}: ${v.why}`);
  }

  if (accepted.length) fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return { ok: accepted.length > 0, accepted, rejected };
}

module.exports = { read, write, validate, writeExample, applyBatch,
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
