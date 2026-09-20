// Saving settings through the notifier redraws and never starts a check; the pending banner follows.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { email: 'me@school.example', language: 'en' } });
process.chdir(proj);
const spawned = [];
cp.spawn = (...a) => { spawned.push(a[1]); return { unref() {} }; };   // must happen before 21 destructures it
const A = require(path.join(proj, '21-notifier-actions.js'));
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
const ok = (n, c, extra='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : extra); if (!c) process.exitCode = 1; };
try { fs.unlinkSync(path.join(proj, 'fetch-applied.json')); } catch {}
const page = () => fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');

let r = A.main('config', enc({ language: 'en', exclusions: [] }));
ok('baseline save ok', r.ok);
ok('no banner when nothing pending', !page().includes('id="pending-banner"'));

r = A.main('config', enc({ exclusions: ['Math'] }));
ok('exclusion save ok', r.ok);
ok('result lists pending', JSON.stringify(r.pending) === '["exclusions"]', JSON.stringify(r.pending));
ok('mode stays redraw for older pages', r.mode === 'redraw');
ok('NO collection was started by saving', spawned.length === 0, JSON.stringify(spawned));
ok('banner is on the redrawn page', page().includes('id="pending-banner"'));
ok('banner has the check button', page().includes('startPendingCheck(this)'));
ok('English text', page().includes('Some of your settings take effect after a fresh check.'));

r = A.main('config', enc({ exclusions: [] }));
ok('reverting removes the banner', !page().includes('id="pending-banner"'));
ok('still no collection', spawned.length === 0);

r = A.main('reload', '');
ok('the banner button\'s action (reload) starts a quick pass', spawned.length === 1 && r.ok, JSON.stringify(spawned));

// Russian
A.main('config', enc({ exclusions: ['Math'], language: 'ru' }));
ok('Russian text', page().includes('Часть настроек вступит в силу после проверки.'));
A.main('config', enc({ exclusions: [], language: 'en' }));
