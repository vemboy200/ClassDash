// The page is replaced whole: someone reading it while a check rewrites it (the
// server sending it to a browser) never gets part of one. Made-up data only.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
T.redraw(proj);
const page = path.join(proj, 'summary.html');
const whole = d => d.length > 100000 && /<\/html>\s*$/.test(d.toString('utf8', d.length - 40));
ok(whole(fs.readFileSync(page)), 'the page is whole to begin with');
const redraws = cp.spawn('sh', ['-c', 'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do node 05-playwright-draft.js --redraw; done'], { cwd: proj, stdio: 'ignore' });
let reads = 0, torn = 0, finished = false;
redraws.on('exit', () => { finished = true; });
const next = () => {
  if (finished) {
    ok(reads > 20, 'it was read many times during the rewrites: ' + reads);
    ok(torn === 0, 'never part of a page: ' + torn + ' of ' + reads);
    ok(!fs.readdirSync(proj).some(f => f.endsWith('.tmp')), 'no temporary files are left behind');
    return;
  }
  fs.readFile(page, (e, d) => { if (!e) { reads++; if (!whole(d)) torn++; } setImmediate(next); });
};
next();
