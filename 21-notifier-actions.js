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
      } else {
        logAction(`  applied: ${result.accepted.join(', ')}` +
          (result.rejected.length ? ` | refused: ${result.rejected.join('; ')}` : ''));
      }
      quickCheck();
      logAction('  quick collection started');
      break;
    }
    case 'quiet':
      appendLine(QUIET_FILE, arg);
      redraw();
      break;
    case 'unquiet':
      removeLine(QUIET_FILE, arg);
      redraw();
      break;
    case 'hide':
      appendLine(HIDDEN_FILE, arg);
      redraw();
      break;
    case 'unhide':
      removeLine(HIDDEN_FILE, arg);
      redraw();
      break;
    case 'check':
      fullCheck();
      break;
    default:
      console.error('unknown napominalka action:', action);
      process.exitCode = 1;
  }
}

module.exports = { main, appendLine, removeLine, readLines };

if (require.main === module) {
  const [action, arg] = process.argv.slice(2);
  main(action, arg || '');
}
