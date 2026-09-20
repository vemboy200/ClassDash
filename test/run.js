/**
 * Runs every test/*.test.js, each in its own process (they change directory,
 * patch modules and start servers, so they must not share one), and reports
 * one line per file. Exits non-zero if any failed.
 *
 *   npm test                 everything
 *   npm test -- shortcuts    only files whose name contains "shortcuts"
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const filter = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filter.length || filter.some(part => f.includes(part)))
  .sort();

if (!files.length) {
  console.log('no tests matched');
  process.exit(1);
}

let failed = 0;
const started = Date.now();
for (const file of files) {
  const t0 = Date.now();
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: 'utf8', timeout: 180000, cwd: __dirname,
  });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const good = result.status === 0;
  if (!good) failed++;
  console.log(`${good ? '✓' : '✗'} ${file.replace('.test.js', '').padEnd(28)} ${seconds}s`);
  if (!good) {
    const out = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n');
    const interesting = out.filter(line => /FAIL|Error|error:/.test(line));
    console.log((interesting.length ? interesting : out.slice(-12)).slice(0, 30).map(l => '    ' + l).join('\n'));
    if (result.error) console.log('    ' + result.error.message);
  }
}
console.log(`\n${files.length - failed}/${files.length} files passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
