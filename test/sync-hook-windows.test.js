// Windows app: syncProjectScripts() at launch.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), childProcess = require('child_process');
const REAL = T.REPO;
const src = fs.readFileSync(path.join(REAL, 'electron/main.js'), 'utf8');
const a = src.indexOf('function syncProjectScripts()'), b = src.indexOf('// Genuinely fire-and-forget', a);
const code = src.slice(a, b);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

function world({ scriptExists = true, spawn, realFs = false }) {
  const calls = [], warns = [];
  const ctx = {
    path, process: { resourcesPath: '/app/resources', execPath: 'ClassDash.exe' }, projectDir: '/proj',
    fs: realFs ? fs : { existsSync: () => scriptExists },
    spawnSync: (...args) => { calls.push(['spawn', ...args]); return spawn(...args); },
    nodeEnv: () => ({ ELECTRON_RUN_AS_NODE: '1' }),
    runNodeScriptSync: (script, args, dir) => calls.push(['run', script, args.join(' '), dir]),
    console: { warn: (...a) => warns.push(a.join(' ')) },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.go = syncProjectScripts;', ctx);
  return { ctx, calls, warns };
}
const out = o => ({ stdout: JSON.stringify(o) + '\n' });

// 1. no bundled template (an unpackaged run): nothing at all
let w = world({ scriptExists: false, spawn: () => out({}) });
w.ctx.go(); ok(w.calls.length === 0, '1 no bundled template: does nothing');

// 2. synced with changes: redraw, then restart the API — in that order, in the project
w = world({ spawn: () => out({ ok: true, action: 'synced', changed: ['08-page.js'], refreshedModules: false }) });
w.ctx.go();
ok(w.calls[0][0] === 'spawn' && w.calls[0][1] === 'ClassDash.exe' && w.calls[0][2][0].endsWith('30-template-sync.js') && w.calls[0][2][1].endsWith('ProjectTemplate') && w.calls[0][2][2] === '/proj', '2 runs the BUNDLED script with (template, project): ' + JSON.stringify(w.calls[0].slice(1, 3)));
ok(w.calls[0][3].env.ELECTRON_RUN_AS_NODE === '1', '2 runs as node (ELECTRON_RUN_AS_NODE), like every other script here');
ok(JSON.stringify(w.calls.slice(1).map(c => c.slice(0, 3))) === JSON.stringify([['run', '05-playwright-draft.js', '--redraw'], ['run', '21-notifier-actions.js', 'restartApi']]), '2 then redraws and restarts the API: ' + JSON.stringify(w.calls.slice(1)));
ok(w.calls[1][3] === '/proj', '2 both run in the project folder');

// 3-5. nothing changed / only a marker / only node_modules
w = world({ spawn: () => out({ ok: true, action: 'synced', changed: [], refreshedModules: false }) }); w.ctx.go();
ok(w.calls.length === 1, '3 identical project (just got its marker): no redraw, no restart');
w = world({ spawn: () => out({ ok: true, action: 'synced', changed: [], refreshedModules: true }) }); w.ctx.go();
ok(w.calls.length === 3, '4 only node_modules refreshed: still redraws and restarts');
for (const action of ['current', 'skipped']) { w = world({ spawn: () => out({ ok: true, action }) }); w.ctx.go(); ok(w.calls.length === 1, '5 ' + action + ': nothing further'); }

// 6-8. failures never throw and never go on to redraw
w = world({ spawn: () => out({ ok: false, action: 'failed', error: 'EACCES: permission denied' }) });
let threw = false; try { w.ctx.go(); } catch { threw = true; }
ok(!threw && w.calls.length === 1 && /EACCES/.test(w.warns[0]), '6 a failed sync warns with the reason and does nothing else: ' + w.warns[0]);
w = world({ spawn: () => ({ stdout: 'not json at all' }) }); threw = false; try { w.ctx.go(); } catch { threw = true; }
ok(!threw && w.calls.length === 1, '7 unparseable output does not throw');
w = world({ spawn: () => ({ stdout: '' }) }); threw = false; try { w.ctx.go(); } catch { threw = true; }
ok(!threw, '8 empty output does not throw');
w = world({ spawn: () => { throw new Error('spawn ENOENT'); } }); threw = false; try { w.ctx.go(); } catch { threw = true; }
ok(!threw && /ENOENT/.test(w.warns[0]), '9 a spawn failure does not throw: ' + w.warns[0]);

// 10. the real thing: real node, real sync script, real scratch folders
{
  const tmp = () => T.tmpDir('w24-');
  const t = tmp(), p = tmp();
  fs.writeFileSync(path.join(t, '08-page.js'), '// NEW\n'); fs.writeFileSync(path.join(t, 'package.json'), '{"dependencies":{}}');
  fs.copyFileSync(path.join(REAL, '30-template-sync.js'), path.join(t, '30-template-sync.js'));
  fs.writeFileSync(path.join(p, '08-page.js'), '// OLD\n'); fs.writeFileSync(path.join(p, 'settings.json'), '{"keep":"me"}');
  const calls = [];
  const ctx = { path, process: { resourcesPath: '/x', execPath: process.execPath }, projectDir: p, fs: { existsSync: () => true },
    spawnSync: (exe, args, o) => childProcess.spawnSync(exe, [args[0].replace('/x/ProjectTemplate', t), t, p], o),
    nodeEnv: () => process.env, runNodeScriptSync: (s, a) => calls.push(s + ' ' + a.join(' ')), console };
  vm.createContext(ctx);
  // point the template path at the real scratch template
  vm.runInContext(code.replace("path.join(process.resourcesPath, 'ProjectTemplate')", JSON.stringify(t)) + '\nthis.go = syncProjectScripts;', ctx);
  ctx.spawnSync = (exe, args, o) => childProcess.spawnSync(exe, args, o);
  ctx.go();
  ok(fs.readFileSync(path.join(p, '08-page.js'), 'utf8') === '// NEW\n' && fs.readFileSync(path.join(p, 'settings.json'), 'utf8') === '{"keep":"me"}', '10 real run: script replaced, settings untouched');
  ok(calls.join('|') === '05-playwright-draft.js --redraw|21-notifier-actions.js restartApi', '10 real run: redraw then restart requested: ' + calls.join('|'));
  calls.length = 0; ctx.go();
  ok(calls.length === 0, '10 real run, second launch: nothing to do');
}
console.log(`sync-hook-windows: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
