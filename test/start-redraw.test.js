// The server draws the page once when it starts (17-api.js), so a page drawn
// by older code (an update, a restart after one) gets the new look without
// waiting for a check, which may never come with scheduled checks off.
const T = require('./helpers');
const fs = require('fs'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', classroomEnabled: true } });
process.chdir(proj);
(async () => {
  T.redraw(proj);
  // As if drawn by an older version: its look is stale.
  fs.writeFileSync('page-shell.html', fs.readFileSync('page-shell.html', 'utf8').replace('.check-summary-line', '.old-look'));
  const old = new Date(Date.now() - 3600e3);
  fs.utimesSync('page-shell.html', old, old);
  const port = 19900 + Math.floor(Math.random() * 90);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let redrawn = false;
  for (let i = 0; i < 100 && !redrawn; i++) { await sleep(150); redrawn = fs.statSync('page-shell.html').mtimeMs > old.getTime() + 1000; }
  ok(redrawn, 'starting the server draws the page again');
  for (let i = 0; i < 20 && /\.old-look/.test(fs.readFileSync('page-shell.html', 'utf8')); i++) await sleep(150);
  ok(!/\.old-look/.test(fs.readFileSync('page-shell.html', 'utf8')) && /\.check-summary-line/.test(fs.readFileSync('page-shell.html', 'utf8')), '...with the look of the code it runs');
  srv.kill('SIGKILL');
  process.exit(process.exitCode || 0);
})();
