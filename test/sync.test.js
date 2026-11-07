// Sync (58-sync.js, 59-sync-follow.js), with two real servers on this computer,
// one following the other. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const days = n => new Date(Date.now() + n * 86400000).toISOString();
const item = (id, cls = 'Made-up Chemistry') => ({ id, title: 'Made-up ' + id, class: cls, cls, due: days(2), source: 'classroom' });

const masterDir = T.makeProject({
  'settings.json': { language: 'en', email: 'student@school.test', canvasToken: 'made-up-master-canvas-token', exclusions: ['Made-up Homeroom'], apiPort: 1111 },
  'last-collection.json': [item('from-master-1'), item('from-master-2')],
  'messages.json': [{ id: 'm1', title: 'Made-up announcement', class: 'Made-up Chemistry' }],
  'скрытые.txt': 'from-master-2\n',
  'grades-secret.json': { password: 'made-up-q-password' },
});
fs.mkdirSync(path.join(masterDir, 'live'));
fs.mkdirSync(path.join(masterDir, 'announcement-photos'));
const PHOTO = 'announcement-photos/0123456789abcdef0123.png';
fs.writeFileSync(path.join(masterDir, PHOTO), 'made-up picture');
const longAgo = new Date(Date.now() - 3 * 3600000);
fs.utimesSync(path.join(masterDir, 'last-collection.json'), longAgo, longAgo);

const followerDir = T.makeProject({
  'settings.json': { language: 'ru', email: 'student@school.test', canvasToken: 'made-up-laptop-canvas-token', exclusions: [], apiPort: 2222 },
  'last-collection.json': [item('from-laptop')],
});

const inProject = (dir, name, arg = '') => JSON.parse(cp.spawnSync('node', ['21-notifier-actions.js', name, arg], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n').pop());
const read = (dir, name) => { try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch { return null; } };
const readList = (dir, name) => JSON.parse(read(dir, name) || '[]');
const servers = new Map();
process.on('exit', () => { for (const s of servers.values()) { try { s.kill('SIGKILL'); } catch {} } });

const call = (port, urlPath, headers = {}) => new Promise(resolve => {
  https.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers }, res => {
    let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: text }));
  }).on('error', e => resolve({ error: e.message }));
});
async function start(dir, port) {
  const server = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: dir, stdio: 'ignore' });
  servers.set(dir, server);
  for (let i = 0; i < 100; i++) { if (!(await call(port, '/login')).error) return server; await sleep(100); }
  throw new Error('server did not start');
}
function stop(dir) {
  return new Promise(resolve => { const s = servers.get(dir); s.once('exit', resolve); s.kill('SIGKILL'); servers.delete(dir); });
}
async function until(what, test, ms = 12000) {
  const started = Date.now();
  while (Date.now() - started < ms) { if (await test()) return Date.now() - started; await sleep(50); }
  return null;
}

(async () => {
  // ---- finding servers on the network, with a stand-in for the network ----
  // (A real announcement would show up in Home Assistant as a new discovery.)
  const { findNearby } = require(path.join(masterDir, '59-sync-follow.js'));
  const announced = [
    { name: 'ClassDash on Made-up-Mac', port: 8734, addresses: ['fe80::1', '100.70.0.1', '192.168.1.20'], txt: { fp: 'AA:BB', role: 'master' } },
    { name: 'ClassDash on Made-up-Self', port: 8734, addresses: ['192.168.1.21'], txt: { fp: 'OWN' } },
    { name: 'ClassDash on Only-VPN', port: 8734, addresses: ['100.70.0.2'], txt: { fp: 'CC:DD' } },
    { name: 'ClassDash, too old to say', port: 8734, addresses: ['192.168.1.22'], txt: {} },
  ];
  class FakeBonjour {
    find(options, seen) { ok(options.type === 'classdash', 'it looks for ClassDash servers'); announced.forEach(seen); return {}; }
    destroy() {}
  }
  const nearby = await findNearby('OWN', 20, FakeBonjour);
  ok(nearby.length === 1 && nearby[0].url === 'https://192.168.1.20:8734' && nearby[0].name === 'Made-up-Mac', 'it lists others, by a reachable address, not itself', JSON.stringify(nearby));
  ok(nearby[0].role === 'master', 'with the role each one announces');

  // ---- what counts as the same account ----
  const { accountKey, sameAccount } = require(path.join(masterDir, '58-sync.js'));
  const acct = (email, canvas) => accountKey({ email, canvas });
  ok(sameAccount(acct('a@school.test', 'https://school.test/'), acct('A@School.test ', 'school.test')), 'case, spaces, https and a final slash make no difference');
  ok(sameAccount(acct('a@school.test', 'school.test'), acct('a@school.test', '')), 'Canvas missing on one is not a different account');
  ok(sameAccount(acct('a@school.test', 'school.test'), acct('a@school.test', 'other.test')), 'the same email decides, whatever Canvas address each uses');
  ok(sameAccount(acct('a@school.test', ''), acct('', 'school.test')), 'nothing to compare is not a difference');
  ok(sameAccount(acct('a@school.test', ''), acct('your.school@email.example', '')), 'the placeholder email counts as none');
  ok(!sameAccount(acct('a@school.test', 'school.test'), acct('b@school.test', 'school.test')), 'a different email is a different account');
  ok(!sameAccount(acct('', 'school.test'), acct('', 'other.test')), 'with no emails, a different Canvas is');

  const base = 20900 + Math.floor(Math.random() * 300);
  const masterPort = base, followerPort = base + 1;
  await start(masterDir, masterPort);
  await start(followerDir, followerPort);
  const masterUrl = `127.0.0.1:${masterPort}`;

  // ---- pairing: nothing changes until the question is answered ----
  let r = inProject(followerDir, 'syncPair', chunk({ url: masterUrl, code: 'AAA-AAA' }));
  ok(!r.ok && r.why === 'noCode', 'no code waiting says so', JSON.stringify(r));
  let made = inProject(masterDir, 'pairCode');
  r = inProject(followerDir, 'syncPair', chunk({ url: masterUrl, code: 'AAA-AAA' }));
  ok(!r.ok && r.why === 'wrongCode', 'a wrong code says so', JSON.stringify(r));
  r = inProject(followerDir, 'syncPair', chunk({ url: 'http://nonsense', code: made.code }));
  ok(!r.ok && r.why === 'badAddress', 'plain http is not an address it will use', JSON.stringify(r));
  r = inProject(followerDir, 'syncPair', chunk({ url: `127.0.0.1:${followerPort}`, code: inProject(followerDir, 'pairCode').code }));
  ok(!r.ok && r.why === 'sameComputer', 'it can\'t pair with itself', JSON.stringify(r));
  inProject(followerDir, 'pairCancel');
  // Pairing with itself spent a key; that one's cleaned off.
  for (const d of inProject(followerDir, 'devices').devices) inProject(followerDir, 'revokeDevice', d.id);

  made = inProject(masterDir, 'pairCode');
  r = inProject(followerDir, 'syncPair', chunk({ url: masterUrl, code: made.code }));
  ok(r.ok && r.theirs && r.mine, 'the right code pairs', JSON.stringify(r).slice(0, 300));
  ok(r.theirs.assignments === 2 && r.mine.assignments === 1, '...with the counts on each computer, for asking which is the master');
  ok(r.sameAccount === true, '...and sees the same account');
  ok(!JSON.stringify(r).includes('student@school.test'), '...without saying the email');
  ok(inProject(followerDir, 'syncStatus').pending && !JSON.parse(read(followerDir, 'sync.json')).master, 'it is only pending so far');
  await sleep(4000);
  ok(readList(followerDir, 'last-collection.json')[0].id === 'from-laptop', '...and nothing was copied');
  const device = inProject(masterDir, 'devices').devices.find(d => d.follower);
  ok(!!device, 'the master knows it as a follower');
  const roleIn = dir => cp.spawnSync('node', ['-e', "console.log(require('./58-sync.js').role())"], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  ok(roleIn(masterDir) === 'master' && roleIn(followerDir) === 'standalone', 'so it now counts as a master, and the other nothing yet');
  if (process.platform !== 'win32') ok((fs.statSync(path.join(followerDir, 'sync.json')).mode & 0o777) === 0o600, 'the file with the key in it is private');

  // A browser with the key can't do this to a computer.
  const followerToken = read(followerDir, 'api-token.txt').trim();
  const posted = await new Promise(resolve => {
    const q = https.request({ host: '127.0.0.1', port: followerPort, path: '/api/action', method: 'POST', rejectUnauthorized: false, headers: { Authorization: 'Bearer ' + followerToken, 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    q.end(JSON.stringify({ action: 'syncFollow', arg: '' }));
  });
  ok(posted === 403, 'only the app can start following, not something with the key');

  // ---- following: the data comes down ----
  r = inProject(followerDir, 'syncFollow');
  ok(r.ok, 'it follows', JSON.stringify(r));
  ok(roleIn(followerDir) === 'follower', 'and now it counts as a follower');
  let took = await until('copied', () => readList(followerDir, 'last-collection.json').some(i => i.id === 'from-master-1'));
  ok(took !== null, `the master's assignments arrive (${took} ms)`);
  ok(await until('synced', () => (inProject(followerDir, 'syncStatus').status || {}).state === 'synced') !== null, 'the status says synced');
  ok(inProject(followerDir, 'syncStatus').status.via === 'local', '...by the home address');
  const sidebar = JSON.parse((await call(followerPort, '/api/dashboard', { Authorization: 'Bearer ' + followerToken })).body).view.pieces.sync;
  ok(/reload-label">Синхронизировано</.test(sidebar), 'the sidebar says just that', String(sidebar).slice(0, 300));
  ok(/title="Синхронизировано с /.test(sidebar), '...and its tooltip says with which computer', String(sidebar).slice(0, 300));
  ok(read(followerDir, 'скрытые.txt') === 'from-master-2\n', 'what is hidden comes too');
  ok(read(followerDir, PHOTO) === 'made-up picture', 'and announcement photos');
  ok(Math.abs(fs.statSync(path.join(followerDir, 'last-collection.json')).mtimeMs - longAgo.getTime()) < 2000, 'the last check keeps its real time');

  const followerSettings = JSON.parse(read(followerDir, 'settings.json'));
  ok(JSON.stringify(followerSettings.exclusions) === '["Made-up Homeroom"]', 'a shared setting comes over');
  ok(followerSettings.language === 'ru' && followerSettings.apiPort === 2222, 'what belongs to the computer does not');
  ok(followerSettings.canvasToken === 'made-up-laptop-canvas-token', 'and neither does a token');
  ok(read(followerDir, 'grades-secret.json') === null, 'the Q password stays home');
  ok(!['api-token.txt', 'device-keys.json'].some(n => (read(followerDir, n) || '').includes('made-up')), 'nor any key');
  ok(inProject(followerDir, 'syncStatus').setAside === true && readList(path.join(followerDir, 'before-sync'), 'last-collection.json')[0].id === 'from-laptop', "this computer's own data was kept aside");

  await until('redrawn', () => (read(followerDir, 'summary.html') || '').includes('from-master-1') || (read(followerDir, 'page-shell.html') || '') !== '', 5000);
  const pending = cp.spawnSync('node', ['-e', "console.log(JSON.stringify(require('./19-settings.js').pendingFetchKeys()))"], { cwd: followerDir, encoding: 'utf8' }).stdout.trim();
  ok(pending === '[]', 'a setting that came over does not ask this computer for a check', pending);

  // ---- what's served, and to whom ----
  const key = JSON.parse(read(followerDir, 'sync.json')).master.key;
  const bearer = { Authorization: 'Bearer ' + key };
  ok((await call(masterPort, '/api/sync/manifest')).status === 401, 'the list of files needs a key');
  ok((await call(masterPort, '/api/sync/file?name=messages.json')).status === 401, 'so does a file');
  for (const name of ['settings.json', 'api-token.txt', 'grades-secret.json', 'device-keys.json', 'sync.json', '../settings.json', 'announcement-photos/../settings.json', 'browser-profile/Cookies']) {
    ok((await call(masterPort, '/api/sync/file?name=' + encodeURIComponent(name), bearer)).status === 404, `${name} is not given out`);
  }
  const asked = JSON.parse((await call(masterPort, '/api/sync/hello', bearer)).body);
  ok(asked.role === 'master', 'a server can be asked its role, with no announcement involved', JSON.stringify(asked.role));
  ok((await call(masterPort, '/api/sync/hello')).status === 401, 'the rest of that answer needs a key');
  const openRole = await call(masterPort, '/api/sync/role');
  ok(openRole.status === 200 && JSON.stringify(JSON.parse(openRole.body)) === '{"role":"master"}', 'just the role needs none, and says nothing else', openRole.body);
  ok(JSON.parse((await call(followerPort, '/api/sync/role')).body).role === 'follower', 'and a follower says so');
  const manifest = JSON.parse((await call(masterPort, '/api/sync/manifest', bearer)).body);
  ok(!JSON.stringify(manifest).includes('made-up-master-canvas-token'), 'the list has no token in it');
  ok(!Object.keys(manifest.settings).some(k => /token|key|password|email|canvas$/i.test(k)), 'and no sign-in setting at all', Object.keys(manifest.settings).join());

  // ---- a change on the master arrives on its own ----
  fs.appendFileSync(path.join(masterDir, 'скрытые.txt'), 'from-master-1\n');
  took = await until('pushed', () => (read(followerDir, 'скрытые.txt') || '').includes('from-master-1'), 5000);
  ok(took !== null && took < 2500, `a change on the master arrives by itself (${took} ms)`);
  fs.writeFileSync(path.join(masterDir, 'скрытые.txt'), '');
  fs.rmSync(path.join(masterDir, PHOTO));
  ok(await until('removed', () => read(followerDir, PHOTO) === null, 5000) !== null, 'and so does something removed');

  // ---- a check running on the master shows here ----
  const running = { running: true, done: 1, total: 4, percent: 25, startedAt: Date.now(), updatedAt: Date.now() };
  fs.writeFileSync(path.join(masterDir, 'live', 'check-run.json'), JSON.stringify(running));
  took = await until('progress', () => JSON.parse(read(followerDir, 'live/check-run.json') || '{}').percent === 25, 5000);
  ok(took !== null, `a check running on the master shows here (${took} ms)`);
  const stillCopies = () => { fs.appendFileSync(path.join(masterDir, 'не-срочно.txt'), 'while-checking\n'); return until('copied', () => (read(followerDir, 'не-срочно.txt') || '').includes('while-checking'), 5000); };
  ok(await stillCopies() !== null, "and that doesn't stop copying, which would never let it end");
  // Every routine copy used to flip this, which made the sidebar jump.
  const states = new Set();
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(path.join(masterDir, 'live', 'check-run.json'), JSON.stringify({ ...running, updatedAt: Date.now() + i }));
    states.add(JSON.parse(read(followerDir, 'sync-status.json')).state);
    await sleep(100);
  }
  ok(states.size === 1 && states.has('synced'), 'and the status stays synced while it does', [...states].join());
  fs.writeFileSync(path.join(masterDir, 'live', 'check-run.json'), JSON.stringify({ ...running, running: false, percent: 100 }));
  ok(await until('over', () => JSON.parse(read(followerDir, 'live/check-run.json') || '{}').running === false, 5000) !== null, 'and its end does too');

  // ---- what's done on the follower happens on the master ----
  r = inProject(followerDir, 'hide', 'from-master-1');
  ok(r.ok, 'hiding on the follower works', JSON.stringify(r));
  ok((read(followerDir, 'скрытые.txt') || '').includes('from-master-1'), '...at once, here');
  ok((read(masterDir, 'скрытые.txt') || '').includes('from-master-1'), '...and on the master');
  r = inProject(followerDir, 'virtualCreate', chunk({ title: 'Made-up reminder', class: 'Made-up Chemistry', due: null }));
  ok(r.ok && r.entry, 'a reminder made on the follower works', JSON.stringify(r));
  const onMaster = readList(masterDir, 'virtual-assignments.json');
  ok(onMaster.some(v => v.id === r.entry.id), '...and it is on the master');
  ok(await until('back', () => readList(followerDir, 'virtual-assignments.json').some(v => v.id === r.entry.id), 5000) !== null, '...and it comes back here');
  const shared = chunk({ exclusions: ['Made-up Homeroom', 'Made-up Study Hall'], language: 'ru' });
  r = inProject(followerDir, 'config', shared);
  ok(r.ok !== false, 'a settings save works', JSON.stringify(r));
  const masterSettings = JSON.parse(read(masterDir, 'settings.json'));
  ok(masterSettings.exclusions.includes('Made-up Study Hall'), 'a shared setting changed on the follower reaches the master');
  ok(masterSettings.language === 'en', "but not this computer's language");
  r = inProject(followerDir, 'config', chunk({ language: 'en' }));
  ok(JSON.parse(read(masterDir, 'settings.json')).language === 'en' && JSON.parse(read(followerDir, 'settings.json')).language === 'en', "a setting that isn't shared stays here");
  inProject(followerDir, 'config', chunk({ language: 'ru' }));
  const held = () => cp.spawnSync('node', ['-e', "console.log(String(require('./58-sync.js').checksHeldBack()))"], { cwd: followerDir, encoding: 'utf8' }).stdout.trim();
  ok(/master checks/.test(held()), 'automatic checks are held back while connected', held());
  ok(cp.spawnSync('node', ['-e', "console.log(String(require('./58-sync.js').checksHeldBack()))"], { cwd: masterDir, encoding: 'utf8' }).stdout.trim() === 'null', 'not on the master');

  // ---- this computer can't be followed ----
  const third = T.makeProject({ 'settings.json': { language: 'en' } });
  made = inProject(followerDir, 'pairCode');
  r = inProject(third, 'syncPair', chunk({ url: `127.0.0.1:${followerPort}`, code: made.code }));
  ok(!r.ok && r.why === 'masterFollows', 'a computer that follows can\'t be followed', JSON.stringify(r));
  ok(inProject(followerDir, 'devices').pairing.waiting === true, '...and that cost its code nothing');
  inProject(followerDir, 'pairCancel');
  r = inProject(followerDir, 'syncPair', chunk({ url: masterUrl, code: 'AAA-AAA' }));
  ok(!r.ok && r.why === 'alreadyFollowing', 'nor follow a second one', JSON.stringify(r));

  // ---- cut off ----
  await stop(masterDir);
  ok(await until('cut off', () => inProject(followerDir, 'syncStatus').status.state === 'cutOff', 5000) !== null, 'the master going away is noticed');
  ok(held() === 'null', 'and now this computer may check by itself');
  inProject(followerDir, 'hide', 'from-laptop-offline');
  r = inProject(followerDir, 'virtualCreate', chunk({ title: 'Made-up offline reminder', class: 'Made-up Chemistry', due: null }));
  const offlineId = r.entry && r.entry.id;
  ok(r.ok && readList(followerDir, 'virtual-assignments.json').some(v => v.id === offlineId), 'a reminder made while cut off is there at once');
  inProject(followerDir, 'virtualDone', offlineId);
  ok(readList(followerDir, 'sync-queue.json').length === 3, 'and these wait', read(followerDir, 'sync-queue.json'));
  ok(inProject(followerDir, 'syncStatus').status.waiting === 3, 'the status counts them');

  // ---- an impostor at the master's address gets nothing ----
  const impostor = T.makeProject({ 'settings.json': { language: 'en' } });
  await start(impostor, masterPort);
  await sleep(5000);
  ok(inProject(followerDir, 'syncStatus').status.state === 'cutOff', 'another server at that address is not believed');
  ok(readList(followerDir, 'sync-queue.json').length === 3, 'and is told nothing');
  ok(inProject(impostor, 'devices').devices.length === 0, 'and has no follower');
  await stop(impostor);

  // ---- back again ----
  await start(masterDir, masterPort);
  took = await until('replayed', () => readList(followerDir, 'sync-queue.json').length === 0, 30000);
  ok(took !== null, `the waiting changes go to the master (${took} ms)`);
  ok((read(masterDir, 'скрытые.txt') || '').includes('from-laptop-offline'), 'the hide reached it');
  const entry = readList(masterDir, 'virtual-assignments.json').find(v => v.id === offlineId);
  ok(!!entry, 'the reminder reached it, with the same id');
  ok(entry && entry.done === true, 'and being marked done afterwards still found it', JSON.stringify(entry));
  ok(await until('synced again', () => inProject(followerDir, 'syncStatus').status.state === 'synced', 5000) !== null, 'and it says synced again');

  // ---- taken off on the master ----
  inProject(masterDir, 'revokeDevice', inProject(masterDir, 'devices').devices.find(d => d.follower).id);
  await stop(masterDir);
  await start(masterDir, masterPort);
  ok(await until('removed', () => inProject(followerDir, 'syncStatus').status.state === 'removed', 15000) !== null, 'being removed on the master says so');

  // ---- stopping ----
  r = inProject(followerDir, 'syncStop', chunk({ restore: true }));
  ok(r.ok && r.restored, 'stopping puts this computer\'s own data back', JSON.stringify(r));
  ok(readList(followerDir, 'last-collection.json')[0].id === 'from-laptop', '...the assignments');
  ok(JSON.stringify(JSON.parse(read(followerDir, 'settings.json')).exclusions) === '[]', '...the shared settings');
  ok(read(followerDir, 'sync.json') === null && inProject(followerDir, 'syncStatus').status === null, 'and it no longer follows');
  ok(await until('quiet', () => cp.spawnSync('node', ['-e', "console.log(String(require('./58-sync.js').checksHeldBack()))"], { cwd: followerDir, encoding: 'utf8' }).stdout.trim() === 'null', 1000) !== null, 'checks are its own again');

  // ---- leaving the master tidy, and another account ----
  fs.writeFileSync(path.join(followerDir, 'settings.json'), JSON.stringify({ ...JSON.parse(read(followerDir, 'settings.json')), email: 'someone-else@school.test' }));
  made = inProject(masterDir, 'pairCode');
  r = inProject(followerDir, 'syncPair', chunk({ url: masterUrl, code: made.code }));
  ok(r.ok && r.sameAccount === false, 'a different account is noticed at pairing', JSON.stringify(r).slice(0, 200));
  r = inProject(followerDir, 'syncFollow');
  ok(!r.ok && r.why === 'otherAccount', 'and it will not follow without being told to', JSON.stringify(r));
  ok(readList(followerDir, 'last-collection.json')[0].id === 'from-laptop', 'nothing was touched');
  const before = inProject(masterDir, 'devices').devices.filter(d => d.follower).length;
  r = inProject(followerDir, 'syncCancel');
  ok(r.ok && read(followerDir, 'sync.json') === null, 'choosing not to follow forgets it here');
  ok(inProject(masterDir, 'devices').devices.filter(d => d.follower).length === before - 1, 'and takes its key off the other computer');

  // ---- this computer as the master: the other has to say yes ----
  const second = T.makeProject({ 'settings.json': { language: 'en', email: 'student@school.test', apiLan: true, apiPort: followerPort + 1 }, 'last-collection.json': [item('from-second')] });
  // apiLan is on in its settings, but this test's server only listens here: the
  // offer's address is swapped for that, as a stand-in for its network address.
  await start(second, followerPort + 1);
  made = inProject(masterDir, 'pairCode');
  r = inProject(second, 'syncPair', chunk({ url: masterUrl, code: made.code }));
  ok(r.ok, 'a third computer pairs with the master', JSON.stringify(r).slice(0, 200));
  r = inProject(second, 'syncBeMaster');
  ok(r.ok, 'it can ask to be the master instead', JSON.stringify(r));
  const proposal = JSON.parse(read(masterDir, 'sync-proposal.json'));
  ok(proposal.name && proposal.urls.length > 0, 'the other computer has the offer');
  ok(inProject(masterDir, 'syncStatus').proposal.name === proposal.name, 'and its Settings says so');
  await sleep(1000);
  ok(!JSON.parse(read(masterDir, 'sync.json') || '{}').master, 'nothing changes until it says yes');
  ok(readList(masterDir, 'last-collection.json').some(i => i.id === 'from-master-1'), 'its data is still there');
  r = inProject(second, 'syncStatus');
  ok(r.pending && r.pending.asked, 'the asking computer is waiting');

  r = inProject(masterDir, 'syncDecline');
  ok(r.ok && read(masterDir, 'sync-proposal.json') === null, 'saying no clears the offer');
  r = inProject(second, 'syncStatus');
  ok(r.declined === true && !r.pending, 'and the asking computer hears no', JSON.stringify(r));
  ok(!inProject(masterDir, 'devices').devices.some(d => d.follower && d.name === proposal.name), 'and its key is gone');

  made = inProject(masterDir, 'pairCode');
  inProject(second, 'syncPair', chunk({ url: masterUrl, code: made.code }));
  inProject(second, 'syncBeMaster');
  const offer = JSON.parse(read(masterDir, 'sync-proposal.json'));
  fs.writeFileSync(path.join(masterDir, 'sync-proposal.json'), JSON.stringify({ ...offer, urls: [`https://127.0.0.1:${followerPort + 1}`] }));
  r = inProject(masterDir, 'syncAccept');
  ok(r.ok, 'saying yes follows the computer that asked', JSON.stringify(r));
  ok(await until('flipped', () => readList(masterDir, 'last-collection.json').some(i => i.id === 'from-second'), 15000) !== null, 'and its data comes over');
  r = inProject(second, 'syncStatus');
  ok(!r.pending && r.followers.length === 1, 'the asking computer is now the master', JSON.stringify(r).slice(0, 200));
  ok(!inProject(masterDir, 'devices').devices.some(d => d.follower), 'the old key is gone');
  ok(read(second, 'sync.json') === null, 'and it holds no key to the other');

  process.exit(process.exitCode || 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
