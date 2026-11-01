// A platform read through its backup way is "fallback": a yellow cloud, and the API says so.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en', canvas: 'https://school.instructure.com', canvasToken: 'T~1', canvasApiEnabled: true, canvasSsoEnabled: true } });
process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
require(path.join(proj, '19-settings.js')).markApplied(require(path.join(proj, '19-settings.js')).read());
const S = require(path.join(proj, '25-check-status.js'));
const read = () => JSON.parse(fs.readFileSync('check-status.json', 'utf8'));

S.record('canvas', true, 'Method: API (access token)');
ok('a plain success is ok', read().canvas.status === 'ok' && read().canvas.detail === 'Method: API (access token)');
S.record('canvas', true, 'Fallback: the API (access token) didn\'t work (refused), so Google sign-in was used instead', { fallback: true });
ok('a success by the backup way is fallback', read().canvas.status === 'fallback');
ok('...and keeps saying which way and why', /^Fallback: /.test(read().canvas.detail) && /Google sign-in was used/.test(read().canvas.detail));
S.record('canvas', false, 'boom', { fallback: true });
ok('a failure is a problem, fallback or not', read().canvas.status === 'problem');
S.record('classroom', true);
ok('platforms with no backup way stay ok', read().classroom.status === 'ok');

// what the API and the page hand out
S.record('canvas', true, 'Fallback: the API (access token) didn\'t work (refused), so Google sign-in was used instead', { fallback: true });
ok('checkStatus() (what /api/check-status returns) says fallback', S.checkStatus().canvas.status === 'fallback');
const { HANDLERS } = require(path.join(proj, '17-api.js'));
ok('/api/check-status says fallback, with the detail', HANDLERS['/api/check-status']({}).canvas.status === 'fallback' && /Google sign-in was used/.test(HANDLERS['/api/check-status']({}).canvas.detail));

const { writePage } = require(path.join(proj, '08-page.js'));
writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [], now: new Date() }, 'p.html');
const html = fs.readFileSync('p.html', 'utf8');
ok('the sidebar has one yellow (fallback) cloud saying so', /title="Check status: 1 used backup"><span class="status-cloud pixel-icon status-fallback"><\/span><span class="reload-label check-summary">1 used backup</.test(html) &&
  (html.match(/class="status-cloud /g) || []).length === 1);
ok('the panel row says Fallback and shows the detail', /status-fallback"><\/span>\s*<span class="check-status-name">Canvas<\/span>\s*<span class="check-status-word">Fallback<\/span>/.test(html) && /check-status-detail-text">Fallback: the API/.test(html));
ok("the panel lists only what's been checked: Classroom and Canvas, not Edpuzzle or Q", (html.match(/class="check-status-name"/g) || []).length === 2 && !/check-status-name">(Edpuzzle|Aequitas Q)</.test(html));
ok('the cloud is yellow, with the ! cloud', /\.status-cloud\.status-fallback \{ color: #f2b600/.test(html) && /\.status-cloud\.status-fallback \{ -webkit-mask-image: var\(--icon-cloud-attention\)/.test(html));
ok("the panel's yellow is styled (plain and pixel skins)", /\.status-dot\.status-fallback \{ background: #f2b600/.test(html) && /\.status-dot\.status-fallback \{ background-image:/.test(html));
ok('...and gets the same 12px sizing as the other dots', /status-ok, \.status-dot\.status-fallback, \.status-dot\.status-problem/.test(html));

// One cloud for them all: off ones don't count, under half working is red.
{
  const { checkStatusSummary: sum } = require(path.join(proj, '08-page.js'));
  const of = (...xs) => ({ classroom: { status: xs[0] }, canvas: { status: xs[1] }, edpuzzle: { status: xs[2] }, q: { status: xs[3] } });
  const is = (st, status, text) => sum(st).status === status && sum(st).text === text;
  ok('nothing checked: the plain cloud', is(of('unknown', 'unknown', 'unknown', 'unknown'), 'unknown', 'Not checked yet'));
  ok('all working: ✓', is(of('ok', 'ok', 'unknown', 'ok'), 'ok', 'All OK'));
  ok('1 of 3 failed: !', is(of('ok', 'problem', 'unknown', 'ok'), 'fallback', '1 of 3 failed'));
  ok('half working: still !', is(of('ok', 'problem', 'unknown', 'unknown'), 'fallback', '1 of 2 failed'));
  ok('under half working: ✕', is(of('problem', 'problem', 'ok', 'unknown'), 'problem', '2 of 3 failed'));
  ok('all failed: ✕', is(of('problem', 'unknown', 'unknown', 'unknown'), 'problem', '1 of 1 failed'));
  ok('a backup way counts as working, but says so', is(of('ok', 'fallback', 'problem', 'ok'), 'fallback', '1 of 4 failed') && is(of('ok', 'fallback', 'unknown', 'unknown'), 'fallback', '1 used backup'));
}

// Russian
fs.writeFileSync('settings.json', JSON.stringify({ language: 'ru', canvas: 'https://school.instructure.com', canvasToken: 'T~1' }));
for (const k of Object.keys(require.cache)) if (k.startsWith(proj) && !k.includes('node_modules')) delete require.cache[k];
require(path.join(proj, '19-settings.js')).markApplied(require(path.join(proj, '19-settings.js')).read());
require(path.join(proj, '08-page.js')).writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [], now: new Date() }, 'p2.html');
ok('the word is translated', /check-status-word">Запасной способ</.test(fs.readFileSync('p2.html', 'utf8')));
