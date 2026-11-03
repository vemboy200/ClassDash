// The automatic fresh checks, run by the server (52-check-schedule.js):
// when one is due, the app's host-state.json report, and the 10-minute
// minimum. Never starts a real check: tick() gets a stand-in.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const S = require(path.join(proj, '52-check-schedule.js'));

// ---- decide() ----
const on = { freshCheckAwakeMinutes: 60, freshCheckAsleepMinutes: 20, freshCheckOnlyWhenCharging: true };
const awake = { asleep: false, onBattery: false };
const d = o => S.decide({ settings: on, host: awake, headless: false, minutes: 90, running: false, ...o });

ok('due: awake, past the awake interval', d({}).run === true, JSON.stringify(d({})));
ok('not yet: awake, inside it', d({ minutes: 30 }).run === false && d({ minutes: 30 }).why === 'not yet');
ok('asleep uses the asleep interval', d({ host: { asleep: true, onBattery: false }, minutes: 30 }).run === true);
ok('never collected: due right away', d({ minutes: null }).run === true);
ok('no app reporting: nothing, however overdue', d({ host: null, minutes: null }).why === 'no app reporting');
ok('...unless the server is headless (a NAS), as awake and plugged in', d({ host: null, headless: true }).run === true);
ok('on battery with charging-only on: skipped', d({ host: { asleep: false, onBattery: true } }).why === 'on battery');
ok('...and run with it off', d({ host: { asleep: false, onBattery: true }, settings: { ...on, freshCheckOnlyWhenCharging: false } }).run === true);
ok('a check already running: none on top of it', d({ running: true }).why === 'a check is running');
ok('interval 0: off for that state', d({ settings: { ...on, freshCheckAwakeMinutes: 0 } }).why === 'off while awake');
ok('under 10 minutes is off, not rounded up (hand-edited settings.json)', d({ settings: { ...on, freshCheckAwakeMinutes: 5 } }).run === false);
ok('...10 itself is fine', d({ settings: { ...on, freshCheckAwakeMinutes: 10 }, minutes: 11 }).run === true);

// ---- the app's report ----
const now = Date.now();
const report = o => fs.writeFileSync(S.HOST_STATE_FILE, JSON.stringify(o));
try { fs.unlinkSync(S.HOST_STATE_FILE); } catch {}
ok('no report: null', S.readHostState(now) === null);
report({ asleep: true, onBattery: false, at: now - 30 * 1000 });
ok('a fresh report is read', JSON.stringify(S.readHostState(now)) === JSON.stringify({ asleep: true, onBattery: false }));
report({ asleep: false, onBattery: false, at: now - S.REPORT_FRESH_MS - 1000 });
ok('an old one means the app isn\'t running: null', S.readHostState(now) === null);
report({ asleep: false, onBattery: false, at: now + 60 * 60 * 1000 });
ok('one from the future (a clock change) isn\'t trusted either', S.readHostState(now) === null);
fs.writeFileSync(S.HOST_STATE_FILE, '{broken');
ok('a broken file: null, not a crash', S.readHostState(now) === null);

// ---- tick(), with the real files ----
const runs = [], lines = [];
const tick = (headless = false) => S.tick({ headless, start: () => runs.push(1), log: l => lines.push(l) });
fs.writeFileSync('settings.json', JSON.stringify({ language: 'en', freshCheckAwakeMinutes: 60 }));
report({ asleep: false, onBattery: false, at: Date.now() });
fs.writeFileSync('last-collection.json', '{}');
fs.utimesSync('last-collection.json', new Date(), new Date(Date.now() - 2 * 3600 * 1000));
tick();
ok('two hours since the last collection, hourly: one check started', runs.length === 1 && /running one/.test(lines.pop()), JSON.stringify(lines));
fs.utimesSync('last-collection.json', new Date(), new Date());
tick();
ok('just collected: none', runs.length === 1);
fs.utimesSync('last-collection.json', new Date(), new Date(Date.now() - 2 * 3600 * 1000));
try { fs.unlinkSync(S.HOST_STATE_FILE); } catch {}
tick();
ok('app gone: none, even though one is due', runs.length === 1);
tick(true);
ok('...but a headless server checks', runs.length === 2);
fs.writeFileSync('settings.json', JSON.stringify({ language: 'en', freshCheckAwakeMinutes: 60, freshCheckOnlyWhenCharging: true }));
report({ asleep: false, onBattery: true, at: Date.now() });
tick();
ok('on battery: none, and the log says why', runs.length === 2 && /on battery/.test(lines.pop()));

// ---- the apps no longer decide ----
const swift = fs.readFileSync(path.join(__dirname, '..', 'mac', '16-summary.swift'), 'utf8');
const electron = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
ok('the Mac app reports host-state.json instead of starting checks', /host-state\.json/.test(swift) && !/maybeRunAutoFreshCheck/.test(swift));
ok('so does the Windows app', /host-state\.json/.test(electron) && !/maybeRunAutoFreshCheck/.test(electron));
ok('the server starts the schedule', /52-check-schedule\.js'\)\.startSchedule/.test(fs.readFileSync(path.join(proj, '17-api.js'), 'utf8')));

console.log('check-schedule: done');
