// Compression (53-compress.js), against a real server when this computer has a
// network address to reach it through. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process'), os = require('os'), zlib = require('zlib');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { wantsCompression } = require(path.join(proj, '53-compress.js'));

const asked = (address, encoding) => wantsCompression({ socket: { remoteAddress: address }, headers: encoding ? { 'accept-encoding': encoding } : {} });
ok(asked('192.168.1.20', 'gzip, deflate, br'), 'another device that accepts gzip gets it');
ok(!asked('192.168.1.20', ''), 'one that does not ask for it does not');
ok(!asked('192.168.1.20', 'gzip;q=0, br'), 'nor one that refuses it');
for (const here of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) ok(!asked(here, 'gzip'), 'this computer (' + here + ') is skipped');

const lan = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal);

(async () => {
  T.redraw(proj);
  const port = 20100 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--network', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  const get = (host, urlPath, headers) => new Promise(resolve => {
    https.get({ host, port, path: urlPath, rejectUnauthorized: false, headers }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', e => resolve({ error: e.message }));
  });
  const cookie = { Cookie: 'classdash_token=' + token, Accept: 'text/html', 'Accept-Encoding': 'gzip' };
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await get('127.0.0.1', '/login', {})).error; if (!up) await sleep(100); }
  ok(up, 'server is listening');

  const local = await get('127.0.0.1', '/', cookie);
  ok(local.status === 200 && !local.headers['content-encoding'] && /<\/html>\s*$/.test(local.body.toString()), 'the page is sent plain to this computer');

  if (!lan) { console.log('no network address here: skipping the checks that need another device'); process.exit(process.exitCode || 0); }
  const host = lan.address;
  const plain = await get(host, '/', { ...cookie, 'Accept-Encoding': 'identity' });
  ok(plain.status === 200 && !plain.headers['content-encoding'], 'a device not asking for gzip gets it plain');
  const zipped = await get(host, '/', cookie);
  ok(zipped.headers['content-encoding'] === 'gzip' && /Accept-Encoding/.test(zipped.headers.vary), 'another device gets the page compressed');
  ok(zipped.body.length < plain.body.length / 2, 'and much smaller: ' + zipped.body.length + ' of ' + plain.body.length);
  ok(zlib.gunzipSync(zipped.body).equals(plain.body), 'and exactly the same page');
  const again = await get(host, '/', cookie);
  ok(again.body.equals(zipped.body), 'the same page again comes out the same');

  const json = await get(host, '/api/status', { Authorization: 'Bearer ' + token, 'Accept-Encoding': 'gzip' });
  ok(json.status === 200 && JSON.parse((json.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(json.body) : json.body).toString()), 'API answers still read as JSON');
  const fresh = await get(host, '/api/announcements', { Authorization: 'Bearer ' + token });
  ok(fresh.status === 200 && !fresh.headers['content-encoding'], 'a program not asking for gzip gets plain JSON');

  // The stream: compressed for a browser, each event arriving right away.
  const stream = (headers) => new Promise(resolve => {
    const req = https.get({ host, port, path: '/api/stream', rejectUnauthorized: false, headers }, res => {
      const gunzip = res.headers['content-encoding'] === 'gzip' ? zlib.createGunzip() : null;
      let text = '';
      const seen = c => {
        text += c;
        if (text.includes('event: update')) { req.destroy(); resolve({ encoding: res.headers['content-encoding'], text }); }
      };
      if (gunzip) { res.pipe(gunzip); gunzip.on('data', seen); gunzip.on('error', () => {}); } else res.on('data', seen);
    });
    req.on('error', () => {});
    setTimeout(() => { req.destroy(); resolve({ timeout: true }); }, 8000);
  });
  const browser = await stream({ Cookie: 'classdash_token=' + token, 'Accept-Encoding': 'gzip' });
  ok(browser.encoding === 'gzip' && /event: update/.test(browser.text), "a browser's stream is compressed and its first event arrives without waiting");
  const program = await stream({ Authorization: 'Bearer ' + token, 'Accept-Encoding': 'gzip' });
  ok(!program.encoding && /event: update/.test(program.text), "another program's stream stays plain");
  await sleep(200);
  const stillUp = await get(host, '/login', {});
  ok(stillUp.status === 200, 'the server is fine after those streams closed');
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
