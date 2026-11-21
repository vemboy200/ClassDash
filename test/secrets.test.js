// The Canvas token and AI keys are kept out of settings.json (16-secrets.js).
// Everything here runs on the plain-file store, except the last part: a real
// round trip through DPAPI on Windows, and through the keychain on a Mac only
// in CI (with a test item of its own), never a developer's real keychain.
const T = require('./helpers');
const { ok, eq } = T;
const path = require('path'), fs = require('fs'), os = require('os');

const PROJ = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b.example', aiOpenaiKey: 'sk-from-an-older-version', canvasToken: '' } });
process.chdir(PROJ);
const S = require(path.join(PROJ, '19-settings.js'));
const secrets = require(path.join(PROJ, '16-secrets.js'));
const raw = () => JSON.parse(fs.readFileSync(path.join(PROJ, 'settings.json'), 'utf8'));
const stored = () => { try { return JSON.parse(fs.readFileSync(path.join(PROJ, 'secrets.json'), 'utf8')); } catch { return null; } };

// A. A key an older version left in settings.json: read as it is, and moved
// out by moveSecrets() (server start), never by reading.
ok(S.read().aiOpenaiKey === 'sk-from-an-older-version', 'A the key still reads the same');
ok(raw().aiOpenaiKey === 'sk-from-an-older-version' && !fs.existsSync(path.join(PROJ, 'secrets.json')), 'A reading alone changes nothing');
S.moveSecrets();
ok(!('aiOpenaiKey' in raw()) && !('canvasToken' in raw()), 'A and is gone from settings.json, empty ones too', JSON.stringify(raw()));
ok(stored().aiOpenaiKey === 'sk-from-an-older-version', 'A it is in the store now');
ok(raw().savedSecrets.aiOpenaiKey === secrets.fingerprint('sk-from-an-older-version'), 'A settings.json only has its fingerprint');
ok(raw().email === 'a@b.example', 'A the rest of settings.json is left alone');
if (process.platform !== 'win32') ok((fs.statSync(path.join(PROJ, 'secrets.json')).mode & 0o777) === 0o600, 'A the plain store is readable only by this user');

// B. Saving one, through either path.
ok(S.write('canvasToken', '  tok~123  ').ok, 'B write() saves a token');
ok(stored().canvasToken === 'tok~123' && !('canvasToken' in raw()), 'B into the store, trimmed, not settings.json');
ok(S.read().canvasToken === 'tok~123' && S.read().aiOpenaiKey === 'sk-from-an-older-version', 'B both read back');
let r = S.applyBatch(T.enc({ aiGeminiKey: 'AIzaMadeUp', language: 'ru' }));
ok(r.ok && stored().aiGeminiKey === 'AIzaMadeUp' && raw().language === 'ru' && !('aiGeminiKey' in raw()), 'B applyBatch() too', JSON.stringify(r));

// C. The page sends every field on every save: the store is only written
// when a key really changed.
let writes = 0;
const plain = secrets.plainFileStore(path.join(PROJ, 'secrets.json'));
secrets._setStore({ kind: 'counting', load: () => plain.load(), save: all => { writes++; plain.save(all); } });
S.applyBatch(T.enc({ canvasToken: 'tok~123', aiOpenaiKey: 'sk-from-an-older-version', language: 'en' }));
eq(writes, 0, 'C a save with the same keys leaves the store alone');
S.applyBatch(T.enc({ canvasToken: 'tok~456' }));
ok(writes === 1 && stored().canvasToken === 'tok~456', 'C a changed one is written');

// D. Another process changed a key: the stamp in settings.json tells this
// one to read the store again instead of using what it kept.
plain.save({ ...plain.load(), canvasToken: 'tok~other-process' });
fs.writeFileSync(path.join(PROJ, 'settings.json'), JSON.stringify({ ...raw(), savedSecrets: { ...raw().savedSecrets, canvasToken: secrets.fingerprint('tok~other-process') } }));
ok(S.read().canvasToken === 'tok~other-process', 'D a change made elsewhere is seen');

// E. Clearing removes it; with none left, the store is emptied.
S.write('canvasToken', '');
ok(!S.read().canvasToken && !('canvasToken' in raw().savedSecrets) && !('canvasToken' in stored()), 'E clearing a key removes it everywhere');
S.applyBatch(T.enc({ aiOpenaiKey: '', aiGeminiKey: '' }));
ok(stored() === null && !('savedSecrets' in raw()), 'E with none left, nothing is kept', JSON.stringify(raw()));

// F. A store that can't be read (a locked keychain) refuses the save rather
// than losing a key or writing it into settings.json.
S.write('aiAnthropicKey', 'sk-ant-keep');
const before = fs.readFileSync(path.join(PROJ, 'settings.json'), 'utf8');
secrets._setStore({ kind: 'broken', load() { throw new Error('locked'); }, save() { throw new Error('locked'); } });
r = S.write('aiAnthropicKey', 'sk-ant-new');
ok(!r.ok && /locked/.test(r.why), 'F write() says it failed', JSON.stringify(r));
r = S.applyBatch(T.enc({ aiOpenaiKey: 'sk-new', language: 'ru' }));
ok(!r.ok && fs.readFileSync(path.join(PROJ, 'settings.json'), 'utf8') === before, 'F applyBatch() too, and settings.json is untouched', JSON.stringify(r));
r = S.applyBatch(T.enc({ language: 'ru' }));
ok(r.ok && raw().language === 'ru' && raw().savedSecrets.aiAnthropicKey, 'F a save without keys still works, and keeps the record of what is saved');
// A key typed into settings.json by hand while the store is broken stays
// there and keeps working, instead of being dropped.
fs.writeFileSync(path.join(PROJ, 'settings.json'), JSON.stringify({ ...raw(), aiOpenaiKey: 'sk-by-hand' }));
S.moveSecrets();
ok(S.read().aiOpenaiKey === 'sk-by-hand' && raw().aiOpenaiKey === 'sk-by-hand', 'F a key in the file stays put while the store is broken');
secrets._setStore(null);
S.moveSecrets();
ok(S.read().aiOpenaiKey === 'sk-by-hand' && !('aiOpenaiKey' in raw()) && stored().aiOpenaiKey === 'sk-by-hand', 'F ...and moves once the store works again');

// G. The keychain store, with a stand-in for /usr/bin/security.
{
  const calls = [];
  const item = { value: null };
  const fake = (cmd, args, opts) => {
    calls.push({ args, input: opts.input });
    if (args[0] === 'find-generic-password') {
      if (item.value === null) { const e = new Error('not found'); e.status = 44; throw e; }
      return Buffer.from(item.value + '\n');
    }
    if (args[0] === '-i') { item.value = /-w "([^"]*)"/.exec(opts.input)[1]; return Buffer.from(''); }
    if (args[0] === 'delete-generic-password') { item.value = null; return Buffer.from(''); }
  };
  const kc = secrets.keychainStore({ run: fake });
  eq(kc.load(), {}, 'G nothing saved yet reads as empty');
  kc.save({ canvasToken: 'a"b\\c' });
  ok(calls.every(c => !c.args.join(' ').includes('a"b')), 'G the key is never on the command line');
  ok(!calls[1].input.includes('a"b'), 'G nor readable in what goes to `security -i`');
  eq(kc.load(), { canvasToken: 'a"b\\c' }, 'G it reads back, quotes and backslashes included');
  kc.save({});
  ok(item.value === null, 'G with nothing left the item is deleted');
  const locked = secrets.keychainStore({ run: () => { const e = new Error('x'); e.status = 51; e.stderr = 'User interaction is not allowed.'; throw e; } });
  let threw = null; try { locked.load(); } catch (e) { threw = e.message; }
  ok(/not allowed/.test(threw || ''), 'G any other failure is an error, not "nothing saved"', threw);
}

// H. DPAPI, with a stand-in for PowerShell: the data only on stdin.
{
  const seen = [];
  const fakePs = (cmd, args, opts) => { seen.push({ cmd, args, input: opts.input }); return Buffer.from(Buffer.from(opts.input, 'base64').reverse().toString('base64')); };
  const file = path.join(PROJ, 'h.dat');
  const pf = secrets.protectedFileStore(file, fakePs);
  pf.save({ aiOpenaiKey: 'sk-secret-value' });
  ok(seen[0].cmd === 'powershell.exe' && !seen[0].args.join(' ').includes('sk-secret'), 'H PowerShell never gets the key on its command line');
  ok(!fs.readFileSync(file, 'utf8').includes('sk-secret'), 'H the file holds only what PowerShell returned');
  eq(pf.load(), { aiOpenaiKey: 'sk-secret-value' }, 'H it reads back');
}

// I. The Q password on Windows: sealed, and an old plain file is moved in.
{
  const grades = require(path.join(PROJ, 'services', 'q', '40-grades.js'));
  const fakePs = (cmd, args, opts) => Buffer.from(Buffer.from(opts.input, 'base64').reverse().toString('base64'));
  const legacy = path.join(PROJ, 'i-old.json'), sealed = path.join(PROJ, 'i.dat');
  fs.writeFileSync(legacy, JSON.stringify({ password: 'q-old-password' }));
  const st = grades.sealedStore(sealed, legacy, fakePs);
  ok(st.get() === 'q-old-password' && !fs.existsSync(legacy) && fs.existsSync(sealed), 'I an old plain password is moved into the sealed file');
  ok(!fs.readFileSync(sealed, 'utf8').includes('q-old'), 'I which doesn\'t hold it as text');
  st.set('q-new'); ok(st.get() === 'q-new', 'I a new one reads back');
  st.clear(); ok(st.get() === '' && !fs.existsSync(sealed), 'I clearing removes it');
}

// K. The browser's sign-ins: not under Playwright's stand-in keychain.
{
  const collector = fs.readFileSync(path.join(PROJ, '05-playwright-draft.js'), 'utf8');
  ok(/ignoreDefaultArgs: \['--use-mock-keychain'\]/.test(collector), 'K the browser is started without --use-mock-keychain');
  const launches = collector.match(/launchPersistentContext\(PROFILE_DIR, (\{\s*\.\.\.BROWSER|options\))/g) || [];
  ok(launches.length === (collector.match(/launchPersistentContext\(/g) || []).length, 'K every launch with the profile starts from BROWSER');
  ok(/const launchOptions = \{\s*\.\.\.BROWSER/.test(collector), 'K the check\'s own options too');
}

// J. The real thing, where this machine has it.
if (process.platform === 'win32') {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-dpapi-')), 'secrets.dat');
  const real = secrets.protectedFileStore(file);
  real.save({ canvasToken: 'real-dpapi-round-trip' });
  ok(!fs.readFileSync(file, 'utf8').includes('real-dpapi'), 'J DPAPI: the file is encrypted');
  eq(real.load(), { canvasToken: 'real-dpapi-round-trip' }, 'J DPAPI: and decrypts again');
} else if (process.platform === 'darwin' && process.env.CI) {
  const kc = secrets.keychainStore({ service: 'ClassDash test secrets' });
  try {
    kc.save({ canvasToken: 'real-keychain-round-trip' });
    eq(kc.load(), { canvasToken: 'real-keychain-round-trip' }, 'J keychain: a real round trip');
  } finally { kc.save({}); }
  eq(kc.load(), {}, 'J keychain: and the test item is gone again');
}

T.done();
