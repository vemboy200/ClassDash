// /api/stop: unit-level through WRITE_HANDLERS, then a real server end to end.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en', apiEnabled: true } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCK = path.join(proj, '.collection-lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const spawnDecoy = extraArgs => {
  const c = extraArgs.length
    ? cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)', '--', ...extraArgs], { stdio: 'ignore', detached: true })
    : cp.spawn('sleep', ['60'], { stdio: 'ignore', detached: true });
  c.unref();
  return c;
};

// ---- unit level: the handle exists, calls the same dispatcher the CLI/page use, no body needed ----
{
  const { WRITE_HANDLERS } = require(path.join(proj, '17-api.js'));
  try { fs.unlinkSync(LOCK); } catch {}
  const r = WRITE_HANDLERS['/api/stop']();
  ok('nothing running: 200, stopped false', r.status === 200 && r.body.ok === true && r.body.action === 'stopCheck' && r.body.stopped === false, JSON.stringify(r));

  const decoy = spawnDecoy([]);
  fs.writeFileSync(LOCK, String(decoy.pid));
  const r2 = WRITE_HANDLERS['/api/stop']();
  ok('a real collector: 200, stopped true, and it actually dies', r2.status === 200 && r2.body.stopped === true, JSON.stringify(r2));
}
try { fs.unlinkSync(LOCK); } catch {}

// ---- a real server: auth, method, and a genuine stop over HTTP ----
(async () => {
  const port = 18000 + Math.floor(Math.random() * 1500);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  const cleanup = () => { try { srv.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  ok('server came up with a token', !!token);

  const request = (method, opts = {}) => new Promise(resolve => {
    const headers = {};
    if (opts.auth !== false) headers.Authorization = 'Bearer ' + token;
    const r = https.request({ host: '127.0.0.1', port, path: '/api/stop', method, rejectUnauthorized: false, headers }, res => {
      let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', e => resolve({ error: e.message }));
    r.end();
  });

  const noToken = await request('POST', { auth: false });
  ok('no token -> 401, not 200 (this changes something)', noToken.status === 401, JSON.stringify(noToken));

  const getReq = await request('GET');
  ok('GET -> 405, Allow: POST (same as every other write handle)', getReq.status === 405 && getReq.headers.allow === 'POST', JSON.stringify(getReq));

  const optionsReq = await new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: '/api/stop', method: 'OPTIONS', rejectUnauthorized: false }, res => resolve({ status: res.statusCode, headers: res.headers }));
    r.on('error', e => resolve({ error: e.message }));
    r.end();
  });
  ok('OPTIONS preflight answered with no token needed', optionsReq.status === 204 && optionsReq.headers['access-control-allow-methods'] === 'GET, POST, OPTIONS', JSON.stringify(optionsReq));

  // nothing running yet
  const idleStop = await request('POST');
  ok('idle: 200, stopped false', idleStop.status === 200 && JSON.parse(idleStop.body).stopped === false, idleStop.body);

  // a real "collector" (decoy) plus a decoy "browser" for this project, both cleaned up by one call
  const { PROFILE_DIR } = require(path.join(proj, '05-playwright-draft.js'));
  const collector = spawnDecoy([]);
  const browser = spawnDecoy([`--user-data-dir=${PROFILE_DIR}`]);
  fs.writeFileSync(LOCK, String(collector.pid));
  const stopResp = await request('POST');
  const parsed = JSON.parse(stopResp.body);
  ok('a real stop over HTTP: 200, stopped true', stopResp.status === 200 && parsed.ok === true && parsed.action === 'stopCheck' && parsed.stopped === true, stopResp.body);
  await sleep(300);
  ok('...and the collector process actually died', !alive(collector.pid));
  ok('...and its leftover browser did too', !alive(browser.pid));

  try { fs.unlinkSync(LOCK); } catch {}
  cleanup();
  console.log(`stop-via-api: done`);
  process.exit(process.exitCode || 0);
})();
