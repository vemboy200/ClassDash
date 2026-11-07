// What a napominalka:// link may run (mac/16-summary.swift). Any website can offer
// one, so this compiles the real list and the real check out of the source, the way
// script-path-swift.test.js does, and asks it directly.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ok = (c, m, x = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : x); if (!c) process.exitCode = 1; };
const source = fs.readFileSync(path.join(T.REPO, 'mac', '16-summary.swift'), 'utf8');

const list = /let LINK_ACTIONS: Set<String> = \[[^\]]*\]/.exec(source);
const check = /func linkMayRun\(_ action: String\) -> Bool \{[^\n]*\}/.exec(source);
ok(!!list && !!check, 'the list and the check are in the source');

// In the handler, before anything runs.
const start = source.indexOf('@objc func handleGetURL');
const handler = source.slice(start, source.indexOf('func applicationDidFinishLaunching', start));
ok(handler.indexOf('guard linkMayRun(action)') !== -1 && handler.indexOf('guard linkMayRun(action)') < handler.indexOf('runAction(action'), 'the handler checks before it runs anything');
ok((handler.match(/runAction\(action/g) || []).length === 1, 'and there is no other way through it');

const allowed = [...list[0].matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]).sort();
ok(allowed.join() === 'hide,quiet,restartApi,unhide,unquiet', 'only these', allowed.join());

// Every action there is that's not on the list stays off it. Named here too, so
// adding one to the list has to be a decision in two places.
const actions = fs.readFileSync(path.join(T.REPO, 'src', '21-notifier-actions.js'), 'utf8');
const every = [...actions.matchAll(/case '([A-Za-z]+)':/g)].map(m => m[1]);
for (const dangerous of ['config', 'rollApiToken', 'pairCode', 'revokeDevice', 'stopApi', 'syncPair', 'syncFollow', 'syncAccept', 'syncStop', 'syncSetRemote', 'workspaceImport', 'importCalendarPdf', 'saveGradesPassword', 'deleteAssignment', 'virtualDelete']) {
  ok(every.includes(dangerous), `${dangerous} is a real action`);
  ok(!allowed.includes(dangerous), `${dangerous} can't be run from a link`);
}

if (!cp.spawnSync('which', ['swiftc']).stdout.toString().trim()) {
  console.log('link-actions: swiftc not found, skipping the compiled check');
  process.exit(process.exitCode || 0);
}
const dir = T.tmpDir('classdash-link-');
const file = path.join(dir, 'main.swift');
fs.writeFileSync(file, `${list[0]}\n${check[0]}\nprint(CommandLine.arguments.dropFirst().map { linkMayRun($0) ? "yes" : "no" }.joined(separator: ","))\n`);
const built = cp.spawnSync('swiftc', ['-o', path.join(dir, 'link'), file], { encoding: 'utf8' });
ok(built.status === 0, 'the real check compiles', built.stderr);
if (built.status === 0) {
  const answer = cp.spawnSync(path.join(dir, 'link'), ['hide', 'config', 'syncFollow', 'HIDE', ''], { encoding: 'utf8' }).stdout.trim();
  ok(answer === 'yes,no,no,no,no', 'and answers as it should', answer);
}
