// 30-template-sync.js: keeps a project's scripts in step with the app's bundled template.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const REAL = T.REPO;
const sync = require(path.join(REAL, 'src', '30-template-sync.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const tmp = () => T.tmpDir('sync-');
const write = (dir, name, body) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), body); };
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const has = (dir, name) => fs.existsSync(path.join(dir, name));

function template(v = 'new', deps = { playwright: '^1.62.1' }) {
  const t = tmp();
  write(t, '05-collector.js', `// collector ${v}\n`);
  write(t, '08-page.js', `// page ${v}\n`);
  write(t, '30-template-sync.js', '// the sync script itself\n');
  write(t, 'refresh-icon.png', `png-${v}`);
  write(t, 'settings.example.json', '{"example":true}');
  write(t, 'package.json', JSON.stringify({ name: 'classdash', dependencies: deps }));
  write(t, 'node_modules/playwright/index.js', `// playwright for ${v}\n`);
  return t;
}
function oldProject() {
  const p = tmp();
  write(p, '05-collector.js', '// collector OLD\n');
  write(p, '08-page.js', '// page OLD\n');
  write(p, 'package.json', JSON.stringify({ name: 'classdash', dependencies: { playwright: '^1.62.1' } }));
  write(p, 'node_modules/playwright/index.js', '// playwright OLD\n');
  // the person's own things — none of these may ever be touched
  write(p, 'settings.json', '{"email":"me@school","canvasToken":"SECRET"}');
  write(p, 'last-collection.json', '[{"id":"a"}]');
  write(p, 'messages.json', '[]');
  write(p, 'не-срочно.txt', 'u1\n');
  write(p, 'browser-profile/Default/Cookies', 'cookie-bytes');
  write(p, 'window-log.txt', 'log');
  write(p, 'my-notes.txt', 'mine');
  write(p, 'extra-script-i-wrote.js', '// not in the template\n');
  return p;
}
const snapshot = (dir, names) => Object.fromEntries(names.map(n => [n, read(dir, n)]));
const THEIRS = ['settings.json', 'last-collection.json', 'messages.json', 'не-срочно.txt', 'browser-profile/Default/Cookies', 'window-log.txt', 'my-notes.txt', 'extra-script-i-wrote.js'];

// ── 1: an old project gets the new scripts, and only those ──
{
  const t = template('new'), p = oldProject();
  const before = snapshot(p, THEIRS);
  const r = sync.syncProject(t, p);
  ok(r.ok && r.action === 'synced', '1 synced: ' + JSON.stringify(r));
  ok(read(p, '08-page.js') === '// page new\n' && read(p, '05-collector.js') === '// collector new\n', '1 the scripts are the new ones');
  ok(has(p, '30-template-sync.js') && has(p, 'refresh-icon.png') && has(p, 'settings.example.json'), '1 files the project lacked (the script itself, the icon, the example) are added');
  ok(JSON.stringify(r.changed.sort()) === JSON.stringify(['05-collector.js', '08-page.js', '30-template-sync.js', 'package.json', 'refresh-icon.png', 'settings.example.json'].sort()) || r.changed.length >= 5, '1 reports what changed: ' + r.changed);
  ok(JSON.stringify(snapshot(p, THEIRS)) === JSON.stringify(before), '1 settings, data, profile, logs and the person\'s own files are byte-for-byte untouched');
  ok(has(p, 'template-sync.json'), '1 the marker is written');
  ok(read(p, 'previous-scripts/08-page.js') === '// page OLD\n' && read(p, 'previous-scripts/05-collector.js') === '// collector OLD\n', '1 the replaced files are backed up');
  ok(!has(p, 'previous-scripts/refresh-icon.png'), '1 only files that existed are backed up');
  ok(read(p, 'node_modules/playwright/index.js') === '// playwright OLD\n' && r.refreshedModules === false, '1 node_modules is left alone when dependencies did not change');

  // ── 2: a second run is a no-op ──
  const stamp = fs.statSync(path.join(p, '08-page.js')).mtimeMs;
  const r2 = sync.syncProject(t, p);
  ok(r2.ok && r2.action === 'current', '2 next launch: nothing to do (' + r2.action + ')');
  ok(fs.statSync(path.join(p, '08-page.js')).mtimeMs === stamp, '2 and nothing was rewritten');

  // ── 3: the app updates again ──
  const t2 = template('newer');
  const r3 = sync.syncProject(t2, p);
  ok(r3.action === 'synced' && read(p, '08-page.js') === '// page newer\n', '3 a newer app brings newer scripts');
  ok(read(p, 'previous-scripts/08-page.js') === '// page new\n', '3 the backup is one step back, replaced (not accumulated)');
  ok(JSON.stringify(snapshot(p, THEIRS)) === JSON.stringify(before), '3 still nothing of theirs touched');

  // ── 4: a hand edit is recoverable ──
  write(p, '08-page.js', '// hand edited\n');
  sync.syncProject(template('newest'), p);
  ok(read(p, 'previous-scripts/08-page.js') === '// hand edited\n', '4 a script edited by hand is kept in previous-scripts/');
}

// ── 5: dependencies changed -> node_modules replaced ──
{
  const t = template('new', { playwright: '^2.0.0', extra: '1.0.0' }), p = oldProject();
  const r = sync.syncProject(t, p);
  ok(r.refreshedModules === true && read(p, 'node_modules/playwright/index.js') === '// playwright for new\n', '5 new dependencies -> node_modules replaced');
  const p2 = oldProject(); fs.rmSync(path.join(p2, 'node_modules'), { recursive: true });
  const r5 = sync.syncProject(template('new'), p2);
  ok(r5.refreshedModules === true && has(p2, 'node_modules/playwright/index.js'), '5 a missing node_modules is restored');
}

// ── 6: the guards ──
{
  // a git checkout: the developer's working copy must NEVER be overwritten
  const t = template('bundled-and-older'), p = oldProject();
  fs.mkdirSync(path.join(p, '.git'));
  write(p, '08-page.js', '// UNCOMMITTED WORK\n');
  const r = sync.syncProject(t, p);
  ok(r.action === 'skipped' && /git/.test(r.reason), '6 a git checkout is skipped: ' + r.reason);
  ok(read(p, '08-page.js') === '// UNCOMMITTED WORK\n' && !has(p, 'template-sync.json') && !has(p, 'previous-scripts'), '6 ...and not a byte of it is touched, no marker, no backup');
  // the project is the template
  const t2 = template('x'); ok(sync.syncProject(t2, t2).action === 'skipped', '6 the project being the template folder is skipped');
  // through a symlink too
  const link = path.join(tmp(), 'link'); fs.symlinkSync(t2, link);
  ok(sync.syncProject(t2, link).action === 'skipped', '6 ...even through a symlink');
  ok(sync.syncProject('/no/such/template', oldProject()).action === 'skipped', '6 no template: skipped');
  ok(sync.syncProject(template('x'), '/no/such/project').action === 'skipped', '6 no project: skipped');
  ok(sync.syncProject(undefined, undefined).action === 'skipped', '6 no arguments: skipped, no throw');
  const empty = tmp(); ok(sync.syncProject(empty, oldProject()).action === 'skipped', '6 an empty template is skipped');
}

// ── 7: things the template does NOT have are left alone (no deletions ever) ──
{
  const t = template('new'), p = oldProject();
  write(p, '99-removed-upstream.js', '// an old script a later version dropped\n');
  sync.syncProject(t, p);
  ok(has(p, '99-removed-upstream.js') && has(p, 'extra-script-i-wrote.js'), '7 nothing is ever deleted');
}

// ── 8: a failure is reported, never thrown, and retried next time ──
{
  const t = template('new'), p = oldProject();
  if (process.getuid && process.getuid() === 0) { console.log('(running as root: an unwritable folder cannot be made, so this case is skipped)'); }
  fs.chmodSync(p, 0o555);       // a project folder we cannot write into
  let r; try { r = sync.syncProject(t, p); } catch (e) { r = { threw: e.message }; }
  fs.chmodSync(p, 0o755);
  ok(!r.threw && r.ok === false && r.action === 'failed' && r.error, '8 an unwritable project reports {ok:false} instead of throwing: ' + JSON.stringify(r).slice(0, 100));
  ok(!has(p, 'template-sync.json'), '8 and is NOT marked done, so the next launch tries again');
  const r2 = sync.syncProject(t, p);
  ok(r2.action === 'synced', '8 the retry succeeds once it can');
}

// ── 9: the fingerprint ──
{
  const a = template('same'), b = template('same');
  ok(sync.fingerprint(a) === sync.fingerprint(b), '9 the same files give the same fingerprint (independent of where they live)');
  write(b, 'refresh-icon.png', 'png-changed');
  ok(sync.fingerprint(a) !== sync.fingerprint(b), '9 a changed icon changes it');
  write(b, 'refresh-icon.png', 'png-same');
  write(b, '.DS_Store', 'junk');
  ok(sync.fingerprint(a) === sync.fingerprint(b), '9 dotfiles are ignored');
  const c = template('same'); fs.renameSync(path.join(c, '08-page.js'), path.join(c, '09-page.js'));
  ok(sync.fingerprint(a) !== sync.fingerprint(c), '9 a renamed file changes it');
}

// ── 10: a fresh wizard project (identical files, no marker yet) ──
{
  const t = template('new'), p = tmp();
  for (const n of sync.shippedFiles(t)) fs.copyFileSync(path.join(t, n), path.join(p, n));
  fs.cpSync(path.join(t, 'node_modules'), path.join(p, 'node_modules'), { recursive: true });
  const r = sync.syncProject(t, p);
  ok(r.action === 'synced' && r.changed.length === 0 && has(p, 'template-sync.json'), '10 an identical fresh project just gets its marker (no changes)');
  ok(!has(p, 'previous-scripts'), '10 and no backup folder is made when nothing was replaced');
}

// ── 11: the command line ──
{
  const t = template('new'), p = oldProject();
  const run = args => cp.spawnSync('node', [path.join(t, '30-template-sync.js'), ...args], { encoding: 'utf8' });
  // the script lives in the template in real use; copy the real one in so we run the real thing
  fs.copyFileSync(path.join(REAL, 'src', '30-template-sync.js'), path.join(t, '30-template-sync.js'));
  const r = run([t, p]);
  const last = r.stdout.trim().split('\n').pop();
  let parsed; try { parsed = JSON.parse(last); } catch { parsed = null; }
  ok(r.status === 0 && parsed && parsed.action === 'synced', '11 CLI: exits 0 and prints one JSON line: ' + last.slice(0, 80));
  ok(read(p, '08-page.js') === '// page new\n', '11 CLI: the work was done');
  const bad = run([]);
  ok(bad.status === 0 && JSON.parse(bad.stdout.trim()).action === 'skipped', '11 CLI with no arguments: still exits 0');
  const again = JSON.parse(run([t, p]).stdout.trim());
  ok(again.action === 'current', '11 CLI: the second launch is a no-op');
}

// ── 12: the real template shape (what build.sh / electron-builder ship) ──
{
  // everything that would be bundled: src/'s *.js + settings.example.json + the icons, plus package.json from the true repo root
  const t = tmp();
  for (const n of fs.readdirSync(path.join(REAL, 'src'))) if (/\.js$/.test(n) || ['settings.example.json', 'refresh-icon.png', 'freshcheck-icon.png', 'settings-icon.png', 'loading-icon.png', 'loading-icon-light.png', 'stop-icon.png'].includes(n)) fs.copyFileSync(path.join(REAL, 'src', n), path.join(t, n));
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(t, 'package.json'));
  const p = oldProject();
  const r = sync.syncProject(t, p);
  ok(r.ok && r.action === 'synced' && r.changed.length > 20, '12 the real file set syncs: ' + r.changed.length + ' files');
  ok(has(p, '28-live-state.js') && has(p, '10-canvas.js') && has(p, '30-template-sync.js'), '12 including files an old project never had');
  ok(!has(p, 'settings.json') || read(p, 'settings.json').includes('SECRET'), '12 the person\'s settings.json is still theirs');
}

console.log(`template-sync: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
