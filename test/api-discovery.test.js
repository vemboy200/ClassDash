// The home API announced on the network (mDNS), so Home Assistant finds it:
// only with --network, with the fingerprint and never the token, announced
// again when the addresses change, gone when the server stops, and never a
// reason for the API itself to fail. A fake Bonjour stands in for the
// network; a real announcement was checked by hand with dns-sd.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '', apiPort: 18995 } });
process.chdir(proj);
const discovery = require(path.join(proj, '36-api-discovery.js'));

// A Bonjour that records what it was asked to do.
const events = [];
class FakeBonjour {
  constructor() { events.push('new'); }
  publish(opts) { events.push({ publish: opts }); return { on() {} }; }
  unpublishAll(cb) { events.push('unpublish'); setImmediate(cb); }
  destroy() { events.push('destroy'); }
}
const published = () => events.filter(e => e.publish).map(e => e.publish);

(async () => {
  // ── names ──
  ok('the computer\'s name, short', discovery.computerName() === os.hostname().replace(/\.local\.?$/i, '').split('.')[0]);
  ok('addresses under its own .local name', discovery.hostFor('Some PC_2') === 'classdash-some-pc-2.local', discovery.hostFor('Some PC_2'));
  ok('...and something even for a strange name', discovery.hostFor('...') === 'classdash-computer.local');

  // ── what goes out ──
  const lines = [];
  const realIfaces = os.networkInterfaces;
  let addr = '192.168.1.20';
  os.networkInterfaces = () => ({ en0: [{ family: 'IPv4', internal: false, address: addr }], lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] });
  const a = discovery.advertise({ port: 18995, fingerprint: 'AA:BB', log: l => lines.push(l) }, { Bonjour: FakeBonjour, addressCheckMs: 50 });
  const first = published()[0];
  ok('announced as _classdash._tcp on the port', first && first.type === 'classdash' && first.protocol === 'tcp' && first.port === 18995, JSON.stringify(first));
  ok('named for the computer', first && first.name === 'ClassDash on ' + discovery.computerName());
  ok('the TXT record has the fingerprint and api 1, nothing else', first && JSON.stringify(first.txt) === JSON.stringify({ api: '1', fp: 'AA:BB' }), JSON.stringify(first && first.txt));
  ok('IPv4 only', first && first.disableIPv6 === true);

  // ── the address changes ──
  await sleep(120);
  ok('same addresses: not announced again', published().length === 1);
  addr = '10.0.0.7';
  await sleep(150);
  ok('new addresses: the old announcement is withdrawn, a new one made', published().length === 2 && events.includes('unpublish') && events.includes('destroy'), JSON.stringify(events));
  ok('...and it says so in the log', lines.some(l => /addresses changed/.test(l)));

  // ── stopping ──
  events.length = 0;
  let stopped = false;
  a.stop(() => { stopped = true; });
  await sleep(50);
  ok('stop withdraws it (the "gone" announcement) and calls back', stopped && events[0] === 'unpublish' && events.includes('destroy'), JSON.stringify(events));
  addr = '10.0.0.8';
  await sleep(150);
  ok('...and nothing is announced after', published().length === 0);
  os.networkInterfaces = realIfaces;

  // ── stuck goodbye, broken library ──
  class Silent extends FakeBonjour { unpublishAll() {} }
  const s = discovery.advertise({ port: 1, fingerprint: null }, { Bonjour: Silent });
  ok('no fingerprint yet: just api', JSON.stringify(published().pop().txt) === JSON.stringify({ api: '1' }));
  const t0 = Date.now(); let late = false;
  s.stop(() => { late = true; });
  await sleep(1200);
  ok('a goodbye that never finishes doesn\'t hold the server up past a second', late && Date.now() - t0 < 1500);
  class Throws { constructor() { throw new Error('no network'); } }
  const broken = [];
  const b = discovery.advertise({ port: 1, log: l => broken.push(l) }, { Bonjour: Throws });
  ok('a library that throws: no announcement, a line in the log, no crash', broken.some(l => /not announcing/.test(l)));
  let bStopped = false; b.stop(() => { bStopped = true; });
  await sleep(10);
  ok('...and stopping still calls back', bStopped);

  // ── the server: localhost mode announces nothing ──
  const local = cp.spawn(process.execPath, ['17-api.js', '--port', '18995'], { cwd: proj, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  local.stdout.on('data', d => { out += d; });
  for (let i = 0; i < 40 && !/listening/.test(out); i++) await sleep(100);
  await sleep(200);
  local.kill('SIGTERM');
  await new Promise(r => local.on('exit', r));
  ok('this-computer-only mode: listening, and not announced', /listening/.test(out) && !/announced on the network/.test(out), out.slice(0, 300));
  ok('the server starts the announcement only inside its --network branch',
    /if \(onNetwork\) \{[\s\S]{0,700}discovery\.advertise\(/.test(fs.readFileSync(path.join(T.REPO, 'src/17-api.js'), 'utf8')));
})();
