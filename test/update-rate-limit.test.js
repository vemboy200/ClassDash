// GitHub's hourly limit on update checks, recorded by the apps as
// error 'rateLimited' with retryAt: the page says it in words instead of
// GitHub's own message.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const note = (proj) => (/<span class="update-error-note">([^<]*)<\/span>/.exec(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8')) || [])[1] || '';

let proj = T.makeProject({ 'settings.json': { language: 'en' } });
fs.writeFileSync(path.join(proj, 'update-status.json'), JSON.stringify({ currentVersion: '2.8.0', error: 'rateLimited', retryAt: '2026-11-04T23:30:00Z', checkedAt: '2026-11-04T22:40:00Z' }));
T.redraw(proj);
let text = note(proj);
ok('rate limited: said in words, with when to try again', /GitHub is limiting update checks from your network/.test(text) && /after \d{1,2}:30/.test(text), text);
ok('...not as "Update check failed: rateLimited"', !/rateLimited|Update check failed/.test(text), text);

proj = T.makeProject({ 'settings.json': { language: 'en' } });
fs.writeFileSync(path.join(proj, 'update-status.json'), JSON.stringify({ currentVersion: '2.8.0', error: 'timed out', checkedAt: '2026-11-04T22:40:00Z' }));
T.redraw(proj);
text = note(proj);
ok('any other error is shown as before', /Update check failed: timed out/.test(text), text);
