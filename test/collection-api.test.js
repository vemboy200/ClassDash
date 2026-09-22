// The check that's running, over the API: /api/collection, status.collecting, and the stream.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en', apiEnabled: true } }); process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { readCollection, STALE_MS } = require(path.join(proj, '28-live-state.js'));
const runFile = o => { fs.mkdirSync('live', { recursive: true }); fs.writeFileSync('live/check-run.json', JSON.stringify(o) + '\n'); };
const now = Date.now();

// ---- readCollection: the rules ----
const idle = { running: false, done: null, total: null, percent: null };
const same = (a, b) => ['running', 'done', 'total', 'percent'].every(k => a[k] === b[k]);
ok('no run ever written: not running, all null', same(readCollection(proj, now), idle) && readCollection(proj, now).updatedAt === null);
runFile({ running: true, done: 3, total: 8, at: now });
ok('a live run: numbers and percent', same(readCollection(proj, now), { running: true, done: 3, total: 8, percent: 38 }), JSON.stringify(readCollection(proj, now)));
ok('...updatedAt is the run\'s own heartbeat', readCollection(proj, now).updatedAt === new Date(now).toISOString());
runFile({ running: true, done: 0, total: 0, at: now });
ok('starting (total unknown): running, but no percent yet', same(readCollection(proj, now), { running: true, done: 0, total: 0, percent: null }), JSON.stringify(readCollection(proj, now)));
runFile({ running: true, done: 8, total: 8, at: now });
ok('all sources read but not over: 100', readCollection(proj, now).percent === 100 && readCollection(proj, now).running);
runFile({ running: true, done: 9, total: 8, at: now });
ok('done never runs past total', readCollection(proj, now).done === 8 && readCollection(proj, now).percent === 100);
runFile({ running: false, done: 8, total: 8, at: now });
ok('a finished run: not running, numbers null (nothing to act on)', same(readCollection(proj, now), idle));
runFile({ running: true, done: 4, total: 8, at: now - STALE_MS - 1000 });
ok('a run whose heartbeat stopped is over, even though it never said so', same(readCollection(proj, now), idle));
runFile({ running: true, done: 4, total: 8, at: now - STALE_MS + 5000 });
ok('...but a slow heartbeat inside the limit is still running', readCollection(proj, now).running === true);
fs.writeFileSync('live/check-run.json', '{"running": tr');
ok('a half-written file is not a crash, and not a run', same(readCollection(proj, now), idle));
ok('the limit is the page\'s own (30s)', STALE_MS === 30000 && /var LIVE_STALE_MS = 30000;/.test(fs.readFileSync('08-page.js', 'utf8')));

// ---- through the handlers ----
runFile({ running: true, done: 2, total: 4, at: Date.now() });
const { HANDLERS } = require(path.join(proj, '17-api.js'));
ok('/api/collection', HANDLERS['/api/collection']({}).percent === 50 && HANDLERS['/api/collection']({}).running === true);
ok('/api/status carries collecting too (for the heartbeat)', HANDLERS['/api/status'](require(path.join(proj, '17-api.js')).gather()).collecting === true);
runFile({ running: false, done: 4, total: 4, at: Date.now() });
ok('...and false when it is over', HANDLERS['/api/status'](require(path.join(proj, '17-api.js')).gather()).collecting === false);

// ---- a real server: the stream pushes progress, and stays quiet for a bare heartbeat ----
(async () => {
  const port = 18000 + Math.floor(Math.random() * 1500);
  runFile({ running: false, done: 0, total: 0, at: Date.now() });
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  const cleanup = () => { try { srv.kill('SIGKILL'); } catch {} };
  process.on('exit', cleanup);
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  const events = [];
  let req;
  for (let i = 0; i < 40 && !req; i++) {
    await sleep(150);
    req = await new Promise(resolve => {
      const r = https.request({ host: '127.0.0.1', port, path: '/api/stream', rejectUnauthorized: false, headers: { Authorization: 'Bearer ' + token } }, res => {
        let buf = '';
        res.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) !== -1) { const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) }); } });
        resolve(r);
      });
      r.on('error', () => resolve(null)); r.end();
    });
  }
  ok('connected to the stream', !!req);
  await sleep(600);
  ok('the first event carries the collection', events.length >= 1 && events[0].event === 'update' && events[0].data.collection && events[0].data.collection.running === false, JSON.stringify(events[0] && events[0].data.collection));

  const before = events.length;
  runFile({ running: true, done: 3, total: 8, at: Date.now() });
  await sleep(1400);
  const pushed = events.slice(before).filter(e => e.event === 'update');
  ok('progress is pushed', pushed.length >= 1 && pushed[pushed.length - 1].data.collection.percent === 38 && pushed[pushed.length - 1].data.collection.running === true, JSON.stringify(pushed.map(e => e.data.collection)));
  ok('...with status.collecting in the same event', pushed[pushed.length - 1].data.status.collecting === true);

  const mid = events.length;
  for (let i = 0; i < 3; i++) { runFile({ running: true, done: 3, total: 8, at: Date.now() }); await sleep(500); }   // heartbeats: same state, new stamp
  ok('a bare heartbeat (same state, new stamp) pushes nothing', events.length === mid, 'extra events: ' + (events.length - mid));

  runFile({ running: true, done: 5, total: 8, at: Date.now() });
  await sleep(1000);
  ok('the next step is pushed', events.slice(mid).some(e => e.event === 'update' && e.data.collection.percent === 63), JSON.stringify(events.slice(mid).map(e => e.data.collection)));
  runFile({ running: false, done: 8, total: 8, at: Date.now() });
  await sleep(1000);
  const last = events.filter(e => e.event === 'update').pop();
  ok('the end is pushed', last.data.collection.running === false && last.data.status.collecting === false, JSON.stringify(last.data.collection));
  try { req.destroy(); } catch {}
  cleanup();
  process.exit(process.exitCode || 0);
})();
