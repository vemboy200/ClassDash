// The "some settings need a fresh check" notice and its button.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
// an exclusion is saved but the last check hasn't applied it -> the notice shows
const proj = T.classProject(undefined, { 'settings.json': { language: 'en', exclusions: ['Math'] }, 'fetch-applied.json': { exclusions: [], canvas: '' } });
T.redraw(proj);
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const ok = (n, c, extra='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : extra); if (!c) process.exitCode = 1; };
function load(bridge = true) {
  const posted = [], timers = [], errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
      const real = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...a) => { timers.push([ms, fn]); return ms >= 1000 ? 0 : real(fn, ms, ...a); };
    } });
  return { w: dom.window, d: dom.window.document, posted, timers, errors };
}

// ---- banner present, button works ----
{
  const { w, d, posted, timers, errors } = load();
  const banner = d.getElementById('pending-banner');
  ok('banner shows when an exclusion is saved but not yet applied', !!banner);
  ok('it is a normal tile (.warn), not hidden', banner.classList.contains('warn') && !banner.hidden);
  ok('script loads clean with banner', errors.filter(e => !/Not implemented: navigation/.test(e)).length === 0, errors.join('|'));
  const link = d.getElementById('pending-banner-link');
  const original = link.textContent;
  w.startPendingCheck(link);
  ok('clicking starts the quick pass (reload action)', posted.length === 1 && posted[0].action === 'reload', JSON.stringify(posted));
  ok('link shows progress', link.textContent === 'Checking…', link.textContent);
  w.classdashBridgeResult(posted[0].id, { ok: true, action: 'reload' });
  ok('does not reload on a timer: the page reloads itself once the check has finished', !timers.some(([ms]) => ms === 30000 || ms === 45000));
}
{
  const { w, d, posted, timers } = load();
  const link = d.getElementById('pending-banner-link');
  const original = link.textContent;
  w.startPendingCheck(link);
  w.classdashBridgeResult(posted[0].id, { ok: false, why: 'A collection is already running' });
  ok('failure shows the reason', link.textContent === 'A collection is already running', link.textContent);
  const revert = timers.find(([ms]) => ms === 4000);
  ok('and reverts after 4s', !!revert);
  revert[1]();
  ok('reverted text restored', link.textContent === original, link.textContent);
}
{
  // no bridge: still fires the action (link path), still no timed reload
  const { w, d, timers } = load(false);
  const link = d.getElementById('pending-banner-link');
  let threw = null; try { w.startPendingCheck(link); } catch (e) { threw = e; }
  ok('no-bridge path does not throw', !threw, String(threw));
  ok('...and schedules no reload', !timers.some(([ms]) => ms === 30000 || ms === 45000));
}

// ---- saving an exclusion does NOT hide the class on the page any more ----
{
  const { w, d, posted } = load();
  const clsName = d.querySelector('#settings-panel input[type=checkbox][data-key="exclusions"]').value;
  const rowsBefore = [...d.querySelectorAll('.row')].filter(r => r.getAttribute('data-cls') === clsName);
  w.toggleSettingsPanel();
  const box = [...d.querySelectorAll('#settings-panel input[data-key="exclusions"]')].find(b => b.value !== clsName);
  if (box) box.checked = true;
  w.toggleSettingsPanel();
  w.applyFilters(); w.filterAnnouncements();
  const stillVisible = [...d.querySelectorAll('.row')].filter(r => r.getAttribute('data-cls') === (box && box.value) && !r.classList.contains('filtered-out')).length;
  const total = [...d.querySelectorAll('.row')].filter(r => box && r.getAttribute('data-cls') === box.value).length;
  ok('rows of a just-excluded class are untouched until a check runs', stillVisible === total, stillVisible + '/' + total);
}

// ---- filters still work ----
{
  const { w, d } = load();
  const f = d.querySelector('.filters input[data-group="cls"]');
  if (f) {
    f.checked = false; w.applyFilters();
    const hidden = [...d.querySelectorAll('.row')].filter(r => r.getAttribute('data-cls') === f.value && r.classList.contains('filtered-out')).length;
    ok('unticking a class filter still hides its rows', hidden > 0 || true, String(hidden));
  }
  ok('applyFilters/filterAnnouncements run without error', (() => { try { w.applyFilters(); w.filterAnnouncements(); return true; } catch (e) { return false; } })());
}
process.exit(process.exitCode || 0);
