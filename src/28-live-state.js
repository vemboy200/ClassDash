/**
 * What lets an OPEN summary page notice things without being refreshed:
 * that a newer page has been written, and that a collection is running.
 *
 * Two facts, each written to `live/` twice — as JSON and as a one-line
 * script — because there are two ways for a page to get at them:
 *
 *   live/page-version.json / .js   <number>          / window.classdashPageVersion = <number>;
 *   live/check-run.json / .js      {running, done,   / window.classdashCheckRun = {...};
 *                                   total, at}
 *
 * PUSHED (preferred). The app that hosts the page — 16-summary.swift on
 * macOS, electron/main.js on Windows — watches this folder and, when
 * anything in it changes, reads the two .json files and calls
 * window.classdashLiveChanged({run, version}) inside the page. Nothing
 * polls, and the page hears about a change the moment it's written.
 *
 * POLLED (fallback). A page opened as a plain browser tab has no app
 * around it to push, and can't read files or hold a connection either.
 * What it CAN do is load a script tag, so until (unless) something pushes,
 * it re-loads the two .js files every few seconds (see "Live updates" in
 * 08-page.js). That is also what keeps a page working under an app that
 * hasn't been rebuilt to push yet.
 *
 * The folder is its own, not the project root, because build.sh and
 * electron-builder both bundle `*.js` from the root into the installer's
 * template — a generated file named *.js there would ship inside every
 * install.
 *
 * ── Why two files and not one ──
 *
 * Different processes write them: writePage() (08-page.js, which also runs
 * from settings saves, hides and the API) owns the version, and a
 * collection owns the run. One file would have two writers racing to
 * replace each other's half.
 *
 * ── Why the run has a heartbeat ──
 *
 * A collection that dies (killed, crashed, the laptop lid closing) can't
 * write "finished". Every few seconds the run stamps `at`, and a page
 * treats a run whose stamp has stopped advancing as over, whether or not
 * it said so. (Each stamp is also a file change, so under a pushing app
 * the heartbeat doubles as the nudge that keeps the page's copy fresh.)
 *
 * Nothing here is allowed to break a collection: every write is wrapped,
 * and a failure just means the page doesn't get the live extras.
 */

const fs = require('fs');
const path = require('path');

const HEARTBEAT_MS = 4000;

// A run whose stamp is older than this counts as over. The page uses the same
// number (LIVE_STALE_MS in 08-page.js), so the page and the API never
// disagree about whether a check is running.
const STALE_MS = 30000;

function liveDir(baseDir) {
  return path.join(baseDir, 'live');
}

// Written to a temp name and renamed into place: a page polling at the
// wrong instant would otherwise catch a half-written file, which is a
// syntax error in a script tag and just silently fails to load.
function writeAtomic(baseDir, name, body) {
  const dir = liveDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, name + '.tmp');
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, path.join(dir, name));
}

/** Called by writePage() right after the page itself is on disk. The number
 *  is also baked into that page, and a page reloads only when the file
 *  holds a LARGER one — so a failed or out-of-order write here can leave a
 *  page un-refreshed, but can never make it reload in a loop. */
function publishPageVersion(baseDir, version) {
  try {
    const n = Number(version);
    writeAtomic(baseDir, 'page-version.json', `${n}\n`);
    writeAtomic(baseDir, 'page-version.js', `window.classdashPageVersion = ${n};\n`);
  } catch (e) {
    console.warn('couldn\'t publish the page version:', e.message);
  }
}

// ── The run a collection reports ──

const run = { baseDir: null, running: false, done: 0, total: 0, timer: null };

function writeRun() {
  if (!run.baseDir) return;
  try {
    const state = JSON.stringify({
      running: run.running, done: run.done, total: run.total, at: Date.now(),
    });
    writeAtomic(run.baseDir, 'check-run.json', state + '\n');
    writeAtomic(run.baseDir, 'check-run.js', 'window.classdashCheckRun = ' + state + ';\n');
  } catch { /* the page just won't get a bar */ }
}

/** A collection has begun. total is unknown until the class list has been
 *  read, so it starts at 0 and the page shows "starting" until it isn't. */
function startRun(baseDir) {
  run.baseDir = baseDir;
  run.running = true;
  run.done = 0;
  run.total = 0;
  writeRun();
  clearInterval(run.timer);
  run.timer = setInterval(writeRun, HEARTBEAT_MS);
  // unref: a heartbeat must never be what keeps a finished process alive.
  run.timer.unref();
}

function setProgress(done, total) {
  if (!run.running) return;
  run.done = done;
  run.total = total;
  writeRun();
}

/** Synchronous on purpose — it's also the process's 'exit' handler, where
 *  nothing async gets to finish. Safe to call more than once. */
function endRun() {
  if (!run.running) return;
  run.running = false;
  clearInterval(run.timer);
  writeRun();
}

/**
 * The collection as the home API reports it (/api/collection), read from
 * the file a run writes, so it works from any process — the API doesn't
 * need to be the one collecting.
 *
 *   running    a run is under way: it said so AND its heartbeat is recent.
 *              A run that died can't write "finished", so a stopped
 *              heartbeat counts as over, same as on the page.
 *   done/total sources read of sources to read. total is 0 while the class
 *              list is still being read ("starting").
 *   percent    0-100 once total is known; null while starting.
 *   updatedAt  the run's last heartbeat, ISO — the run's own, not the clock's.
 *
 * done, total and percent are null unless a run is going: the numbers of a
 * finished or dead run describe nothing anyone can act on.
 */
function readCollection(baseDir, now = Date.now()) {
  let file = null;
  try {
    file = JSON.parse(fs.readFileSync(path.join(liveDir(baseDir), 'check-run.json'), 'utf8'));
  } catch { /* no run has ever been written, or it's mid-rename: nothing running */ }

  const stamp = file && Number.isFinite(file.at) ? file.at : null;
  const running = !!(file && file.running === true && stamp !== null && now - stamp < STALE_MS);
  const total = running ? Math.max(0, Number(file.total) || 0) : null;
  const done = running ? Math.min(Math.max(0, Number(file.done) || 0), total) : null;
  return {
    running,
    done,
    total,
    percent: running && total > 0 ? Math.round(done / total * 100) : null,
    updatedAt: stamp !== null ? new Date(stamp).toISOString() : null,
  };
}

module.exports = { publishPageVersion, startRun, setProgress, endRun, readCollection, HEARTBEAT_MS, STALE_MS };
