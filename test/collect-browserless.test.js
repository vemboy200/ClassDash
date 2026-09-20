// End-to-end: a real collection with NO browser — Canvas by token only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), http = require('http'), cp = require('child_process');
const E2E = T.makeProject();
const BIN = T.tmpDir('classdash-bin-');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
// fake osascript: records instead of popping a real notification
fs.writeFileSync(path.join(BIN, 'osascript'), '#!/bin/sh\necho "$@" >> "' + path.join(E2E, 'osascript.calls') + '"\n', { mode: 0o755 });

const TOKEN = 'E2ETOKEN~1';
const due = new Date(Date.now() + 2 * 864e5).toISOString();
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.method + ' ' + req.url.split('?')[0]);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end('{}'); }
  const send = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.url.startsWith('/api/v1/courses?')) return send([{ id: 1, name: 'History', workflow_state: 'available' }]);
  if (/courses\/1\/assignments/.test(req.url)) return send([{ id: 7, name: 'Essay', html_url: 'x', due_at: due, submission: { workflow_state: 'unsubmitted' } }]);
  if (/courses\/1\/pages/.test(req.url)) return send([]);
  send({}, 404);
});

const run = (args, env = {}) => new Promise(resolve => {
  const c = cp.spawn('node', ['05-playwright-draft.js', ...args], { cwd: E2E, env: { ...process.env, PATH: BIN + ':' + process.env.PATH, ...env } });
  let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  const t = setTimeout(() => c.kill('SIGKILL'), 90000);
  c.on('exit', code => { clearTimeout(t); resolve({ code, out }); });
});
const write = (f, o) => fs.writeFileSync(path.join(E2E, f), typeof o === 'string' ? o : JSON.stringify(o));
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(E2E, f), 'utf8')); } catch { return null; } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const SITE = `http://127.0.0.1:${server.address().port}`;
  const base = { email: '', canvas: SITE, canvasToken: TOKEN, classroomEnabled: false, edpuzzleEnabled: false, browserPath: '/nonexistent/browser', language: 'en' };

  // 1. Canvas-only on a token, a Classroom leftover in memory
  write('settings.json', base);
  write('last-collection.json', [{ class: 'Old Classroom Class', id: 'cr-1', type: 'Assignment', title: 'Old classroom work', due: null, due_iso: due }]);
  write('messages.json', [{ id: 'm1', class: 'Old Classroom Class', text: 'old announcement', date: 'Sep 1', sortTime: 1 }]);
  let r = await run([]);
  ok(r.code === 0, 'run exits 0 (no browser launch was attempted): code ' + r.code + '\n' + r.out.slice(-600));
  ok(!/executable|browserType|Failed to launch/i.test(r.out), 'no browser launch error');
  ok(/Canvas: courses 1, items 1/.test(r.out), 'Canvas read through the token: ' + (r.out.match(/Canvas:.*\n/) || [''])[0]);
  ok(hits.every(h => h.startsWith('GET ')), 'only GETs to Canvas');
  const mem = read('last-collection.json') || [];
  ok(mem.some(x => x.id === 'canvas-7'), 'Canvas item is in memory');
  ok(!mem.some(x => x.id === 'cr-1'), 'the Classroom leftover left memory');
  ok((read('messages.json') || []).length === 0, 'announcements (Classroom only) are gone');
  const html = fs.readFileSync(path.join(E2E, 'summary.html'), 'utf8');
  ok(html.includes('Essay') && !html.includes('Old classroom work') && !html.includes('old announcement'), 'page shows the Canvas item only');
  // the "finish setup" email nag: silent with Classroom off, shown with it on
  write('settings.json', { ...base, email: 'your.school@email.example' });
  await run(['--redraw']);
  ok(!/<div class="warn setup-banner"/.test(fs.readFileSync(path.join(E2E, 'summary.html'), 'utf8')), 'no email nag with Classroom off');
  write('settings.json', { ...base, email: 'your.school@email.example', classroomEnabled: true });
  await run(['--redraw']);
  ok(/<div class="warn setup-banner"/.test(fs.readFileSync(path.join(E2E, 'summary.html'), 'utf8')), 'email nag still shows with Classroom on');
  write('settings.json', base);
  const st = read('check-status.json') || {};
  ok(st.canvas && st.canvas.status === 'ok' && !st.classroom, 'status: Canvas ok, Classroom never recorded');
  const applied = fs.readFileSync(path.join(E2E, 'fetch-applied.json'), 'utf8');
  ok(/"classroomEnabled": false/.test(applied) && !applied.includes(TOKEN), 'applied record has classroomEnabled and only a token fingerprint');
  ok(!/id="pending-banner"/.test(html), 'no "needs a fresh check" banner after the run');

  // 2. --login has nothing to do
  write('settings.json', { ...base, canvasSsoEnabled: false });
  r = await run(['--login']);
  ok(r.code === 0 && /Nothing to sign into/.test(r.out), '--login (token only) says there is nothing to sign into: ' + r.out.slice(-200));
  write('settings.json', base);

  // 3. the gate discriminates: Classroom ON needs a browser -> tries to launch the (nonexistent) one
  write('settings.json', { ...base, classroomEnabled: true });
  r = await run([]);
  ok(/executable|Failed to launch|doesn't exist|ENOENT/i.test(r.out), 'with Classroom on a browser IS launched (and the fake path fails): ' + r.out.slice(-250));
  {
    const st3 = read('check-status.json') || {};
    ok(st3.classroom && st3.classroom.status === 'problem' && /couldn't start a browser/.test(st3.classroom.detail || ''), 'Classroom dot goes red with the reason: ' + JSON.stringify(st3.classroom));
    ok(!(st3.classroom.detail || '').includes('access token'), 'no token hint for a school that has a token');
  }

  // 4. Canvas on the browser way (no token) also needs one
  write('settings.json', { ...base, canvasToken: '' });
  r = await run([]);
  ok(/executable|Failed to launch|doesn't exist|ENOENT/i.test(r.out), 'Canvas without a token needs the browser: ' + r.out.slice(-200));
  {
    const st4 = read('check-status.json') || {};
    ok(st4.canvas && st4.canvas.status === 'problem' && /access token, which needs no browser/.test(st4.canvas.detail || ''), 'Canvas dot goes red and points at the token: ' + JSON.stringify(st4.canvas));
  }

  // 5. Edpuzzle in a full check needs one too
  write('settings.json', { ...base, edpuzzleEnabled: true });
  r = await run(['--full']);
  ok(/executable|Failed to launch|doesn't exist|ENOENT/i.test(r.out), 'a full check with Edpuzzle on needs the browser: ' + r.out.slice(-200));

  // 6. the fallback: a refused token with the browser way ON launches a browser lazily (fails on the fake path),
  //    and the Canvas status says both things went wrong
  write('settings.json', { ...base, canvasToken: 'WRONG~1', canvasSsoEnabled: true });
  hits.length = 0;
  r = await run([]);
  {
    const st = read('check-status.json') || {};
    ok(st.canvas && st.canvas.status === 'problem' && /refused the access token/.test(st.canvas.detail) && /browser sign-in didn't work either/.test(st.canvas.detail), 'refused token + browser fallback that cannot start -> both reasons: ' + JSON.stringify(st.canvas));
    ok(!(st.canvas.detail || '').includes('WRONG~1'), 'the token is not in the status');
  }

  // 7. a refused token with the browser way OFF: the token error only, and NO browser is even attempted
  write('settings.json', { ...base, canvasToken: 'WRONG~1', canvasSsoEnabled: false });
  r = await run([]);
  {
    const st = read('check-status.json') || {};
    ok(st.canvas && st.canvas.status === 'problem' && /refused the access token/.test(st.canvas.detail) && !/browser/.test(st.canvas.detail), 'refused token, browser off -> only the token error: ' + JSON.stringify(st.canvas));
    ok(!/couldn't start a browser/.test(r.out), 'and no browser launch was attempted');
  }

  // 8. API switched on, nothing filled in, browser way off: reported, not silent, no browser
  write('settings.json', { ...base, canvasToken: '', canvasApiEnabled: true, canvasSsoEnabled: false });
  r = await run([]);
  {
    const st = read('check-status.json') || {};
    ok(st.canvas && st.canvas.status === 'problem' && /neither way/.test(st.canvas.detail), 'API on with no token and no browser way -> a clear problem: ' + JSON.stringify(st.canvas));
    ok(!/couldn't start a browser/.test(r.out), 'no browser attempted');
  }

  // 9. both Canvas switches off: Canvas is off, nothing read, no browser
  write('settings.json', { ...base, canvasApiEnabled: false, canvasSsoEnabled: false });
  hits.length = 0;
  r = await run([]);
  ok(/Canvas is off/.test(r.out) && hits.length === 0 && r.code === 0, 'both Canvas switches off -> Canvas off, nothing requested: ' + r.out.slice(-200));

  // 10. --login with the browser way ON still opens a sign-in (the fallback needs a signed-in session) -> tries to launch
  write('settings.json', { ...base, canvasSsoEnabled: true });
  r = await run(['--login']);
  ok(!/Nothing to sign into/.test(r.out), '--login with the browser way on has something to sign into (the fallback session)');
  write('settings.json', { ...base, canvasSsoEnabled: false });
  r = await run(['--login']);
  ok(/Nothing to sign into/.test(r.out), '--login with only the token: nothing to sign into');

  server.close();
  console.log(`collect-browserless: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
