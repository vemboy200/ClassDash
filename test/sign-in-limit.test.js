// The limit on wrong sign-ins (57-sign-in-limit.js), and traffic through a tunnel
// no longer passing for this computer (53-compress.js), against a real server.
// Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const action = (name, arg = '') => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', name, arg], { cwd: proj, encoding: 'utf8' }).stdout.trim().split('\n').pop());
const { isThisComputer, wantsCompression } = require(path.join(proj, '53-compress.js'));
const limit = require(path.join(proj, '57-sign-in-limit.js'));

// ---- the tunnel headers ----
const from = (address, headers = {}) => ({ socket: { remoteAddress: address }, headers });
ok(isThisComputer(from('127.0.0.1')), 'a plain local connection is this computer');
ok(!isThisComputer(from('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' })), 'one through cloudflared is not');
ok(!isThisComputer(from('::1', { 'x-forwarded-for': '203.0.113.9' })), 'nor one through another proxy');
ok(wantsCompression(from('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9', 'accept-encoding': 'gzip' })), 'so it gets compressed answers');

// ---- the count on its own, with a made-up clock ----
const far = from('127.0.0.1', { 'cf-connecting-ip': '203.0.113.10' });
for (let i = 0; i < limit.MOST_WRONG - 1; i++) limit.noteWrong(far, 1000);
ok(limit.waitSeconds(far, 1000) === 0, 'one short of the limit, it can still try');
limit.noteWrong(far, 1000);
ok(limit.waitSeconds(far, 1000) === 60, 'at the limit it waits a minute');
ok(limit.waitSeconds(from('127.0.0.1', { 'cf-connecting-ip': '203.0.113.11' }), 1000) === 0, 'someone else through the same tunnel does not');
ok(limit.waitSeconds(far, 1000 + limit.WINDOW_MS) === 0, 'and after the minute, it can try again');
limit.noteWrong(far, 1000 + limit.WINDOW_MS);
ok(limit.waitSeconds(far, 1000 + limit.WINDOW_MS) === 0, 'starting a new count');
const here = from('127.0.0.1');
for (let i = 0; i < limit.MOST_WRONG * 2; i++) limit.noteWrong(here, 1000);
ok(limit.waitSeconds(here, 1000) === 0, 'this computer is not counted');

(async () => {
  const port = 20500 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  const request = (method, urlPath, headers, body) => new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: urlPath, method, rejectUnauthorized: false, headers }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    r.on('error', e => resolve({ error: e.message }));
    if (body) r.write(body);
    r.end();
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await request('OPTIONS', '/')).error; if (!up) await sleep(100); }
  ok(up, 'server is listening');
  const token = fs.readFileSync('api-token.txt', 'utf8').trim();

  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const stranger = ip => ({ ...form, 'CF-Connecting-IP': ip });
  // Not shaped like a code, so these cost a waiting code nothing, only the count.
  for (let i = 0; i < limit.MOST_WRONG; i++) {
    const r = await request('POST', '/login', stranger('203.0.113.20'), 'token=not-a-real-key');
    if (r.status !== 401) ok(false, 'a wrong try says wrong', JSON.stringify(r));
  }
  let r = await request('POST', '/login', stranger('203.0.113.20'), 'token=' + token);
  ok(r.status === 429 && Number(r.headers['retry-after']) > 0 && /Too many wrong tries/.test(r.body), 'past the limit, even the right key has to wait', JSON.stringify(r.headers));
  ok(!r.headers['set-cookie'], '...and gets no cookie');

  const made = action('pairCode');
  r = await request('POST', '/login', stranger('203.0.113.20'), 'token=' + encodeURIComponent(made.code));
  ok(r.status === 429, 'a pairing code from them is not looked at');
  ok(action('devices').pairing.waiting === true, '...so it is still waiting');
  r = await request('POST', '/api/pair', { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.20' }, JSON.stringify({ code: 'AAA-AAA' }));
  ok(r.status === 429 && Number(r.headers['retry-after']) > 0, '/api/pair waits too');
  ok(action('devices').pairing.waiting === true, '...and that guess cost the code nothing');

  r = await request('POST', '/login', stranger('203.0.113.21'), 'token=' + token);
  ok(r.status === 303, 'someone else with the right key signs in fine');
  r = await request('POST', '/login', form, 'token=' + encodeURIComponent(made.code));
  ok(r.status === 303, 'and the code still works from this computer');
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
