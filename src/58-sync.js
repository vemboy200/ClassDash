/**
 * Sync between two of the same person's computers: one is the master, the
 * other follows it. The follower keeps its own server and its own copy of the
 * data, so it keeps working when the connection drops.
 *
 * This file is what both sides and every process need: what's copied, the
 * saved connection, talking to the other computer. The follower's running loop
 * is in 59-sync-follow.js, and the routes the master answers are in 17-api.js.
 *
 * ── What's copied ──
 *
 * Only the files named below, plus the settings in SHARED_SETTINGS. It's a list
 * of what IS copied rather than of what isn't, so a file added later stays on its
 * own computer until someone decides otherwise. In particular these never leave:
 * sign-ins and keys (browser-profile/, the Q password, tokens in settings.json),
 * and anything about the computer itself (its port, window, language, browser).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const { PROJECT_ROOT } = require('./00-project-root.js');
const security = require('./23-api-security.js');

const SYNC_FILE = path.join(PROJECT_ROOT, 'sync.json');
const STATUS_FILE = path.join(PROJECT_ROOT, 'sync-status.json');
const QUEUE_FILE = path.join(PROJECT_ROOT, 'sync-queue.json');
const PROPOSAL_FILE = path.join(PROJECT_ROOT, 'sync-proposal.json');
const PROPOSAL_MINUTES = security.PAIR_MINUTES;
const ASIDE_DIR = path.join(PROJECT_ROOT, 'before-sync');
const PHOTO_DIR = 'announcement-photos';
const PHOTO_NAME = new RegExp(`^${PHOTO_DIR}/[0-9a-f]{20}\\.[a-z0-9]{1,5}$`);

const COPIED_FILES = [
  'classes.json', 'canvas-classes.json', 'edpuzzle-classes.json',
  'messages.json', 'new.json',
  'class-activity.json', 'check-status.json',
  'school-calendar.json', 'school-schedule.json',
  'ai-scan.json',
  'grades.json', 'canvas-grades.json', 'classroom-grades.json', 'grade-history.json',
  'virtual-assignments.json', 'assignment-links.json',
  'не-срочно.txt', 'скрытые.txt', 'deleted-assignments.txt',
  // A check running on the master, so its progress shows here too.
  'live/check-run.json', 'live/check-run.js',
  // Last: the time of the last check comes from this file's date.
  'last-collection.json',
];

const SHARED_SETTINGS = [
  'exclusions', 'classLinks', 'assignmentLinksSameClass', 'treatUndatedAsUrgent',
  'skipStaleClasses', 'staleMonths', 'hideInactiveClasses', 'showEmptyClasses', 'gradesWeights',
];

// How long the follower's last word is believed by other processes. It rewrites
// the status at least every STATUS_EVERY_MS, so this means it isn't running.
const STATUS_EVERY_MS = 30 * 1000;
const STATUS_FRESH_MS = 90 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Written in one step, so another process never reads half of it. */
function writeJsonFile(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}

// ── The saved connection ──

/** {master: {fp, cert, key, name, account, localUrl, remoteUrl}, pending: same}.
 *  It holds a key, so it's private, like the other key files. `pending` is a
 *  computer paired with but not chosen yet. */
function readSync() {
  const saved = readJson(SYNC_FILE, null);
  return saved && typeof saved === 'object' ? saved : {};
}

function writeSync(value) {
  if (!value.master && !value.pending) { try { fs.unlinkSync(SYNC_FILE); } catch {} return; }
  writeJsonFile(SYNC_FILE, value);
}

function master() { return readSync().master || null; }
function isFollowing() { return !!master(); }

/** What this computer is to others, for its network announcement. */
function role() {
  if (isFollowing()) return 'follower';
  return security.listDevices().some(d => d.follower) ? 'master' : 'standalone';
}

// ── Status: what the follower's loop last knew ──

function readStatus(now = Date.now()) {
  const m = master();
  if (!m) return null;
  const status = readJson(STATUS_FILE, null);
  const base = { name: m.name, remote: !!m.remoteUrl };
  if (!status || !(now - status.at < STATUS_FRESH_MS)) return { ...base, state: 'cutOff', waiting: queue().length, lastSync: status ? status.lastSync || null : null };
  return { ...status, ...base, waiting: queue().length };
}

function writeStatus(status) {
  writeJsonFile(STATUS_FILE, { ...status, at: Date.now() });
}

/** Whether the master can be reached right now, as far as this computer knows. */
function isConnected(now = Date.now()) {
  const status = readStatus(now);
  return !!status && (status.state === 'synced' || status.state === 'syncing');
}

/** Why this computer shouldn't start an automatic check, or null. */
function checksHeldBack() {
  const m = master();
  if (!m) return null;
  if (isConnected()) return 'the master checks while connected';
  if (!sameAccount(m.account, accountKey())) return 'set up for a different account than the master';
  return null;
}

// ── Whose data this is ──

/** Fingerprints of the account set up here, never the addresses themselves, so
 *  two computers can compare without either saying who it is. Empty when not set.
 *  Separate, since a computer can have one set up and not the other. */
function accountKey(settings = require('./19-settings.js').read()) {
  const hash = (kind, value) => (value ? crypto.createHash('sha256').update(`classdash-account\n${kind}\n${value}`).digest('hex').slice(0, 32) : '');
  const email = String(settings.email || '').trim().toLowerCase();
  const canvas = String(settings.canvas || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { email: hash('email', email === 'your.school@email.example' ? '' : email), canvas: hash('canvas', canvas) };
}

/** Whether two computers could be the same person's. The email decides when both
 *  have one, since a person has one school email and Canvas can be reached by more
 *  than one address. Only something set on both can differ: missing isn't different. */
function sameAccount(a, b) {
  if (!a || !b) return true;
  if (a.email && b.email) return a.email === b.email;
  if (a.canvas && b.canvas) return a.canvas === b.canvas;
  return true;
}

/** The facts each computer shows when asking which should be the master. */
function facts() {
  const { computerName } = require('./36-api-discovery.js');
  const collected = path.join(PROJECT_ROOT, 'last-collection.json');
  let lastCheck = null, assignments = 0;
  try {
    lastCheck = fs.statSync(collected).mtimeMs;
    const items = JSON.parse(fs.readFileSync(collected, 'utf8'));
    assignments = Array.isArray(items) ? items.length : 0;
  } catch { /* never checked */ }
  const announcements = readJson(path.join(PROJECT_ROOT, 'messages.json'), []);
  return {
    name: computerName(),
    fingerprint: security.certFingerprint(),
    lastCheck,
    assignments,
    announcements: Array.isArray(announcements) ? announcements.length : 0,
    following: isFollowing(),
    // Also in the network announcement, but that can be blocked or not reach here.
    role: role(),
    account: accountKey(),
  };
}

// ── What's copied, and whether it changed ──

const hashes = new Map();
function hashOf(name, stat) {
  const known = hashes.get(name);
  if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(PROJECT_ROOT, name))).digest('hex');
  hashes.set(name, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
  return hash;
}

function listPhotos() {
  try {
    return fs.readdirSync(path.join(PROJECT_ROOT, PHOTO_DIR)).map(n => `${PHOTO_DIR}/${n}`).filter(n => PHOTO_NAME.test(n));
  } catch { return []; }
}

/** Every copied file here: {name: {hash, size, mtimeMs}}, and the shared
 *  settings. A photo's name already is a hash of it, so it isn't read. */
function manifest() {
  const files = {};
  for (const name of COPIED_FILES) {
    try {
      const stat = fs.statSync(path.join(PROJECT_ROOT, name));
      files[name] = { hash: hashOf(name, stat), size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
    } catch { /* not made yet */ }
  }
  for (const name of listPhotos()) files[name] = { hash: name, size: 0, mtimeMs: 0 };
  const store = require('./19-settings.js');
  const all = store.read();
  const settings = Object.fromEntries(SHARED_SETTINGS.map(key => [key, all[key]]));
  // Shared settings that decide what's collected, as the data here reflects them.
  const collectedWith = { exclusions: store.appliedFetchSettings(all).exclusions };
  const version = crypto.createHash('sha256').update(JSON.stringify({ files, settings, collectedWith })).digest('hex');
  return { version, files, settings, collectedWith };
}

/** Whether a name someone asked for is a copied file, and so may be sent. */
function isCopied(name) {
  return COPIED_FILES.includes(name) || PHOTO_NAME.test(name);
}

/** Whether a changed file in the project folder is one the follower cares about. */
function isWatched(name) {
  const normal = String(name).normalize('NFC');
  return COPIED_FILES.some(f => f.normalize('NFC') === normal);
}

/**
 * Brings this computer's copy in line with the master's. Everything changed is
 * fetched first and only then moved into place, so a connection dropping partway
 * leaves the old copy whole, not half of each. `fetchFile(name)` answers a Buffer.
 * Answers how many things changed.
 */
async function applyManifest(theirs, fetchFile) {
  const mine = manifest();
  const stage = [];
  try {
    for (const [name, file] of Object.entries(theirs.files)) {
      if (!isCopied(name)) continue;
      if (mine.files[name] && mine.files[name].hash === file.hash) continue;
      const data = await fetchFile(name);
      if (!PHOTO_NAME.test(name) && crypto.createHash('sha256').update(data).digest('hex') !== file.hash) {
        // It changed on the master while being sent; the next round gets it.
        throw Object.assign(new Error(`${name} changed while it was being copied`), { tryAgain: true });
      }
      const target = path.join(PROJECT_ROOT, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = path.join(path.dirname(target), `.sync-${crypto.randomBytes(6).toString('hex')}.tmp`);
      fs.writeFileSync(temp, data);
      stage.push({ temp, target, name, mtimeMs: file.mtimeMs });
    }
    // Photos first, so a card never points at one that isn't here yet, and the
    // order of COPIED_FILES after that.
    stage.sort((a, b) => order(a.name) - order(b.name));
    for (const s of stage) {
      fs.renameSync(s.temp, s.target);
      s.temp = null;
      if (s.mtimeMs) fs.utimesSync(s.target, new Date(s.mtimeMs), new Date(s.mtimeMs));
    }
  } finally {
    for (const s of stage) if (s.temp) { try { fs.unlinkSync(s.temp); } catch {} }
  }
  let changed = stage.length;
  // The same contents with a newer date: a check that found nothing new.
  for (const [name, file] of Object.entries(theirs.files)) {
    if (!isCopied(name) || !file.mtimeMs || !mine.files[name] || mine.files[name].hash !== file.hash) continue;
    if (mine.files[name].mtimeMs !== file.mtimeMs) {
      fs.utimesSync(path.join(PROJECT_ROOT, name), new Date(file.mtimeMs), new Date(file.mtimeMs));
      changed++;
    }
  }
  // Gone from the master, gone from here (a list emptied, an old photo cleared).
  for (const name of Object.keys(mine.files)) {
    if (theirs.files[name] || !isCopied(name)) continue;
    try { fs.unlinkSync(path.join(PROJECT_ROOT, name)); changed++; } catch {}
  }
  const settings = require('./19-settings.js');
  for (const key of SHARED_SETTINGS) {
    if (!(key in (theirs.settings || {}))) continue;
    if (JSON.stringify(mine.settings[key]) === JSON.stringify(theirs.settings[key])) continue;
    if (settings.write(key, theirs.settings[key]).ok) changed++;
  }
  for (const [key, value] of Object.entries(theirs.collectedWith || {})) {
    if (JSON.stringify(mine.collectedWith[key]) === JSON.stringify(value)) continue;
    settings.markOneApplied(key, value);
    changed++;
  }
  return changed;
}

function order(name) {
  return PHOTO_NAME.test(name) ? -1 : COPIED_FILES.indexOf(name);
}

/** Whether a check is running on this computer right now, whose files shouldn't
 *  be swapped underneath it. Its lock, not the live state, which on a follower may
 *  be the master's check. */
function isCheckingHere() {
  try {
    process.kill(parseInt(fs.readFileSync(path.join(PROJECT_ROOT, '.collection-lock'), 'utf8'), 10), 0);
    return true;
  } catch { return false; }
}

// ── This computer's own data, while it follows ──

/** Keeps this computer's data aside when it starts following, in case it was
 *  chosen by mistake or it's someone else's. */
function setAside() {
  fs.rmSync(ASIDE_DIR, { recursive: true, force: true });
  fs.mkdirSync(ASIDE_DIR, { recursive: true });
  for (const name of COPIED_FILES) {
    fs.mkdirSync(path.dirname(path.join(ASIDE_DIR, name)), { recursive: true });
    copyIfThere(path.join(PROJECT_ROOT, name), path.join(ASIDE_DIR, name));
  }
  for (const name of listPhotos()) {
    fs.mkdirSync(path.join(ASIDE_DIR, PHOTO_DIR), { recursive: true });
    copyIfThere(path.join(PROJECT_ROOT, name), path.join(ASIDE_DIR, name));
  }
  const all = require('./19-settings.js').read();
  writeJsonFile(path.join(ASIDE_DIR, 'settings.json'), Object.fromEntries(SHARED_SETTINGS.map(key => [key, all[key]])));
}

/** Puts back what setAside kept, replacing what was copied from the master. */
function restoreAside() {
  if (!fs.existsSync(ASIDE_DIR)) return false;
  for (const name of [...COPIED_FILES, ...listPhotos()]) {
    try { fs.unlinkSync(path.join(PROJECT_ROOT, name)); } catch {}
  }
  for (const name of COPIED_FILES) copyIfThere(path.join(ASIDE_DIR, name), path.join(PROJECT_ROOT, name));
  let photos = [];
  try { photos = fs.readdirSync(path.join(ASIDE_DIR, PHOTO_DIR)); } catch {}
  if (photos.length) fs.mkdirSync(path.join(PROJECT_ROOT, PHOTO_DIR), { recursive: true });
  for (const n of photos) copyIfThere(path.join(ASIDE_DIR, PHOTO_DIR, n), path.join(PROJECT_ROOT, PHOTO_DIR, n));
  const settings = require('./19-settings.js');
  for (const [key, value] of Object.entries(readJson(path.join(ASIDE_DIR, 'settings.json'), {}))) settings.write(key, value);
  fs.rmSync(ASIDE_DIR, { recursive: true, force: true });
  return true;
}

function copyIfThere(from, to) {
  try { fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return;
  }
  // Keeps the date, since the last check's time comes from it.
  const stat = fs.statSync(from);
  fs.utimesSync(to, stat.atime, stat.mtime);
}

// ── Talking to the other computer ──

/** A certificate's fingerprint, written the way certFingerprint() writes it. */
function fingerprintOf(pem) {
  const der = new crypto.X509Certificate(pem).raw;
  return crypto.createHash('sha256').update(der).digest('hex').replace(/(.{2})(?=.)/g, '$1:').toUpperCase();
}

/** Tidies an address someone typed: https only, and no path. Null if it isn't one. */
function cleanUrl(given, defaultPort) {
  let text = String(given || '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  if (!url.port && defaultPort) url.port = String(defaultPort);
  return url.origin;
}

/**
 * Connection options for one way of reaching the master.
 *
 * On the home network, only the certificate saved at pairing is accepted, and
 * that's checked before anything is sent, so the key can't reach anything else
 * answering at that address. Through a tunnel the certificate is a public one the
 * system already trusts, and the saved one proves nothing, so 17-api.js's answer
 * saying which server it is gets checked instead (see 59-sync-follow.js).
 */
function tlsOptions(route, m) {
  if (route.kind === 'remote') return {};
  return {
    ca: m.cert,
    checkServerIdentity: (host, cert) => (cert.fingerprint256 === m.fp ? undefined : new Error('not the certificate saved at pairing')),
  };
}

/** One request to the master. Answers {status, headers, body: Buffer}. */
function request(route, m, urlPath, { method = 'GET', body, timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, route.url);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(url, {
      method,
      agent: false,
      headers: {
        Authorization: `Bearer ${m.key}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
      ...tlsOptions(route, m),
    }, res => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Same, for an answer that should be JSON. A tunnel with nothing behind it
 *  answers an error page, and that's "can't reach it", not a broken master. */
async function requestJson(route, m, urlPath, options) {
  const r = await request(route, m, urlPath, options);
  if (r.status === 401) { const e = new Error('removed by the master'); e.removed = true; throw e; }
  let parsed;
  try { parsed = JSON.parse(r.body.toString('utf8')); } catch { const e = new Error(`no ClassDash at that address (${r.status})`); e.notJson = r.status; throw e; }
  if (r.status >= 400) { const e = new Error(parsed.error || `answered ${r.status}`); e.status = r.status; e.answer = parsed; throw e; }
  return parsed;
}

/**
 * Trades a pairing code for a key to that server, keeping what it takes to
 * recognize it later. The first connection can't check a certificate, having
 * none saved yet, so the code is what's being trusted, as everywhere pairing
 * happens. The certificate seen has to be the one the server says is its own,
 * unless it's a public one through a tunnel, which the system has checked.
 */
function redeem(url, code, name) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ code, name, follower: true }));
    const req = https.request(new URL('/api/pair', url), {
      method: 'POST',
      agent: false,
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, res => {
      const peer = res.socket.getPeerCertificate();
      const authorized = res.socket.authorized === true;
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => {
        let answer;
        try { answer = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return reject(Object.assign(new Error('no ClassDash at that address'), { why: 'notClassDash' })); }
        if (res.statusCode === 401) return reject(Object.assign(new Error(answer.error), { why: 'wrongCode' }));
        if (res.statusCode === 410) return reject(Object.assign(new Error(answer.error), { why: 'noCode' }));
        if (res.statusCode === 409) return reject(Object.assign(new Error(answer.error), { why: 'masterFollows' }));
        if (res.statusCode === 429) return reject(Object.assign(new Error(answer.error), { why: 'tooMany' }));
        if (res.statusCode !== 200 || !answer.key || !answer.cert) return reject(Object.assign(new Error('no ClassDash at that address'), { why: 'notClassDash' }));
        if (fingerprintOf(answer.cert) !== answer.fingerprint) return reject(Object.assign(new Error('the certificate does not match'), { why: 'wrongCert' }));
        const direct = peer && peer.fingerprint256 === answer.fingerprint;
        if (!direct && !authorized) return reject(Object.assign(new Error('the certificate does not match'), { why: 'wrongCert' }));
        resolve({ key: answer.key, fp: answer.fingerprint, cert: answer.cert, kind: direct ? 'local' : 'remote' });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', e => reject(Object.assign(e, { why: e.why || 'unreachable' })));
    req.write(payload);
    req.end();
  });
}

/** Tells the other computer to forget this one's key. Best effort: it may be off,
 *  and it can still remove this computer itself in its Settings. */
async function leave(m) {
  const urls = [m.localUrl && { url: m.localUrl, kind: 'local' }, m.remoteUrl && { url: m.remoteUrl, kind: 'remote' }].filter(Boolean);
  for (const route of urls) {
    try { await requestJson(route, m, '/api/sync/leave', { method: 'POST', body: {}, timeout: 4000 }); return true; } catch { /* the next way */ }
  }
  return false;
}

// ── Choosing the other computer as the master ──
//
// The computer where the code was typed can't simply declare itself the master:
// that would replace the other computer's data, and all it took was a code. So it
// asks, and the other computer has to say yes on its own screen. The offer carries
// a pairing code the other way, which is what it follows with if it says yes.

function readProposal(now = Date.now()) {
  const proposal = readJson(PROPOSAL_FILE, null);
  if (!proposal || !(now - proposal.at < PROPOSAL_MINUTES * 60 * 1000)) return null;
  return proposal;
}

function writeProposal(proposal) {
  writeJsonFile(PROPOSAL_FILE, proposal);
}

function clearProposal() {
  try { fs.unlinkSync(PROPOSAL_FILE); } catch { /* none */ }
}

// ── Actions while following ──
//
// While connected, what the person does here happens on the master, and comes
// back with the next copy, so both computers can't disagree. While cut off it
// happens here and is written down, and the master gets it on reconnecting.
//
// Three kinds:
//   RUNS_ON_MASTER   a check or scan: the master does it while connected, this
//                    computer when it can't be reached. Never queued, since a
//                    check from an hour ago isn't worth running later.
//   LOCAL_TOO        a line added to or taken off a list, safe to do twice, so
//                    it also happens here at once, for a click that feels instant.
//   FORWARDED        happens on the master, or if it can't be reached, here and
//                    then queued.
//
// Anything else isn't listed because it belongs to this computer (its sign-ins,
// its window, its AI keys), and just happens here as always.
const RUNS_ON_MASTER = new Set(['check', 'quickCheck', 'reload', 'stopCheck', 'aiScan', 'checkGrades']);
const LOCAL_TOO = new Set(['quiet', 'unquiet', 'hide', 'unhide', 'deleteAssignment', 'linkAssignments', 'unlinkAssignment']);
const FORWARDED = new Set([
  'virtualCreate', 'virtualEdit', 'virtualDone', 'virtualUndone', 'virtualHide', 'virtualUnhide', 'virtualDelete',
  'saveCalendar', 'clearCalendar', 'saveSchedule', 'dismissHeadsUp', 'setCalendarIcs', 'refreshCalendarIcs',
]);

function isThroughMaster(action) {
  return isFollowing() && (action === 'config' || RUNS_ON_MASTER.has(action) || LOCAL_TOO.has(action) || FORWARDED.has(action));
}

function queue() {
  const list = readJson(QUEUE_FILE, []);
  return Array.isArray(list) ? list : [];
}

function enqueue(action, arg) {
  writeJsonFile(QUEUE_FILE, [...queue(), { action, arg, at: Date.now() }]);
}

function currentRoute() {
  const status = readJson(STATUS_FILE, null);
  return status && status.url ? { url: status.url, kind: status.via } : null;
}

/** Runs an action on the master and answers what it answered. Throws only when
 *  the master couldn't be reached: a refusal is still an answer. */
async function forward(action, arg, route = currentRoute(), m = master()) {
  if (!route || !m) throw new Error('not connected');
  try {
    return await requestJson(route, m, '/api/action', { method: 'POST', body: { action, arg } });
  } catch (e) {
    if (e.status && e.answer) return e.answer;
    throw e;
  }
}

/** What's queued goes to the master, oldest first, before anything is copied back
 *  over it. Stops at the first it can't deliver, keeping the rest. One the master
 *  refuses is dropped: asking again won't change its answer. */
async function replayQueue(route, m, log = () => {}) {
  let list = queue();
  while (list.length) {
    const next = list[0];
    const answer = await forward(next.action, next.arg, route, m);
    if (answer && answer.ok === false) log(`sync: the master refused a waiting ${next.action}: ${answer.why || answer.error || 'no reason given'}`);
    // Read again, in case the page queued something else meanwhile.
    list = queue().slice(1);
    if (list.length) writeJsonFile(QUEUE_FILE, list);
    else try { fs.unlinkSync(QUEUE_FILE); } catch {}
  }
}

/** The part of a settings save the master should hear about: shared settings
 *  that actually changed here. The page sends every setting on every save, and an
 *  old copy of one shouldn't overwrite what's on the master. Null if there's none. */
function sharedConfigChange(chunk) {
  let given;
  try { given = JSON.parse(Buffer.from(String(chunk), 'base64url').toString('utf8')); } catch { return null; }
  if (!given || typeof given !== 'object') return null;
  const now = require('./19-settings.js').read();
  const changed = {};
  for (const key of SHARED_SETTINGS) {
    if (key in given && JSON.stringify(given[key]) !== JSON.stringify(now[key])) changed[key] = given[key];
  }
  return Object.keys(changed).length ? Buffer.from(JSON.stringify(changed)).toString('base64url') : null;
}

module.exports = {
  SYNC_FILE, STATUS_FILE, QUEUE_FILE, PROPOSAL_FILE, ASIDE_DIR, COPIED_FILES, SHARED_SETTINGS, STATUS_EVERY_MS,
  readSync, writeSync, master, isFollowing, role, readStatus, writeStatus, isConnected, checksHeldBack,
  accountKey, sameAccount, facts, manifest, isCopied, isWatched, applyManifest, setAside, restoreAside,
  fingerprintOf, cleanUrl, tlsOptions, request, requestJson, redeem, leave,
  isCheckingHere, readProposal, writeProposal, clearProposal,
  RUNS_ON_MASTER, LOCAL_TOO, FORWARDED, isThroughMaster, queue, enqueue, forward, replayQueue, sharedConfigChange,
};
