/**
 * The home API's TLS certificate, bearer token, and running-process
 * tracking — its own file, not part of 17-api.js.
 *
 * ── Why its own file ──
 *
 * Two different processes need this: 17-api.js itself (reads the token on
 * every request, writes its own pid on startup) and
 * 21-notifier-actions.js (starts/stops the server when the settings-panel
 * toggle changes, rolls the token when the page's "roll" button is
 * clicked). Neither should require the other — 21-notifier-actions.js
 * spawns 17-api.js as a detached child, requiring it directly would pull
 * in an http server it never runs. A third, leaf file both can require
 * avoids that, same reasoning as 22-class-activity.js.
 *
 * It also fixes a real race: generating the cert/token used to happen
 * lazily, inside 17-api.js's own start(), the first time the server
 * actually ran. If 21-notifier-actions.js just spawned that process and
 * moved on to redrawing the page — which reads these same files to show
 * the token in the settings panel — the redraw could easily win the
 * race and show nothing, or a client could ask before either file
 * existed. Generating them HERE, synchronously, before the server is
 * even spawned, means they're guaranteed to exist by the time anything
 * downstream looks for them.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const selfsigned = require('selfsigned');
const { PROJECT_ROOT } = require('./00-project-root.js');

const CERT_FILE = path.join(PROJECT_ROOT, 'api-cert.pem');
const KEY_FILE = path.join(PROJECT_ROOT, 'api-key.pem');
const TOKEN_FILE = path.join(PROJECT_ROOT, 'api-token.txt');
const PID_FILE = path.join(PROJECT_ROOT, 'api-server.pid');
// The app's own key (see ensureAppKey()).
const APP_KEY_FILE = path.join(PROJECT_ROOT, 'app-key.txt');

/** Generates the self-signed cert + key on first run only — never
 *  regenerated after, since a client pins the fingerprint of whatever
 *  it first saw, and a silent replacement would just lock them out.
 *
 *  USED TO SHELL OUT TO openssl, MATCHING THIS EXACT COMMAND:
 *  `openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes
 *  -subj /CN=classdash-local -keyout KEY_FILE -out CERT_FILE`. That's a
 *  real dependency macOS happens to have around (Xcode Command Line
 *  Tools) but Windows never ships at all — confirmed live: enabling the
 *  home API there failed outright ("node exited with status 1") because
 *  execFileSync('openssl', ...) couldn't find it. selfsigned (built on
 *  node-forge, pure JS, no native compilation) generates the exact same
 *  shape of cert without needing anything external — pinned to 4.x
 *  specifically, not ^4 or later: 5.0 made generate() async-only, which
 *  would ripple into making this whole file's caller chain
 *  (startApiServer() → main()'s 'config' case → both call sites that
 *  invoke main()) async too, for no benefit here. */
function ensureCert() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'classdash-local' }],
    { algorithm: 'sha256', days: 3650, keySize: 2048 }
  );
  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(CERT_FILE, pems.cert);
}

/** The fingerprint a client pins — same value openssl itself would
 *  print, computed the same way rather than shelling out twice for it.
 *  null if the certificate doesn't exist yet (API never started). */
function certFingerprint() {
  if (!fs.existsSync(CERT_FILE)) return null;
  const der = new crypto.X509Certificate(fs.readFileSync(CERT_FILE)).raw;
  return crypto.createHash('sha256').update(der).digest('hex')
    .replace(/(.{2})(?=.)/g, '$1:').toUpperCase();
}

/** Generates the bearer token on first run only. */
function ensureToken() {
  if (!fs.existsSync(TOKEN_FILE)) rollToken();
  // One made before key files were private (0644) is made private now.
  else try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* Windows, or a file system without modes */ }
}

/** The current token, or null if none has ever been generated. Read
 *  fresh from disk every time, not cached — 17-api.js checks this on
 *  every single request, and a roll needs to take effect on the very
 *  next one, not after a restart. */
function currentToken() {
  return fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : null;
}

/** Replaces the token with a new random one — "in case something
 *  happened": a leaked token, a client config shared somewhere it
 *  shouldn't have been. Anything already configured with the old token
 *  stops working immediately, on its very next request; there's no
 *  overlap period, on purpose — a roll is meant to actually cut off
 *  the old value, not just add a new one alongside it. */
function rollToken() {
  const token = crypto.randomBytes(32).toString('hex');
  writePrivate(TOKEN_FILE, token);
  return token;
}

/** Writes a key file only this user account can read (0600). The mode on
 *  writeFileSync only applies to a new file, so an existing one (made
 *  before this, with the default 0644) is chmodded too. Windows ignores
 *  the mode; a user's own folder there isn't readable by other accounts
 *  anyway. */
function writePrivate(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows, or a file system without modes */ }
}

// ── The app's own key ──
//
// A second key, next to the access key, that only the ClassDash app uses:
// it sets it as a cookie in its own window (an HttpOnly one, so the page's
// scripts can't read it) before loading the page from this server. A
// request carrying it is the app on this computer; one carrying the
// access key is anything else (a browser, Home Assistant). So the server
// can tell the two apart, and rolling the access key signs browsers and
// other devices out without signing out the app.
//
// It's never shown anywhere. Like the access key, anything running as this
// user account could read the file: it keeps browsers and other devices
// from passing as the app, not other programs on the same account.
function ensureAppKey() {
  if (!fs.existsSync(APP_KEY_FILE)) writePrivate(APP_KEY_FILE, crypto.randomBytes(32).toString('hex'));
}

function currentAppKey() {
  return fs.existsSync(APP_KEY_FILE) ? fs.readFileSync(APP_KEY_FILE, 'utf8').trim() : null;
}

/** The cookie a browser showing the page sends instead of the header: a
 *  page loaded by typing an address can't add an Authorization header to
 *  its own requests, its scripts or its images. Set by /login in 17-api.js,
 *  HttpOnly (the page's scripts can't read it), Secure, and SameSite=Strict
 *  (another website's page can't make the browser send it). */
const COOKIE_NAME = 'classdash_token';
// The app's own cookie, holding the app key (see ensureAppKey()).
const APP_COOKIE_NAME = 'classdash_app';

/** One cookie's value from a request, or ''. */
function cookieValue(req, name) {
  for (const part of (req.headers['cookie'] || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/** Timing-safe comparison of a given key with the expected one. */
function sameKey(given, expected) {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The token a request carries, from the Authorization header, or failing
 *  that the cookie. */
function givenToken(req) {
  const header = req.headers['authorization'] || '';
  const prefix = 'Bearer ';
  if (header.startsWith(prefix)) return header.slice(prefix.length);
  return cookieValue(req, COOKIE_NAME);
}

/** Whether a token is this install's access key, timing-safe. */
function isToken(given) {
  return sameKey(given, currentToken());
}

/** Who's asking: 'app' (the ClassDash app on this computer, by its app-key
 *  cookie), 'key' (anything with the access key: a browser, Home
 *  Assistant, a script), or null (not signed in). */
function clientKind(req) {
  if (sameKey(cookieValue(req, APP_COOKIE_NAME), currentAppKey())) return 'app';
  if (isToken(givenToken(req))) return 'key';
  return null;
}

/** Timing-safe, and tolerant of a missing/malformed header or cookie or a
 *  not-yet-generated key — those are just "not authorized", not a
 *  crash. */
function isAuthorized(req) {
  return clientKind(req) !== null;
}

/** When this computer last started, to the second or so: now minus how long
 *  it's been up. */
function bootTime() {
  return Date.now() - os.uptime() * 1000;
}

/** The server's pid, or null when there's no pid file, or it was written
 *  before this computer last restarted. A restart ends the server without
 *  it clearing its pid file, and the system then hands its old pid to
 *  whatever starts next (on Windows, often within seconds of booting), so
 *  a pid from before the restart is never the server, even when something
 *  answers to it. Trusting it used to keep the server from being started
 *  again after a reboot, and stopping it would have signalled an unrelated
 *  program. A pid file from before this check existed is a bare number,
 *  taken as it is. */
function readPid() {
  let text;
  try { text = fs.readFileSync(PID_FILE, 'utf8'); } catch { return null; }
  let pid, boot = null;
  try {
    const saved = JSON.parse(text);
    if (saved && typeof saved === 'object') { pid = saved.pid; boot = saved.boot; } else pid = saved;
  } catch { pid = parseInt(text, 10); }
  pid = parseInt(pid, 10);
  if (!pid) return null;
  // Uptime drifts a little against the wall clock (sleep, clock changes),
  // so only a gap of more than a few minutes means a restart.
  if (typeof boot === 'number' && Math.abs(boot - bootTime()) > 5 * 60 * 1000) return null;
  return pid;
}

/** Whether the server process this pid file points at is actually still
 *  alive — same "signal 0" check 05-playwright-draft.js's own
 *  acquireLock() uses for its collection lock, same reason: a crashed
 *  process leaves the file behind, and trusting its mere existence
 *  would make the toggle think the API is running when it isn't. */
function isServerRunning() {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Called by 17-api.js itself, once listening: its pid, and when this
 *  computer started (see readPid). */
function writePid() {
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, boot: Math.round(bootTime()) }));
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
}

module.exports = {
  CERT_FILE, KEY_FILE, TOKEN_FILE, PID_FILE,
  ensureCert, certFingerprint, ensureToken, currentToken, rollToken,
  APP_KEY_FILE, ensureAppKey, currentAppKey, APP_COOKIE_NAME, clientKind,
  COOKIE_NAME, isToken, isAuthorized, isServerRunning, readPid, writePid, clearPid,
};
