// Claude Code (a Claude plan, through `claude -p`) is for chats only: the
// announcement scan runs by itself, and Anthropic's consumer terms don't
// allow automated use of a plan except with an API key (37-ai.js).
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@example.test', canvas: '' } });
const ai = require(path.join(proj, '37-ai.js'));
ok(!ai.scanAllowed('claudecode') && ai.scanAllowed('anthropic') && ai.scanAllowed('ollama') && !ai.scanAllowed('nope'), 'Claude Code can\'t scan; the Anthropic API and local ones can');

const settings = require(path.join(proj, '19-settings.js'));
ok(!settings.validate('aiProvider', 'claudecode').ok && settings.validate('aiProvider', 'anthropic').ok && settings.validate('aiProvider', 'none').ok, 'it can\'t be saved as the announcement AI');
ok(settings.validate('aiChatProvider', 'claudecode').ok, 'but the chats can still use it');

const pick = obj => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const r = cp.spawnSync(process.execPath, ['21-notifier-actions.js', 'aiPick', pick({ for: 'scan', provider: 'claudecode', model: 'haiku' })], { cwd: proj, encoding: 'utf8' });
ok(/"ok":false/.test(r.stdout) && JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8')).aiProvider !== 'claudecode', 'picking it for announcements is turned down');

// Picked before this: the scan doesn't run with it, and no AI buttons.
const s = JSON.parse(fs.readFileSync(path.join(proj, 'settings.json'), 'utf8'));
fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...s, aiProvider: 'claudecode', aiAgreed: ['claudecode'] }));
const scan = cp.spawnSync(process.execPath, ['-e', `require('./38-announcement-scan.js').scan({ ids: ['1'] }).then(r => process.stdout.write(JSON.stringify(r)))`], { cwd: proj, encoding: 'utf8' });
ok(/"ok":false/.test(scan.stdout) && /chats only/.test(scan.stdout), 'saved from before: the scan won\'t use it: ' + scan.stdout.slice(0, 200));
const draft = fs.readFileSync(path.join(proj, '05-playwright-draft.js'), 'utf8');
ok(/function startAnnouncementScan\(\)[^]{0,300}scanAllowed\(SETTINGS\.aiProvider\)/.test(draft), 'and the scan after a check isn\'t started');

// The scan's picker lists it, but greyed out with the reason.
const picker = fs.readFileSync(path.join(proj, '51-model-picker.js'), 'utf8');
ok(/opts\.which === 'scan'[^\n]*chatOnly[^\n]*why: 'chatOnly'/.test(picker) && /mpWhy_chatOnly/.test(picker), 'the announcement picker shows it as chats only');

// Settings → AI: Claude Code's warning note says so too, and only its.
T.redraw(proj);
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
ok((html.match(/Chats only: it can&#39;t read announcements|Chats only: it can't read announcements/g) || []).length === 1 && /Consumer Terms \(section 3\)/.test(html), 'Claude Code\'s note in Settings → AI says it\'s chats only, citing the terms');
