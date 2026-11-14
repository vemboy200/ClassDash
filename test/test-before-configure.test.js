// Test before saving (Home Assistant's test-before-configure): Canvas's
// address and token are tried before Settings keeps them, and a calendar
// link that doesn't read isn't saved. A made-up Canvas on this computer
// stands in for the school's, answering the way a real one does. It runs in
// a process of its own: spawnSync blocks this one, so it couldn't answer.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const TOKEN = 'good-token-1234';
const SERVERS = `
  const http = require('http'); let asked = 0;
  const canvas = http.createServer((req, res) => {
    if (req.url === '/count') return res.end(String(asked));
    asked++;
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url !== '/api/v1/users/self') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html>not here</html>'); }
    // What a real Canvas answers: the student with a working token, its own
    // "unauthenticated" without one or with a wrong one.
    if (req.headers.authorization === 'Bearer ${TOKEN}') return json(200, { id: 7, name: 'A Student' });
    json(401, { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] });
  });
  const other = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html>a school website</html>'); });
  const nothing = http.createServer();
  canvas.listen(0, '127.0.0.1', () => other.listen(0, '127.0.0.1', () => nothing.listen(0, '127.0.0.1', () => {
    const free = nothing.address().port; nothing.close();
    process.stdout.write(JSON.stringify({ canvas: canvas.address().port, other: other.address().port, free }) + '\\n');
  })));`;

(async () => {
  const server = cp.spawn(process.execPath, ['-e', SERVERS], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ports = await new Promise(resolve => server.stdout.once('data', d => resolve(JSON.parse(String(d)))));
  const CANVAS = `http://127.0.0.1:${ports.canvas}`, NOT_CANVAS = `http://127.0.0.1:${ports.other}`, NOWHERE = `http://127.0.0.1:${ports.free}`;
  const count = () => cp.spawnSync(process.execPath, ['-e', `fetch('${CANVAS}/count').then(r => r.text()).then(t => process.stdout.write(t))`], { encoding: 'utf8' }).stdout;

  const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '', showEmptyClasses: false } });
  const lastJson = out => { try { return JSON.parse(out.stdout.trim().split('\n').pop()); } catch { return { failed: (out.stdout + out.stderr).slice(-300) }; } };
  const tried = (address, token) => lastJson(cp.spawnSync(process.execPath, ['-e',
    `require('./services/canvas/10-canvas.js').testSettings(${JSON.stringify(address)}, ${JSON.stringify(token)}).then(r => process.stdout.write(JSON.stringify(r)))`],
    { cwd: proj, encoding: 'utf8' }));
  const save = values => lastJson(cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'config', T.enc(values)], { cwd: proj, encoding: 'utf8' }));
  const saved = () => JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8'));

  try {
    // ── Canvas's own test ──
    let r = tried(CANVAS, '');
    ok(r.ok === true, 'no token: an address that answers like Canvas passes: ' + JSON.stringify(r));
    r = tried(CANVAS, TOKEN);
    ok(r.ok === true, 'a token Canvas takes passes: ' + JSON.stringify(r));
    r = tried(CANVAS, 'wrong-token-5678');
    ok(r.ok === false && /refused the access token/.test(r.why) && !/wrong-token/.test(r.why), 'a token Canvas refuses doesn\'t, and the reason doesn\'t have it in it: ' + JSON.stringify(r));
    r = tried(NOT_CANVAS, '');
    ok(r.ok === false && /doesn't answer the way Canvas does/.test(r.why), 'a website that isn\'t a Canvas doesn\'t: ' + JSON.stringify(r));
    r = tried(NOWHERE, '');
    ok(r.ok === false && /couldn't reach Canvas/.test(r.why), 'nothing at the address: couldn\'t reach it: ' + JSON.stringify(r));
    r = tried('http://canvas.example.test', TOKEN);
    ok(r.ok === false && /https/.test(r.why), 'a token is never sent over plain http to anywhere but this computer: ' + JSON.stringify(r));

    // ── Saving in Settings ──
    let n = count();
    r = save({ canvas: CANVAS, canvasToken: 'wrong-token-5678', showEmptyClasses: true });
    ok(r.ok === true && (r.rejected || []).some(x => /^Canvas: Canvas refused the access token/.test(x)), 'a token that doesn\'t work: the save says why: ' + JSON.stringify(r));
    ok(saved().canvas === '' && !saved().canvasToken, 'and Canvas\'s address and token aren\'t saved');
    ok(saved().showEmptyClasses === true, 'while the rest of the save went through');
    ok(count() !== n, 'Canvas was asked');
    const log = fs.readFileSync(path.join(proj, 'notifier-log.txt'), 'utf8');
    ok(/Canvas settings not saved/.test(log) && !/wrong-token/.test(log) && !/wrong-token/.test(JSON.stringify(r)), 'the log says so, and the token is in neither it nor the answer');

    r = save({ canvas: CANVAS, canvasToken: TOKEN });
    ok(r.ok === true && !r.rejected.length && saved().canvas === CANVAS && saved().canvasToken === TOKEN, 'a token that works is saved: ' + JSON.stringify(r));

    n = count();
    r = save({ canvas: CANVAS, canvasToken: TOKEN, showEmptyClasses: false });
    ok(r.ok === true && count() === n && saved().showEmptyClasses === false, 'a save that doesn\'t change Canvas\'s settings doesn\'t ask it');

    r = save({ canvas: NOT_CANVAS, canvasToken: '', canvasApiEnabled: false });
    ok((r.rejected || []).some(x => /^Canvas: /.test(x)), 'moving to an address that isn\'t a Canvas is refused: ' + JSON.stringify(r));
    ok(saved().canvas === CANVAS && saved().canvasToken === TOKEN && saved().canvasApiEnabled !== false, 'and all of Canvas\'s settings stay as they were, its switches too');

    n = count();
    r = save({ canvas: '', canvasToken: '' });
    ok(r.ok === true && !r.rejected.length && saved().canvas === '' && count() === n, 'emptying the address (Canvas off) has nothing to test: ' + JSON.stringify(r));

    r = save({ canvas: CANVAS, canvasToken: '', canvasApiEnabled: true, canvasSsoEnabled: true });
    ok(r.ok === true && !r.rejected.length && saved().canvas === CANVAS, 'the Google sign-in way: only the address is tested, and it passes: ' + JSON.stringify(r));

    // ── The calendar's link ──
    const cal = lastJson(cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'setCalendarIcs', encodeURIComponent(NOT_CANVAS + '/school.ics')], { cwd: proj, encoding: 'utf8' }));
    const file = path.join(proj, 'school-calendar.json');
    const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    ok(cal.ok === false && !!cal.why && !stored.ics, 'a calendar link that doesn\'t read says why and isn\'t saved: ' + JSON.stringify(cal).slice(0, 200));
  } finally {
    server.kill();
  }
})();
