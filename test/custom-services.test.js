// Custom services: the project's own custom_services/<domain>/, loaded by the
// bridge (61-services.js) next to the built-in ones and read in the check.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const bridge = require(path.join(T.REPO, 'src', '61-services.js'));

const manifest = (domain, extra = {}) => ({
  domain, name: domain.replace(/_/g, ' '), categories: ['assignments'], introduced: '3.0.0',
  communication_class: 'cloud_polling', browser_class: 'none', codeowners: [], documentation: 'README.md', version: '1.0.0', ...extra,
});

// The bridge: which custom services are loaded, and which are skipped.
{
  const dir = T.tmpDir('custom-');
  T.writeFiles(dir, {
    'good_one/manifest.json': manifest('good_one'),
    'good_one/index.js': 'module.exports = { read: async () => ({ items: [] }) };',
    'no_version/manifest.json': manifest('no_version', { version: undefined }),
    'canvas/manifest.json': manifest('canvas'),
    'Bad-Name/manifest.json': manifest('Bad-Name'),
    'throws/manifest.json': manifest('throws'),
    'throws/index.js': 'throw new Error("made-up load failure");',
  });
  const warn = console.warn; const warned = []; console.warn = m => warned.push(m);
  const all = bridge.list(undefined, { customDir: dir });
  const customs = all.filter(m => m.custom).map(m => m.domain);
  ok(customs.join() === 'good_one,throws', 'valid custom services are listed: ' + customs);
  ok(all.slice(0, 5).map(m => m.domain).join() === 'classroom,canvas,edpuzzle,q,calendar' && !all.find(m => m.domain === 'canvas').custom, 'after the built-in ones, which they can\'t replace');
  ok(warned.some(w => /no_version.*version/.test(w)), 'a custom service needs a version of its own');
  ok(warned.some(w => /"canvas".*built-in/.test(w)), 'one named like a built-in service is skipped, and says why');
  ok(warned.some(w => /Bad-Name.*lowercase/.test(w)), 'a domain has to be lowercase letters, digits and _');
  ok(typeof bridge.load('good_one', undefined, { customDir: dir }).read === 'function', 'a custom service\'s index.js loads');
  warned.length = 0;
  ok(bridge.load('throws', undefined, { customDir: dir }) === null && warned.some(w => /throws.*made-up load failure/.test(w)), 'one whose index.js fails to load is null, with a warning');
  console.warn = warn;
  ok(!bridge.list(undefined, { customDir: path.join(dir, 'missing') }).some(m => m.custom), 'no custom_services folder at all is fine');
}

// A whole check, with no browser: a custom service that works, one that
// fails, and one that's off.
{
  const due = new Date(Date.now() + 2 * 864e5).toISOString();
  const proj = T.makeProject({
    'settings.json': { language: 'en', email: '', canvas: '', classroomEnabled: false, edpuzzleEnabled: false, browserPath: '/nonexistent/browser' },
    'custom_services/homework_club/manifest.json': manifest('homework_club', { name: { en: 'Homework Club', ru: 'Кружок' } }),
    'custom_services/homework_club/index.js': `
      const fs = require('fs'), path = require('path');
      module.exports = {
        read: async () => {
          if (fs.existsSync(path.join(__dirname, 'fail'))) throw new Error('made-up read failure');
          return { items: [{ id: '1', title: 'Worksheet 4', type: 'Assignment', due_iso: ${JSON.stringify(due)} }] };
        },
      };`,
    'custom_services/always_broken/manifest.json': manifest('always_broken'),
    'custom_services/always_broken/index.js': 'module.exports = { read: async () => { throw new Error("made-up failure"); } };',
    'custom_services/switched_off/manifest.json': manifest('switched_off'),
    'custom_services/switched_off/index.js': 'module.exports = { enabled: () => false, read: async () => ({ items: [{ id: "x", title: "Never read" }] }) };',
  });
  const run = () => cp.spawnSync(process.execPath, ['05-playwright-draft.js'], { cwd: proj, encoding: 'utf8', timeout: 90000, env: { ...process.env, CLASSDASH_NOTIFY_TO: path.join(proj, 'notified.jsonl') } });
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(proj, f), 'utf8')); } catch { return null; } };

  let r = run();
  const out = r.stdout + r.stderr;
  ok(r.status === 0, 'the check runs: ' + r.status + ' ' + out.slice(-400));
  ok(!/couldn't start a browser|Failed to launch/.test(out), 'no browser for services whose browser class is none');
  let mem = read('last-collection.json') || [];
  const item = mem.find(x => x.id === 'homework_club-1');
  ok(item && item.platform === 'Homework Club' && item.class === 'Homework Club', 'its item is kept, tagged with its English name: ' + JSON.stringify(item));
  ok(!mem.some(x => x.title === 'Never read'), 'a custom service that\'s off isn\'t read');
  const st = read('check-status.json') || {};
  ok(st.homework_club && st.homework_club.status === 'ok', 'its status dot is green');
  ok(st.always_broken && st.always_broken.status === 'problem' && /made-up failure/.test(st.always_broken.detail), 'a failing one is red, with why, and the check goes on');
  ok(!st.switched_off, 'one that\'s off has no status');
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  ok(html.includes('Worksheet 4'), 'the page shows its item');
  ok(/data-svc-card="homework_club"/.test(html) && /data-section="svc-homework_club"/.test(html) && html.includes('custom_services/homework_club'), 'it has a card and a page of its own in Settings → Services');
  ok(!/data-svc-add="homework_club"/.test(html), 'but isn\'t offered under + Add service');

  // Its read fails next time: what it had is kept, not dropped.
  fs.writeFileSync(path.join(proj, 'custom_services', 'homework_club', 'fail'), '');
  r = run();
  mem = read('last-collection.json') || [];
  ok(mem.some(x => x.id === 'homework_club-1'), 'a failed read keeps its items from memory');
  ok((read('check-status.json') || {}).homework_club.status === 'problem', 'and its dot goes red');
}
