// The page served by the API server: sign-in by cookie, the page and only
// its own files, and page actions over /api/action, against a real server.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.writeFileSync(path.join(proj, 'summary.html'), '<!doctype html><title>made-up page</title>');
fs.mkdirSync(path.join(proj, 'live'), { recursive: true });
fs.writeFileSync(path.join(proj, 'live', 'page-version.js'), 'window.classdashPageVersion = 1;\n');

(async () => {
  const port = 18000 + Math.floor(Math.random() * 1500);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  const cleanup = () => { try { srv.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  ok('server came up with a token', !!token);

  const request = (method, urlPath, { headers = {}, body } = {}) => new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: urlPath, method, rejectUnauthorized: false, headers }, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    r.on('error', e => resolve({ error: e.message }));
    if (body) r.write(body);
    r.end();
  });
  const browser = { Accept: 'text/html,application/xhtml+xml' };

  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await request('OPTIONS', '/')).error; if (!up) await sleep(100); }
  ok('server is listening', up);

  // ---- http:// typed by mistake ----
  const plain = await new Promise(resolve => {
    const r = require('http').get({ host: '127.0.0.1', port, path: '/settings?x=1', headers: { Host: `127.0.0.1:${port}` } }, res => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); });
    r.on('error', e => resolve({ error: e.message }));
  });
  ok('plain http on the same port is sent to https, path and all', plain.status === 301 && plain.location === `https://127.0.0.1:${port}/settings?x=1`, JSON.stringify(plain));
  const odd = await new Promise(resolve => {
    const r = require('http').get({ host: '127.0.0.1', port, path: '/', headers: { Host: 'a"b<c>.example:1' } }, res => { res.resume(); resolve(res.headers.location); });
    r.on('error', e => resolve(e.message));
  });
  ok('...with the host kept to host-name characters', odd === `https://abc.example:${port}/`, odd);
  ok('...and https still works beside it', (await request('GET', '/api/status')).status === 401);

  // ---- signing in ----
  const signedOut = await request('GET', '/', { headers: browser });
  ok('a browser with no cookie is sent to sign in', signedOut.status === 303 && signedOut.headers.location === '/login', JSON.stringify(signedOut));
  const form = await request('GET', '/login', { headers: browser });
  ok('the sign-in page needs no token', form.status === 200 && /Sign in to ClassDash/.test(form.body) && /name="token"/.test(form.body), form.body.slice(0, 200));
  ok('...and never shows the token', !form.body.includes(token));

  const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const wrong = await request('POST', '/login', { headers: formHeaders, body: 'token=nope' });
  ok('a wrong token: 401, the form again with the error, no cookie', wrong.status === 401 && /didn't work/.test(wrong.body) && !wrong.headers['set-cookie'], JSON.stringify(wrong.headers));
  const right = await request('POST', '/login', { headers: formHeaders, body: 'token=' + encodeURIComponent(token) });
  const cookie = (right.headers['set-cookie'] || [''])[0];
  ok('the right token: back to the page with a cookie', right.status === 303 && right.headers.location === '/' && cookie.startsWith('classdash_token='), JSON.stringify(right.headers));
  ok('...that scripts can\'t read and other sites can\'t send', /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie), cookie);
  const withCookie = { Cookie: cookie.split(';')[0] };

  // ---- the page and its files ----
  const page = await request('GET', '/', { headers: { ...browser, ...withCookie } });
  ok('signed in: the page itself', page.status === 200 && /text\/html/.test(page.headers['content-type']) && page.body.includes('made-up page'), JSON.stringify(page).slice(0, 300));
  ok('...asked about every time', page.headers['cache-control'] === 'no-cache' && !!page.headers.etag);
  const again = await request('GET', '/', { headers: { ...browser, ...withCookie, 'If-None-Match': page.headers.etag } });
  ok('...and not sent again when it hasn\'t changed', again.status === 304 && again.body === '');
  const live = await request('GET', '/live/page-version.js', { headers: withCookie });
  ok('its live files', live.status === 200 && /javascript/.test(live.headers['content-type']) && live.body.includes('classdashPageVersion'), JSON.stringify(live));
  const missing = await request('GET', '/live/check-run.js', { headers: withCookie });
  ok('a live file not written yet: 404', missing.status === 404, JSON.stringify(missing));
  for (const p of ['/settings.json', '/api-token.txt', '/api-key.pem', '/live/../settings.json', '/announcement-photos/../api-token.txt', '/17-api.js']) {
    const r = await request('GET', p, { headers: withCookie });
    ok(`no other project file: ${p}`, r.status === 404 && !r.body.includes(token), `${r.status} ${r.body.slice(0, 80)}`);
  }
  const noCookieLive = await request('GET', '/live/page-version.js');
  ok('the page\'s files need signing in too', noCookieLive.status === 401);

  // ---- programs still get JSON ----
  const bearer = { Authorization: 'Bearer ' + token };
  const index = await request('GET', '/', { headers: bearer });
  ok('"/" with a token is still the list of handles', index.status === 200 && JSON.parse(index.body).handles.includes('/api/status'), index.body.slice(0, 200));
  const apiIndex = await request('GET', '/api', { headers: withCookie });
  ok('...and so is "/api"', apiIndex.status === 200 && Array.isArray(JSON.parse(apiIndex.body).handles));
  const status = await request('GET', '/api/status', { headers: withCookie });
  ok('the cookie works for the API too', status.status === 200, JSON.stringify(status).slice(0, 200));

  // ---- page actions ----
  const act = (action, arg, headers = withCookie) => request('POST', '/api/action', {
    headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, arg }),
  });
  const noAuth = await act('quiet', 'x', {});
  ok('an action with no token: 401', noAuth.status === 401);
  const getAct = await request('GET', '/api/action', { headers: withCookie });
  ok('GET /api/action: 405', getAct.status === 405);
  const quiet = await act('quiet', 'made-up-id');
  ok('an action runs and answers like the bridge would', quiet.status === 200 && JSON.parse(quiet.body).ok === true, quiet.body);
  ok('...and did what it says', fs.readFileSync(path.join(proj, 'не-срочно.txt'), 'utf8').includes('made-up-id'));
  for (const action of ['rollApiToken', 'restartApi', 'ensureApi', 'stopApi', 'importCalendarPdf', 'workspaceImport']) {
    const r = await act(action, '/etc/hosts');
    ok(`app-only: ${action}`, r.status === 403 && JSON.parse(r.body).why === 'appOnly', r.body);
  }
  ok('...so the token is unchanged', fs.readFileSync('api-token.txt', 'utf8').trim() === token);
  const chunk = s => Buffer.from(JSON.stringify(s)).toString('base64url');
  const lanOn = await act('config', chunk({ apiLan: true }));
  ok('a settings save that would turn LAN access on: app-only', lanOn.status === 403, lanOn.body);
  // ---- settings from before v3 ----
  const settings = require(path.join(proj, '19-settings.js'));
  const asOld = o => { fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...o })); return settings.read().apiLan; };
  ok('old settings, Home API on and on the network: LAN access on', asOld({ apiEnabled: true, apiNetwork: true }) === true);
  ok('...on with the network left at its old default: on', asOld({ apiEnabled: true }) === true);
  ok('...on, this computer only: off', asOld({ apiEnabled: true, apiNetwork: false }) === false);
  ok('...off: off', asOld({ apiEnabled: false, apiNetwork: true }) === false);
  ok('...and apiLan, once saved, wins', asOld({ apiEnabled: true, apiNetwork: true, apiLan: false }) === false);
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en' }));
  const sameApi = await act('config', chunk({ apiLan: false, showEmptyClasses: true }));
  ok('a settings save that leaves the Home API alone: runs', sameApi.status === 200 && JSON.parse(sameApi.body).ok === true, sameApi.body);

  // ---- the app's own key ----
  const appKey = fs.readFileSync('app-key.txt', 'utf8').trim();
  ok('the server made an app key, different from the access key', /^[0-9a-f]{64}$/.test(appKey) && appKey !== token);
  if (process.platform !== 'win32') {
    ok('...readable by this user account only', (fs.statSync('app-key.txt').mode & 0o777) === 0o600);
    ok('...and so is the access key', (fs.statSync('api-token.txt').mode & 0o777) === 0o600);
  }
  const security = require(path.join(proj, '23-api-security.js'));
  const asReq = headers => ({ headers });
  ok('the app cookie says "app"', security.clientKind(asReq({ cookie: 'classdash_app=' + appKey })) === 'app');
  ok('the access key says "key"', security.clientKind(asReq({ authorization: 'Bearer ' + token })) === 'key' && security.clientKind(asReq({ cookie: 'classdash_token=' + token })) === 'key');
  ok('the access key in the app\'s cookie isn\'t the app', security.clientKind(asReq({ cookie: 'classdash_app=' + token })) === null);
  ok('nothing: not signed in', security.clientKind(asReq({})) === null);
  const appCookie = { Cookie: 'classdash_app=' + appKey };
  const appPage = await request('GET', '/', { headers: { ...browser, ...appCookie } });
  ok('the app gets the page with its own cookie, no sign-in', appPage.status === 200 && /text\/html/.test(appPage.headers['content-type']) && /<html/i.test(appPage.body), JSON.stringify(appPage).slice(0, 200));

  // ---- the workspace, from the server ----
  fs.writeFileSync(path.join(proj, 'workspace.html'), '<!doctype html><title>made-up desk</title>');
  fs.mkdirSync(path.join(proj, 'workspace', '0123456789abcdef'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'workspace', '0123456789abcdef', 'meta.json'), '{"name":"made-up.pdf"}');
  const desk = await request('GET', '/ws/workspace.html', { headers: appCookie });
  ok('the workspace\'s desk is served under /ws/', desk.status === 200 && desk.body.includes('made-up desk') && /text\/html/.test(desk.headers['content-type']));
  const meta = await request('GET', '/ws/doc/0123456789abcdef/meta.json', { headers: appCookie });
  ok('...and a document\'s files', meta.status === 200 && /application\/json/.test(meta.headers['content-type']) && meta.body.includes('made-up.pdf'));
  const lib = await request('GET', '/ws/pdf-lib.min.js', { headers: appCookie });
  ok('...and pdf-lib', lib.status === 200 && /javascript/.test(lib.headers['content-type']));
  for (const p of ['/ws/doc/0123456789abcdef/../../settings.json', '/ws/doc/notanid/meta.json', '/ws/doc/0123456789abcdef/other.json', '/ws/settings.json', '/workspace.html']) {
    const r = await request('GET', p, { headers: appCookie });
    ok(`nothing else under it: ${p}`, r.status === 404, `${r.status}`);
  }
  const noCookieDesk = await request('GET', '/ws/workspace.html');
  ok('...and it needs signing in', noCookieDesk.status === 401);

  // ---- the stream pings ----
  const pinged = await new Promise(resolve => {
    const r = https.request({ host: '127.0.0.1', port, path: '/api/stream', method: 'GET', rejectUnauthorized: false, headers: appCookie }, res => {
      let text = '';
      const t = setTimeout(() => { r.destroy(); resolve(text); }, 21500);
      res.on('data', c => { text += c; if (/event: ping/.test(text)) { clearTimeout(t); r.destroy(); resolve(text); } });
    });
    r.on('error', () => {});
    r.end();
  });
  ok('the stream says "ping" within 20 seconds, so a page can tell it\'s still there', /event: ping\ndata: \{\}/.test(pinged), pinged.slice(0, 200));

  // ---- signing out ----
  const getLogout = await request('GET', '/logout', { headers: withCookie });
  ok('signing out is POST only (a link or a prefetch can\'t)', getLogout.status !== 303 && !getLogout.headers['set-cookie'], JSON.stringify(getLogout.headers));
  const logout = await request('POST', '/logout', { headers: withCookie });
  const cleared = (logout.headers['set-cookie'] || [''])[0];
  ok('POST /logout clears the cookie and goes back to signing in', logout.status === 303 && logout.headers.location === '/login' && /^classdash_token=;/.test(cleared) && /Max-Age=0/.test(cleared), JSON.stringify(logout.headers));

  cleanup();
  console.log('served-page: done');
  process.exit(process.exitCode || 0);
})();
