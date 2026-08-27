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

function main(action, arg) {
  switch (action) {
    case 'config': {
      const { applyBatch } = require('./19-settings.js');
      const result = applyBatch(arg);
      if (!result.ok) console.error('settings not applied:', result.rejected);
      redraw();
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
