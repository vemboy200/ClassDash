// The loading wheel (08-page.js pixelSpinner): its frames, and where the
// page shows it — the connection bar while it can't reach the server.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.classProject(['Chemistry', 'History'], { 'settings.json': { language: 'en' } });
const { pixelSpinner } = require(path.join(proj, '08-page.js'));

const cellsOf = uri => {
  const svg = decodeURIComponent(uri.replace(/^url\("data:image\/svg\+xml,/, '').replace(/"\)$/, ''));
  const cells = [];
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) for (let k = 0; k < +m[3]; k++) cells.push([+m[1] + k, +m[2]]);
  return cells;
};
const { track, arc } = pixelSpinner();
const ring = new Set(cellsOf(track).map(c => c.join()));
const frames = Array.from({ length: 160 }, () => new Set());
for (const [x, y] of cellsOf(arc)) frames[Math.floor(x / 16)]?.add(`${x % 16},${y}`);

T.ok(ring.size > 40, 'the track is a ring of cells', ring.size);
T.ok(frames.every(f => f.size > 0 && f.size < ring.size), 'every frame shows some arc, never the whole ring', frames.map(f => f.size));
T.ok(frames.every(f => [...f].every(c => ring.has(c))), 'the arc only ever covers the track');
const sizes = frames.map(f => f.size);
T.ok(Math.max(...sizes) > 2.5 * Math.min(...sizes), 'it grows and shrinks, like the Spinner it copies', sizes);
const share = n => n / ring.size;
T.ok(Math.abs(share(Math.min(...sizes)) - 0.25) < 0.05 && Math.abs(share(Math.max(...sizes)) - 0.75) < 0.05, 'between a quarter and three quarters of the ring', sizes);
const overlap = (a, b) => [...a].filter(c => b.has(c)).length / Math.min(a.size, b.size);
// Four 40-frame loops, each a quarter turn on from the last, all in the
// one strip, so nothing else has to keep time with it.
const quarter = f => new Set([...f].map(c => { const [x, y] = c.split(',').map(Number); return `${15 - y},${x}`; }));
const same = (a, b) => a.size === b.size && [...a].every(c => b.has(c));
T.ok([0, 1, 2].every(k => same(frames[40 * (k + 1)], quarter(frames[40 * k]))), 'each loop is the one before turned a quarter');
T.ok(same(quarter(frames[120]), frames[0]), '...and the fourth turns back round to the first');
T.ok(!same(frames[40], frames[0]), 'so the smallest arc lands somewhere new each loop');
T.ok(frames.every((f, i) => overlap(f, frames[(i + 1) % 160]) > 0.3), 'every frame runs into the next, the last into the first: no jump anywhere',
  frames.map((f, i) => overlap(f, frames[(i + 1) % 160]).toFixed(2)).join(' '));
T.ok([...ring].every(c => ring.has([...quarter(new Set([c]))][0])), 'a quarter turn keeps the ring on the same cells');

T.redraw(proj);
const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
const { JSDOM } = T.jsdom();
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'file:///project/summary.html' });
const bar = dom.window.document.getElementById('connection-bar');
T.ok(bar && bar.querySelector('.pixel-spinner[aria-hidden="true"]'), 'the connection bar has the wheel');
T.ok(/\.connection-bar\.back \.pixel-spinner \{ display: none; \}/.test(html), '...and drops it once the server is back');
T.ok(/--spinner-arc: url\("data:image\/svg\+xml,/.test(html) && /background: var\(--new\)/.test(html), 'the arc is a mask coloured by the theme blue');
T.ok(/animation: spinner-frames 10s steps\(160\) infinite/.test(html), 'stepped frame to frame, not eased: 2.5s a loop');
T.ok(!/spinner-turn/.test(html), 'one animation only, nothing to fall out of step with');

// ---- the apps' connecting screen and offline bar ----
const connecting = fs.readFileSync(path.join(proj, 'connecting.html'), 'utf8');
T.ok(/class="pixel-spinner"/.test(connecting) && /role="status">[^<]+</.test(connecting), 'a redraw writes connecting.html beside the page: the wheel and a line of text');
T.ok(/animation: appear 0s \.4s both/.test(connecting), '...shown only after a moment, so a quick load shows nothing');
T.ok(!/<script/.test(connecting), '...and nothing to run: it only has to sit there');
dom.window.classdashOffline();
T.ok(!bar.hidden && !bar.classList.contains('back') && bar.querySelector('.pixel-spinner'), 'classdashOffline() shows the bar, wheel turning');
T.ok(/last saved copy/.test(dom.window.document.getElementById('connection-text').textContent), '...saying it\'s the saved copy, not just reconnecting', dom.window.document.getElementById('connection-text').textContent);

const swift = fs.readFileSync(path.join(__dirname, '..', 'mac', '16-summary.swift'), 'utf8');
const electron = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
T.ok(/connecting\.html/.test(swift) && /classdashOffline/.test(swift), 'the Mac app shows the connecting screen, and the bar over the page from disk');
T.ok(/connecting\.html/.test(electron) && /classdashOffline/.test(electron), 'so does the Windows app');
T.ok(/function serverAnswers/.test(electron) && /checkServer/.test(electron), 'Windows asks whether the server answers before loading its page (a failed load would blank the window)');
T.done();
