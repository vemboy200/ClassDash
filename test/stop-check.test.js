// The stopCheck notifier action and killLeftoverBrowser, on the scratch project.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCK = path.join(PROJ, '.collection-lock');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const action = () => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', 'stopCheck'], { cwd: PROJ, encoding: 'utf8' }).stdout.trim().split('\n').pop());
// A stand-in "still running" process. Plain `sleep 60` works fine with no
// extra args (that's all a fake collector needs) but macOS's `sleep` REJECTS
// anything else on its command line ("invalid time interval") and exits
// immediately, which silently broke an earlier version of this test's
// "leave a different profile's browser alone" case — the decoy had already
// exited on its own by the time it was checked, for the wrong reason
// entirely. `node -e` with `--` ignores anything after it, so it stays up
// AND still carries the args pkill -f needs to see.
const spawnDecoy = extraArgs => {
  const c = extraArgs.length
    ? cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)', '--', ...extraArgs], { stdio: 'ignore', detached: true })
    : cp.spawn('sleep', ['60'], { stdio: 'ignore', detached: true });
  c.unref();
  return c;
};
const cleanup = () => { try { fs.unlinkSync(LOCK); } catch {} };
cleanup();

(async () => {
  // 1. nothing running -> nothing to stop
  let r = action();
  ok(r.ok && r.stopped === false, '1 nothing running: stopped is false: ' + JSON.stringify(r));

  // 2. a stale lock (pid long dead) -> also nothing to stop, and no error
  fs.writeFileSync(LOCK, '999999');
  r = action();
  ok(r.ok && r.stopped === false, '2 a dead pid in the lock: stopped is false: ' + JSON.stringify(r));
  cleanup();

  // 3. a real "collection" running -> it is asked to stop and dies
  const collector = spawnDecoy([]);
  fs.writeFileSync(LOCK, String(collector.pid));
  r = action();
  ok(r.ok && r.stopped === true, '3 a real process: stopped is true: ' + JSON.stringify(r));
  await sleep(300);
  ok(!alive(collector.pid), '3 the process actually died');
  cleanup();

  // 4. killLeftoverBrowser only touches something whose command line names
  //    THIS project's browser profile — never anything else running.
  const { PROFILE_DIR, killLeftoverBrowser } = require(path.join(PROJ, '05-playwright-draft.js'));
  const matching = spawnDecoy([`--user-data-dir=${PROFILE_DIR}`]);
  const other = spawnDecoy(['--user-data-dir=/somewhere/else/entirely']);
  await sleep(200);
  killLeftoverBrowser();
  await sleep(300);
  ok(!alive(matching.pid), '4 a leftover browser for THIS project is killed');
  ok(alive(other.pid), "4 a decoy for a different profile is left alone");
  try { process.kill(other.pid, 'SIGKILL'); } catch {}

  // 5. stopCheck calls it too: a decoy "browser" for this project, plus a
  //    real "collector" holding the lock, are both gone afterward.
  const collector2 = spawnDecoy([]);
  const browser2 = spawnDecoy([`--user-data-dir=${PROFILE_DIR}`]);
  fs.writeFileSync(LOCK, String(collector2.pid));
  r = action();
  await sleep(300);
  ok(r.stopped === true && !alive(collector2.pid) && !alive(browser2.pid),
    '5 stopCheck ends both the collector and its leftover browser: ' + JSON.stringify(r));
  cleanup();

  // 6. The response line stays PLAIN JSON, no matter which case ran above —
  //    05-playwright-draft.js patches console.log/warn/error the moment it's
  //    required at all (for its own runs.log timestamps), and stopCheck()
  //    requires it. Without saving and restoring around that require, this
  //    file's own final line gets a leaked "HH:MM:SS " in front of it — and
  //    the native bridge (Swift/Electron) parses that exact line literally,
  //    so a leaked prefix breaks it on the real app too, not just here.
  const raw = cp.spawnSync('node', ['21-notifier-actions.js', 'stopCheck'], { cwd: PROJ, encoding: 'utf8' }).stdout;
  const lastLine = raw.trim().split('\n').pop();
  ok(/^\{/.test(lastLine), '6 the response is plain JSON, not prefixed with a timestamp: ' + JSON.stringify(lastLine));
  let parsed = null; try { parsed = JSON.parse(lastLine); } catch {}
  ok(!!parsed && parsed.action === 'stopCheck', '6 ...and it actually parses: ' + JSON.stringify(lastLine));

  console.log(`stop-check: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
