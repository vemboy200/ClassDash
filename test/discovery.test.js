// Finding services after a sign-in (65-discovery.js), with made-up custom
// services standing in: which are tried, what's offered, Ignore, and
// --discover not opening a browser when there's nothing to try.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const manifest = (domain, signIn) => ({
  domain, name: domain.replace(/_/g, ' '), categories: ['assignments'], introduced: '3.0.0', communication_class: 'cloud_polling',
  browser_class: 'background', sign_in: signIn, codeowners: [], documentation: 'README.md', version: '1.0.0',
});
const service = (on, found) => `module.exports = { enabled: () => ${on}, read: async () => ({ items: [] })${found === undefined ? '' : `, found: async b => { const p = await b.openPage(); await p.close(); return ${found}; }`} };`;
const proj = T.makeProject({
  // Classroom on, Canvas without an address, Edpuzzle off: none of the
  // built-in ones is worth trying here.
  'settings.json': { language: 'en', email: 'a@example.test', canvas: '', edpuzzleEnabled: false, browserPath: '/nonexistent/browser' },
  'custom_services/works_off/manifest.json': manifest('works_off', ['google']),
  'custom_services/works_off/index.js': service(false, true),
  'custom_services/fails_off/manifest.json': manifest('fails_off', ['google']),
  'custom_services/fails_off/index.js': service(false, false),
  'custom_services/already_on/manifest.json': manifest('already_on', ['google']),
  'custom_services/already_on/index.js': service(true, true),
  'custom_services/no_test/manifest.json': manifest('no_test', ['google']),
  'custom_services/no_test/index.js': service(false),
  'custom_services/own_sign_in/manifest.json': manifest('own_sign_in', ['browser']),
  'custom_services/own_sign_in/index.js': service(false, true),
});
const node = code => {
  const r = cp.spawnSync(process.execPath, ['-e', `(async () => { const d = require('./65-discovery.js'); const settings = require('./19-settings.js').read();
    let opened = 0, closed = 0; const openPage = async () => { opened++; return { close: async () => { closed++; } }; };
    const out = await (async () => { ${code} })(); process.stdout.write(JSON.stringify(out)); })();`], { cwd: proj, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return 'failed: ' + (r.stdout + r.stderr).slice(-300); }
};

ok(JSON.stringify(node(`return d.candidates('google', settings).map(c => c.manifest.domain);`)) === '["fails_off","works_off"]',
  'after Google: the services that use it, are off and can be tested: ' + JSON.stringify(node(`return d.candidates('google', settings).map(c => c.manifest.domain);`)));
ok(JSON.stringify(node(`return d.candidates('own_sign_in', settings).map(c => c.manifest.domain);`)) === '["own_sign_in"]', 'a service\'s own sign-in tries only that service');
const ran = node(`const found = await d.run('google', settings, openPage); return { found, opened, closed, offers: d.offers(settings).map(m => m.domain) };`);
ok(ran.found && ran.found.join() === 'works_off', 'the one whose test passes is found: ' + JSON.stringify(ran));
ok(ran.opened === 2 && ran.closed === 2, 'each test gets a tab and closes it');
ok(ran.offers.join() === 'works_off', 'and it\'s what Settings → Services offers');

// The page offers it, with Set up and Ignore.
T.redraw(proj);
let html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(/data-svc-found="works_off"[\s\S]*?setUpFound\('works_off'\)[\s\S]*?ignoreFound\(this, 'works_off'\)/.test(html) && /Found: works off/.test(html), 'Settings → Services shows "Found: works off" with Set up and Ignore');
ok(/onclick="lookAgain\(this\)"/.test(html), 'Settings → Sign-ins has Look again');

// Ignore: through the page's action, which redraws.
const act = cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'ignoreFound', 'works_off'], { cwd: proj, encoding: 'utf8' });
ok(/"ok":true/.test(act.stdout), 'ignoreFound answers ok: ' + act.stdout.trim().slice(-200));
html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(!/data-svc-found="works_off"/.test(html), 'and it isn\'t offered any more');
ok(JSON.stringify(node(`return d.candidates('google', settings).map(c => c.manifest.domain);`)) === '["fails_off"]', 'nor tried again');
ok(/"ok":false/.test(cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'ignoreFound', '../x'], { cwd: proj, encoding: 'utf8' }).stdout), 'ignoreFound only takes a service\'s name');

// --discover with nothing worth trying opens no browser.
const r = cp.spawnSync(process.execPath, ['05-playwright-draft.js', '--discover', 'nothing_uses_this'], { cwd: proj, encoding: 'utf8', timeout: 30000 });
ok(/No service to look for/.test(r.stdout) && !/launch|executable/i.test(r.stdout + r.stderr), '--discover with nothing to try: no browser: ' + r.stdout.trim().slice(-200));
