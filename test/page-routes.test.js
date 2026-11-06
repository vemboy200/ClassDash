// Real addresses for the page's pages: the page following and opening them, and
// the server answering them. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test' } }); process.chdir(proj);
T.redraw(proj);
const { JSDOM, VirtualConsole } = T.jsdom();
const html = fs.readFileSync('summary.html', 'utf8');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open(url, { bridge = true } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) {
    w.Element.prototype.scrollIntoView = function () {};
    w.fetch = () => new Promise(() => {});
    if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage() {} } } };
  } });
  return dom.window;
}
const pushes = w => { let n = 0; const real = w.history.pushState.bind(w.history); w.history.pushState = (...a) => { n++; real(...a); }; return () => n; };

(async () => {
  let w = open('https://127.0.0.1:8734/');
  ok(w.location.pathname === '/dashboard', '"/" settles on /dashboard');
  ok(w.history.length === 1, 'without adding a step to go Back through');
  const count = pushes(w);
  w.showPage('settings');
  ok(w.location.pathname === '/settings' && count() === 1, 'Settings gets its address');
  w.showSettingsSection('api');
  ok(w.location.pathname === '/settings/api', 'a section gets its own');
  w.settingsBack();
  ok(w.location.pathname === '/settings', 'the back arrow goes back up');
  w.showSettingsSection('svc-canvas');
  ok(w.location.pathname === '/settings/services/canvas', "a service's page has one too");
  const before = count();
  w.showPage('dashboard');
  ok(w.location.pathname === '/dashboard' && count() === before + 1, 'changing page is one step, however many panels move');
  w.toggleSettingsPanel();
  ok(w.location.pathname === '/settings', "the app's menu item is followed too");
  w.close();

  w = open('https://127.0.0.1:8734/settings/api');
  ok(w.document.getElementById('settings-panel').hidden === false, 'opening /settings/api opens Settings');
  ok(!w.document.querySelector('.settings-section[data-section="api"]').hidden, 'on that section');
  ok(w.location.pathname === '/settings/api', 'and stays there');
  w.close();

  w = open('https://127.0.0.1:8734/settings/services/canvas');
  ok(!w.document.querySelector('.settings-section[data-section="svc-canvas"]').hidden, "opening a service's address opens its page");
  w.close();

  w = open('https://127.0.0.1:8734/settings/nothing-like-this');
  ok(w.location.pathname === '/settings', 'a section that does not exist lands on the Settings menu');
  w.close();

  w = open('https://127.0.0.1:8734/workspace', { bridge: false });
  ok(w.location.pathname === '/dashboard', "a page this client can't show lands on the Dashboard");
  w.close();

  // Back and Forward.
  w = open('https://127.0.0.1:8734/dashboard');
  w.showPage('settings');
  w.showSettingsSection('api');
  w.history.back();
  await sleep(100);
  ok(w.location.pathname === '/settings' && !w.document.getElementById('settings-menu').hidden, 'Back goes to the Settings menu');
  w.history.back();
  await sleep(100);
  ok(w.location.pathname === '/dashboard' && w.document.getElementById('settings-panel').hidden, 'Back again closes Settings');
  w.history.forward();
  await sleep(100);
  ok(w.location.pathname === '/settings' && w.document.getElementById('settings-panel').hidden === false, 'Forward opens it again');
  w.close();

  // Opened from disk, there are no addresses.
  w = open('file:///made-up/summary.html');
  w.showPage('settings');
  ok(w.location.pathname === '/made-up/summary.html', 'a page from disk keeps its address');
  w.close();

  // The server.
  const port = 21700 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  const request = (method, urlPath, headers = {}, body) => new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: urlPath, method, rejectUnauthorized: false, headers }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', e => resolve({ error: e.message }));
    if (body) r.write(body);
    r.end();
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await request('GET', '/login')).error; if (!up) await sleep(100); }
  ok(up, 'server is listening');
  const browser = { Cookie: 'classdash_token=' + token, Accept: 'text/html' };
  for (const route of ['/dashboard', '/grades', '/workspace', '/settings', '/settings/api', '/settings/services/canvas']) {
    const r = await request('GET', route, browser);
    ok(r.status === 200 && /<title>/.test(r.text), route + ' gets the page');
  }
  ok((await request('GET', '/nothing-like-this', browser)).status === 404, 'other addresses are still a 404');
  ok((await request('GET', '/settings/api', { Authorization: 'Bearer ' + token })).status === 404, 'a program asking is not sent the page');
  const out = await request('GET', '/settings/api', { Accept: 'text/html' });
  ok(out.status === 303 && out.headers.location === '/login?next=%2Fsettings%2Fapi', 'signed out, it goes to sign in and remembers where');
  const signIn = await request('GET', out.headers.location);
  ok(/action="\/login\?next=%2Fsettings%2Fapi"/.test(signIn.text), 'the sign-in form keeps it');
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const inn = await request('POST', '/login?next=%2Fsettings%2Fapi', form, 'token=' + token);
  ok(inn.status === 303 && inn.headers.location === '/settings/api', 'and signing in goes there');
  const away = await request('POST', '/login?next=https%3A%2F%2Fexample.test%2F', form, 'token=' + token);
  ok(away.status === 303 && away.headers.location === '/', 'signing in never sends you to another site');
  const away2 = await request('POST', '/login?next=%2F%2Fexample.test', form, 'token=' + token);
  ok(away2.headers.location === '/', 'not by a // address either');
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
