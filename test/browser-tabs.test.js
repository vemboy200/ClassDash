// Last time's tabs aren't brought back (forgetOpenTabs in 20-browser.js): a
// check cut off for taking too long leaves the browser thinking it crashed,
// and it reopened every tab it had, run after run, dozens of them.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en' } });
const { forgetOpenTabs } = require(path.join(proj, '20-browser.js'));
const profile = path.join(proj, 'browser-profile'), def = path.join(profile, 'Default');
const make = () => {
  fs.mkdirSync(path.join(def, 'Sessions'), { recursive: true });
  fs.writeFileSync(path.join(def, 'Sessions', 'Tabs_1'), 'old tabs');
  fs.writeFileSync(path.join(def, 'Last Session'), 'old');
  fs.writeFileSync(path.join(def, 'Cookies'), 'signed in');
  fs.writeFileSync(path.join(def, 'Preferences'), '{}');
};
make();
ok(forgetOpenTabs(profile) === true && !fs.existsSync(path.join(def, 'Sessions')) && !fs.existsSync(path.join(def, 'Last Session')), 'the saved tabs are forgotten');
ok(fs.readFileSync(path.join(def, 'Cookies'), 'utf8') === 'signed in' && fs.existsSync(path.join(def, 'Preferences')), '...the sign-ins (cookies) and the rest of the profile aren\'t');
ok(forgetOpenTabs(profile) === false, 'nothing to forget: nothing happens');
make();
fs.symlinkSync(`made-up-host-${process.pid}`, path.join(profile, 'SingletonLock'));
ok(forgetOpenTabs(profile) === false && fs.existsSync(path.join(def, 'Sessions', 'Tabs_1')), 'a browser has the profile open: left alone');
// One killed mid-check leaves its lock: a process that isn't running.
const gone = require('child_process').spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
fs.unlinkSync(path.join(profile, 'SingletonLock'));
fs.symlinkSync(`made-up-host-${gone}`, path.join(profile, 'SingletonLock'));
ok(forgetOpenTabs(profile) === true && !fs.existsSync(path.join(def, 'Sessions')), 'a lock left by a browser that\'s gone doesn\'t stop it');
ok(forgetOpenTabs(path.join(proj, 'no-such-profile')) === false, 'no profile yet: fine');

const src = fs.readFileSync(path.join(proj, '05-playwright-draft.js'), 'utf8');
const launches = src.split('chromium.launchPersistentContext(PROFILE_DIR').length - 1;
const guarded = (src.match(/forgetOpenTabs\(PROFILE_DIR\);[^\n]*\n\s*(const ctx = |ctx = )?await chromium\.launchPersistentContext\(PROFILE_DIR/g) || []).length;
ok(launches > 0 && guarded === launches, `every launch forgets them first (sign-in, discovery, checks): ${guarded} of ${launches}`);
