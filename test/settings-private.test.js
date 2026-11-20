// settings.json holds the Canvas token and AI keys, so it's saved readable
// only by this user account (19-settings.js saveFile / lockDown).
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const PROJ = T.makeProject({ 'settings.json': { language: 'en' } });
process.chdir(PROJ);
const S = require(path.join(PROJ, '19-settings.js'));
const FILE = path.join(PROJ, 'settings.json');
const mode = () => fs.statSync(FILE).mode & 0o777;
const eq = (name, got, want) => { const ok = got === want; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : got.toString(8) + ' != ' + want.toString(8)); if (!ok) process.exitCode = 1; };
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');

if (process.platform === 'win32') { console.log('PASS skipped: Windows has no file modes'); process.exit(); }

// An older version, or the wizard's copy of the example, left it readable by everyone.
fs.chmodSync(FILE, 0o644);
S.write('canvasToken', 'test-token-123');
eq('write() locks an existing world-readable file', mode(), 0o600);

fs.chmodSync(FILE, 0o644);
S.applyBatch(enc({ language: 'ru' }));
eq('applyBatch() locks it too', mode(), 0o600);

fs.chmodSync(FILE, 0o644);
S.lockDown();
eq('lockDown() on its own (server start)', mode(), 0o600);

fs.unlinkSync(FILE);
S.write('language', 'en');
eq('a new file is created owner-only', mode(), 0o600);
