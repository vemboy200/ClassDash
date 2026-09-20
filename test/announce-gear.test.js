// The gear button announces saving and scrolls into view when it's off screen.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); T.redraw(proj);
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const timers = [], scrolled = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    w.Element.prototype.scrollIntoView = function (o) { scrolled.push([this.id, o]); };
    w.webkit = { messageHandlers: { classdash: { postMessage() {} } } };
    w.setTimeout = (fn, ms) => { timers.push([ms, fn]); return timers.length; };
  } });
const w = dom.window, d = w.document;
const gear = d.getElementById('settings-button'), status = d.getElementById('settings-status');

// gear on screen: no scrolling
gear.getBoundingClientRect = () => ({ top: 10, bottom: 36 });
w.announceSettings('Saved.');
ok('on screen -> expands, no scroll', gear.classList.contains('expanded') && scrolled.length === 0, JSON.stringify(scrolled));
const t = timers.find(([ms]) => ms === 2500);
ok('collapse scheduled at 2500ms', !!t);
t[1]();
ok('collapses and clears the text', !gear.classList.contains('expanded') && status.textContent === '');

// gear scrolled off the top: brought back into view
gear.getBoundingClientRect = () => ({ top: -300, bottom: -274 });
w.announceSettings('Saving…');
ok('off screen -> scrolled into view', scrolled.length === 1 && scrolled[0][0] === 'settings-button', JSON.stringify(scrolled));

// a newer message replaces the pending collapse instead of being cut short by it
timers.length = 0;
w.announceSettings('Saving…'); w.announceSettings('Saved.');
ok('only the latest collapse timer is live (earlier one cleared)', timers.filter(([ms]) => ms === 2500).length === 2, JSON.stringify(timers.map(x => x[0])));
process.exit(process.exitCode || 0);
