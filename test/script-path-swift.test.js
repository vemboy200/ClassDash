// mac/16-summary.swift's scriptPath(): the Swift-side half of the same fix
// as script-path.test.js (electron/main.js). This is where the real bug
// actually happened live — the already-running, already-compiled Mac app
// kept calling project scripts at their old flat path after they moved
// into src/, and every auto fresh check failed silently with
// MODULE_NOT_FOUND until this was found and fixed.
//
// Compiles the REAL function out of the real source (not a reimplementation
// that could quietly drift from it) into a tiny standalone binary, and runs
// that binary against real folder shapes — the strongest check available
// without a Swift unit-test framework in this repo.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REAL = T.REPO;
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

if (!cp.spawnSync('which', ['swiftc']).stdout.toString().trim()) {
  console.log('script-path-swift: swiftc not found, skipping (Windows/Linux CI has no Swift toolchain)');
  process.exit(0);
}

// ---- every real call site actually goes through scriptPath(), not a raw "dir + / + script" ----
const swiftSrc = fs.readFileSync(path.join(REAL, 'mac', '16-summary.swift'), 'utf8');
const spawnLines = [...swiftSrc.matchAll(/process\.arguments = \["node",[^\n]*/g)].map(m => m[0]);
ok('found the node-spawn lines to check', spawnLines.length >= 4, spawnLines.length);
ok('every one of them calls scriptPath(...) rather than building a flat path itself',
  spawnLines.every(l => /scriptPath\(/.test(l)), spawnLines.filter(l => !/scriptPath\(/.test(l)).join('\n'));

// ---- extract the real function and compile it into a tiny standalone binary ----
const start = swiftSrc.indexOf('func scriptPath(_ script: String, in dir: String) -> String {');
ok('found scriptPath() in mac/16-summary.swift', start !== -1);
const end = swiftSrc.indexOf('\n}\n', start) + 3;
const fnSrc = swiftSrc.slice(start, end);

const dir = T.tmpDir('swift-harness-');
const harnessSrc = path.join(dir, 'harness.swift');
const harnessBin = path.join(dir, 'harness');
fs.writeFileSync(harnessSrc, `import Foundation\n${fnSrc}\nlet args = CommandLine.arguments\nprint(scriptPath(args[1], in: args[2]))\n`);
const build = cp.spawnSync('swiftc', ['-O', harnessSrc, '-o', harnessBin], { encoding: 'utf8' });
ok('the extracted function compiles on its own (proves the extraction is exactly right, not a stale copy)',
  build.status === 0, build.stderr);

const run = (script, projDir) => cp.spawnSync(harnessBin, [script, projDir], { encoding: 'utf8' }).stdout.trim();

// ---- a real deployed project: the script sits flat ----
{
  const proj = T.tmpDir();
  fs.writeFileSync(path.join(proj, '05-playwright-draft.js'), '// flat');
  ok('flat project: finds it right there', run('05-playwright-draft.js', proj) === path.join(proj, '05-playwright-draft.js'));
}

// ---- this app's own source checkout: the script is under src/, nothing flat ----
// (exactly the shape that broke live: the Mac app pointed at its own git checkout)
{
  const proj = T.tmpDir();
  fs.mkdirSync(path.join(proj, 'src'));
  fs.writeFileSync(path.join(proj, 'src', '21-notifier-actions.js'), '// nested');
  ok('nested project (this app\'s own checkout): falls back to src/', run('21-notifier-actions.js', proj) === path.join(proj, 'src', '21-notifier-actions.js'));
}

// ---- neither exists: still returns the src/ guess, doesn't crash ----
{
  const proj = T.tmpDir();
  ok('script genuinely missing: no crash, returns the src/ path anyway', run('17-api.js', proj) === path.join(proj, 'src', '17-api.js'));
}

process.exit(process.exitCode || 0);
