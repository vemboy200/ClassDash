// 63-browser-health.js: a browser that keeps failing to start leads to one
// server restart, then one request to sign in again, with every error kept.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en' } });
const health = require(path.join(proj, '63-browser-health.js'));
const log = () => fs.readFileSync(path.join(proj, 'browser-launch-log.txt'), 'utf8');
const error = 'browserType.launchPersistentContext: Target page, context or browser has been closed\nBrowser logs:\n\nmade-up: a reason only the browser knows';

ok(health.failed(error) === null && health.failed(error) === null, 'one or two failures: nothing yet');
ok(/made-up: a reason only the browser knows/.test(log()) && /2 in a row/.test(log()), 'every failure is kept whole, the browser\'s own output included');
ok(health.failed(error) === 'restart' && health.restarted(), 'the third in a row: restart the server, once');
ok(health.failed(error) === 'signIn', 'still failing after it: ask for a sign-in');
ok(health.failed(error) === null && health.failed(error) === null, '...once, not on every check after');
health.worked();
ok(!health.restarted() && !health.read().failures && /worked again, after 6 failures and a server restart/.test(log()), 'one launch that works starts it all over, and says so');
ok(health.failed(error) === null, 'so the next failure is the first again');
health.worked();

ok([1, 2, 3].map(() => health.failed(error, new Date(), { canRestart: false }))[2] === 'signIn' && !health.restarted(), 'no server to restart: straight to asking for a sign-in');
health.worked();

health.note('the sign-in window opened');
ok(/the sign-in window opened/.test(log()), 'other things worth knowing go in the same log');

fs.writeFileSync(path.join(proj, 'browser-launch-log.txt'), 'x'.repeat(300 * 1024) + '\n');
health.failed(error);
ok(fs.statSync(path.join(proj, 'browser-launch-log.txt')).size < 200 * 1024 && /launch failed/.test(log()), 'the log is kept to about 200KB');
