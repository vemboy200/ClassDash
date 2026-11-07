// The count of connected clients (17-api.js), against a real server. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  T.redraw(proj);
  const port = 21600 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  const get = (urlPath, headers = {}) => new Promise(resolve => {
    https.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: text }));
    }).on('error', e => resolve({ error: e.message }));
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await get('/login')).error; if (!up) await sleep(100); }
  ok(up, 'server is listening');
  const token = fs.readFileSync('api-token.txt', 'utf8').trim();
  const appKey = fs.readFileSync('app-key.txt', 'utf8').trim();
  const key = { Authorization: 'Bearer ' + token };
  const clients = async () => JSON.parse((await get('/api/clients', key)).body);
  const counts = async () => { const { followers, browsers, programs } = await clients(); return { followers, browsers, programs }; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Opens a stream, and collects what it says. */
  const open = (urlPath, headers) => new Promise(resolve => {
    const heard = { text: '' };
    const req = https.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers }, res => {
      res.on('data', c => { heard.text += c; });
      resolve({ heard, close: () => req.destroy() });
    });
    req.on('error', () => {});
  });

  ok((await get('/api/clients')).status === 401, 'the count needs a key');
  ok(same(await counts(), { followers: 0, browsers: 0, programs: 0 }), 'nothing connected to begin with');

  const own = await open('/api/stream?view=dashboard', { Cookie: 'classdash_app=' + appKey });
  await sleep(150);
  ok(same(await counts(), { followers: 0, browsers: 0, programs: 0 }), "the app's own window isn't counted");

  const browser = await open('/api/stream?view=dashboard', { Cookie: 'classdash_token=' + token, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
  await sleep(150);
  ok(same(await counts(), { followers: 0, browsers: 1, programs: 0 }), 'a page in a browser is');
  ok(/event: clients\ndata: \{"followers":0,"browsers":1,"programs":0,/.test(own.heard.text), 'and the app hears of it right away', own.heard.text.slice(-200));

  const program = await open('/api/stream', { ...key, 'User-Agent': 'HomeAssistant/2026.11.0 aiohttp/3.13 Python/3.13' });
  const unnamed = await open('/api/stream', { ...key, 'User-Agent': 'curl/8' });
  const made = JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', 'pairCode'], { cwd: proj, encoding: 'utf8' }).stdout.trim().split('\n').pop());
  const paired = await new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: '/api/pair', method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve(JSON.parse(t))); });
    r.end(JSON.stringify({ code: made.code, name: 'Made-up-Laptop', follower: true }));
  });
  const follower = await open('/api/sync/stream', { Authorization: 'Bearer ' + paired.key });
  await sleep(150);
  ok(same(await counts(), { followers: 1, browsers: 1, programs: 2 }), 'so are programs and a follower');
  const names = (await clients()).list.map(c => `${c.kind}:${c.name}`).join();
  ok(names === 'follower:Made-up-Laptop,browser:Safari on Mac,program:Home Assistant,program:null', 'each by name, where it has one', names);
  ok((await clients()).list.every(c => Number.isFinite(c.since)), 'and when it connected');
  ok(!JSON.stringify(await clients()).includes(paired.key), 'never a key');
  unnamed.close();
  ok(!/event: clients/.test(program.heard.text), "a program's stream isn't told, since it only expects its own events");

  follower.close(); browser.close(); program.close();
  await sleep(200);
  ok(same(await counts(), { followers: 0, browsers: 0, programs: 0 }), 'and each goes when it leaves');
  ok(/"followers":0,"browsers":0,"programs":0,"list":\[\]\}\n\n$/.test(own.heard.text), 'and the app hears that too');

  const page = fs.readFileSync(path.join(proj, 'page-shell.html'), 'utf8');
  ok(/id="client-count" hidden/.test(page), 'the sidebar line starts hidden');
  ok(/data-bool-key="showClientCount"(?![^>]*checked)/.test(page), 'and showing it is off unless asked for');
  ok(/\.api-pair-code\[hidden\] \{ display: none; \}/.test(fs.readFileSync(path.join(proj, '08-page.js'), 'utf8')), 'the pairing box stays hidden when no code is waiting');
  ok(/keyHintTip\(document\.getElementById\('check-status-button'\)/.test(fs.readFileSync(path.join(proj, '08-page.js'), 'utf8')), "the status shortcut's hint goes on the status button, not these lines");
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
