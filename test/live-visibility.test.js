// A hidden window doesn't poll; showing it again catches up at once.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); T.redraw(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(30); } return f(); };
const live = path.join(proj, 'live');
const cur = Number(/var PAGE_VERSION = (\d+);/.exec(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'))[1]);
fs.writeFileSync(path.join(live, 'page-version.js'), 'window.classdashPageVersion = ' + cur + ';\n');
try { fs.unlinkSync(path.join(live, 'check-run.js')); } catch {}
(async () => {
  let hidden = true;
  const dom = await JSDOM.fromFile(path.join(proj, 'summary.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      Object.defineProperty(w.document, 'hidden', { get: () => hidden });
      const real = w.setTimeout.bind(w); w.setTimeout = (fn, ms, ...a) => real(fn, Math.min(ms, 40), ...a);
    } });
  const w = dom.window;
  await until(() => typeof w.pollLive === 'function');
  w.pageLoadedAt = 0; w.lastInteraction = 0;
  fs.writeFileSync(path.join(live, 'page-version.js'), 'window.classdashPageVersion = ' + (cur + 5) + ';\n');
  await sleep(500);
  ok('hidden window -> does not poll, so does not reload', w.reloadingForLive === false);
  hidden = false; w.document.dispatchEvent(new w.Event('visibilitychange'));
  ok('shown again -> catches up straight away', await until(() => w.reloadingForLive === true));
  process.exit(process.exitCode || 0);
})();
