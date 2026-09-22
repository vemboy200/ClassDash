/**
 * What every test file shares.
 *
 * ── Isolation is the point ──
 *
 * A test never touches the project it runs from. makeProject() builds a
 * throwaway project in the system's temp folder out of this repo's own code
 * (the same allowlist the apps bundle as their template: src/'s scripts,
 * settings.example.json and the icons, plus package.json from the true
 * repo root — see 00-project-root.js for why that split matters), links
 * the repo's node_modules into it, and hands back its path. The scripts
 * read and write their settings and data next to themselves, so a test's
 * settings.json, summary.html, logs and pid files all land in the temp
 * folder — never in a developer's real project, and never on a real API
 * port.
 *
 * ── Why the test dependencies live in test/, not the root ──
 *
 * jsdom is large, and the apps bundle the ROOT node_modules into every
 * installer. Keeping it in test/package.json means it can never ship.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..');

// What the apps bundle as a project template (see build.sh and
// electron/package.json): nothing else in src/ is a project file.
const ICONS = ['refresh-icon.png', 'freshcheck-icon.png', 'settings-icon.png',
               'loading-icon.png', 'loading-icon-light.png', 'stop-icon.png'];
const isProjectFile = name =>
  name.endsWith('.js') || name === 'package.json' || name === 'settings.example.json' || ICONS.includes(name);

const made = [];
process.on('exit', () => {
  for (const dir of made) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** A temp folder that is removed when the test process exits. */
function tmpDir(prefix = 'classdash-test-') {
  // The REAL path: on macOS the temp folder is reached through a symlink
  // (/var -> /private/var), and Node's module cache is keyed by real paths, so
  // a test that clears the cache for "modules under this folder" would
  // otherwise match nothing.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** Writes files into a folder: name -> string | Buffer | plain object (as JSON). */
function writeFiles(dir, files = {}) {
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, (typeof body === 'string' || Buffer.isBuffer(body)) ? body : JSON.stringify(body, null, 2));
  }
}

/**
 * A fresh, isolated project: this repo's scripts and icons, a linked
 * node_modules, and whatever files the test asks for.
 *
 *   makeProject({ 'settings.json': { language: 'en' }, 'classes.json': [...] })
 */
function makeProject(files = {}) {
  const dir = tmpDir();
  // package.json is the one project file that stays at the true repo
  // root, never inside src/ — see 00-project-root.js's own header
  // comment for why that matters: its absence from src/ is exactly what
  // tells a script running from source "your data is one level up", and
  // a scratch project must never trigger that (it's meant to look exactly
  // like a real deployed project, where package.json IS a sibling).
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
  for (const entry of fs.readdirSync(path.join(REPO, 'src'), { withFileTypes: true })) {
    if (entry.isFile() && isProjectFile(entry.name)) {
      fs.copyFileSync(path.join(REPO, 'src', entry.name), path.join(dir, entry.name));
    }
  }
  const modules = path.join(REPO, 'node_modules');
  if (!fs.existsSync(modules)) {
    throw new Error('the project root has no node_modules — run `npm ci` in the repository root first');
  }
  fs.symlinkSync(modules, path.join(dir, 'node_modules'), 'dir');
  writeFiles(dir, files);
  return dir;
}

/** Runs a project script to completion; returns {status, stdout, stderr}. */
function run(dir, script, args = [], options = {}) {
  return cp.spawnSync(process.execPath, [path.join(dir, script), ...args],
    { cwd: dir, encoding: 'utf8', ...options });
}

/** Rebuilds summary.html from what's in the project, without collecting. */
function redraw(dir) {
  const r = run(dir, '05-playwright-draft.js', ['--redraw']);
  if (r.status !== 0) throw new Error('--redraw failed: ' + (r.stderr || r.stdout));
}

/** jsdom lives in test/node_modules. A missing install gets a clear message;
 *  any other failure (say, a jsdom too new for this Node) is passed on as it is
 *  rather than being mistaken for "not installed".
 *
 *  The JSDOM it returns hands every page TextEncoder/TextDecoder when the
 *  installed jsdom doesn't (older ones don't; every real browser does, and the
 *  page's base64 encoding of a settings save uses them), so the same tests pass
 *  on every jsdom version the test dependency allows. */
function jsdom() {
  let lib;
  try {
    lib = require('jsdom');
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && /jsdom/.test(e.message)) {
      throw new Error('jsdom is missing — run `npm install --prefix test` first');
    }
    throw e;
  }
  const withEncoders = (options = {}) => {
    const before = options.beforeParse;
    return {
      ...options,
      beforeParse(window) {
        if (!window.TextEncoder) { window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder; }
        if (before) before(window);
      },
    };
  };
  class JSDOM extends lib.JSDOM {
    constructor(html, options) { super(html, withEncoders(options)); }
    static fromFile(file, options) { return lib.JSDOM.fromFile(file, withEncoders(options)); }
    static fromURL(url, options) { return lib.JSDOM.fromURL(url, withEncoders(options)); }
  }
  return { ...lib, JSDOM };
}

// ── Checking things ──
//
// Every test file prints only what fails, and exits non-zero if anything did.
// Both spellings exist because the older tests were written as ok(name, cond)
// and the newer ones as ok(cond, name); ok() takes either.
let passed = 0;
let failed = 0;

function ok(a, b, c) {
  const [cond, name, extra] = (typeof a === 'string') ? [b, a, c] : [a, b, c];
  if (cond) { passed++; return; }
  failed++;
  console.log('FAIL', name, extra === undefined || extra === '' ? '' : String(extra));
  process.exitCode = 1;
}

function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name,
     `\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`);
}

/** Prints the tally; the runner reads the exit code, not this line. */
function done(name = path.basename(process.argv[1], '.test.js')) {
  console.log(`${name}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (check()) return true; await sleep(30); }
  return check();
}

/** A settings save as the page sends it: base64url of JSON. */
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * A project with a few classes and one assignment in each — enough for the
 * settings panel's class list, the filters and the cards to exist.
 */
function classProject(names = ['Chemistry', 'History', 'Math', 'Spanish'], files = {}) {
  const due = new Date(Date.now() + 3 * 864e5).toISOString();
  return makeProject({
    'classes.json': names.map(name => ({ name })),
    'last-collection.json': names.map((name, i) => ({
      class: name, id: 'a' + i, type: 'Assignment', title: 'Work ' + i, due: null, due_iso: due, link: 'x',
    })),
    ...files,
  });
}

module.exports = {
  REPO, makeProject, classProject, tmpDir, writeFiles, run, redraw, jsdom,
  ok, eq, done, sleep, until, enc,
};
