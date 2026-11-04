// Device keys and pairing codes (23-api-security.js), against a real
// server: a code traded at /login and /api/pair, what it can and can't do,
// a paired device not getting the access key, and removing a device.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const action = (name, arg = '') => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', name, arg], { cwd: proj, encoding: 'utf8' }).stdout.trim().split('\n').pop());

(async () => {
  const port = 19600 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  // A page that has the access key in it, the way Settings → API does.
  fs.writeFileSync(path.join(proj, 'summary.html'), `<!doctype html><head><title>made-up page</title></head><body><input id="api-token-field" value="${token}"></body>`);

  const request = (method, urlPath, { headers = {}, body } = {}) => new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: urlPath, method, rejectUnauthorized: false, headers }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    r.on('error', e => resolve({ error: e.message }));
    if (body) r.write(body);
    r.end();
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await request('OPTIONS', '/')).error; if (!up) await sleep(100); }
  ok('server is listening', up);
  const form = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
  const json = { 'Content-Type': 'application/json' };

  // ---- no code waiting ----
  let r = await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: 'ABC-DEF' }) });
  ok('no code waiting: /api/pair says so', r.status === 410, JSON.stringify(r));
  ok('the devices list starts empty', action('devices').devices.length === 0);

  // ---- a code, traded in a browser ----
  let made = action('pairCode');
  ok('a code is made: 3-3 letters, 10 minutes', /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(made.code) && Math.abs(made.expires - Date.now() - 600000) < 5000, JSON.stringify(made));
  ok('...and only its hash is on disk', !fs.readFileSync('pairing-code.json', 'utf8').includes(made.code.replace('-', '')));
  ok('...and the devices action says one is waiting', action('devices').pairing.waiting === true);
  const asCode = await request('GET', '/api/status', { headers: { Authorization: 'Bearer ' + made.code } });
  ok('the code itself reads nothing', asCode.status === 401);
  r = await request('POST', '/login', { headers: form, body: 'token=' + encodeURIComponent(made.code.toLowerCase()) });
  const cookie = ((r.headers['set-cookie'] || [''])[0]).split(';')[0];
  const deviceKey = cookie.split('=')[1] || '';
  ok('a browser signs in with the code (any case): a cookie with a key of its own', r.status === 303 && /^[0-9a-f]{64}$/.test(deviceKey) && deviceKey !== token, JSON.stringify(r.headers));
  let devices = action('devices').devices;
  ok('...named after the browser', devices.length === 1 && devices[0].name === 'Safari on iPhone', JSON.stringify(devices));
  ok('...without its key or hash in the list', !JSON.stringify(devices).includes(deviceKey) && !('hash' in devices[0]));
  ok('the code is used up', action('devices').pairing.waiting === false);
  r = await request('POST', '/login', { headers: form, body: 'token=' + encodeURIComponent(made.code) });
  ok('...so it can\'t sign in a second browser', r.status === 401 && !r.headers['set-cookie']);

  // ---- what a paired device gets ----
  const page = await request('GET', '/', { headers: { Accept: 'text/html', Cookie: cookie } });
  ok('the paired browser gets the page', page.status === 200 && page.body.includes('made-up page'));
  ok('...without the access key in it', !page.body.includes(token) && page.body.includes('window.classdashPairedDevice = true'));
  const mainCookie = ((await request('POST', '/login', { headers: form, body: 'token=' + token })).headers['set-cookie'] || [''])[0].split(';')[0];
  const mainPage = await request('GET', '/', { headers: { Accept: 'text/html', Cookie: mainCookie } });
  ok('signed in with the access key, the page still has it', mainPage.status === 200 && mainPage.body.includes(token) && !mainPage.body.includes('classdashPairedDevice'));
  ok('a device key works as a bearer token too', (await request('GET', '/api/status', { headers: { Authorization: 'Bearer ' + deviceKey } })).status === 200);
  for (const name of ['pairCode', 'pairCancel', 'revokeDevice', 'rollApiToken']) {
    r = await request('POST', '/api/action', { headers: { ...json, Cookie: cookie }, body: JSON.stringify({ action: name, arg: devices[0].id }) });
    ok(`a device can't ${name} over the API`, r.status === 403, JSON.stringify(r));
  }
  ok('...and so it is still paired', action('devices').devices.length === 1);
  r = await request('POST', '/api/action', { headers: { ...json, Cookie: cookie }, body: JSON.stringify({ action: 'devices' }) });
  ok('it can see the list', r.status === 200 && JSON.parse(r.body).devices.length === 1);

  // ---- a program pairs at /api/pair ----
  made = action('pairCode');
  for (let i = 0; i < 4; i++) await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: 'AAA-AAA' }) });
  r = await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: made.code, name: 'Home Assistant\u0007 ' + 'x'.repeat(80) }) });
  const paired = r.status === 200 ? JSON.parse(r.body) : {};
  ok('four wrong guesses leave the code working', r.status === 200 && /^[0-9a-f]{64}$/.test(paired.key), JSON.stringify(r));
  ok('...the answer carries the certificate fingerprint', /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(paired.fingerprint || ''));
  ok('...and the name is cleaned up', paired.name && paired.name.length === 60 && !/\u0007/.test(paired.name), JSON.stringify(paired.name));
  made = action('pairCode');
  for (let i = 0; i < 5; i++) await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: 'AAA-AAA' }) });
  r = await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: made.code }) });
  ok('five wrong guesses end the code', r.status === 410, JSON.stringify(r));
  made = action('pairCode');
  action('pairCancel');
  r = await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: made.code }) });
  ok('a cancelled code is gone', r.status === 410);
  made = action('pairCode');
  const waiting = JSON.parse(fs.readFileSync('pairing-code.json', 'utf8'));
  fs.writeFileSync('pairing-code.json', JSON.stringify({ ...waiting, expires: Date.now() - 1 }));
  r = await request('POST', '/api/pair', { headers: json, body: JSON.stringify({ code: made.code }) });
  ok('an expired code is gone', r.status === 410);

  // ---- removing ----
  devices = action('devices').devices;
  const program = devices.find(d => d.id === paired.id);
  ok('removing a device works', action('revokeDevice', program.id).ok === true);
  ok('...its key stops working at once', (await request('GET', '/api/status', { headers: { Authorization: 'Bearer ' + paired.key } })).status === 401);
  ok('...and the other device is untouched', (await request('GET', '/api/status', { headers: { Authorization: 'Bearer ' + deviceKey } })).status === 200);
  action('rollApiToken');
  ok('rolling the access key doesn\'t sign devices out', (await request('GET', '/api/status', { headers: { Authorization: 'Bearer ' + deviceKey } })).status === 200);
  r = await request('POST', '/logout', { headers: { Cookie: cookie } });
  ok('a paired browser signing out removes its key', r.status === 303 && action('devices').devices.length === 0);
  ok('...so the old cookie no longer works', (await request('GET', '/api/status', { headers: { Cookie: cookie } })).status === 401);
  ok('device-keys.json is private', process.platform === 'win32' || (fs.statSync('device-keys.json').mode & 0o077) === 0);
  srv.kill('SIGKILL');
})();
