// Beta versions (betaUpdates): the order versions and betas are offered in
// (isNewer, the same in 16-summary.swift and electron/main.js), which
// release the list gives with betas on, and the switch in Settings.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '' } });
const u = require(path.join(proj, '26-update-check.js'));
const newer = (a, b) => u.isNewer(a, b);

ok(newer('3.0.0-beta.2', '3.0.0-beta.1') && !newer('3.0.0-beta.1', '3.0.0-beta.2'), 'a newer beta of the same version is offered');
ok(newer('3.0.0-beta.10', '3.0.0-beta.9'), 'beta.10 comes after beta.9, by number not by letters');
ok(newer('3.0.0-rc.1', '3.0.0-beta.9'), 'a release candidate comes after the betas');
ok(newer('3.0.0', '3.0.0-rc.1') && !newer('3.0.0-rc.1', '3.0.0'), 'the release comes after its betas');
ok(newer('3.0.0-beta.1', '2.8.0') && !newer('2.8.0', '3.0.0-beta.1'), 'a beta of the next version is newer than the last release');
ok(newer('3.0.0-beta.1', '3.0.0-dev.62+0ab2f48') && !newer('3.0.0-dev.62+0ab2f48', '3.0.0-beta.1'), 'a local build is older than any published beta of its version, so the beta is offered to it');
ok(!newer('3.0.0-beta.1', '3.0.0-beta.1') && !newer('3.0.0-beta.1+abc', '3.0.0-beta.1'), 'the same beta isn\'t newer than itself, build info or not');
ok(newer('1.10.0', '1.9.0') && newer('3.0.0', '3.0.0-dev.57+e27cf92'), 'what already worked still does');

const list = [
  { tag_name: 'v3.0.0-beta.3', draft: true },
  { tag_name: 'v3.0.0-beta.2', prerelease: true },
  { tag_name: 'v2.8.0' },
  { tag_name: 'v3.0.0-beta.1', prerelease: true },
];
ok(u.newestRelease(list).tag_name === 'v3.0.0-beta.2', 'betas on: the newest release in the list, never a draft');
ok(u.newestRelease([{ tag_name: 'v3.0.0' }, { tag_name: 'v3.0.0-rc.2', prerelease: true }]).tag_name === 'v3.0.0', 'and the release itself once it\'s out');
ok(u.newestRelease([]) === null, 'none: nothing to offer');

// The apps pick the same way: their copies of isNewer match this one.
const electron = fs.readFileSync(path.join(T.REPO || path.resolve(__dirname, '..'), 'electron', 'main.js'), 'utf8');
const mine = fs.readFileSync(path.join(proj, '26-update-check.js'), 'utf8');
const fn = (src, name) => (new RegExp(`function ${name}\\([^]*?\\n}\\n`).exec(src) || [''])[0];
ok(fn(electron, 'isNewer') === fn(mine, 'isNewer') && fn(electron, 'comparePre') === fn(mine, 'comparePre') && fn(mine, 'comparePre'), 'the Windows app\'s comparison is the same code');

// The switch: Settings → Advanced, off at first.
T.redraw(proj);
let html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(/data-bool-key="betaUpdates" onchange="betaToggled\(\)">/.test(html), 'Settings → Advanced has Beta versions, off');
T.run(proj, '21-notifier-actions.js', ['config', T.enc({ betaUpdates: true })]);
ok(JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8')).betaUpdates === true, 'turned on, it\'s saved');
fs.writeFileSync(path.join(proj, 'update-status.json'), JSON.stringify({ currentVersion: '2.8.0', latestVersion: '3.0.0-beta.2', url: 'https://example.test/r', updateAvailable: true }));
T.run(proj, '21-notifier-actions.js', ['updateChecked', '']);
html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok(/data-bool-key="betaUpdates" onchange="betaToggled\(\)" checked>/.test(html) && /ClassDash v3\.0\.0-beta\.2 <span class="update-beta">beta<\/span>/.test(html),
  'after the app\'s check, the page shows the beta, marked as one');
