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
const { execFileSync } = require('child_process');

const CERT_FILE = path.join(__dirname, 'api-cert.pem');
const KEY_FILE = path.join(__dirname, 'api-key.pem');
const TOKEN_FILE = path.join(__dirname, 'api-token.txt');
const PID_FILE = path.join(__dirname, 'api-server.pid');

/** Generates the self-signed cert + key on first run only — never
 *  regenerated after, since a client pins the fingerprint of whatever
 *  it first saw, and a silent replacement would just lock them out. */
function ensureCert() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '3650',
    '-nodes', '-subj', '/CN=classdash-local',
    '-keyout', KEY_FILE, '-out', CERT_FILE,
  ], { stdio: 'ignore' });
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
  fs.writeFileSync(TOKEN_FILE, token);
  return token;
}

/** Timing-safe, and tolerant of a missing/malformed header or a
 *  not-yet-generated token — those are just "not authorized", not a
 *  crash. */
function isAuthorized(req) {
  const token = currentToken();
  if (!token) return false;
  const header = req.headers['authorization'] || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Whether the server process this pid file points at is actually still
 *  alive — same "signal 0" check 05-playwright-draft.js's own
 *  acquireLock() uses for its collection lock, same reason: a crashed
 *  process leaves the file behind, and trusting its mere existence
 *  would make the toggle think the API is running when it isn't. */
function isServerRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Called by 17-api.js itself, once listening. */
function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
}

module.exports = {
  CERT_FILE, KEY_FILE, TOKEN_FILE, PID_FILE,
  ensureCert, certFingerprint, ensureToken, currentToken, rollToken,
  isAuthorized, isServerRunning, writePid, clearPid,
};
