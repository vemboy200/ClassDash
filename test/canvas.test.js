// Canvas: access token path + browser path + settings. Isolated copy in ./proj.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), http = require('http'), cp = require('child_process');
const PROJ = T.makeProject();
process.chdir(PROJ);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   got ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`);

const TOKEN = 'TESTTOKEN~abc123';
const future = new Date(Date.now() + 3 * 864e5).toISOString();
const seen = [];       // {method, url, auth}
let mode = 'ok';
let teachersOn = true;   // whether the fake Canvas reports course teachers this time
const server = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
  const auth = req.headers.authorization;
  const viaToken = !!auth;
  if (auth && auth !== `Bearer ${TOKEN}`) { res.statusCode = 401; res.end('{"errors":[{"message":"Invalid access token."}]}'); return; }
  // a browser-session request gets Canvas's anti-forgery prefix, a token one doesn't
  const send = (obj, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end((viaToken ? '' : 'while(1);') + JSON.stringify(obj)); };
  const u = req.url;
  if (u.startsWith('/api/v1/courses?')) {
    return send([
      { id: 1, name: 'English 9', workflow_state: 'available', term: { end_at: new Date(Date.now() + 90 * 864e5).toISOString() },
        ...(teachersOn ? { teachers: [{ id: 7, display_name: 'Ms. Kirakosyan' }, { id: 8, display_name: 'Mr. Two' }, { id: 9, display_name: 'Ms. Kirakosyan' }] } : {}) },
      { id: 2, name: 'Old Course', workflow_state: 'available', term: { end_at: '2020-01-01T00:00:00Z' } },
      { id: 3, name: 'Not Yet Open', workflow_state: 'unpublished' },
      { id: 4, name: 'No Pages Course', workflow_state: 'available' },
    ]);
  }
  if (/^\/api\/v1\/courses\/1\/assignments/.test(u)) {
    return send([
      { id: 10, name: 'Essay', html_url: 'http://x/courses/1/assignments/10', due_at: future, created_at: '2026-09-01T00:00:00Z', description: '<p>Write <b>it</b></p>', submission: { workflow_state: 'unsubmitted' } },
      { id: 11, name: 'Turned in', html_url: 'x', due_at: future, submission: { submitted_at: '2026-09-10T00:00:00Z' } },
      { id: 12, name: 'Graded', html_url: 'x', due_at: future, submission: { workflow_state: 'graded' } },
    ]);
  }
  if (/^\/api\/v1\/courses\/4\/assignments/.test(u)) return send([]);
  if (/^\/api\/v1\/courses\/1\/pages/.test(u)) {
    return send([{ page_id: 50, title: 'Reading', html_url: 'x', published: true }, { page_id: 51, title: 'Draft', html_url: 'x', published: false }]);
  }
  if (/^\/api\/v1\/courses\/4\/pages/.test(u)) return send({ errors: 'disabled' }, 404);
  send({}, 404);
});

const load = (settings) => {
  fs.writeFileSync('settings.json', JSON.stringify(settings));
  for (const k of Object.keys(require.cache)) if (k.startsWith(PROJ) && !k.includes('node_modules')) delete require.cache[k];
  return require(path.join(PROJ, '10-canvas.js'));
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const SITE = `http://127.0.0.1:${server.address().port}`;

  // ── A: with a token — no page at all ──
  {
    const canvas = load({ canvas: SITE, canvasToken: `  ${TOKEN}  ` });
    seen.length = 0;
    try { fs.unlinkSync('canvas-classes.json'); } catch {}
    const r = await canvas.collectCanvas(null, 'api');
    eq(r.items.map(i => i.id).sort(), ['canvas-10', 'canvas-page-50'], 'A assignments (unsubmitted only) and the published page');
    eq(r.courses.sort(), ['English 9', 'No Pages Course'], 'A active courses (term-ended one is dropped)');
    eq(r.pending, ['Not Yet Open'], 'A unpublished courses reported');
    eq(r.items.find(i => i.id === 'canvas-10').description, 'Write it', 'A description cleaned');
    eq(JSON.parse(fs.readFileSync('canvas-classes.json', 'utf8')).map(c => c.name).sort(), ['English 9', 'No Pages Course'], 'A classes file for the picker');
    ok(seen.some(s => s.url.startsWith('/api/v1/courses?') && s.url.includes('include[]=teachers')), 'A courses are asked for with their teachers');
    const classes = JSON.parse(fs.readFileSync('canvas-classes.json', 'utf8'));
    eq(classes.find(c => c.name === 'English 9').teacher, 'Ms. Kirakosyan, Mr. Two', 'A teachers joined, a repeated name once');
    ok(!('teacher' in classes.find(c => c.name === 'No Pages Course')), 'A a course with no teachers gets no teacher key');
    ok(seen.length > 0 && seen.every(s => s.method === 'GET'), 'A only GET requests');
    ok(seen.every(s => s.auth === `Bearer ${TOKEN}`), 'A every request carried the (trimmed) token');
  }

  // ── A2: a response that leaves the teachers out keeps the ones already known ──
  {
    const canvas = load({ canvas: SITE, canvasToken: TOKEN });
    teachersOn = false;
    await canvas.collectCanvas(null, 'api');
    teachersOn = true;
    eq(JSON.parse(fs.readFileSync('canvas-classes.json', 'utf8')).find(c => c.name === 'English 9').teacher, 'Ms. Kirakosyan, Mr. Two', 'A2 teacher kept when a response omits them');
  }

  // ── B: a refused token — clear message, no leak, no retry wait ──
  {
    const canvas = load({ canvas: SITE, canvasToken: 'WRONGTOKEN~zzz' });
    const t0 = Date.now(); let err = null;
    try { await canvas.collectCanvas(null, 'api'); } catch (e) { err = e; }
    ok(err && /refused the access token/.test(err.message), 'B says the token was refused: ' + (err && err.message));
    ok(err && !err.message.includes('WRONGTOKEN') && !err.message.includes(SITE), 'B message has neither the token nor the address');
    ok(Date.now() - t0 < 2000, 'B not retried (a retry cannot fix it)');
  }

  // ── C: token over plain http to a real host is refused before sending anything ──
  {
    const canvas = load({ canvas: 'http://school.example.com', canvasToken: TOKEN });
    seen.length = 0; let err = null;
    try { await canvas.collectCanvas(null, 'api'); } catch (e) { err = e; }
    ok(err && /https/.test(err.message) && seen.length === 0, 'C plain http refused: ' + (err && err.message));
  }

  // ── D: the browser way (no token) still works, through a stand-in page ──
  {
    const canvas = load({ canvas: SITE });
    const page = {
      goto: async () => {},
      url: () => SITE + '/',
      waitForTimeout: async () => {},
      evaluate: async (fn, arg) => fn(arg),
    };
    seen.length = 0;
    const r = await canvas.collectCanvas(page, 'browser');
    eq(r.items.map(i => i.id).sort(), ['canvas-10', 'canvas-page-50'], 'D same items through the browser session (while(1); prefix stripped)');
    ok(seen.every(s => s.auth === null), 'D no token header in the browser way');
    let err = null;
    try { await canvas.collectCanvas({ goto: async () => {}, url: () => 'https://login.example/sso', waitForTimeout: async () => {}, evaluate: async () => {} }, 'browser'); } catch (e) { err = e; }
    ok(err && /stuck on sign-in/.test(err.message), 'D sign-in trouble still reports "stuck on sign-in"');
  }

  // ── D2: reading Canvas the way the plan says (API first, browser as fallback) ──
  {
    const standIn = () => ({ goto: async () => {}, url: () => SITE + '/', waitForTimeout: async () => {}, evaluate: async (fn, arg) => fn(arg), close: async () => {} });
    let opened = 0;
    const openPage = async () => { opened++; return standIn(); };
    const ids = r => r.items.map(i => i.id).sort();

    // API works -> the browser is never touched
    let canvas = load({ canvas: SITE, canvasToken: TOKEN });
    opened = 0;
    let r = await canvas.collectCanvasPlanned({ api: true, sso: true }, openPage);
    ok(opened === 0 && r.note === undefined && ids(r).length === 2, 'D2 a working token never opens the browser, no note');
    ok(r.way === 'api' && !r.fallback && r.detail === 'Method: API (access token)', 'D2 a working token says it was the API, and is not a fallback: ' + r.detail);

    // API refused + browser allowed -> falls back, succeeds, and SAYS the token failed
    canvas = load({ canvas: SITE, canvasToken: 'WRONGTOKEN~zzz' });
    opened = 0;
    r = await canvas.collectCanvasPlanned({ api: true, sso: true }, openPage);
    ok(opened === 1 && ids(r).length === 2, 'D2 refused token + browser allowed -> read through the browser');
    ok(/access token didn't work/.test(r.note || '') && /refused the access token/.test(r.note) && !r.note.includes('WRONGTOKEN'), 'D2 the note says the token failed (no token in it): ' + r.note);
    ok(r.way === 'browser' && r.fallback === true, 'D2 the fallback is flagged, and the way is the browser');
    ok(/^Fallback: /.test(r.detail) && /API \(access token\)/.test(r.detail) && /Google sign-in was used/.test(r.detail) && /refused the access token/.test(r.detail) && !r.detail.includes('WRONGTOKEN'), 'D2 the detail names both ways and why, without the token: ' + r.detail);

    // API refused + browser NOT allowed -> the token error, no browser
    opened = 0; let err = null;
    try { await canvas.collectCanvasPlanned({ api: true, sso: false }, openPage); } catch (e) { err = e; }
    ok(opened === 0 && err && /refused the access token/.test(err.message), 'D2 refused token, browser off -> the token error only');

    // API refused and the browser fails too -> one message with both
    err = null;
    try { await canvas.collectCanvasPlanned({ api: true, sso: true }, async () => { throw new Error('no browser here'); }); } catch (e) { err = e; }
    ok(err && /refused the access token/.test(err.message) && /browser sign-in didn't work either: no browser here/.test(err.message), 'D2 both fail -> both reasons: ' + (err && err.message));

    // no token in use, browser allowed -> the browser way
    canvas = load({ canvas: SITE });
    opened = 0;
    r = await canvas.collectCanvasPlanned({ api: false, sso: true }, openPage);
    ok(opened === 1 && ids(r).length === 2 && r.note === undefined, 'D2 no token -> browser is the way, no note');
    ok(r.way === 'browser' && !r.fallback && r.detail === 'Method: Google sign-in', 'D2 Google sign-in as the plan is not a fallback: ' + r.detail);

    // neither -> a clear config error
    err = null;
    try { await canvas.collectCanvasPlanned({ api: false, sso: false }, openPage); } catch (e) { err = e; }
    ok(err && /neither way/.test(err.message), 'D2 neither way on -> clear error: ' + (err && err.message));

    // way 'api' with no token at all
    err = null;
    try { await canvas.collectCanvas(null, 'api'); } catch (e) { err = e; }
    ok(err && /needs an access token/.test(err.message), 'D2 api way without a token says so');
  }

  // ── E: the address is normalized to its origin ──
  {
    ok(load({ canvas: 'school.instructure.com' }).SITE === 'https://school.instructure.com', 'E schemeless');
    ok(load({ canvas: 'https://school.instructure.com/calendar?x=1' }).SITE === 'https://school.instructure.com', 'E pasted page address -> origin');
    ok(load({ canvas: 'https://school.instructure.com/' }).SITE === 'https://school.instructure.com', 'E trailing slash');
    ok(load({ canvas: '' }).SITE === '', 'E empty stays empty');
  }
  server.close();

  // ── F: settings ──
  for (const k of Object.keys(require.cache)) if (k.startsWith(PROJ) && !k.includes('node_modules')) delete require.cache[k];
  fs.writeFileSync('settings.json', JSON.stringify({ email: 'a@b', canvas: 'https://school.instructure.com' }));
  fs.writeFileSync('fetch-applied.json', JSON.stringify({ exclusions: [], canvas: 'https://school.instructure.com' }));
  const S = require(path.join(PROJ, '19-settings.js'));
  ok(S.validate('canvasToken', '  abc~123 ').value === 'abc~123', 'F token trimmed');
  ok(!S.validate('canvasToken', 'abc 123').ok && !S.validate('canvasToken', 'abc\n123').ok, 'F token with inner whitespace refused');
  ok(S.validate('canvasToken', '').ok, 'F empty token ok (back to the browser)');
  eq(S.pendingFetchKeys(), [], 'F old install (record without the token key): nothing pending');
  S.write('canvasToken', 'SECRETVALUE~1');
  eq(S.pendingFetchKeys(), ['canvasToken'], 'F adding a token is a pending change');
  S.markApplied(S.read());
  eq(S.pendingFetchKeys(), [], 'F recorded -> clear');
  ok(!fs.readFileSync('fetch-applied.json', 'utf8').includes('SECRETVALUE'), 'F the record never contains the token');
  S.write('canvasToken', 'SECRETVALUE~2');
  eq(S.pendingFetchKeys(), ['canvasToken'], 'F a different token is pending');
  S.markApplied(S.read());
  S.write('canvasToken', '');
  eq(S.pendingFetchKeys(), ['canvasToken'], 'F clearing it is pending too');
  eq(S.applyBatch(Buffer.from(JSON.stringify({ canvasToken: 'has space' })).toString('base64url')).accepted, [], 'F refused through the batch path');

  // ── F2: which ways Canvas is read ──
  {
    const P = x => S.canvasPlan(x);
    const eq2 = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' ' + JSON.stringify(a));
    eq2(P({ canvas: '' }), { enabled: false, api: false, sso: false }, 'F2 no address -> off');
    eq2(P({ canvas: 'https://x' }), { enabled: true, api: false, sso: true }, 'F2 an existing install (address only, defaults) -> browser way, as before');
    eq2(P({ canvas: 'https://x', canvasToken: 't' }), { enabled: true, api: true, sso: true }, 'F2 address + token, both on -> API with browser fallback');
    eq2(P({ canvas: 'https://x', canvasToken: 't', canvasSsoEnabled: false }), { enabled: true, api: true, sso: false }, 'F2 token, browser way off -> API only');
    eq2(P({ canvas: 'https://x', canvasToken: 't', canvasApiEnabled: false }), { enabled: true, api: false, sso: true }, 'F2 token filled but API off -> browser only');
    eq2(P({ canvas: 'https://x', canvasApiEnabled: true, canvasSsoEnabled: false }), { enabled: true, api: false, sso: false }, 'F2 API on, no token, browser off -> configured but unusable (reported, not silent)');
    eq2(P({ canvas: 'https://x', canvasApiEnabled: false, canvasSsoEnabled: false }), { enabled: false, api: false, sso: false }, 'F2 both off -> Canvas off');
    eq2(P({ canvas: '  ', canvasToken: 't' }), { enabled: false, api: false, sso: false }, 'F2 blank address -> off whatever else');
    // an old record without the new keys reads as both on -> nothing pending for an existing install
    fs.writeFileSync('settings.json', JSON.stringify({ canvas: 'https://x.instructure.com' }));
    fs.writeFileSync('fetch-applied.json', JSON.stringify({ exclusions: [], canvas: 'https://x.instructure.com', canvasToken: '', classroomEnabled: true }));
    eq2(S.pendingFetchKeys(), [], 'F2 old record without canvasApiEnabled/canvasSsoEnabled -> nothing pending');
    S.write('canvasSsoEnabled', false);
    eq2(S.pendingFetchKeys(), ['canvasSsoEnabled'], 'F2 switching the browser way off is a pending change');
    S.write('canvasSsoEnabled', true);
    eq2(S.pendingFetchKeys(), [], 'F2 ...and back is not');
  }

  // ── G: the page ──
  S.write('canvasToken', 'PAGETOKEN~9');
  S.markApplied(S.read());
  const r = cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { encoding: 'utf8', cwd: PROJ });
  ok(r.status === 0, 'G redraw ok ' + (r.stderr || ''));
  const html = fs.readFileSync('summary.html', 'utf8');
  ok(/<input type="password" data-key="canvasToken"/.test(html), 'G token box is masked like a password');
  ok(/Canvas access token/.test(html) || /Токен доступа Canvas/.test(html), 'G labelled');
  ok(!/id="pending-banner"/.test(html), 'G no pending banner when applied');

  for (const f of ['settings.json', 'fetch-applied.json']) try { fs.unlinkSync(f); } catch {}
  console.log(`canvas: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
