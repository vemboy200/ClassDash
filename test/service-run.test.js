// 62-service-run.js: runs one service through the bridge, the way Q runs after
// a check and from Check now. Made-up services in a scratch project.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', gradesProvider: 'none' } });
const manifest = domain => ({ domain, name: domain, categories: ['grades'], introduced: '3.0.0', communication_class: 'cloud_polling', browser_class: 'none', codeowners: [], documentation: 'x.md', runs: 'background' });
T.writeFiles(path.join(proj, 'services'), {
  'goodone/manifest.json': manifest('goodone'),
  'goodone/index.js': `module.exports = {
    due: (b, now) => b.force || !require('fs').existsSync(require('path').join(__dirname, 'ran')),
    read: async b => { require('fs').writeFileSync(require('path').join(__dirname, 'ran'), String(b.force)); return { grades: [{ class: 'Made-up' }], status: { detail: '1 class' } }; },
  };`,
  'breaks/manifest.json': manifest('breaks'),
  'breaks/index.js': `module.exports = { read: async () => { throw new Error('made-up failure\\nwith a second line'); } };`,
  'slow/manifest.json': manifest('slow'),
  'slow/index.js': `module.exports = { read: () => new Promise(r => setTimeout(() => r({}), 300)) };`,
  'shy/manifest.json': manifest('shy'),
  'shy/index.js': `module.exports = { due: () => ({ due: false, why: 'password' }), read: async () => { throw new Error('should not run'); } };`,
});
const run = require(path.join(proj, '62-service-run.js'));
const status = () => JSON.parse(fs.readFileSync(path.join(proj, 'check-status.json'), 'utf8'));

(async () => {
  let r = await run.run('goodone');
  ok(r.ok && r.result.grades.length === 1 && r.result.events.length === 0, 'a read comes back in the shared shape');
  ok(status().goodone.status === 'ok' && status().goodone.detail === '1 class', 'and its dot goes green with its detail');
  r = await run.run('goodone');
  ok(r.skipped === 'recent', 'not due: skipped, without a reason of its own it says "recent"');
  r = await run.run('goodone', { force: true });
  ok(r.ok && fs.readFileSync(path.join(proj, 'services/goodone/ran'), 'utf8') === 'true', 'Check now hands it force');

  r = await run.run('breaks');
  ok(!r.ok && r.why === 'made-up failure', 'a read that throws is a failure, first line only: ' + r.why);
  ok(status().breaks.status === 'problem' && status().breaks.detail === 'made-up failure', 'and its dot goes red with why');
  ok(!fs.existsSync(path.join(proj, 'service-breaks.lock')), 'the lock is let go after a failure too');

  r = await run.run('shy');
  ok(r.skipped === 'password' && !status().shy, 'due() can say why not, and nothing is recorded');

  const first = run.run('slow');
  const second = await run.run('slow');
  ok(second.busy && !second.ok, 'a second run while one is going is turned away');
  ok((await first).ok, 'and the first finishes');

  ok((await run.run('nothing-like-this')).skipped === 'missing', 'a service that doesn\'t exist is skipped');
  r = await run.run('q');
  ok(r.skipped === 'off', 'Q with grades off is skipped as off');
})().catch(e => { console.log('FAIL', e.stack); process.exitCode = 1; });
