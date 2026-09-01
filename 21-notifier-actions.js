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

const QUIET_FILE = path.join(__dirname, 'не-срочно.txt');
const HIDDEN_FILE = path.join(__dirname, 'скрытые.txt');
const ACTION_LOG = path.join(__dirname, 'notifier-log.txt');

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

/** Same idea as fullCheck(), but the quick pass (Classroom + Canvas,
 *  no Edpuzzle window, ~17 seconds) — enough to make a saved setting
 *  actually apply. A saved exclusion only changes what gets fetched on
 *  the NEXT collection; a redraw just re-renders what's already there,
 *  which is why saving used to look like it did nothing at all. */
function quickCheck() {
  const child = spawn(process.execPath,
    [path.join(__dirname, '05-playwright-draft.js')],
    { detached: true, stdio: 'ignore', cwd: __dirname });
  child.unref();
}

/** Starts 17-api.js as a detached background process, if it isn't
 *  already running — called when the settings-panel toggle turns
 *  apiEnabled on. Generates the cert/token FIRST, synchronously, in
 *  THIS process, rather than leaving it to the spawned server's own
 *  startup — see 23-api-security.js's own comment on why that avoids a
 *  real race against the redraw that follows right after, which reads
 *  those same files to show the token in the settings panel.
 *
 *  `network` passes --network through to 17-api.js, binding 0.0.0.0
 *  instead of 127.0.0.1 — see apiNetwork's own comment in 19-settings.js
 *  for why that's the default. Which interface it bound to is decided
 *  once, at process startup; changing it later means actually restarting
 *  the process, not just flipping a setting — see the 'config' case
 *  below, which stops it first whenever apiNetwork changes too, not
 *  only when apiEnabled itself does. */
function startApiServer(network) {
  const security = require('./23-api-security.js');
  if (security.isServerRunning()) return;
  security.ensureCert();
  security.ensureToken();
  const args = [path.join(__dirname, '17-api.js')];
  if (network) args.push('--network');
  const child = spawn(process.execPath, args,
    { detached: true, stdio: 'ignore', cwd: __dirname });
  child.unref();
}

/** Blocks the calling thread — Node has no sleep() built in, and this
 *  needs to be a genuine, synchronous pause, not a setTimeout a script
 *  that's about to exit anyway would never actually wait for. Atomics.wait
 *  on the main thread is specifically allowed in Node (unlike a browser). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Stops it — apiEnabled turned off. SIGTERM, not SIGKILL: 17-api.js
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
  const pid = parseInt(fs.readFileSync(security.PID_FILE, 'utf8'), 10);
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
function main(action, arg) {
  logAction(`${action} ${arg}`);
  switch (action) {
    case 'config': {
      const { applyBatch } = require('./19-settings.js');
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

      // NOT EVERY SAVED SETTING NEEDS A REAL FETCH TO TAKE EFFECT.
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
      // Only two settings actually change what gets FETCHED: exclusions
      // (a class has to stop being read, and its old data purged — see
      // the diffWithPrevious comment on EXCLUDED CLASSES for why that
      // specifically needs a real pass) and canvas (a different data
      // source entirely). Only those two get the slow path.
      // result.changed, NOT result.accepted: the page sends every field
      // on every save, whether the user touched it or not, so
      // "exclusions was accepted" is true on essentially every save —
      // changed is specifically "this value is actually different from
      // what settings.json already had" (see applyBatch's own comment).
      const NEEDS_REAL_FETCH = ['exclusions', 'canvas'];
      const needsFetch = result.changed.some(key => NEEDS_REAL_FETCH.includes(key));

      // apiEnabled/apiNetwork start, stop, or rebind a whole separate
      // background process — orthogonal to needsFetch above (neither
      // touches Classroom/Canvas at all), so it's handled alongside
      // that check, not instead of it.
      //
      // BOTH keys trigger this, not just apiEnabled: which interface
      // 17-api.js binds to is decided once, at its own startup, so
      // apiNetwork changing while the server's already running does
      // nothing on its own unless the process actually restarts. Always
      // stopping first (harmless no-op if nothing's running — see
      // stopApiServer()) then starting fresh handles every case the
      // same way: freshly enabled, freshly disabled, or just switching
      // between localhost-only and LAN-visible while already on.
      if (result.changed.includes('apiEnabled') || result.changed.includes('apiNetwork')) {
        const { apiEnabled, apiNetwork } = require('./19-settings.js').read();
        stopApiServer();
        if (apiEnabled) {
          startApiServer(apiNetwork);
          logAction(`  home API server started (${apiNetwork ? 'network' : 'localhost-only'})`);
        } else {
          logAction('  home API server stopped');
        }
      }

      if (needsFetch) {
        quickCheck();
        logAction('  quick collection started (fetch-affecting setting changed)');
      } else {
        redraw();
        logAction('  redrawn only (no fetch-affecting setting changed)');
      }
      return {
        ok: true, action, accepted: result.accepted, rejected: result.rejected,
        mode: needsFetch ? 'quick' : 'redraw',
      };
    }
    case 'quiet':
      appendLine(QUIET_FILE, arg);
      redraw();
      return { ok: true, action };
    case 'unquiet':
      removeLine(QUIET_FILE, arg);
      redraw();
      return { ok: true, action };
    case 'hide':
      appendLine(HIDDEN_FILE, arg);
      redraw();
      return { ok: true, action };
    case 'unhide':
      removeLine(HIDDEN_FILE, arg);
      redraw();
      return { ok: true, action };
    case 'check':
      fullCheck();
      return { ok: true, action };
    // The quick pass (Classroom + Canvas, ~17s, no Edpuzzle window) —
    // 'config' above already starts one internally when a fetch-
    // affecting setting changes, but wasn't reachable as its own
    // action. Added for the home API's /api/reload, which needs the
    // same "lighter than a full check" option 'check' already gives it
    // for a real full one. Same "started, not finished" contract as
    // 'check': this returns immediately, the pass runs detached.
    case 'reload':
      quickCheck();
      return { ok: true, action };
    case 'rollApiToken':
      // No restart needed: 17-api.js's isAuthorized() reads the token
      // file fresh on every single request rather than caching it at
      // startup, specifically so a roll takes effect on the very next
      // request instead of requiring the server to be bounced.
      require('./23-api-security.js').rollToken();
      redraw();
      return { ok: true, action };

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
      const result = va.create(payload);
      if (!result.ok) return { ok: false, action, why: result.why };
      redraw();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualDone':
    case 'virtualUndone': {
      const result = require('./24-virtual-assignments.js').markDone(arg, action === 'virtualDone');
      if (!result.ok) return { ok: false, action, why: result.why };
      redraw();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualHide':
    case 'virtualUnhide': {
      const result = require('./24-virtual-assignments.js').setHidden(arg, action === 'virtualHide');
      if (!result.ok) return { ok: false, action, why: result.why };
      redraw();
      return { ok: true, action, entry: result.entry };
    }
    case 'virtualDelete': {
      const result = require('./24-virtual-assignments.js').remove(arg);
      if (!result.ok) return { ok: false, action, why: result.why };
      redraw();
      return { ok: true, action, entry: result.entry };
    }
    default:
      console.error('unknown napominalka action:', action);
      process.exitCode = 1;
      return { ok: false, action, why: `unknown action: ${action}` };
  }
}

module.exports = { main, appendLine, removeLine, readLines };

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
  console.log(JSON.stringify(result));
}
