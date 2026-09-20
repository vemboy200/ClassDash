// The restartApi notifier action, on the scratch project (never the real API server / port 8734).
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PID = path.join(PROJ, 'api-server.pid');
const action = () => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', 'restartApi'], { cwd: PROJ, encoding: 'utf8' }).stdout.trim().split('\n').pop());
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const cleanup = () => { try { const p = parseInt(fs.readFileSync(PID, 'utf8'), 10); if (p) process.kill(p, 'SIGKILL'); } catch {} for (const f of ['api-server.pid', 'settings.json']) try { fs.unlinkSync(f); } catch {} };
cleanup();
(async () => {
  // 1. nothing running -> nothing started (a refresh must not switch the API on)
  fs.writeFileSync('settings.json', JSON.stringify({ apiEnabled: true, apiPort: 18999, apiNetwork: false }));
  let r = action();
  ok(r.ok && r.restarted === false && !fs.existsSync(PID), '1 nothing running: nothing is started, even with the API enabled: ' + JSON.stringify(r));

  // 2. running + enabled -> replaced by a fresh server
  const old = cp.spawn('sleep', ['60'], { stdio: 'ignore', detached: true }); old.unref();
  fs.writeFileSync(PID, String(old.pid));
  r = action();
  ok(r.ok && r.restarted === true, '2 running and enabled: restarted: ' + JSON.stringify(r));
  await sleep(300);
  ok(!alive(old.pid), '2 the old process is gone');
  let fresh = 0;
  for (let i = 0; i < 40 && !fresh; i++) { await sleep(150); try { fresh = parseInt(fs.readFileSync(PID, 'utf8'), 10); } catch {} if (fresh === old.pid) fresh = 0; }
  ok(fresh && fresh !== old.pid && alive(fresh), '2 a NEW server is running (pid ' + fresh + ', not ' + old.pid + ')');
  cleanup();

  // 3. running but switched off -> stopped, not restarted
  fs.writeFileSync('settings.json', JSON.stringify({ apiEnabled: false, apiPort: 18999 }));
  const old2 = cp.spawn('sleep', ['60'], { stdio: 'ignore', detached: true }); old2.unref();
  fs.writeFileSync(PID, String(old2.pid));
  r = action();
  await sleep(300);
  ok(r.ok && r.restarted === false && !alive(old2.pid) && !fs.existsSync(PID), '3 running but switched off: stopped and left off: ' + JSON.stringify(r));
  cleanup();
  console.log(`restart-api: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
