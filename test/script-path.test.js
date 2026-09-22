// electron/main.js's scriptPath(): finds a project script whether it sits
// flat in the project folder (a real, deployed project) or under src/ (this
// app's own source checkout, pointed at itself — see 00-project-root.js's
// own comment for the Node-side half of this same split, and
// mac/16-summary.swift's own scriptPath for the identical Swift-side fix).
//
// Caught live: after the pipeline scripts moved into src/, the ALREADY-
// RUNNING, already-compiled Mac app kept calling them at their old flat
// path — every auto fresh check failed with MODULE_NOT_FOUND for weeks
// on end, silently, because nothing exercised this path end to end.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REAL = T.REPO;
const src = fs.readFileSync(path.join(REAL, 'electron/main.js'), 'utf8');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const a = src.indexOf('function scriptPath(script, dir) {');
const b = src.indexOf('\n}\n', a) + 3;
const fnSrc = src.slice(a, b);
ok('found scriptPath() in electron/main.js (the extraction didn\'t silently grab nothing)', /scriptPath/.test(fnSrc) && fnSrc.length > 20, fnSrc.length);

const ctx = { fs, path };
vm.createContext(ctx);
vm.runInContext(fnSrc + '\nthis.__scriptPath = scriptPath;', ctx);
const scriptPath = ctx.__scriptPath;

// ---- a real deployed project: the script sits flat ----
{
  const dir = T.tmpDir();
  fs.writeFileSync(path.join(dir, '05-playwright-draft.js'), '// flat');
  ok('flat project: finds it right there', scriptPath('05-playwright-draft.js', dir) === path.join(dir, '05-playwright-draft.js'));
}

// ---- this app's own source checkout: the script is under src/, nothing flat ----
{
  const dir = T.tmpDir();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', '21-notifier-actions.js'), '// nested');
  ok('nested project: falls back to src/', scriptPath('21-notifier-actions.js', dir) === path.join(dir, 'src', '21-notifier-actions.js'));
}

// ---- neither exists: still returns the src/ guess rather than throwing ----
{
  const dir = T.tmpDir();
  let threw = null;
  let result;
  try { result = scriptPath('17-api.js', dir); } catch (e) { threw = e; }
  ok('script genuinely missing: no throw, returns the src/ path anyway', !threw && result === path.join(dir, 'src', '17-api.js'), String(threw));
}

// ---- wired into every place electron/main.js actually spawns a project script ----
//
// A test can stub scriptPath and prove runNodeScriptSync/runNodeScriptDetached/
// runAction all call THROUGH it (not around it with a raw path.join), which is
// the exact gap that let the real bug through: the functions existed and
// worked, they just weren't being used everywhere a script gets spawned.
for (const name of ['runNodeScriptSync', 'runNodeScriptDetached', 'runAction']) {
  const start = src.indexOf(`function ${name}(`);
  ok(`${name} is defined`, start !== -1);
  const bodyEnd = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, bodyEnd === -1 ? start + 2000 : bodyEnd);
  ok(`${name} calls scriptPath(...) to find its script, not a raw path.join`, /scriptPath\(/.test(body), body.slice(0, 200));
}

process.exit(process.exitCode || 0);
