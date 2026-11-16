// The address typed when pairing (cleanUrl in 58-sync.js): a home address gets
// the server's own port, a site like a Cloudflare tunnel keeps 443 (Cloudflare
// can't pass 8734 on), a typed port is kept, and pairing tries the other port
// when nothing answers on the first.
const T = require('./helpers');
const fs = require('fs'), path = require('path');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '' } });
const s = require(path.join(proj, '58-sync.js'));
const clean = (a, o) => s.cleanUrl(a, 8734, o);

ok(clean('classdash.example.com') === 'https://classdash.example.com', 'a site name with no port stays on 443, where a tunnel answers');
ok(clean('https://classdash.example.com/settings') === 'https://classdash.example.com', 'with https:// and a path too');
ok(clean('https://classdash.example.com:443') === 'https://classdash.example.com' && clean('classdash.example.com:443', { other: true }) === 'https://classdash.example.com', 'a typed :443 is kept, even as the other try');
ok(clean('example.com:8734') === 'https://example.com:8734', 'a typed port is kept');
ok(clean('192.168.1.20') === 'https://192.168.1.20:8734', 'an IP gets the server\'s port');
ok(clean('mac.local') === 'https://mac.local:8734' && clean('mymac') === 'https://mymac:8734' && clean('box.lan') === 'https://box.lan:8734', '.local, .lan and one-word names too');
ok(clean('[fe80::1]') === 'https://[fe80::1]:8734', 'and an IPv6 address');
ok(clean('classdash.example.com', { other: true }) === 'https://classdash.example.com:8734' && clean('192.168.1.20', { other: true }) === 'https://192.168.1.20', 'the other try swaps the two');
ok(clean('http://x.example.com') === null && clean('') === null, 'not https, or nothing: not an address');
ok(s.hasPort('x.example.com:443') && s.hasPort('https://[::1]:8734') && !s.hasPort('x.example.com') && !s.hasPort('https://[::1]/'), 'hasPort sees a typed port');

// Pairing falls back to the other port when the first can't be reached.
const src = fs.readFileSync(path.join(proj, '21-notifier-actions.js'), 'utf8');
const pair = src.slice(src.indexOf('async function syncPair'), src.indexOf('async function syncBeMaster'));
ok(/cleanUrl\(given\.url, port, \{ other: true \}\)/.test(pair) && /!sync\.hasPort\(given\.url\)/.test(pair), 'syncPair tries the other port only when none was typed');

// Pairing gives up when nothing answers, instead of staying on "Connecting" forever.
const net = require('net');
const silent = net.createServer(() => { /* accepts, never answers */ }).listen(0, '127.0.0.1', async () => {
  const src58 = fs.readFileSync(path.join(proj, '58-sync.js'), 'utf8').replace(/const REDEEM_TIMEOUT_MS = \d+;/, 'const REDEEM_TIMEOUT_MS = 300;');
  fs.writeFileSync(path.join(proj, '58-sync-fast.js'), src58);
  const fast = require(path.join(proj, '58-sync-fast.js'));
  const started = Date.now();
  const why = await fast.redeem(`https://127.0.0.1:${silent.address().port}`, 'AAA-AAA', 'test').then(() => 'paired?', e => e.why);
  ok(why === 'unreachable' && Date.now() - started < 3000, `nothing answering: "couldn't reach" after the time limit, not stuck (${why}, ${Date.now() - started} ms)`);
  silent.close();
});
