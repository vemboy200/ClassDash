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
  };
}
for (const m of all) {
  ok(fs.existsSync(path.join(T.REPO, m.documentation)), `${m.domain}: its documentation page exists (${m.documentation})`);
  const doc = details(m.documentation);
  for (const key of Object.keys(doc)) {
    ok(JSON.stringify(doc[key]) === JSON.stringify(m[key]), `${m.domain}: ${key} matches its page (manifest ${JSON.stringify(m[key])}, page ${JSON.stringify(doc[key])})`);
  }
}
ok(bridge.nameOf(all.find(m => m.domain === 'calendar'), 'ru') === 'Календарь по ссылке (ICS)' && bridge.nameOf(all.find(m => m.domain === 'calendar'), 'xx') === 'Calendar feed (ICS)', 'a translated name falls back to English');

// A broken service is skipped, and doesn't take the others with it.
{
  const dir = T.tmpDir('services-');
  const good = { domain: 'good', name: 'Good', categories: ['grades'], introduced: '3.0.0', communication_class: 'cloud_polling', browser_class: 'none', codeowners: [], documentation: 'x.md' };
  T.writeFiles(dir, {
    'good/manifest.json': good,
    'renamed/manifest.json': { ...good, domain: 'not-its-folder' },
    'bad-class/manifest.json': { ...good, domain: 'bad-class', browser_class: 'sometimes' },
    'not-json/manifest.json': '{ nope',
    'no-manifest/index.js': '',
  });
  const warn = console.warn; const warned = []; console.warn = m => warned.push(m);
  const found = bridge.list(dir);
  console.warn = warn;
  ok(found.map(m => m.domain).join() === 'good', 'only the valid one is listed: ' + found.map(m => m.domain));
  ok(warned.length === 4 && warned.some(w => /bad-class.*browser_class/.test(w)) && warned.some(w => /renamed.*domain/.test(w)), 'each skipped one says why: ' + warned.join(' | '));
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
}

// The bridge's load(): a service's index.js, the only file of it the check calls.
{
  const canvas = bridge.load('canvas');
  ok(canvas && typeof canvas.read === 'function' && typeof canvas.enabled === 'function', 'Canvas loads through the bridge');
  ok(bridge.load('edpuzzle') === null && bridge.load('nothing-like-this') === null, 'a service without an index.js yet, or none at all, is null');
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
