// Writes frames.css: the app's stepped pixel frames (08-page.js
// PIXEL_CORNERS / rasterSprite) for this site's tiles, buttons and pills,
// in light and dark. Run: node site/make-frames.js
const fs = require('fs'), path = require('path');
const CORNERS = { large: [4, 2, 1, 1, 0], medium: [3, 1, 1, 0], pill: [2, 1, 0] };
const CELL = 2;
const THEME = {
  light: { bg: '#f6f7f9', card: '#ffffff', ink: '#101018', new: '#0004ff', warnbg: '#fffaeb', line: '#e5e7eb' },
  dark:  { bg: '#16181c', card: '#1f2226', ink: '#66718a', new: '#00ffff', warnbg: '#2a2314', line: '#2f3338' },
};
function sprite(size, edge, fill) {
  const ins = CORNERS[size], R = ins.length, N = 2 * R + 1;
  const shape = (x, y) => x >= 0 && y >= 0 && x < N && y < N && Math.min(x, N - 1 - x) >= (Math.min(y, N - 1 - y) < R ? ins[Math.min(y, N - 1 - y)] : 0);
  let body = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!shape(x, y)) continue;
    const isEdge = !shape(x - 1, y) || !shape(x + 1, y) || !shape(x, y - 1) || !shape(x, y + 1);
    body += `<rect x='${x * CELL}' y='${y * CELL}' width='${CELL}' height='${CELL}' fill='${isEdge ? edge : fill}'/>`;
  }
  const W = N * CELL;
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${W}' shape-rendering='crispEdges'>${body}</svg>`)}")`;
}
const geo = s => { const n = CORNERS[s].length * CELL; return `border-style:solid;border-radius:0;background:transparent;border-image-slice:${n} fill;border-image-width:${n}px;border-image-repeat:stretch;`; };
const themed = t => `
.tile{border-image-source:${sprite('large', t.ink, t.card)}}
a.tile:hover{border-image-source:${sprite('large', t.new, t.card)}}
.tile.warn{border-image-source:${sprite('large', t.ink, t.warnbg)}}
.btn{border-image-source:${sprite('medium', t.ink, t.card)}}
.btn:hover{border-image-source:${sprite('medium', t.new, t.card)}}
.btn.primary{border-image-source:${sprite('medium', t.ink, t.new)}}
.btn.primary:hover{border-image-source:${sprite('medium', t.ink, t.card)}}
.pill{border-image-source:${sprite('pill', t.ink, t.line)}}`;
const css = `/* Made by make-frames.js; don't edit by hand. */
.tile{${geo('large')}}
.btn{${geo('medium')}}
.pill{${geo('pill')}}
${themed(THEME.light)}
@media (prefers-color-scheme: dark){${themed(THEME.dark)}
}
`;
fs.writeFileSync(path.join(__dirname, 'frames.css'), css);
