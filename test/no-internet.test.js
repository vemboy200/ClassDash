// A check with nothing to reach (60-network-check.js, 05-playwright-draft.js), with
// a closed port standing in for no internet. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), http = require('http'), cp = require('child_process');
module.paths.push(path.resolve(__dirname, '..', 'node_modules'));
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); if (!c) process.exitCode = 1; };
const original = [{ id: 'kept-1', title: 'Made-up kept assignment', class: 'Made-up History', platform: 'canvas', due: new Date(Date.now() + 2 * 864e5).toISOString() }];
const proj = T.makeProject({
  'settings.json': { language: 'en', email: '', canvas: 'http://127.0.0.1:1', canvasToken: 'made-up', classroomEnabled: false, edpuzzleEnabled: false },
  'last-collection.json': original,
});
process.chdir(proj);
const net = require(path.join(proj, '60-network-check.js'));

(async () => {
  // ---- what counts as reaching somewhere ----
  ok(!await net.online(['http://127.0.0.1:1/'], { tries: 1 }), 'a closed port is not reached');
  const plain = http.createServer((req, res) => { res.statusCode = 500; res.end(); });
  await new Promise(r => plain.listen(0, '127.0.0.1', r));
  ok(await net.online([`http://127.0.0.1:${plain.address().port}/`]), 'any answer counts, even an error');
  ok(await net.online(['http://127.0.0.1:1/', `http://127.0.0.1:${plain.address().port}/`]), 'and one of several is enough');
  // A filter's certificate this can't check still means something answered.
  const pems = require('selfsigned').generate([{ name: 'commonName', value: 'made-up-filter' }], { days: 1, keySize: 2048 });
  const filter = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => res.end());
  await new Promise(r => filter.listen(0, '127.0.0.1', r));
  ok(await net.online([`https://127.0.0.1:${filter.address().port}/`]), "a certificate it can't check counts as an answer");
  filter.close();
  plain.close();
  const silent = require('net').createServer(() => {});
  await new Promise(r => silent.listen(0, '127.0.0.1', r));
  const started = Date.now();
  ok(!await net.online([`http://127.0.0.1:${silent.address().port}/`], { timeoutMs: 300, tries: 2 }) && Date.now() - started < 2000, "a place that never answers doesn't hold it up");
  silent.close();
  for (const detail of ['Math: page.goto: net::ERR_INTERNET_DISCONNECTED at https://x', 'getaddrinfo ENOTFOUND x', net.NO_INTERNET]) ok(net.isNetworkProblem(detail), `"${detail.slice(0, 30)}" is the network`);
  for (const detail of ['cookies expired', 'Timeout 8000ms exceeded', null]) ok(!net.isNetworkProblem(detail), `"${detail}" is not`);

  // ---- a whole check ----
  const before = fs.statSync('last-collection.json').mtimeMs;
  const started2 = Date.now();
  const run = cp.spawnSync('node', ['05-playwright-draft.js'], { cwd: proj, encoding: 'utf8', timeout: 60000 });
  ok(run.status === 1 && /no internet connection/.test(run.stderr + run.stdout), 'the check stops and says why', (run.stdout + run.stderr).slice(-300));
  ok(Date.now() - started2 < 30000, `within seconds (${Date.now() - started2} ms)`);
  ok(fs.statSync('last-collection.json').mtimeMs === before && JSON.parse(fs.readFileSync('last-collection.json', 'utf8'))[0].id === 'kept-1', "what's here is untouched, and its date too");
  const status = JSON.parse(fs.readFileSync('check-status.json', 'utf8'));
  ok(status.canvas.status === 'problem' && status.canvas.detail === net.NO_INTERNET, 'the service is marked as a problem, and why');
  ok(!('classroom' in status), 'one that is off is not');
  ok(!fs.existsSync('.collection-lock'), 'the lock is gone, so the next check can run');
  ok(JSON.parse(fs.readFileSync(path.join('live', 'check-run.json'), 'utf8')).running === false, 'and the progress bar has ended');
  const page = fs.readFileSync('summary.html', 'utf8');
  ok(/no-internet-banner[^]*?No internet connection\. Showing the last copy, from /.test(page), 'the page says so, and from when');

  // ---- it goes when a check works ----
  fs.writeFileSync('check-status.json', JSON.stringify({ canvas: { status: 'ok', at: new Date().toISOString(), detail: null } }));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: proj });
  ok(!/class="warn no-internet-banner"/.test(fs.readFileSync('summary.html', 'utf8')), 'and the banner goes once a check works');
  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
