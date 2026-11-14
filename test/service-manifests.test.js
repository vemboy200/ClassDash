// Services' manifest.json files (61-services.js): valid, in step with the
// Details table on each service's docs page, and what the Services cards are
// built from. Like Home Assistant's hassfest, for ClassDash's services.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const bridge = require(path.join(T.REPO, 'src', '61-services.js'));

const all = bridge.list();
ok(all.map(m => m.domain).join() === 'classroom,canvas,edpuzzle,q,calendar', 'every built-in service has a valid manifest, in the cards\' order: ' + all.map(m => m.domain));
const folders = fs.readdirSync(bridge.SERVICES_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
ok(folders.length === all.length, 'no service folder is missing its manifest');

// The docs' Details table, read back into manifest terms.
const plain = cell => cell.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
function details(file) {
  const text = fs.readFileSync(path.join(T.REPO, file), 'utf8');
  const rows = {};
  for (const m of text.slice(text.indexOf('## Details')).matchAll(/^\| \*\*(.+?)\*\* \| (.+?) \|$/gm)) rows[m[1]] = plain(m[2]);
  return {
    categories: (rows.Categories || '').split(',').map(c => c.trim().toLowerCase().replace(/ /g, '_')),
    introduced: (rows.Introduced || '').replace(/^v/, ''),
    communication_class: (rows['Communication class'] || '').toLowerCase().replace(/ /g, '_'),
    codeowners: rows['Code owners'] === 'None yet' ? [] : (rows['Code owners'] || '').split(',').map(o => o.trim()),
    browser_class: { 'Background browser': 'background', 'Visible browser': 'visible', 'Optional browser': 'optional', 'No browser': 'none' }[rows['Browser class']],
    sign_in: (rows['Sign-in'] || '').split(',').map(w => ({ 'Own fields': 'fields', 'Own browser sign-in': 'browser', 'Google sign-in': 'google' })[w.trim()]),
  };
}
for (const m of all) {
  ok(fs.existsSync(path.join(T.REPO, m.documentation)), `${m.domain}: its documentation page exists (${m.documentation})`);
  const doc = details(m.documentation);
  for (const key of Object.keys(doc)) {
    ok(JSON.stringify(doc[key]) === JSON.stringify(m[key]), `${m.domain}: ${key} matches its page (manifest ${JSON.stringify(m[key])}, page ${JSON.stringify(doc[key])})`);
  }
}
for (const m of all.filter(x => x.domain !== 'calendar')) {
  const png = Buffer.from(bridge.iconOf(m) || '', 'base64');
  ok(png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 64 && png.readUInt32BE(20) === 64 && png.length < 16 * 1024, `${m.domain}: its icon is a 64×64 PNG under 16 KB (${png.length} bytes)`);
}
ok(bridge.nameOf(all.find(m => m.domain === 'calendar'), 'ru') === 'Календарь по ссылке (ICS)' && bridge.nameOf(all.find(m => m.domain === 'calendar'), 'xx') === 'Calendar feed (ICS)', 'a translated name falls back to English');

// A broken service is skipped, and doesn't take the others with it.
{
  const dir = T.tmpDir('services-');
  const good = { domain: 'good', name: 'Good', categories: ['grades'], introduced: '3.0.0', communication_class: 'cloud_polling', browser_class: 'none', sign_in: ['fields'], codeowners: [], documentation: 'x.md' };
  T.writeFiles(dir, {
    'good/manifest.json': good,
    'renamed/manifest.json': { ...good, domain: 'not-its-folder' },
    'bad-class/manifest.json': { ...good, domain: 'bad-class', browser_class: 'sometimes' },
    'bad_sign_in/manifest.json': { ...good, domain: 'bad_sign_in', sign_in: ['facebook'] },
    'not-json/manifest.json': '{ nope',
    'no-manifest/index.js': '',
  });
  const warn = console.warn; const warned = []; console.warn = m => warned.push(m);
  const found = bridge.list(dir);
  console.warn = warn;
  ok(found.map(m => m.domain).join() === 'good', 'only the valid one is listed: ' + found.map(m => m.domain));
  ok(warned.length === 5 && warned.some(w => /bad_sign_in.*sign_in/.test(w)) && warned.some(w => /bad-class.*browser_class/.test(w)) && warned.some(w => /renamed.*domain/.test(w)), 'each skipped one says why: ' + warned.join(' | '));
  ok(bridge.list(path.join(dir, 'missing')).length === 0, 'no services folder at all is an empty list, not a crash');
}

// The Services cards come from the manifests.
{
  const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test' } });
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  const cards = [...html.matchAll(/class="svc-card" data-svc-card="([^"]+)"/g)].map(m => m[1]);
  ok(cards.join() === 'classroom,canvas,edpuzzle,q,calendar', 'a card per service, in order: ' + cards);
  ok(/data-svc-card="edpuzzle"[\s\S]*?icon-browser-head/.test(html) && /data-svc-card="calendar"[\s\S]*?Calendar feed \(ICS\)/.test(html), 'with the badge from its browser class and its name');
  fs.rmSync(path.join(proj, 'services', 'edpuzzle', 'manifest.json'));
  T.redraw(proj);
  const fewer = [...fs.readFileSync(path.join(proj, 'summary.html'), 'utf8').matchAll(/class="svc-card" data-svc-card="([^"]+)"/g)].map(m => m[1]);
  ok(!fewer.includes('edpuzzle') && fewer.length === 4, 'a service without a manifest has no card, and the page still draws');
  const logo = id => new RegExp(`data-svc-card="${id}"[^>]*>\\s*<span class="svc-head"><img class="svc-logo" src="data:image/png;base64,`).test(html);
  ok(['classroom', 'canvas', 'edpuzzle', 'q'].every(logo) && !logo('calendar'), 'cards show a service\'s brand/icon.png, and the calendar feed has none');
}

// The bridge's load(): a service's index.js, the only file of it the check calls.
{
  const canvas = bridge.load('canvas');
  ok(canvas && typeof canvas.read === 'function' && typeof canvas.enabled === 'function', 'Canvas loads through the bridge');
  ok(bridge.load('nothing-like-this') === null, 'a service that isn\'t there is null');
  const b = settings => ({ settings });
  const site = 'https://school.example.test';
  ok(!canvas.enabled(b({ canvas: '' })) && canvas.addresses(b({ canvas: '' })).length === 0, 'no address: off, and nowhere to reach');
  ok(canvas.enabled(b({ canvas: site, canvasToken: 'T' })) && !canvas.browserNeeded(b({ canvas: site, canvasToken: 'T' })), 'a token: no browser needed');
  ok(canvas.signInNeeded(b({ canvas: site, canvasToken: 'T' })), '...but the sign-in fallback still has to be signed into');
  ok(canvas.browserNeeded(b({ canvas: site })), 'no token: the sign-in way needs the browser');
  ok(!canvas.enabled(b({ canvas: site, canvasApiEnabled: false, canvasSsoEnabled: false })), 'both ways off: off');
  ok(canvas.addresses(b({ canvas: 'school.example.test' }))[0] === site + '/', 'its address gets https:// added');
  const collector = fs.readFileSync(path.join(T.REPO, 'src', '05-playwright-draft.js'), 'utf8');
  ok(!/require\([^)]*10-canvas\.js/.test(collector), 'the check never reaches into 10-canvas.js itself');
}

// result(): every read() comes back in one shape.
{
  const r = bridge.result({ items: [1], status: { detail: 'Method: API' } });
  ok(r.items.length === 1 && r.announcements.length === 0 && r.grades.length === 0 && r.events.length === 0, 'what a service leaves out is empty');
  ok(r.status.ok === true && r.status.detail === 'Method: API' && r.status.fallback === false, 'and the status defaults to a green dot');
  ok(bridge.result({ items: 'nope', status: { ok: false } }).items.length === 0 && bridge.result().status.ok, 'something that isn\'t a list is treated as empty');
}

// The calendar feed through the bridge.
(async () => {
  const feed = bridge.load('calendar');
  const at = h => new Date(Date.UTC(2026, 10, 13, h)).toISOString();
  const now = new Date(Date.UTC(2026, 10, 14, 12));
  ok(feed && !feed.enabled({ saved: {} }) && !feed.due({ saved: {} }, now), 'no saved link: off, and never due');
  ok(feed.due({ saved: { url: 'https://example.test/a.ics' } }, now), 'a link never read is due');
  ok(!feed.due({ saved: { url: 'x', fetchedAt: at(20) } }, now) && feed.due({ saved: { url: 'x', fetchedAt: at(10) } }, now), 'then once a day or so after the last read');
  ok(!feed.due({ saved: { url: 'x', fetchedAt: at(1), failedAt: at(20) } }, now), 'a failed try counts as a try, so it isn\'t retried every check');
  ok(feed.addresses({ saved: { url: 'webcal://example.test/a.ics' } })[0] === 'https://example.test/a.ics', 'webcal:// becomes https://');
  let why = null;
  try { await feed.read({ saved: { url: 'ftp://example.test/a.ics' } }); } catch (e) { why = e.message; }
  ok(/has to start with https/.test(why || ''), 'a read that can\'t work throws why: ' + why);
  ok(JSON.stringify(bridge.savedFor('nothing-like-this')) === '{}', 'a service with nothing saved gets an empty object');
})();

// Q: read in the background, through the bridge.
{
  const q = bridge.load('q');
  ok(all.find(m => m.domain === 'q').runs === 'background' && all.filter(m => m.runs === 'background').length === 1, 'Q is the one service read in the background');
  ok(q && q.enabled({ settings: { gradesProvider: 'q' } }) && !q.enabled({ settings: { gradesProvider: 'none' } }), 'Q is on only when it\'s the grades provider');
  ok(bridge.problems({ ...all[0], runs: 'sometimes' }, all[0].domain).some(p => /runs/.test(p)), 'an unknown "runs" is caught');
  const collector = fs.readFileSync(path.join(T.REPO, 'src', '05-playwright-draft.js'), 'utf8');
  ok(!/40-grades\.js'\), '--if-due'/.test(collector), 'the check no longer starts 40-grades.js itself');
}

// Edpuzzle through the bridge.
(async () => {
  const ed = bridge.load('edpuzzle');
  ok(ed && ed.enabled({ settings: {} }) && !ed.enabled({ settings: { edpuzzleEnabled: false } }), 'Edpuzzle is on unless switched off');
  ok(ed.addresses({ settings: {} })[0] === 'https://edpuzzle.com/' && ed.addresses({ settings: { edpuzzleEnabled: false } }).length === 0, 'its address, only while on');
  let closed = false, why = null;
  const page = { evaluate: async () => { throw new Error('made-up page failure'); }, goto: async () => { throw new Error('made-up page failure'); }, url: () => '', close: async () => { closed = true; } };
  try { await ed.read({ settings: {}, openPage: async () => page }); } catch (e) { why = e.message; }
  ok(why && closed, 'a read that fails throws, and its tab is closed anyway: ' + why);
  const collector = fs.readFileSync(path.join(T.REPO, 'src', '05-playwright-draft.js'), 'utf8');
  ok(!/require\([^)]*11-edpuzzle\.js/.test(collector), 'the check never reaches into 11-edpuzzle.js itself');
})();

// Classroom: its questions go through the bridge (reading it doesn't yet).
{
  const cr = bridge.load('classroom');
  ok(cr && cr.enabled({ settings: {} }) && cr.browserNeeded({ settings: {} }) && cr.signInNeeded({ settings: {} }), 'Classroom is on unless switched off, and needs the browser');
  ok(!cr.enabled({ settings: { classroomEnabled: false } }) && cr.addresses({ settings: { classroomEnabled: false } }).length === 0, 'off: nothing to reach');
  ok(cr.addresses({ settings: {} })[0] === 'https://classroom.google.com/', 'its address, while on');
  const collector = fs.readFileSync(path.join(T.REPO, 'src', '05-playwright-draft.js'), 'utf8');
  ok(!/SETTINGS\.classroomEnabled !==/.test(collector), 'the check asks the bridge whether Classroom is on');
}

// Classroom's read(), in a project of its own (it reads and writes classes.json).
{
  const proj = T.makeProject({
    'settings.json': { language: 'en', email: 'a@example.test' },
    'classes.json': [{ id: 'c1', name: 'Class One' }, { id: 'c2', name: 'Class Two' }],
  });
  const script = `
    const cr = require('./services/classroom/index.js');
    const settings = require('./19-settings.js').read();
    const out = {};
    const run = async (name, extra) => {
      const seen = { started: null, done: [] };
      const r = await cr.read({ settings, log: () => {}, previous: [], nonEmptyClasses: new Set(),
        started: s => { seen.started = s; }, done: p => seen.done.push(p), ...extra });
      out[name] = { r, seen };
    };
    (async () => {
      console.log = console.error = console.warn = () => {};
      const broken = new Error('made-up launch failure');
      await run('noBrowser', { browserFailed: broken, openPage: async () => { throw new Error('not called'); } });
      let opened = 0;
      const page = () => { opened++; const no = async () => { throw new Error('made-up page failure'); };
        return { goto: no, evaluate: no, waitForSelector: no, waitForTimeout: no, url: () => '', close: async () => { opened--; } }; };
      await run('pagesFail', { browserFailed: null, openPage: async () => page() });
      out.leftOpen = opened;
      process.stdout.write(JSON.stringify(out));
    })();`;
  const res = require('child_process').spawnSync(process.execPath, ['-e', script], { cwd: proj, encoding: 'utf8' });
  let out = {};
  try { out = JSON.parse(res.stdout); } catch { ok(false, 'Classroom read() ran: ' + res.stderr.slice(-400)); }
  const nb = out.noBrowser || { r: { sources: [], status: {} }, seen: { done: [] } };
  ok(nb.seen.started && nb.seen.started.map(c => c.id).join() === 'c1,c2', 'no browser: the classes from memory are still announced');
  ok(nb.r.sources.length === 2 && nb.r.sources.every(p => !p.ok && p.noBrowser) && nb.seen.done.length === 2, 'and each one fails as "no browser", reported as it goes');
  ok(nb.r.status.ok === false && nb.r.status.detail === 'made-up launch failure', 'Classroom\'s dot says why, not one class\'s name: ' + JSON.stringify(nb.r.status));
  const pf = out.pagesFail || { r: { sources: [], status: {} } };
  ok(pf.r.sources.length === 2 && pf.r.sources.every(p => !p.ok && !p.noBrowser && /made-up page failure/.test(p.error)), 'a class whose page fails is that class failing, with its reason');
  ok(/^Class One: /.test(pf.r.status.detail || ''), 'and the dot names the class: ' + pf.r.status.detail);
  ok(out.leftOpen === 0, 'every tab it opened is closed again');
  ok(bridge.result({ sources: [{ id: 'x' }] }).sources.length === 1 && bridge.result({}).sources.length === 0, 'result() passes sources through, empty when left out');
}
