// The home API server keeps a log, survives a stray error, and is started
// again by the next check if it stopped anyway. Scratch project, private
// port — never the real server or port 8734.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process'), https = require('https');
const PROJ = T.makeProject(); process.chdir(PROJ);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 18997;
const PID = path.join(PROJ, 'api-server.pid');
// {pid, boot} since the restart check; a bare number before it.
const readPidFile = () => { const t = fs.readFileSync(PID, 'utf8'); try { const j = JSON.parse(t); return parseInt(typeof j === 'object' ? j.pid : j, 10); } catch { return parseInt(t, 10); } };
const LOG = path.join(PROJ, 'api-log.txt');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pid = () => { try { return readPidFile() || 0; } catch { return 0; } };
const ensure = () => JSON.parse(cp.spawnSync('node', ['-e', "console.log(JSON.stringify(require('./21-notifier-actions.js').ensureApiServer()))"], { cwd: PROJ, encoding: 'utf8' }).stdout.trim().split('\n').pop());
const waitFor = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (f()) return true; await sleep(100); } return false; };
const get = (p) => new Promise((resolve) => {
  const token = fs.readFileSync(path.join(PROJ, 'api-token.txt'), 'utf8').trim();
  https.get({ host: '127.0.0.1', port: PORT, path: p, rejectUnauthorized: false, headers: { Authorization: 'Bearer ' + token } },
    res => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
});
const kill = () => { const p = pid(); if (p) try { process.kill(p, 'SIGKILL'); } catch {} try { fs.unlinkSync(PID); } catch {} };

(async () => {
  fs.writeFileSync('settings.json', JSON.stringify({ apiEnabled: false, apiPort: PORT, apiNetwork: false }));
  ok('switched off: a check starts nothing', ensure() === false && !pid());

  fs.writeFileSync('settings.json', JSON.stringify({ apiEnabled: true, apiPort: PORT, apiNetwork: false }));
  ok('switched on but not running: a check starts it', ensure() === true);
  ok('...and it comes up', await waitFor(() => pid() && alive(pid())));
  ok('...and answers', await waitFor(() => false, 300) || await get('/api/status') === 200);
  ok('a running server is left alone', ensure() === false);
  const log = fs.readFileSync(LOG, 'utf8');
  ok('its output goes to api-log.txt, with timestamps', /^\d{4}-\d\d-\d\dT[^ ]+ Home API listening/m.test(log), log.slice(0, 300));
  ok('...but never the access key', !log.includes(fs.readFileSync('api-token.txt', 'utf8').trim()) && /in api-token\.txt/.test(log));
  ok('the check that restarted it says so in notifier-log.txt', /started it again/.test(fs.readFileSync('notifier-log.txt', 'utf8')));

  // stopped by something nothing caught: the next check brings it back
  const before = pid();
  process.kill(before, 'SIGKILL');
  await waitFor(() => !alive(before));
  ok('killed outright: the next check starts it again', ensure() === true && await waitFor(() => pid() && pid() !== before && alive(pid())));
  kill();

  // a stray error inside the server is written down and survived
  fs.writeFileSync('boom.js', "setTimeout(() => { throw new Error('test boom') }, 1200);");
  const out = fs.openSync(LOG, 'a');
  const child = cp.spawn(process.execPath, ['-r', './boom.js', '17-api.js', '--port', String(PORT)], { cwd: PROJ, stdio: ['ignore', out, out] });
  fs.closeSync(out);
  await waitFor(() => /test boom/.test(fs.readFileSync(LOG, 'utf8')), 6000);
  await sleep(300);
  ok('an uncaught error is logged…', /unexpected error, still running: Error: test boom/.test(fs.readFileSync(LOG, 'utf8')));
  ok('…and the server is still answering', alive(child.pid) && await get('/api/status') === 200);
  child.kill('SIGKILL');
  try { fs.unlinkSync(PID); } catch {}

  // the log doesn't grow forever
  fs.writeFileSync(LOG, 'x'.repeat(1024 * 1024 + 10));
  ensure();
  await waitFor(() => pid() && alive(pid()));
  ok('over a megabyte, the old log is moved aside', fs.existsSync(path.join(PROJ, 'api-log.old.txt')) && fs.statSync(LOG).size < 1024 * 1024);
  kill();
  process.exit(process.exitCode || 0);
})();
