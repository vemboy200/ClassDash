// The page's styling and script as their own files (54-page-assets.js), against
// a real server when this computer has a network address. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process'), os = require('os');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { splitPage, pageAsset } = require(path.join(proj, '54-page-assets.js'));

T.redraw(proj);
const first = fs.readFileSync('summary.html');
ok(/<style>/.test(first.toString()) && /<script id="page-main">/.test(first.toString()), 'the file on disk stays one whole page');
const links = html => [...html.toString().matchAll(/(?:href|src)="(\/assets\/page-[0-9a-f]+\.(?:css|js))"/g)].map(m => m[1]);
const split = splitPage(first);
const names = links(split);
ok(names.length === 2 && names.every(n => pageAsset(n)), 'the split page links its two files');
ok(split.length < first.length * 0.6, 'and is much smaller');
ok(!/<style>/.test(split.toString()) && !/id="page-main"/.test(split.toString()), 'with neither left inside it');
ok(/var PAGE_VERSION = /.test(split.toString()), 'what changes between redraws stays in the page');

// New data and a new page version must not change the files' names.
fs.writeFileSync('last-collection.json', JSON.stringify([{ class: 'Made-up Math', id: 'a1', type: 'Assignment', title: 'Made-up work', due: null, due_iso: new Date(Date.now() + 864e5).toISOString(), link: 'x' }]));
const settings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
fs.writeFileSync('settings.json', JSON.stringify({ ...settings, showKeyHints: false, filterUnchecked: { cls: ['Made-up Art'] } }));
T.redraw(proj);
const second = fs.readFileSync('summary.html');
ok(!second.equals(first), 'a redraw with new data changes the page');
ok(links(splitPage(second)).join() === names.join(), 'but not its styling or script');
ok(splitPage(Buffer.from('<html>made-up page with nothing to split</html>')).toString().includes('nothing to split'), 'a page with nothing to split comes back as it is');

const lan = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal);

(async () => {
  const port = 20900 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--network', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  const get = (host, urlPath, headers = { Cookie: 'classdash_token=' + token, Accept: 'text/html' }) => new Promise(resolve => {
    https.get({ host, port, path: urlPath, rejectUnauthorized: false, headers }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', e => resolve({ error: e.message }));
  });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !(await get('127.0.0.1', '/login', {})).error; if (!up) await sleep(100); }
  ok(up, 'server is listening');
  const local = await get('127.0.0.1', '/');
  ok(local.status === 200 && links(local.body).length === 0, 'this computer still gets the whole page');
  if (!lan) { console.log('no network address here: skipping the checks that need another device'); process.exit(process.exitCode || 0); }
  const host = lan.address;
  const page = await get(host, '/');
  const [css, js] = links(page.body);
  ok(css && js, 'another device gets the split page');
  ok(/no-store/.test(page.headers['cache-control']), 'the page itself is never kept');
  const cssFile = await get(host, css), jsFile = await get(host, js);
  ok(cssFile.status === 200 && /text\/css/.test(cssFile.headers['content-type']) && /immutable/.test(cssFile.headers['cache-control']), 'its styling can be kept');
  ok(jsFile.status === 200 && /javascript/.test(jsFile.headers['content-type']) && /immutable/.test(jsFile.headers['cache-control']), 'and so can its script');
  ok((await get(host, css, {})).status === 401, 'they still need signing in');
  const key = token;
  ok(!cssFile.body.includes(key) && !jsFile.body.includes(key), 'neither has the access key in it');
  ok((await get(host, '/?whole=1')).body.includes('id="page-main"'), '?whole=1 gets the whole page');
  ok((await get(host, '/assets/page-0000000000000000.js')).status === 404, 'a file it no longer has is a 404, which asks for the whole page');
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
