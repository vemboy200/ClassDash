/**
 * The actual logic behind every napominalka:// action.
 *
 * Kept here in JS rather than in the AppleScript app itself, so it's
 * testable the same way as everything else in this project — run it
 * directly with node and check what it did to the files, no need to
 * rebuild and relaunch a compiled app to verify a change. 07-notifier.
 * applescript's whole job is just parsing the incoming napominalka://
 * URL and shelling out to this file with the action name and its
 * argument; everything past that happens here.
 *
 * ── Why ids aren't decoded here ──
 *
 * The id arrives from the page still percent-encoded (it went through
 * encodeURIComponent there — see 08-page.js). It's written to the .txt
 * files in that same encoded form and decoded later, when
 * readMutedIds()/readHiddenIds() in 05-playwright-draft.js read the file
 * back. Decoding it here too would just mean encoding and decoding twice
 * for no reason — the two ends already agree on the encoded form.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { PROJECT_ROOT } = require('./00-project-root.js');

const QUIET_FILE = path.join(PROJECT_ROOT, 'не-срочно.txt');
const HIDDEN_FILE = path.join(PROJECT_ROOT, 'скрытые.txt');
const DELETED_FILE = path.join(PROJECT_ROOT, 'deleted-assignments.txt');
const API_LOG = path.join(PROJECT_ROOT, 'api-log.txt');
const API_LOG_OLD = path.join(PROJECT_ROOT, 'api-log.old.txt');
const ACTION_LOG = path.join(PROJECT_ROOT, 'notifier-log.txt');

/**
 * Records every action that arrives here, and how it ended.
 *
 * THIS EXISTS BECAUSE THE NOTIFIER FAILS INVISIBLY.
 *
 * It's launched by macOS from a URL, with no terminal attached: nothing
 * it prints goes anywhere a person can see. So "the button did nothing"
 * covers everything from "the click never became a URL" through "the URL
 * never reached this file" to "this ran fine and the page just didn't
 * show it" — three completely different bugs that look identical from
 * the outside. One of them ("the page reloaded on top of the result")
 * cost three rounds of fixing the wrong end of the chain.
 *
 * A line here settles which one it is immediately. Deliberately dumb:
 * plain text, appended, no rotation beyond a size cap — a log that
 * itself needs debugging is worse than none.
 */
function logAction(text) {
  try {
    // Truncate rather than grow forever. A few hundred lines is plenty
    // of history for "what happened when I clicked that", and this file
    // should never be something anyone has to think about.
    if (fs.existsSync(ACTION_LOG) && fs.statSync(ACTION_LOG).size > 64 * 1024) {
      fs.writeFileSync(ACTION_LOG, '');
    }
    fs.appendFileSync(ACTION_LOG, `${new Date().toISOString()}  ${text}\n`);
  } catch { /* logging must never be the thing that breaks an action */ }
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
}

function appendLine(file, line) {
  const lines = readLines(file);
  if (!lines.includes(line)) lines.push(line);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function removeLine(file, line) {
  const lines = readLines(file).filter(l => l !== line);
  fs.writeFileSync(file, lines.length ? lines.join('\n') + '\n' : '');
}

/** Redraws the page from memory. Fast (well under a second) — safe to
 *  wait for. */
function redraw() {
  execFileSync(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js'), '--redraw'],
    { stdio: 'ignore' });
}

// Inside the server, waiting for a redraw stops everything it's doing, every
// open page's updates included. What changes only the cards doesn't need it:
// the page hears from the file itself, and only the copy on disk is left to
// catch up, so this runs it alongside. One at a time, and once more if asked
// again meanwhile. In the apps' own short-lived process, waiting costs nothing.
let inServer = false;
let backgroundRedraw = null;
let redrawAgain = false;
function redrawCards() {
  if (!inServer) return redraw();
  if (backgroundRedraw) { redrawAgain = true; return undefined; }
  backgroundRedraw = spawn(process.execPath, [path.join(__dirname, '05-playwright-draft.js'), '--redraw'], { stdio: 'ignore' });
  const finished = () => {
    backgroundRedraw = null;
    if (redrawAgain) { redrawAgain = false; redrawCards(); }
  };
  backgroundRedraw.on('exit', finished);
  backgroundRedraw.on('error', finished);
  return undefined;
}

/** A full collection pass takes about a minute. The caller (the
 *  AppleScript app, ultimately triggered by a click on the page) can't
 *  sit around waiting for that, so this starts it and returns
 *  immediately — detached, so it keeps running after this process exits. */
function fullCheck() {
  const child = spawn(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js'), '--full'],
    { detached: true, stdio: 'ignore', cwd: __dirname });
  child.unref();
}

/**
 * Stops whatever collection is running right now, if any.
 *
 * `05-playwright-draft.js`'s own lock file holds the pid of the process
 * running it (see acquireLock() there) — that's already exactly the
 * "is a check running, and which process" this needs, kept up to date by
 * the collector itself, so nothing new has to track it separately.
 *
 * SIGTERM, not SIGKILL: on macOS and Linux this reaches the collector's
 * own handler, which cleans up the lock and the live/ run state properly
 * (same code path as Ctrl+C) before exiting — a well-behaved stop, not a
 * yank. WINDOWS has no SIGTERM to catch, so there it's taskkill /T,
 * which ends the collector and the browser it started together, and the
 * lock is removed here since the collector's own cleanup never runs.
 *
 * Either way the run is then marked over right here (markRunStopped in
 * 28-live-state.js), so an open page goes back to idle straight away
 * instead of waiting 30 seconds for the heartbeat to go stale.
 *
 * killLeftoverBrowser() runs on macOS and Linux unconditionally, not only
 * as a fallback: running it after an already-clean exit costs nothing.
 */
function stopCheck() {
  // 05-playwright-draft.js patches console.log/warn/error the moment it's
  // required at all — even just for these two things — timestamping every
  // line for its own runs.log (see its own "Timestamps in the log" header
  // comment). Harmless there, but this file's OWN final console.log is a
  // single JSON line the native bridge parses literally (see this file's
  // own CLI entry point comment): a leaked timestamp in front of it broke
  // that parse, caught live — every stopCheck response failed to parse on
  // the Electron/Swift side even though the check itself had genuinely
  // stopped. Saved and restored right around the require so it can't
  // leak into anything this file prints afterward.
  const original = { log: console.log, warn: console.warn, error: console.error };
  const { LOCK_FILE, killLeftoverBrowser } = require('./05-playwright-draft.js');
  Object.assign(console, original);

  let pid = null;
  try { pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10); } catch { /* nothing running */ }
  if (!pid || Number.isNaN(pid)) return { stopped: false };

  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* no such process — already over */ }
  if (!alive) return { stopped: false };

  if (process.platform === 'win32') {
    // Windows has no SIGTERM to catch and no pkill, so the collector's
    // own cleanup never ran and its browser was left open (a visible
    // Edpuzzle window included), holding the profile for the next check.
    // taskkill /T ends the collector AND the browser it started.
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone between the check above and here — fine */ }
    killLeftoverBrowser();
  }
  require('./28-live-state.js').markRunStopped(PROJECT_ROOT);
  // The page on disk is the run's last half-read draft, and a stopped run never writes the finished one, so it's drawn
  // from memory once the run is really gone. In the background: from a browser
  // this runs inside the server, which must keep answering, and whose own
  // stopped child isn't gone until the server is free to notice.
  const after = spawn(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js'), '--redraw', `--after-pid=${pid}`],
    { detached: true, stdio: 'ignore', cwd: __dirname, windowsHide: true });
  after.unref();
  return { stopped: true };
}

/** Same idea as fullCheck(), but the quick pass (Classroom + Canvas,
 *  no Edpuzzle window, ~17 seconds) — enough to make a saved exclusion
 *  or Canvas address actually apply. Those only change what gets fetched
 *  on the NEXT collection; a redraw just re-renders what's already there.
 *  The page's "some settings need a fresh check" notice starts this. */
function quickCheck() {
  const child = spawn(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js')],
    { detached: true, stdio: 'ignore', cwd: __dirname });
  child.unref();
}

/** Opens the real, visible sign-in browser window — same script and
 *  flag the Settings → Services → Setup "Sign In…" button and `npm run
 *  login` both already use. Detached and fire-and-forget like
 *  fullCheck()/quickCheck() above, but for a different reason: this one
 *  isn't waiting on a result that'll be ready in a minute, it's waiting
 *  on a PERSON, who might take anywhere from ten seconds to however
 *  long their school's SSO/MFA takes. There's nothing useful this
 *  process could do with a result even if it waited for one.
 *
 *  Reachable from the page itself (see 08-page.js's sign-in banner,
 *  shown when 25-check-status.js records Classroom's "cookies expired"
 *  or Canvas's "stuck on sign-in") as well as from the native menu —
 *  the same underlying flow either way, just two different triggers. */
function signIn() {
  const child = spawn(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js'), '--login'],
    { detached: true, stdio: 'ignore', cwd: __dirname });
  child.unref();
}

/** Starts 17-api.js as a detached background process, if it isn't
 *  already running. Generates the cert/token FIRST, synchronously, in
 *  THIS process, rather than leaving it to the spawned server's own
 *  startup — see 23-api-security.js's own comment on why that avoids a
 *  real race against the redraw that follows right after, which reads
 *  those same files to show the token in the settings panel.
 *
 *  `network` passes --network through to 17-api.js, binding 0.0.0.0
 *  instead of 127.0.0.1 — see apiLan in 19-settings.js. Which interface
 *  it bound to is decided once, at process startup; changing it later
 *  means actually restarting the process, not just flipping a setting —
 *  see the 'config' case below. */
function startApiServer(network) {
  const security = require('./23-api-security.js');
  if (security.isServerRunning()) return;
  security.ensureCert();
  security.ensureToken();
  security.ensureAppKey();
  const args = [path.join(__dirname, '17-api.js')];
  if (network) args.push('--network');
  // Its output goes to api-log.txt, so a server that stops has left a note
  // saying why. Kept to about a megabyte: the previous one is moved aside.
  try {
    if (fs.statSync(API_LOG).size > 1024 * 1024) fs.renameSync(API_LOG, API_LOG_OLD);
  } catch { /* no log yet */ }
  const log = fs.openSync(API_LOG, 'a');
  const child = spawn(process.execPath, args,
    { detached: true, stdio: ['ignore', log, log], cwd: __dirname });
  fs.closeSync(log);
  child.unref();
}

/** Starts the API server if it isn't running: when the app opens (a
 *  restart of the computer ends it), and on every check, in case it stopped
 *  for some reason nothing caught. It always runs, since the page and its
 *  other clients go through it; apiLan only decides whether the home
 *  network can reach it too. */
function ensureApiServer() {
  if (require('./23-api-security.js').isServerRunning()) return false;
  startApiServer(require('./19-settings.js').read().apiLan);
  logAction('  API server was not running — started it (see api-log.txt)');
  return true;
}

/** Blocks the calling thread — Node has no sleep() built in, and this
 *  needs to be a genuine, synchronous pause, not a setTimeout a script
 *  that's about to exit anyway would never actually wait for. Atomics.wait
 *  on the main thread is specifically allowed in Node (unlike a browser). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Stops it, to start it again listening somewhere else. SIGTERM, not SIGKILL: 17-api.js
 *  has its own handler (see its start()) that clears the pid file
 *  before exiting, and skipping straight to SIGKILL would leave that
 *  file behind lying about whether the server's still up.
 *
 *  DOESN'T RETURN UNTIL THE PROCESS IS ACTUALLY GONE, not just signaled.
 *  SIGTERM is only a request — the process needs a moment to act on it.
 *  Returning right away used to mean a quick toggle-off-then-back-on
 *  could have startApiServer()'s isServerRunning() check see this same
 *  pid, still alive for another few milliseconds, and skip spawning a
 *  replacement entirely — leaving nothing running at all, silently.
 *  That's exactly what "turning it off and on again didn't fix it"
 *  looks like from outside. */
function stopApiServer() {
  const security = require('./23-api-security.js');
  if (!security.isServerRunning()) return;
  const pid = security.readPid();
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    security.clearPid(); // already gone; the pid file just hadn't caught up
    return;
  }

  let gone = false;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      gone = true;
      break;
    }
    sleepSync(50);
  }
  // A plain HTTP server should react to SIGTERM in milliseconds — two
  // full seconds of not doing so means something's actually stuck, not
  // just slow. SIGKILL guarantees the port is free by the time this
  // returns; without it, a stuck old process would make the very next
  // startApiServer() call fail to bind and die silently, the same
  // "toggled it back on and nothing happened" symptom this whole
  // function exists to prevent.
  if (!gone) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone right at the wire */ }
  }
  // Cleared here regardless of whether the loop above confirmed it or
  // just timed out — a pid file left behind either way would keep
  // isServerRunning() reporting a dead (or stuck) process as live forever.
  security.clearPid();
}

/**
 * Runs one action and returns what happened — never throws for an
 * expected failure (a parse error, a rejected setting), only for
 * something genuinely unexpected, which the CLI entry point below
 * turns into a result too rather than letting it vanish.
 */
function safeDecode(s) {
  try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); }
}

/** What the page's calendar script draws from: { read, ics, overrides }. */
function calendarPayload(store) {
  const cal = store.readCalendar();
  return { read: cal.pdf || null, ics: cal.ics || null, overrides: cal.overrides || {} };
}

/** Fetches the calendar feed and saves its events (or why it failed), then redraws. */
function refreshIcs(url) {
  return require('./33-school-calendar.js').refreshFeed(url).then(result => {
    if (!result.ok) logAction(`  calendar feed not read: ${result.why}`);
    redraw();
    return result;
  });
}

/** Decodes a page's base64url-JSON argument, or null. */
function decodeArg(arg) {
  try { return JSON.parse(Buffer.from(String(arg), 'base64url').toString('utf8')); } catch { return null; }
}

/** An action on a computer following another (see 58-sync.js for the kinds). */
function throughMaster(action, arg, sync) {
  const connected = sync.isConnected();
  if (sync.RUNS_ON_MASTER.has(action)) {
    if (!connected) return act(action, arg);
    return sync.forward(action, arg).catch(() => act(action, arg));
  }
  const alsoHere = (sent, sentArg) => {
    const local = act(action, arg);
    if (!connected) { sync.enqueue(sent, sentArg); return local; }
    return Promise.resolve(local).then(answer => sync.forward(sent, sentArg)
      .catch(() => sync.enqueue(sent, sentArg)).then(() => answer));
  };
  if (action === 'config') {
    const shared = sync.sharedConfigChange(arg);
    return shared ? alsoHere('config', shared) : act(action, arg);
  }
  if (sync.LOCAL_TOO.has(action)) return alsoHere(action, arg);
  const hereThenQueue = () => {
    const local = act(action, arg);
    if (local && local.ok === false) return local;
    // Its id goes along, so later changes to it still find it on the master.
    if (action === 'virtualCreate' && local.entry) {
      const payload = decodeArg(arg) || {};
      sync.enqueue(action, Buffer.from(JSON.stringify({ ...payload, id: local.entry.id })).toString('base64url'));
    } else {
      sync.enqueue(action, arg);
    }
    return local;
  };
  if (!connected) return hereThenQueue();
  return sync.forward(action, arg).catch(hereThenQueue);
}

function main(action, arg) {
  const sync = require('./58-sync.js');
  // What it reads would be replaced by the next copy from the master, and the
  // file it reads is on this computer, so the master can't read it instead.
  if (action === 'importCalendarPdf' && sync.isFollowing()) return { ok: false, action, why: require('./18-language.js').t('syncImportOnMaster') };
  return sync.isThroughMaster(action) ? throughMaster(action, arg, sync) : act(action, arg);
}

/** Pairing with another computer: trades the code for a key, and answers the
 *  facts for asking which computer should be the master. Nothing changes here
 *  until that's answered. */
async function syncPair(action, arg) {
  const sync = require('./58-sync.js');
  const security = require('./23-api-security.js');
  const given = decodeArg(arg) || {};
  if (sync.isFollowing()) return { ok: false, action, why: 'alreadyFollowing' };
  if (security.listDevices().some(d => d.follower)) return { ok: false, action, why: 'hasFollowers' };
  const url = sync.cleanUrl(given.url, require('./19-settings.js').read().apiPort);
  if (!url) return { ok: false, action, why: 'badAddress' };
  const me = sync.facts();
  let paired;
  try {
    paired = await sync.redeem(url, given.code, me.name);
  } catch (e) {
    return { ok: false, action, why: e.why || 'unreachable' };
  }
  if (paired.fp === me.fingerprint) {
    // It just made itself a key; that key has nothing to do.
    await sync.leave({ fp: paired.fp, cert: paired.cert, key: paired.key, localUrl: url }).catch(() => {});
    return { ok: false, action, why: 'sameComputer' };
  }
  const candidate = { fp: paired.fp, cert: paired.cert, key: paired.key, [paired.kind === 'local' ? 'localUrl' : 'remoteUrl']: url };
  let theirs;
  try {
    theirs = await sync.requestJson({ url, kind: paired.kind }, candidate, '/api/sync/hello');
  } catch {
    return { ok: false, action, why: 'unreachable' };
  }
  candidate.name = theirs.name;
  candidate.account = theirs.account;
  sync.writeSync({ pending: candidate });
  return pairingFacts(action, me, theirs);
}

function pairingFacts(action, mine, theirs) {
  return {
    ok: true, action, mine, theirs,
    sameAccount: require('./58-sync.js').sameAccount(mine.account, theirs.account),
    newer: (theirs.lastCheck || 0) >= (mine.lastCheck || 0) ? 'theirs' : 'mine',
  };
}

/** The computer the code was typed on asks the other to follow it. Needs this
 *  computer to be reachable, and a code the other can use. */
async function syncBeMaster(action) {
  const sync = require('./58-sync.js');
  const security = require('./23-api-security.js');
  const settings = require('./19-settings.js').read();
  const saved = sync.readSync();
  if (!saved.pending) return { ok: false, action, why: 'nothingPaired' };
  if (!settings.apiLan) return { ok: false, action, why: 'needLan' };
  const { addressKey } = require('./36-api-discovery.js');
  const urls = addressKey().split(',').filter(Boolean).map(a => `https://${a}:${settings.apiPort}`);
  if (!urls.length) return { ok: false, action, why: 'unreachable' };
  const { code } = security.makePairingCode();
  const route = saved.pending.localUrl ? { url: saved.pending.localUrl, kind: 'local' } : { url: saved.pending.remoteUrl, kind: 'remote' };
  try {
    await sync.requestJson(route, saved.pending, '/api/sync/propose', { method: 'POST', body: { name: sync.facts().name, urls, code } });
  } catch (e) {
    security.cancelPairingCode();
    return { ok: false, action, why: e.status === 409 ? 'masterFollows' : 'unreachable' };
  }
  sync.writeSync({ pending: { ...saved.pending, asked: true } });
  return { ok: true, action };
}

/** Yes to being asked: pairs back with the computer that asked, and follows it. */
async function syncAccept(action, arg) {
  const sync = require('./58-sync.js');
  const security = require('./23-api-security.js');
  const proposal = sync.readProposal();
  if (!proposal) return { ok: false, action, why: 'nothingPaired' };
  if (sync.isFollowing()) return { ok: false, action, why: 'alreadyFollowing' };
  if (security.listDevices().some(d => d.follower && d.id !== proposal.deviceId)) return { ok: false, action, why: 'hasFollowers' };
  const me = sync.facts();
  let paired = null, url = null;
  for (const candidate of proposal.urls) {
    try {
      paired = await sync.redeem(candidate, proposal.code, me.name);
      url = candidate;
      break;
    } catch (e) {
      if (e.why && e.why !== 'unreachable') return { ok: false, action, why: e.why };
    }
  }
  if (!paired) return { ok: false, action, why: 'unreachable' };
  const candidate = { fp: paired.fp, cert: paired.cert, key: paired.key, localUrl: url };
  let theirs;
  try { theirs = await sync.requestJson({ url, kind: 'local' }, candidate, '/api/sync/hello'); } catch { return { ok: false, action, why: 'unreachable' }; }
  const given = decodeArg(arg) || {};
  if (!sync.sameAccount(me.account, theirs.account) && given.otherAccount !== true) {
    await sync.leave(candidate).catch(() => {});
    return { ok: false, action, why: 'otherAccount' };
  }
  sync.setAside();
  sync.writeSync({ master: { ...candidate, name: theirs.name, account: theirs.account } });
  security.revokeDevice(proposal.deviceId);
  sync.clearProposal();
  logAction(`  now following ${theirs.name}`);
  return { ok: true, action };
}

/** What Settings → Sync shows. While waiting on the other computer's answer,
 *  also finds out whether it said no, which took this computer's key away. */
async function syncSummary(action) {
  const sync = require('./58-sync.js');
  const security = require('./23-api-security.js');
  let saved = sync.readSync();
  const followers = security.listDevices().filter(d => d.follower);
  let declined = false;
  if (saved.pending && saved.pending.asked) {
    if (followers.length) {
      sync.writeSync({});
      saved = {};
    } else {
      const route = saved.pending.localUrl ? { url: saved.pending.localUrl, kind: 'local' } : { url: saved.pending.remoteUrl, kind: 'remote' };
      try {
        await sync.requestJson(route, saved.pending, '/api/sync/hello', { timeout: 4000 });
      } catch (e) {
        if (e.removed) {
          security.cancelPairingCode();
          sync.writeSync({});
          saved = {};
          declined = true;
        }
      }
    }
  }
  const proposal = sync.readProposal();
  return {
    ok: true, action,
    status: sync.readStatus(),
    pending: saved.pending ? { name: saved.pending.name, asked: saved.pending.asked === true } : null,
    declined,
    proposal: proposal ? { name: proposal.name } : null,
    followers,
    localUrl: saved.master ? saved.master.localUrl || null : null,
    remoteUrl: saved.master ? saved.master.remoteUrl || null : null,
    setAside: require('fs').existsSync(sync.ASIDE_DIR),
  };
}

function syncAct(action, arg) {
  const sync = require('./58-sync.js');
  const security = require('./23-api-security.js');
  const saved = sync.readSync();
  switch (action) {
    case 'syncStatus':
      return syncSummary(action);
    // The facts again, for a page that reloaded while asking which is the master.
    case 'syncFacts': {
      const pending = saved.pending;
      if (!pending) return { ok: false, action, why: 'nothingPaired' };
      const route = pending.localUrl ? { url: pending.localUrl, kind: 'local' } : { url: pending.remoteUrl, kind: 'remote' };
      return sync.requestJson(route, pending, '/api/sync/hello').then(theirs => pairingFacts(action, sync.facts(), theirs), () => ({ ok: false, action, why: 'unreachable' }));
    }
    case 'syncBeMaster':
      return syncBeMaster(action);
    case 'syncAccept':
      return syncAccept(action, arg);
    case 'syncDecline': {
      const proposal = sync.readProposal();
      if (proposal) security.revokeDevice(proposal.deviceId);
      sync.clearProposal();
      return { ok: true, action };
    }
    case 'syncNearby':
      return require('./59-sync-follow.js').findNearby(security.certFingerprint()).then(servers => ({ ok: true, action, servers }));
    case 'syncPair':
      return syncPair(action, arg);
    // The answer to "which should be the master?": the other computer. What's
    // here is kept aside, then replaced by the next copy.
    case 'syncFollow': {
      if (!saved.pending) return { ok: false, action, why: 'nothingPaired' };
      const given = decodeArg(arg) || {};
      if (!sync.sameAccount(sync.accountKey(), saved.pending.account) && given.otherAccount !== true) return { ok: false, action, why: 'otherAccount' };
      sync.setAside();
      sync.writeSync({ master: saved.pending });
      logAction(`  now following ${saved.pending.name}`);
      return { ok: true, action };
    }
    case 'syncCancel':
      if (!saved.pending) return { ok: true, action };
      if (saved.pending.asked) security.cancelPairingCode();
      return sync.leave(saved.pending).then(() => {
        sync.writeSync({});
        return { ok: true, action };
      });
    case 'syncStop': {
      const m = saved.master;
      if (!m) return { ok: false, action, why: 'notFollowing' };
      const given = decodeArg(arg) || {};
      return sync.leave(m).then(left => {
        sync.writeSync({});
        for (const file of [sync.STATUS_FILE, sync.QUEUE_FILE]) { try { require('fs').unlinkSync(file); } catch {} }
        const restored = given.restore === true && sync.restoreAside();
        logAction(`  stopped following ${m.name}`);
        redrawCards();
        return { ok: true, action, left, restored };
      });
    }
    // The tunnel's address, kept beside the home one. Empty takes it away.
    case 'syncSetRemote': {
      if (!saved.master) return { ok: false, action, why: 'notFollowing' };
      const given = decodeArg(arg) || {};
      const url = given.url ? sync.cleanUrl(given.url) : null;
      if (given.url && !url) return { ok: false, action, why: 'badAddress' };
      if (url) saved.master.remoteUrl = url; else delete saved.master.remoteUrl;
      sync.writeSync(saved);
      return { ok: true, action, url };
    }
    default:
      return { ok: false, action, why: 'unknown' };
  }
}

function act(action, arg) {
  if (action.startsWith('sync')) return syncAct(action, arg);
  // A settings save carries every setting, the Canvas access token and the
  // email included, so its payload is never logged — the "applied:" line
  // below says which settings took, by name, which is all a log needs.
  // The Q password (saveGradesPassword) never is either, obviously.
  // Nor a question to the Grades center's AI or the workspace's.
  logAction(action === 'config' || action === 'saveGradesPassword' || action === 'gradesAsk' || action === 'workspaceAsk' ? `${action} (payload not logged)` : `${action} ${arg}`);
  switch (action) {
    case 'config': {
      const { applyBatch } = require('./19-settings.js');
      const classLinks = require('./29-class-links.js');
      const linksBefore = classLinks.readLinks();
      const result = applyBatch(arg);
      if (!result.ok) {
        // Two different failures share this branch: the chunk didn't
        // parse at all (result.why), or it parsed and every key in it
        // was refused (result.rejected). Both get logged as they are.
        console.error('settings not applied:', result.why || result.rejected);
        logAction(`  NOT APPLIED: ${result.why || JSON.stringify(result.rejected)}`);
        return { ok: false, action, why: result.why, rejected: result.rejected };
      }
      logAction(`  applied: ${result.accepted.join(', ')}` +
        (result.rejected.length ? ` | refused: ${result.rejected.join('; ')}` : ''));

      // SAVING NEVER STARTS A COLLECTION ITSELF.
      //
      // Most of what's on the settings panel only changes how ALREADY-
      // COLLECTED data gets displayed — treatUndatedAsUrgent is a
      // bucket a redraw already re-sorts existing items into,
      // showEmptyClasses is a rendering choice about the class list,
      // language has worked this way since redraw() was first written.
      // None of that needs Classroom or Canvas read again, so none of
      // it needs a browser launched — which is also the ONLY reason
      // saving settings needs the App Management permission at all.
      //
      // Two settings do change what gets FETCHED: exclusions (a class has
      // to stop being read, and its old data purged — see the
      // diffWithPrevious comment on EXCLUDED CLASSES for why that
      // specifically needs a real pass) and canvas (a different data
      // source entirely). They used to start a quick collection right
      // here, which meant closing the settings panel could launch a
      // browser and purge a class's data on an accidental click. Now they
      // just wait: the page shows a "some settings need a fresh check"
      // notice (see pendingFetchKeys in 19-settings.js) and the next
      // collection — that button, a manual check, or an automatic one —
      // picks them up, since it reads settings.json when it starts.

      // apiLan changes where a whole separate background process listens,
      // which 17-api.js decides once, at its own startup — orthogonal to
      // needsFetch above (it doesn't touch Classroom/Canvas at all), so
      // it's handled alongside that check, not instead of it. Stopping
      // first, then starting fresh, rebinds it.
      if (result.changed.includes('apiLan')) {
        const { apiLan } = require('./19-settings.js').read();
        stopApiServer();
        startApiServer(apiLan);
        logAction(`  API server restarted (${apiLan ? 'home network too' : 'this computer only'})`);
      }

      // AI just turned on: the announcements already here are the backlog,
      // not new, so the automatic scan after each check leaves them alone
      // (Settings → AI can scan any of them on purpose).
      if (result.changed.includes('aiProvider')) {
        const { aiProvider } = require('./19-settings.js').read();
        if (aiProvider && aiProvider !== 'none') {
          const n = require('./38-announcement-scan.js').seedKnown();
          logAction(`  AI on: ${n} announcements already here won't be scanned automatically`);
        }
      }

      // Fewer announcement photos (or none): cleared now, not at the next
      // check. More are downloaded at the next check.
      if (result.changed.includes('announcementPhotos')) {
        const deleted = require('./39-announcement-photos.js').pruneSaved();
        logAction(`  announcement photos: ${deleted} deleted`);
      }

      // Reminders saved under a link's name follow it when it's renamed or
      // removed (see renamesAfter() in 29-class-links.js).
      if (result.changed.includes('classLinks')) {
        const renames = classLinks.renamesAfter(linksBefore, classLinks.readLinks());
        const moved = require('./24-virtual-assignments.js').renameClasses(renames);
        if (moved) logAction(`  reminders moved to renamed classes: ${moved}`);
      }

      // Ticking a filter or folding the sidebar saves on every click, and those
      // are already showing on the page that did it.
      const PAGE_MEMORY = ['filterUnchecked', 'filterShowHidden', 'filterShowRemoved', 'navCollapsed', 'dashHidden'];
      if (result.changed.length && result.changed.every(key => PAGE_MEMORY.includes(key))) redrawCards();
      else redraw();
      const pending = require('./19-settings.js').pendingFetchKeys();
      logAction(pending.length
        ? `  redrawn; waiting for a fresh check to apply: ${pending.join(', ')}`
        : '  redrawn');
      // mode stays for pages generated before this changed, which read it
      // to decide how long to wait before reloading; 'redraw' is the short
      // wait, and it's now always the right one.
      return {
        ok: true, action, accepted: result.accepted, rejected: result.rejected,
        pending, mode: 'redraw',
      };
    }
    case 'quiet':
      appendLine(QUIET_FILE, arg);
      redrawCards();
      return { ok: true, action };
    case 'unquiet':
      removeLine(QUIET_FILE, arg);
      redrawCards();
      return { ok: true, action };
    // Assignment links (31-assignment-links.js): arg "a,b" links b to a;
    // unlinkAssignment undoes the whole link an assignment is in. An id that
    // came through a napominalka:// URL may still be percent-encoded.
    case 'linkAssignments': {
      const [a, b] = String(arg || '').split(',').map(safeDecode);
      const result = require('./31-assignment-links.js').link(a, b);
      if (result.ok) redrawCards();
      else logAction(`  not linked: ${result.why}`);
      return { ...result, action };
    }
    case 'unlinkAssignment': {
      const result = require('./31-assignment-links.js').unlink(safeDecode(arg));
      if (result.ok) redrawCards();
      return { ...result, action };
    }
    // The page's Calendar section. importCalendarPdf reads a PDF (the path
    // the app's file picker chose) and saves it as the calendar right away;
    // saveCalendar carries each change made on the page afterwards, as
    // base64url JSON the way virtualCreate does. The read is the one action
    // that answers later, so main() returns a promise for it (the CLI entry
    // below waits for it; nothing else calls it).
    case 'importCalendarPdf': {
      const file = safeDecode(arg);
      return require('./32-calendar-pdf.js').readCalendarPdf(file).then(read => {
        if (!read.ok) { logAction(`  calendar PDF not read: ${read.why}`); return { ...read, action }; }
        const saved = require('./33-school-calendar.js').importRead(read, file);
        redraw();
        return { ok: true, action, calendar: calendarPayload(require('./33-school-calendar.js')) };
      });
    }
    case 'saveCalendar': {
      let choices;
      try {
        const normal = String(arg).replace(/-/g, '+').replace(/_/g, '/');
        choices = JSON.parse(Buffer.from(normal, 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      const result = require('./33-school-calendar.js').saveChoices(choices);
      if (result.ok) redraw();
      // School days changed, so A/B days may have too.
      return { ...result, action, schedule: require('./35-school-schedule.js').schedulePayload() };
    }
    // The × on a schedule heads-up in the page's banner: 'flip:2026-10-14'.
    case 'dismissHeadsUp': {
      const result = require('./35-school-schedule.js').dismissHeadsUp(safeDecode(arg));
      if (result.ok) redraw();
      return { ...result, action };
    }
    // Settings → Schedule: every change, as base64url JSON (see saveSchedule
    // in 35-school-schedule.js). Answers with the schedule as the page shows it.
    case 'saveSchedule': {
      let choices;
      try {
        choices = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      const schedule = require('./35-school-schedule.js');
      const result = schedule.saveSchedule(choices);
      if (result.ok) redraw();
      return { ...result, action, schedule: schedule.schedulePayload() };
    }
    // The calendar feed (ICS): setCalendarIcs saves its link and fetches it
    // at once (an empty link removes the feed), refreshCalendarIcs fetches it
    // again. Both answer later, like importCalendarPdf.
    case 'setCalendarIcs':
    case 'refreshCalendarIcs': {
      const store = require('./33-school-calendar.js');
      const url = action === 'setCalendarIcs' ? safeDecode(arg).trim() : ((store.readCalendar().ics || {}).url || '');
      if (!url) {
        store.clearIcs();
        redraw();
        return { ok: true, action, calendar: calendarPayload(store) };
      }
      return refreshIcs(url).then(result => ({ ...result, action, calendar: calendarPayload(store) }));
    }
    // Settings → AI's Test button beside one AI, its id the argument, with
    // its settings as saved (the page saves first, so no key ever travels
    // in this action's argument, which the apps write to their logs). The
    // announcement scan's own model when it's that one, else its first or
    // default. Logs only whether it worked: the answer and the models
    // aren't the log's business.
    case 'aiTest': {
      const s = require('./19-settings.js').read();
      const ai = require('./37-ai.js');
      const id = ai.PROVIDER_IDS.includes(arg) ? arg : s.aiProvider;
      const same = id === s.aiProvider;
      return ai.test({ ...s, aiProvider: id, aiModel: same ? s.aiModel : '', aiLocalUrl: same ? s.aiLocalUrl : '' }).then(result => {
        logAction(result.ok ? `  AI test: ok (${result.ms} ms)` : `  AI test failed: ${result.why}`);
        return { ...result, action };
      });
    }
    // Settings → AI opening: what's on this computer (and the saved cloud
    // provider's models) so the panel can fill itself in. Logs nothing but
    // that it ran.
    case 'aiDetect': {
      return require('./37-ai.js').detect().then(result => ({ ok: true, action, ...result }));
    }
    // A chat's model picker (51-model-picker.js) opening: every provider,
    // whether the chats can use it and its models. Logs nothing.
    case 'aiChoices': {
      return require('./37-ai.js').choices(require('./19-settings.js').read()).then(result => ({ ok: true, action, ...result }));
    }
    // A model picked in one, as base64url JSON {for, provider, model, url, effort}:
    // for "scan", the announcement scan's AI (aiProvider, aiModel,
    // aiLocalUrl; provider "none" turns it off), otherwise the chats'
    // (37-ai.js chatSettings). Only those settings can be written this way.
    case 'aiPick': {
      let pick;
      try {
        pick = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) || {};
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      const scan = pick.for === 'scan';
      const values = scan
        ? { aiProvider: String(pick.provider || 'none'), aiModel: String(pick.model || ''), aiLocalUrl: String(pick.url || ''), aiEffort: String(pick.effort || '') }
        : { aiChatProvider: String(pick.provider || ''), aiChatModel: String(pick.model || ''), aiChatUrl: String(pick.url || ''), aiChatEffort: String(pick.effort || '') };
      const settings = require('./19-settings.js');
      // All three or none.
      const bad = Object.keys(values).map(k => settings.validate(k, values[k])).find(v => !v.ok);
      if (bad) return { ok: false, action, why: bad.why };
      settings.applyBatch(Buffer.from(JSON.stringify(values)).toString('base64'));
      logAction(scan ? '  announcement AI picked' : '  chat model picked');
      if (scan) redraw();
      return { ok: true, action };
    }
    // The AI button beside an announcement: the announcements picked, as a
    // base64url JSON list of ids. Answers with what was kept, and redraws
    // after any scan, so the card's fold-out shows what the AI said. Logs
    // counts only, never titles or text.
    case 'aiScan': {
      let ids;
      try {
        ids = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      if (!Array.isArray(ids) || !ids.length) return { ok: false, action, why: 'no announcements picked' };
      const scanner = require('./38-announcement-scan.js');
      return scanner.scan({ ids: ids.map(String) }).then(result => {
        logAction(result.ok
          ? `  AI scan: ${result.scanned} read, ${result.kept.length} kept, ${result.dropped} already there, ${result.failed} failed`
          : `  AI scan not run: ${result.why}`);
        if (result.ok && result.scanned) redraw();
        return { ...result, action };
      });
    }
    // Settings → Services → Aequitas Q: the Q password, as base64url JSON (a string; empty
    // removes it). Into the keychain, never settings.json; see 40-grades.js.
    // Answers with whether one's saved now, nothing more.
    case 'saveGradesPassword': {
      let password;
      try {
        password = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      if (typeof password !== 'string') return { ok: false, action, why: 'expected a password' };
      const result = require('./40-grades.js').savePassword(password);
      logAction(result.ok ? `  grades password ${result.saved ? 'saved' : 'removed'} (${result.where})` : `  grades password not saved: ${result.why}`);
      if (result.ok) redraw();
      // A new password is tried right away, not at the next hourly check:
      // usually it's the fix for one Q turned down or wanted changed.
      if (result.ok && result.saved && require('./40-grades.js').readiness().ready) {
        try {
          require('./40-grades.js').startCheckNow();
          logAction('  grades check started with the new password');
        } catch (e) { logAction(`  grades check not started: ${e.message}`); }
      }
      return { ...result, action };
    }
    // Settings → Services → Aequitas Q → Check now: signs in to Q and reads the grades right
    // away (not waiting out the hour), then redraws.
    case 'checkGrades': {
      const grades = require('./40-grades.js');
      if (!grades.takeLock()) return { ok: false, action, why: 'a grades check is already running' };
      return grades.check({ force: true }).then(result => {
        logAction(result.skipped ? `  grades not checked: ${result.skipped}` : result.ok ? `  grades: ${result.classes} classes` : `  grades not read: ${result.why}`);
        // A good read goes into the grade history (and its alerts) first.
        if (result.ok) execFileSync(process.execPath, [path.join(__dirname, '05-playwright-draft.js'), '--grades-read'], { stdio: 'ignore' });
        else redraw();
        // Why it didn't even try, in words: 'password' means none is saved.
        if (result.skipped) return { ...result, action, why: require('./18-language.js').t('gradesSkip_' + result.skipped) };
        return { ...result, action };
      }).finally(grades.dropLock);
    }
    // The Grades center's AI sidebar: a question, as base64url JSON
    // {question, live}: live is the page's id for showing the answer as
    // it's written (41-grades-center.js liveWriter). Answers with the reply and the saved chat; logs only
    // whether it worked, never the question or the answer.
    case 'gradesAsk': {
      let payload;
      try {
        payload = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      return require('./41-grades-center.js').ask(payload && payload.question, { live: payload && payload.live }).then(result => {
        if (result.savedWeights) redraw();
        logAction(result.ok ? `  grades question answered${result.savedWeights ? ', category weights saved' : ''}` : `  grades question not answered: ${result.why}${result.detail ? ' (' + result.detail + ')' : ''}`);
        const { t } = require('./18-language.js');
        return result.ok ? { ...result, action } : { ...result, action, why: t('gcWhy_' + result.why) + (result.detail ? ' ' + result.detail : '') };
      });
    }
    case 'gradesChatClear': {
      return { ...require('./41-grades-center.js').clearChat(), action };
    }
    case 'clearCalendar': {
      const result = require('./33-school-calendar.js').clearCalendar();
      redraw();
      return { ...result, action };
    }
    case 'hide':
      appendLine(HIDDEN_FILE, arg);
      redrawCards();
      return { ok: true, action };
    case 'unhide':
      removeLine(HIDDEN_FILE, arg);
      redrawCards();
      return { ok: true, action };
    // Closed Canvas work, deleted from the page for good: it's left out of
    // everything from now on, and there's no undo (the page asks first).
    case 'deleteAssignment':
      if (!arg) return { ok: false, action, why: 'no assignment id' };
      appendLine(DELETED_FILE, arg);
      removeLine(HIDDEN_FILE, arg);
      redrawCards();
      return { ok: true, action };
    case 'check':
      ensureApiServer();
      fullCheck();
      return { ok: true, action };
    case 'stopCheck': {
      const { stopped } = stopCheck();
      logAction(stopped ? '  check stopped' : '  stopCheck: nothing was running');
      return { ok: true, action, stopped };
    }
    // The quick pass (Classroom + Canvas, ~17s, no Edpuzzle window) —
    // what the page's "some settings need a fresh check" notice starts,
    // and what the home API's /api/reload uses: the same "lighter than a
    // full check" option 'check' already gives it for a real full one.
    // Same "started, not finished" contract as 'check': this returns
    // immediately, the pass runs detached.
    // The app runs this when it opens: a restart of the computer ends the
    // home API server, and nothing else would start it before the next
    // full check.
    case 'ensureApi':
      return { ok: true, action, started: ensureApiServer() };
    case 'reload':
      ensureApiServer();
      quickCheck();
      return { ok: true, action };
    // The page's Quick check button and the server's schedule while
    // someone's at the computer: Classroom and Canvas, no browser window.
    // ('reload' above does the same, and is what /api/reload has always run.)
    case 'quickCheck':
      quickCheck();
      return { ok: true, action };
    case 'signIn':
      signIn();
      return { ok: true, action };
    // The app telling the project which version is really running, at launch
    // (see recordRunningVersion in 26-update-check.js): redraws only if that
    // changed what the page shows.
    case 'noteVersion': {
      const changed = require('./26-update-check.js').recordRunningVersion(arg);
      if (changed) redraw();
      return { ok: true, action, changed };
    }
    // After the app refreshed this project's scripts (30-template-sync.js): a
    // server that was already running is still the OLD code, held in
    // memory, and would go on serving it until something restarted it.
    case 'restartApi': {
      const security = require('./23-api-security.js');
      const wasRunning = security.isServerRunning();
      const { apiLan } = require('./19-settings.js').read();
      stopApiServer();
      startApiServer(apiLan);
      logAction(wasRunning ? '  API server restarted (scripts were refreshed)' : '  API server started (scripts were refreshed)');
      return { ok: true, action, restarted: wasRunning };
    }
    // Quitting the app (the menu bar's or the app menu's Quit ClassDash):
    // the server goes too, so nothing keeps running once ClassDash is
    // quit. Closing the window doesn't quit; the app stays in the menu bar
    // (or the tray) with the server running.
    case 'stopApi': {
      const wasRunning = require('./23-api-security.js').isServerRunning();
      stopApiServer();
      if (wasRunning) logAction('  API server stopped (ClassDash quit)');
      return { ok: true, action, stopped: wasRunning };
    }
    // The page reporting that it hid its own progress bar while it believed
    // a collection was still going. Nothing to do here: main() already
    // logged the arg above, which is the whole point — the page has no
    // console in the app window, and this is how it leaves a trace of what
    // it decided and why. See reportLiveDecision in 08-page.js.
    case 'liveDebug':
      return { ok: true, action };
    // Pairing a device (Settings → API → Devices): a short code another
    // device trades for a key of its own, at /login or /api/pair (see
    // 23-api-security.js). Making a code and removing a device are
    // app-only, like rolling the key: either could otherwise be used by
    // something holding a key to keep or take away access.
    case 'pairCode': {
      const { code, expires } = require('./23-api-security.js').makePairingCode();
      logAction('  pairing code made');
      return { ok: true, action, code, expires };
    }
    case 'pairCancel':
      require('./23-api-security.js').cancelPairingCode();
      return { ok: true, action };
    // Read-only: the paired devices, and whether a code is still waiting.
    case 'devices': {
      const security = require('./23-api-security.js');
      return { ok: true, action, devices: security.listDevices(), pairing: security.pairingStatus() };
    }
    case 'revokeDevice': {
      const removed = require('./23-api-security.js').revokeDevice(String(arg || ''));
      if (removed) logAction('  device removed');
      return { ok: removed, action };
    }
    case 'rollApiToken':
      // No restart needed: 17-api.js's isAuthorized() reads the token
      // file fresh on every single request rather than caching it at
      // startup, specifically so a roll takes effect on the very next
      // request instead of requiring the server to be bounced.
      require('./23-api-security.js').rollToken();
      redraw();
      return { ok: true, action };
    // arg is the version being dismissed, plain text — a version
    // string never needs the base64url-JSON treatment 'config' and the
    // virtual-assignment actions below use for structured payloads. See
    // 26-update-check.js's own header comment for why this writes
    // dismissedVersion from here instead of 16-summary.swift's own
    // update check doing it directly.
    case 'dismissUpdate':
      require('./26-update-check.js').dismissUpdate(arg);
      redraw();
      return { ok: true, action };
    // Starts the actual download — see 26-update-check.js's own header
    // comment for why the fetch itself lives there and not in
    // 16-summary.swift. Async, same "started, not finished" contract
    // 'check'/'reload' already use: main() returns right away while
    // the download keeps running.
    //
    // ONLY REACHABLE FROM THE API TODAY, DELIBERATELY NOT FROM THE
    // BRIDGE. 17-api.js calls main() as a plain in-process function —
    // its own long-running server process stays alive regardless, so
    // the download finishing later is genuinely fire-and-forget from
    // its point of view. The napominalka:// bridge is different: it
    // invokes this exact file as a fresh, short-lived CLI process (see
    // runAction() in 16-summary.swift), and nothing here ever calls
    // process.exit() — Node keeps a process alive for as long as
    // there's a pending callback, an open download socket included.
    // 'check'/'reload' avoid that by detaching their real work into a
    // SEPARATE child process before returning; this case doesn't. A
    // future page-side "download now" button would need the same
    // detach, not a direct call through this path, or the click would
    // just hang until the whole .dmg finished downloading.
    case 'downloadUpdate': {
      const result = require('./26-update-check.js').downloadUpdate();
      return { ok: result.ok, action, ...result };
    }

    // ── Virtual assignments — see 24-virtual-assignments.js's own
    // header comment for what these are and why they're not just
    // another Classroom/Canvas/Edpuzzle source. 'virtualCreate' carries
    // {title, class, due} the same base64url-JSON way 'config' carries
    // a settings batch (see applyBatch's own comment in 19-settings.js)
    // — one short id fits in a napominalka:// URL segment, a title
    // typed by hand with commas and slashes in it doesn't. The rest
    // just take the id directly, same as hide/unhide above.
    case 'virtualCreate': {
      const va = require('./24-virtual-assignments.js');
      let payload;
      try {
        const normal = String(arg).replace(/-/g, '+').replace(/_/g, '/');
        payload = JSON.parse(Buffer.from(normal, 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      const result = va.create({ title: payload.title, class: payload.class, due: payload.due, id: payload.id });
      if (!result.ok) return { ok: false, action, why: result.why };
      redrawCards();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualEdit': {
      const va = require('./24-virtual-assignments.js');
      let payload;
      try {
        const normal = String(arg).replace(/-/g, '+').replace(/_/g, '/');
        payload = JSON.parse(Buffer.from(normal, 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      if (!payload.id) return { ok: false, action, why: 'id is required' };
      const result = va.edit(payload.id, payload);
      if (!result.ok) return { ok: false, action, why: result.why };
      redrawCards();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualDone':
    case 'virtualUndone': {
      const result = require('./24-virtual-assignments.js').markDone(arg, action === 'virtualDone');
      if (!result.ok) return { ok: false, action, why: result.why };
      redrawCards();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualHide':
    case 'virtualUnhide': {
      const result = require('./24-virtual-assignments.js').setHidden(arg, action === 'virtualHide');
      if (!result.ok) return { ok: false, action, why: result.why };
      redrawCards();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualDelete': {
      const result = require('./24-virtual-assignments.js').remove(arg);
      if (!result.ok) return { ok: false, action, why: result.why };
      redrawCards();
      return { ok: true, action, entry: result.entry };
    }
    // The PDF workspace (46-workspace.js). The app runs workspacePage
    // before it opens the window, so the page is always this version's, in
    // the current language. workspaceImport gets the path the app's file
    // picker chose, percent-encoded.
    case 'workspacePage':
      require('./46-workspace.js').writeWorkspacePage();
      return { ok: true, action };
    case 'workspaceImport': {
      const result = require('./46-workspace.js').importPdf(safeDecode(arg));
      return { ...result, action };
    }
    case 'workspaceList':
      return { ok: true, action, docs: require('./46-workspace.js').listDocs() };
    case 'workspaceRemove':
      return { ...require('./46-workspace.js').removeDoc(arg), action };
    // The workspace's AI sidebar (49-ai-sidebar.js): a question, as
    // base64url JSON {doc, page, question, hints, live, web}: web, the panes
    // whose pages it may see (saved just before by the Mac app). Logs only whether
    // it worked, never the question or the answer.
    case 'workspaceAsk': {
      let payload;
      try {
        payload = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) || {};
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      // The web pages saved for it are gone afterwards, however it went.
      const forget = () => { try { fs.rmSync(require('./47-ai-tools.js').webDir(), { recursive: true, force: true }); } catch {} };
      return require('./49-ai-sidebar.js').ask(payload.question, { doc: payload.doc, page: payload.page, hints: payload.hints, live: payload.live, web: payload.web }).then(result => {
        forget();
        logAction(result.ok ? '  workspace question answered' : `  workspace question not answered: ${result.why}${result.detail ? ' (' + result.detail + ')' : ''}`);
        const { t } = require('./18-language.js');
        return result.ok ? { ...result, action } : { ...result, action, why: t('wsAiWhy_' + result.why) + (result.detail ? ' ' + result.detail : '') };
      });
    }
    // A PDF's chat, and whether the sidebar can ask (and why not).
    case 'workspaceChat': {
      const side = require('./49-ai-sidebar.js');
      const can = side.canAsk();
      const { t } = require('./18-language.js');
      return { ok: true, ...side.readChat(arg), can: can.ok ? { ok: true, label: can.label, tools: can.tools } : { ok: false, why: t('wsAiWhy_' + can.why) }, action };
    }
    case 'workspaceChatClear':
      return { ...require('./49-ai-sidebar.js').clearChat(arg), action };
    // "<doc>:1" or "<doc>:0": Hints only for that PDF.
    case 'workspaceChatHints': {
      const [doc, on] = String(arg).split(':');
      return { ...require('./49-ai-sidebar.js').setHints(doc, on === '1'), action };
    }
    // The workspace's desk (50-desk.js): its layout and bookmarks, the
    // saved one as base64url JSON, cleaned before it's written.
    case 'workspaceDesk':
      return { ok: true, desk: require('./50-desk.js').readDesk(), action };
    case 'workspaceDeskSave': {
      let raw;
      try {
        raw = JSON.parse(Buffer.from(String(arg).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      } catch (e) {
        return { ok: false, action, why: 'could not parse: ' + e.message };
      }
      return { ok: require('./50-desk.js').writeDesk(raw).ok, action };
    }
    // Whether the app draws web panes itself. The Mac and Windows apps
    // answer this one before it gets here; anywhere it does get here (a
    // page in a plain browser), nothing can.
    case 'webCaps':
      return { ok: true, web: false, action };
    default:
      console.error('unknown napominalka action:', action);
      process.exitCode = 1;
      return { ok: false, action, why: `unknown action: ${action}` };
  }
}

module.exports = {
  setInServer(yes) { inServer = yes; }, main, redrawCards, appendLine, removeLine, readLines, ensureApiServer };

if (require.main === module) {
  const [action, arg] = process.argv.slice(2);
  let result;
  try {
    result = main(action, arg || '');
  } catch (e) {
    // A CRASH HERE USED TO MEAN THE CALLER GOT NOTHING AT ALL.
    //
    // Whatever ran this — the AppleScript notifier's `do shell script`,
    // or the native window's own bridge in 16-summary.swift — needs
    // SOME answer even when this throws outright. An unhandled
    // exception with empty stdout looked exactly like a click that
    // never reached here, which is the one thing this file exists to
    // stop being ambiguous. So this is the one place that can't itself
    // become the next silent failure.
    logAction(`  CRASHED: ${e.message}`);
    result = { ok: false, action, why: e.message };
    process.exitCode = 1;
  }
  // Printed as the LAST line of stdout, always. 16-summary.swift's
  // bridge and 07-notifier.applescript's dispatch both read this
  // program's own answer instead of guessing from a bare exit code.
  // (importCalendarPdf answers with a promise; everything else at once.)
  // Straight to stdout, not console.log: an action that loads the collector
  // (05-playwright-draft.js, through the Home API's gather() for the Grades
  // center's or the workspace's AI) has it put the time in front of every
  // console line, and "12:01:20 {...}" isn't JSON, so the app never got the
  // answer.
  Promise.resolve(result).catch(e => {
    logAction(`  CRASHED: ${e.message}`);
    process.exitCode = 1;
    return { ok: false, action, why: e.message };
  }).then(answer => process.stdout.write(JSON.stringify(answer) + '\n'));
}
