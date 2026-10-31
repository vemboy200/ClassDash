/**
 * The workspace's desk: up to five panes side by side, mixed and matched.
 *
 * ── Panes ──
 *
 * Each pane shows one thing:
 *   pdf  a PDF to write on: 46-workspace.js's page (workspace-pdf.html) in
 *        a frame of its own, so two PDFs can sit side by side
 *   ai   the AI chat (49-ai-sidebar.js), about the PDF pane last clicked
 *   web  a bookmarked site: Google Docs, Word, Desmos... There's no address
 *        bar: the bookmarks are the way in (a new one is typed in on the
 *        bookmarks screen), so ClassDash stays a desk, not a second browser
 * Panes split right or down and the dividers drag. The layout, each pane's
 * PDF or page, and the bookmarks are kept in workspace/desk.json, so the
 * desk opens the way it was left.
 *
 * Panes are laid out by hand (absolute positions from the split tree), never
 * moved in the page: a frame that moves reloads, and a PDF would lose its
 * undo history every time a pane next to it split.
 *
 * ── Web panes ──
 *
 * A web page can't sit in a frame here: Google, Microsoft and most sites
 * refuse to be framed, and their sign-in wouldn't work in one anyway. So the
 * app draws each web pane itself, a real browser view laid over the pane's
 * box (16-summary.swift's WebPanes). It has a sign-in of its own, kept
 * apart from Safari's and from the browser the checks use, and identifies
 * itself as Safari, which it is underneath, so Google lets it sign in. This
 * page tells the app where each box is (webPane layout) whenever anything
 * moves, and the app tells it where each page has got to. Closing the
 * workspace closes the pages too (each is a WebKit process of its own, a
 * Doc a few hundred MB); they open again where they were, from desk.json. Something drawn
 * over a web pane (a menu) would end up under the app's view, so a web pane
 * a menu covers is hidden while it's open.
 *
 * Only the Mac app draws web panes so far; elsewhere webCaps says so and
 * the Web choice explains.
 *
 * ── Messages ──
 *
 * The desk is the frame in the main page's Workspace panel. A PDF pane's
 * frame posts its actions here and they go on to the main page (with the
 * pane's id put in front of theirs, so the answer finds its way back).
 */
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const PAGE = path.join(PROJECT_ROOT, 'workspace.html');
const MAX_PANES = 5;
const KINDS = ['pdf', 'ai', 'web'];
const MAX_BOOKMARKS = 40;

const DEFAULT_BOOKMARKS = [
  { title: 'Google Docs', url: 'https://docs.google.com/document/' },
  { title: 'Google Slides', url: 'https://docs.google.com/presentation/' },
  { title: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/' },
  { title: 'Word', url: 'https://www.office.com/launch/word' },
  { title: 'PowerPoint', url: 'https://www.office.com/launch/powerpoint' },
  { title: 'Excel', url: 'https://www.office.com/launch/excel' },
  { title: 'Desmos', url: 'https://www.desmos.com/calculator' },
];

const DEFAULT_DESK = {
  layout: { split: 'row', sizes: [0.68, 0.32], kids: [{ pane: 'p1', kind: 'pdf' }, { pane: 'p2', kind: 'ai' }] },
  focus: 'p1',
};

const workspace = () => require('./46-workspace.js');
const deskFile = () => path.join(workspace().DIR, 'desk.json');

/** A web address a pane may open: http(s) only. */
function webUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

/**
 * The desk as it may be saved: at most five panes, one AI pane, known
 * kinds, real PDF ids and web addresses, sizes that add up to 1.
 */
function clean(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  let ai = false;
  const node = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 6) return null;
    if (typeof n.pane === 'string') {
      if (!/^[a-z0-9]{1,12}$/.test(n.pane) || seen.has(n.pane) || seen.size >= MAX_PANES || !KINDS.includes(n.kind)) return null;
      if (n.kind === 'ai') { if (ai) return null; ai = true; }
      seen.add(n.pane);
      const out = { pane: n.pane, kind: n.kind };
      if (n.kind === 'pdf' && workspace().isId(n.doc)) out.doc = n.doc;
      if (n.kind === 'web' && webUrl(n.url)) out.url = webUrl(n.url);
      return out;
    }
    if ((n.split !== 'row' && n.split !== 'col') || !Array.isArray(n.kids)) return null;
    const kids = [], sizes = [];
    n.kids.forEach((k, i) => {
      const c = node(k, depth + 1);
      if (!c) return;
      kids.push(c);
      const size = Array.isArray(n.sizes) ? Number(n.sizes[i]) : NaN;
      sizes.push(size > 0 && isFinite(size) ? size : 1);
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const sum = sizes.reduce((a, b) => a + b, 0);
    return { split: n.split, sizes: sizes.map(s => Math.round(s / sum * 10000) / 10000), kids };
  };
  const layout = node(raw.layout, 0) || JSON.parse(JSON.stringify(DEFAULT_DESK.layout));
  const ids = [];
  (function walk(n) { if (n.pane) ids.push(n.pane); else n.kids.forEach(walk); })(layout);
  const bookmarks = Array.isArray(raw.bookmarks)
    ? raw.bookmarks.map(b => b && webUrl(b.url) ? { title: String(b.title || '').trim().slice(0, 80) || new URL(b.url).host, url: webUrl(b.url) } : null).filter(Boolean).slice(0, MAX_BOOKMARKS)
    : DEFAULT_BOOKMARKS.map(b => ({ ...b }));
  return { version: 1, layout, focus: ids.includes(raw.focus) ? raw.focus : ids[0], bookmarks };
}

function readDesk() {
  try { return clean(JSON.parse(fs.readFileSync(deskFile(), 'utf8'))); } catch { return clean({}); }
}

function writeDesk(raw) {
  const desk = clean(raw);
  fs.mkdirSync(workspace().DIR, { recursive: true });
  fs.writeFileSync(deskFile(), JSON.stringify(desk, null, 2));
  return { ok: true, desk };
}

function strings() {
  const { t } = require('./18-language.js');
  const keys = ['wsTitle', 'wsClose', 'wsNoBridge',
    'wsPaneKind', 'wsPanePdf', 'wsPaneWeb', 'wsSplitRight', 'wsSplitDown', 'wsClosePane', 'wsMaxPanes', 'wsAiOnlyOne',
    'wsWebBack', 'wsWebForward', 'wsWebReload', 'wsWebBookmarks', 'wsWebNewMark', 'wsWebNewName', 'wsWebNewUrl', 'wsWebNewAdd', 'wsWebNewBad', 'wsWebAddPage', 'wsWebRemove', 'wsWebNoNative', 'wsWebNoBookmarks', 'wsWebDownloaded',
    'wsAi', 'wsAiTitle', 'wsAiHints', 'wsAiHintsTip', 'wsAiClear', 'wsAiAsk', 'wsAiPlaceholder', 'wsAiThinking', 'wsAiThought',
    'wsAiPage', 'wsAiUsed', 'wsAiUsing', 'wsAiFailed', 'wsAiEmpty', 'wsAiAbout',
    'wsAiTool_list_assignments', 'wsAiTool_get_assignment', 'wsAiTool_list_classes', 'wsAiTool_list_announcements',
    'wsAiTool_list_pdfs', 'wsAiTool_read_pdf_pages', 'wsAiTool_get_grades'];
  const out = { locale: t('locale') };
  for (const k of keys) out[k] = t(k);
  return out;
}

function pageHtml() {
  const { PIXEL_THEME } = require('./08-page.js');
  const { escapeHtml } = workspace();
  const L = strings();
  const vars = th => `--bg:${th.bg};--card:${th.card};--line:${th.line};--dim:${th.dim};--ink:${th.ink};--accent:${th.new};--hot:${th.hot};`;
  return `<!doctype html>
<html lang="${L.locale.slice(0, 2)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(L.wsTitle)}</title>
<style>
  :root { ${vars(PIXEL_THEME.light)} --text: #111; --desk: #e7e9ee; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { ${vars(PIXEL_THEME.dark)} --text: #eee; --desk: #101114; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--desk); color: var(--text); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; overflow: hidden; }
  button { font: inherit; color: inherit; background: var(--card); border: 2px solid var(--ink); border-radius: 0; padding: 4px 9px; cursor: pointer; box-shadow: 2px 2px 0 var(--ink); }
  button:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 var(--ink); }
  button:disabled { opacity: .4; cursor: default; }
  button.on { background: var(--accent); color: var(--card); }
  button.small { padding: 1px 6px; box-shadow: 1px 1px 0 var(--ink); font-size: 13px; }
  .top { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--bg); border-bottom: 2px solid var(--ink); }
  .top b { font-size: 15px; }
  .top .grow, .grow { flex: 1; }
  #tabs { display: flex; gap: 4px; overflow-x: auto; }
  #panes { flex: 1; position: relative; min-height: 0; }
  .pane { position: absolute; display: flex; flex-direction: column; background: var(--bg); border: 2px solid var(--ink); min-width: 0; min-height: 0; }
  .pane.front { border-color: var(--accent); }
  .pane-head { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-bottom: 2px solid var(--line); position: relative; }
  .pane-title { font-size: 12px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .pane-body { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .pane-body iframe { flex: 1; width: 100%; border: 0; display: block; background: var(--desk); }
  .menu { position: absolute; top: 100%; left: 6px; z-index: 5; background: var(--card); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); display: flex; flex-direction: column; min-width: 150px; }
  .menu button { border: 0; box-shadow: none; text-align: left; padding: 6px 10px; }
  .menu button:hover:not(:disabled) { background: var(--accent); color: var(--card); }
  .menu .note { font-size: 11px; color: var(--dim); padding: 2px 10px 6px; max-width: 220px; }
  .divider { position: absolute; z-index: 2; touch-action: none; }
  .divider.row { cursor: col-resize; }
  .divider.col { cursor: row-resize; }
  .divider:hover, .divider.dragging { background: var(--accent); opacity: .5; }
  .note-box { padding: 24px; color: var(--dim); text-align: center; }
  /* web */
  .web-bar { display: flex; gap: 4px; align-items: center; padding: 4px 6px; border-bottom: 2px solid var(--line); }
  .new-mark { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .new-mark b { flex-basis: 100%; font-size: 13px; }
  .new-mark input { flex: 1; min-width: 120px; font: inherit; font-size: 13px; color: var(--text); background: var(--card); border: 2px solid var(--ink); padding: 3px 6px; }
  .new-mark .mark-url { flex: 2; }
  .new-mark .why { flex-basis: 100%; color: var(--hot); font-size: 12px; }
  .new-mark .why:empty { display: none; }
  .web-box { flex: 1; position: relative; min-height: 0; }
  .web-home { position: absolute; inset: 0; overflow: auto; padding: 14px; }
  .marks { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .mark { position: relative; }
  .mark > button:first-child { width: 100%; text-align: left; padding: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark small { display: block; color: var(--dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .mark .x { position: absolute; top: -8px; right: -8px; padding: 0 5px; font-size: 12px; display: none; }
  .mark:hover .x { display: block; }
  .web-home .add { margin-top: 14px; }
  .web-loading { position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--accent); animation: load 1.2s ease-in-out infinite; transform-origin: left; }
  @keyframes load { 0% { transform: scaleX(.05); } 60% { transform: scaleX(.7); } 100% { transform: scaleX(.95); opacity: .3; } }
  .web-said { font-size: 12px; color: var(--dim); padding: 2px 8px; }
  .web-said:empty { display: none; }
  /* ai */
  .ai-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 2px solid var(--line); font-size: 13px; }
  .ai-head .about { flex: 1; min-width: 0; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ai-head label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
  #ai-chat { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  #ai-chat .empty { color: var(--dim); font-size: 13px; }
  .ai-msg { max-width: 92%; padding: 7px 10px; border: 2px solid var(--ink); background: var(--card); white-space: pre-wrap; overflow-wrap: anywhere; }
  .ai-msg.user { align-self: flex-end; background: var(--accent); color: var(--card); }
  .ai-msg.ai { align-self: flex-start; }
  .ai-msg.pending .ai-said { color: var(--dim); font-style: italic; }
  .ai-msg .ai-meta { display: block; color: var(--dim); font-size: 11px; margin-top: 4px; white-space: normal; }
  .ai-msg.user .ai-meta { color: inherit; opacity: .8; }
  .ai-thought { font-size: 12px; color: var(--dim); margin-bottom: 4px; }
  .ai-thought summary { cursor: pointer; }
  .ai-thought div { max-height: 160px; overflow-y: auto; white-space: pre-wrap; }
  #ai-status { color: var(--hot); font-size: 12px; padding: 0 10px; }
  #ai-status:empty { display: none; }
  .ai-form { display: flex; gap: 6px; padding: 8px 10px 10px; align-items: flex-end; }
  #ai-q { flex: 1; min-height: 38px; max-height: 140px; resize: vertical; font: inherit; color: var(--text); background: var(--card); border: 2px solid var(--ink); padding: 6px 8px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="top">
  <b>${escapeHtml(L.wsTitle)}</b>
  <div id="tabs" hidden></div>
  <div class="grow"></div>
  <button id="close-btn">${escapeHtml(L.wsClose)}</button>
</div>
<div id="panes"></div>
<script>
${PAGE_SCRIPT.replace('__STRINGS__', () => JSON.stringify(L).replace(/</g, '\\u003c'))}
</script>
</body>
</html>
`;
}

/** Writes workspace.html, the desk. */
function writeDeskPage() {
  fs.writeFileSync(PAGE, pageHtml());
  return PAGE;
}

const PAGE_SCRIPT = String.raw`
'use strict';
const L = __STRINGS__;
const MAX_PANES = 5;
const GAP = 6;
const MIN_PANE = 150;
const NARROW = 700;
const $ = id => document.getElementById(id);
const KIND_WORD = { pdf: L.wsPanePdf, ai: L.wsAi, web: L.wsPaneWeb };

// ── Talking to the main page ──
const embedded = window.parent !== window;
let seq = 0;
const waiting = {};
function toParent(message) { window.parent.postMessage(Object.assign({ cd: 'ws' }, message), '*'); }
function bridge(action, arg, extra) {
  return new Promise(resolve => {
    if (!embedded) { resolve({ ok: false, why: L.wsNoBridge }); return; }
    const id = 'd' + Date.now().toString(36) + '-' + (++seq);
    waiting[id] = resolve;
    toParent(Object.assign({ type: 'action', id, action, arg: arg || '' }, extra || {}));
  });
}
// No answer wanted (the main page sends none for 'flush').
const tell = (action, arg) => toParent({ type: 'action', id: 'flush', action, arg });
const closePanel = () => toParent({ type: 'close' });

// ── The desk ──
let desk = null;          // { layout, focus, bookmarks }
let canWeb = false;       // the app draws web panes
const els = {};           // pane id -> { el, kind, body, ... }
const pdfs = {};          // pane id -> { doc, title, page } as its frame last said
const webs = {};          // pane id -> { url, title, loading, back, forward, home }
let lastPdf = null;
let menu = null;          // { el, pane } while a menu is open

function panesOf(n, out = []) { if (n.pane) out.push(n); else n.kids.forEach(k => panesOf(k, out)); return out; }
function findPane(id) { return panesOf(desk.layout).find(p => p.pane === id); }
function parentOf(target, n = desk.layout, up = null) {
  if (n === target) return up;
  if (n.pane) return undefined;
  for (const k of n.kids) { const r = parentOf(target, k, n); if (r !== undefined) return r; }
  return undefined;
}
function newPaneId() { let i = 1; while (findPane('p' + i)) i++; return 'p' + i; }

let saveTimer = null, saving = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!desk) return;
  const json = JSON.stringify({ layout: desk.layout, focus: desk.focus, bookmarks: desk.bookmarks });
  saving = bridge('workspaceDeskSave', b64(json));
  await saving;
  saving = null;
}
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Laying out ──
// The split tree gives each pane and divider a box; nothing is ever moved
// in the page, only placed.
function place(n, x, y, w, h, out) {
  if (n.pane) { out.panes[n.pane] = { x, y, w, h }; return; }
  const row = n.split === 'row';
  const avail = (row ? w : h) - GAP * (n.kids.length - 1);
  let at = row ? x : y;
  n.kids.forEach((k, i) => {
    const size = avail * n.sizes[i];
    if (row) place(k, at, y, size, h, out); else place(k, x, at, w, size, out);
    at += size;
    if (i < n.kids.length - 1) {
      out.dividers.push({ n, i, row, avail, box: row ? { x: at, y, w: GAP, h } : { x, y: at, w, h: GAP } });
      at += GAP;
    }
  });
}

const narrow = () => $('panes').clientWidth < NARROW;

function layout() {
  const host = $('panes');
  const W = host.clientWidth, H = host.clientHeight;
  const out = { panes: {}, dividers: [] };
  const small = narrow();
  if (small) out.panes[desk.focus] = { x: 0, y: 0, w: W, h: H };
  else place(desk.layout, 0, 0, W, H, out);
  for (const id in els) {
    const r = out.panes[id];
    const el = els[id].el;
    el.hidden = !r;
    el.classList.toggle('front', id === desk.focus && panesOf(desk.layout).length > 1);
    if (r) Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
  // The dividers, reused in order: one being dragged keeps its pointer.
  const old = [...host.querySelectorAll('.divider')];
  out.dividers.forEach((d, k) => {
    const el = old[k] || host.appendChild(document.createElement('div'));
    el.className = 'divider ' + (d.row ? 'row' : 'col') + (el.classList.contains('dragging') ? ' dragging' : '');
    Object.assign(el.style, { left: d.box.x + 'px', top: d.box.y + 'px', width: d.box.w + 'px', height: d.box.h + 'px' });
    el.d = d;
  });
  old.slice(out.dividers.length).forEach(el => el.remove());
  drawTabs(small);
  syncWeb();
}

function drawTabs(small) {
  const tabs = $('tabs');
  tabs.hidden = !small;
  tabs.textContent = '';
  if (!small) return;
  for (const p of panesOf(desk.layout)) {
    const b = document.createElement('button');
    b.className = 'small' + (p.pane === desk.focus ? ' on' : '');
    b.textContent = paneLabel(p);
    b.onclick = () => { setFocus(p.pane); layout(); };
    tabs.appendChild(b);
  }
}

function paneLabel(p) {
  if (p.kind === 'pdf' && pdfs[p.pane] && pdfs[p.pane].title) return pdfs[p.pane].title;
  if (p.kind === 'web' && webs[p.pane] && webs[p.pane].title) return webs[p.pane].title;
  return KIND_WORD[p.kind];
}

function wireDividers() {
  $('panes').addEventListener('pointerdown', e => {
    const el = e.target.closest('.divider');
    if (!el || !el.d) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add('dragging');
    const { n, i, row, avail } = el.d;
    const start = row ? e.clientX : e.clientY;
    const a = n.sizes[i], b = n.sizes[i + 1];
    const min = Math.min(MIN_PANE / Math.max(avail, 1), (a + b) / 2);
    let frame = 0;
    const move = ev => {
      const delta = ((row ? ev.clientX : ev.clientY) - start) / Math.max(avail, 1);
      const na = Math.max(min, Math.min(a + b - min, a + delta));
      n.sizes[i] = na; n.sizes[i + 1] = a + b - na;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      layout();
      save();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// ── Panes ──
function setFocus(id) {
  if (!desk || desk.focus === id || !findPane(id)) return;
  desk.focus = id;
  const p = findPane(id);
  if (p.kind === 'pdf') { lastPdf = id; aiTargetChanged(); }
  for (const k in els) els[k].el.classList.toggle('front', k === id && panesOf(desk.layout).length > 1);
  save();
}

function makePane(p) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.id = p.pane;
  el.innerHTML = '<div class="pane-head"><button class="small kind"></button><span class="pane-title"></span>' +
    '<button class="small split-r"></button><button class="small split-d"></button><button class="small shut">×</button></div><div class="pane-body"></div>';
  const head = el.querySelector('.pane-head');
  const kindBtn = head.querySelector('.kind');
  kindBtn.title = L.wsPaneKind;
  kindBtn.onclick = e => { e.stopPropagation(); openKindMenu(p.pane, kindBtn); };
  head.querySelector('.split-r').textContent = '◫';
  head.querySelector('.split-r').title = L.wsSplitRight;
  head.querySelector('.split-r').onclick = () => split(p.pane, 'row');
  head.querySelector('.split-d').textContent = '⊟';
  head.querySelector('.split-d').title = L.wsSplitDown;
  head.querySelector('.split-d').onclick = () => split(p.pane, 'col');
  head.querySelector('.shut').title = L.wsClosePane;
  head.querySelector('.shut').onclick = () => closePane(p.pane);
  el.addEventListener('pointerdown', () => setFocus(p.pane), true);
  $('panes').appendChild(el);
  els[p.pane] = { el, kind: null, body: el.querySelector('.pane-body') };
  fill(p);
}

// Puts what the pane shows in its body, if that changed.
function fill(p) {
  const e = els[p.pane];
  e.el.querySelector('.kind').textContent = KIND_WORD[p.kind] + ' ▾';
  if (e.kind === p.kind) { headButtons(); return; }
  if (e.kind === 'ai') ai.el = null;
  e.kind = p.kind;
  e.body.textContent = '';
  delete pdfs[p.pane];
  delete webs[p.pane];
  if (p.kind === 'pdf') {
    const f = document.createElement('iframe');
    f.src = 'workspace-pdf.html' + (p.doc ? '?doc=' + p.doc : '');
    f.title = L.wsPanePdf;
    e.body.appendChild(f);
    e.frame = f;
  } else e.frame = null;
  if (p.kind === 'ai') makeAi(e.body);
  if (p.kind === 'web') makeWeb(p, e.body);
  setTitle(p.pane);
  headButtons();
}

function setTitle(id) {
  const p = findPane(id), e = els[id];
  if (!p || !e) return;
  const t = p.kind === 'pdf' ? (pdfs[id] && pdfs[id].title) || '' : p.kind === 'web' ? (webs[id] && webs[id].title) || '' : '';
  e.el.querySelector('.pane-title').textContent = t;
}

function headButtons() {
  const n = panesOf(desk.layout).length;
  for (const id in els) {
    const h = els[id].el.querySelector('.pane-head');
    h.querySelector('.split-r').disabled = n >= MAX_PANES;
    h.querySelector('.split-d').disabled = n >= MAX_PANES;
    h.querySelector('.split-r').title = n >= MAX_PANES ? L.wsMaxPanes : L.wsSplitRight;
    h.querySelector('.split-d').title = n >= MAX_PANES ? L.wsMaxPanes : L.wsSplitDown;
    h.querySelector('.shut').hidden = n <= 1;
  }
}

function render() {
  const ids = new Set(panesOf(desk.layout).map(p => p.pane));
  for (const id in els) {
    if (ids.has(id)) continue;
    if (els[id].kind === 'ai') ai.el = null;
    els[id].el.remove();
    delete els[id]; delete pdfs[id]; delete webs[id];
  }
  for (const p of panesOf(desk.layout)) { if (els[p.pane]) fill(p); else makePane(p); }
  if (!ids.has(desk.focus)) desk.focus = [...ids][0];
  if (lastPdf && !(findPane(lastPdf) && findPane(lastPdf).kind === 'pdf')) lastPdf = null;
  aiTargetChanged();
  layout();
}

function split(id, dir) {
  const all = panesOf(desk.layout);
  if (all.length >= MAX_PANES) return;
  const p = findPane(id);
  const kind = !all.some(q => q.kind === 'ai') ? 'ai' : canWeb ? 'web' : 'pdf';
  const fresh = { pane: newPaneId(), kind };
  const up = parentOf(p);
  if (up && up.split === dir) {
    const i = up.kids.indexOf(p);
    const half = up.sizes[i] / 2;
    up.kids.splice(i + 1, 0, fresh);
    up.sizes.splice(i, 1, half, half);
  } else {
    const box = { split: dir, sizes: [0.5, 0.5], kids: [p, fresh] };
    if (!up) desk.layout = box;
    else up.kids[up.kids.indexOf(p)] = box;
  }
  desk.focus = fresh.pane;
  render();
  save();
}

function closePane(id) {
  const p = findPane(id);
  const up = parentOf(p);
  if (!up) return;
  const i = up.kids.indexOf(p);
  const share = up.sizes[i];
  up.kids.splice(i, 1);
  up.sizes.splice(i, 1);
  // Its room goes to the pane beside it, the one it was split from.
  up.sizes[i > 0 ? i - 1 : 0] += share;
  if (up.kids.length === 1) {
    const only = up.kids[0];
    const grand = parentOf(up);
    if (!grand) desk.layout = only;
    else grand.kids[grand.kids.indexOf(up)] = only;
  }
  if (els[id] && els[id].frame) flushFrame(els[id].frame);
  render();
  save();
}

function openKindMenu(id, button) {
  closeMenu();
  const p = findPane(id);
  const m = document.createElement('div');
  m.className = 'menu';
  const otherAi = panesOf(desk.layout).some(q => q.kind === 'ai' && q.pane !== id);
  for (const kind of ['pdf', 'ai', 'web']) {
    const b = document.createElement('button');
    b.textContent = KIND_WORD[kind];
    b.disabled = (kind === 'ai' && otherAi) || (kind === 'web' && !canWeb);
    if (kind === 'ai' && otherAi) b.title = L.wsAiOnlyOne;
    b.classList.toggle('on', p.kind === kind);
    b.onclick = () => { closeMenu(); setKind(id, kind); };
    m.appendChild(b);
  }
  if (!canWeb) { const n = document.createElement('div'); n.className = 'note'; n.textContent = L.wsWebNoNative; m.appendChild(n); }
  button.parentNode.appendChild(m);
  menu = { el: m, pane: id };
  syncWeb();
}
function closeMenu() { if (!menu) return; menu.el.remove(); menu = null; syncWeb(); }

function setKind(id, kind) {
  const p = findPane(id);
  if (p.kind === kind) return;
  if (els[id] && els[id].frame) flushFrame(els[id].frame);
  p.kind = kind;
  delete p.doc; delete p.url;
  render();
  save();
}

// ── PDF panes: their frames ──
function paneOfSource(src) { for (const id in els) if (els[id].frame && els[id].frame.contentWindow === src) return id; return null; }
function flushFrame(f) { try { f.contentWindow.postMessage({ cd: 'ws', type: 'flush' }, '*'); } catch (e) {} }

window.addEventListener('message', e => {
  const m = e.data;
  if (!m || m.cd !== 'ws') return;
  if (e.source === window.parent) { fromMain(m); return; }
  const id = paneOfSource(e.source);
  if (!id) return;
  const f = els[id].frame;
  if (m.type === 'action') {
    // Passed on with the pane in front of its id; a 'flush' wants no answer.
    toParent({ type: 'action', id: m.id === 'flush' ? 'flush' : id + '|' + m.id, action: m.action, arg: m.arg });
  } else if (m.type === 'pdf') {
    const p = findPane(id);
    pdfs[id] = { doc: m.doc || '', title: m.title || '', page: m.page || 0 };
    if (p && p.kind === 'pdf' && (p.doc || '') !== (m.doc || '')) { if (m.doc) p.doc = m.doc; else delete p.doc; save(); }
    if (!lastPdf || id === desk.focus) lastPdf = id;
    setTitle(id);
    drawTabs(narrow());
    aiTargetChanged();
  } else if (m.type === 'focus') { setFocus(id); closeMenu(); }
  else if (m.type === 'close') closePanel();
  else if (m.type === 'flushed') { if (flushing) flushing.done(f); }
});

function fromMain(m) {
  if (m.type === 'result') {
    const bar = String(m.id).indexOf('|');
    if (bar > 0) {
      const e = els[m.id.slice(0, bar)];
      if (e && e.frame) e.frame.contentWindow.postMessage({ cd: 'ws', type: 'result', id: m.id.slice(bar + 1), result: m.result }, '*');
      return;
    }
    const cb = waiting[m.id]; delete waiting[m.id];
    if (cb) cb(m.result || { ok: false });
  } else if (m.type === 'flush') flushAll();
  else if (m.type === 'live' && m.live) showLive(m.live);
  else if (m.type === 'web' && m.web) webEvent(m.web);
}

// Closing or quitting: every PDF pane saves, then the desk, then the main
// page hears it's done.
let flushing = null;
function flushAll() {
  const frames = Object.values(els).map(e => e.frame).filter(Boolean);
  const left = new Set(frames);
  const finish = async () => { if (!flushing) return; flushing = null; await saveNow(); toParent({ type: 'flushed' }); };
  flushing = { done(f) { left.delete(f); if (!left.size) finish(); } };
  if (!frames.length) { finish(); return; }
  frames.forEach(flushFrame);
}

// ── Web panes ──
function makeWeb(p, body) {
  webs[p.pane] = { url: p.url || '', title: '', loading: false, back: false, forward: false, home: !p.url, said: '' };
  if (!canWeb) { const n = document.createElement('div'); n.className = 'note-box'; n.textContent = L.wsWebNoNative; body.appendChild(n); return; }
  const bar = document.createElement('div');
  bar.className = 'web-bar';
  bar.innerHTML = '<button class="small back">‹</button><button class="small fwd">›</button><button class="small reload">⟳</button><span class="grow"></span><button class="small marks-btn"></button>';
  const [back, fwd, reload] = bar.querySelectorAll('button');
  back.title = L.wsWebBack; fwd.title = L.wsWebForward; reload.title = L.wsWebReload;
  back.onclick = () => tell('webPane', JSON.stringify({ op: 'nav', id: p.pane, cmd: 'back' }));
  fwd.onclick = () => tell('webPane', JSON.stringify({ op: 'nav', id: p.pane, cmd: 'forward' }));
  reload.onclick = () => tell('webPane', JSON.stringify({ op: 'nav', id: p.pane, cmd: 'reload' }));
  const marks = bar.querySelector('.marks-btn');
  marks.textContent = '☆ ' + L.wsWebBookmarks;
  marks.onclick = () => { const w = webs[p.pane]; w.home = !w.home || !w.url; drawWeb(p.pane); syncWeb(); };
  const said = document.createElement('div');
  said.className = 'web-said';
  const box = document.createElement('div');
  box.className = 'web-box';
  body.append(bar, said, box);
  drawWeb(p.pane);
}

// A typed web address for a new bookmark (https:// added if it's missing),
// or null if it isn't one.
function addressOf(text) {
  let v = String(text || '').trim();
  if (!v || /\s/.test(v)) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return /\./.test(u.hostname) ? u.href : null;
  } catch (e) { return null; }
}

function go(id, url) {
  const w = webs[id];
  if (!w) return;
  w.url = url; w.home = false;
  const p = findPane(id);
  p.url = url;
  tell('webPane', JSON.stringify({ op: 'load', id, url }));
  drawWeb(id);
  syncWeb();
  save();
}

// The pane's own parts: the buttons, and the bookmarks when shown.
function drawWeb(id) {
  const e = els[id], w = webs[id];
  if (!e || !w || !canWeb) return;
  const body = e.body;
  body.querySelector('.back').disabled = !w.back || w.home;
  body.querySelector('.fwd').disabled = !w.forward || w.home;
  body.querySelector('.reload').disabled = !w.url || w.home;
  body.querySelector('.marks-btn').classList.toggle('on', w.home);
  body.querySelector('.web-said').textContent = w.said || '';
  const box = body.querySelector('.web-box');
  let bar = box.querySelector('.web-loading');
  if (w.loading && !w.home && !bar) { bar = document.createElement('div'); bar.className = 'web-loading'; box.appendChild(bar); }
  if ((!w.loading || w.home) && bar) bar.remove();
  let home = box.querySelector('.web-home');
  // The "downloaded" line moves the box: the app's view follows.
  syncWeb();
  if (!w.home) { if (home) home.remove(); return; }
  if (!home) { home = document.createElement('div'); home.className = 'web-home'; box.appendChild(home); home.appendChild(newMarkForm()); }
  // Everything but the form, which keeps what's being typed in it.
  [...home.children].forEach(c => { if (!c.classList.contains('new-mark')) c.remove(); });
  const form = home.querySelector('.new-mark');
  const grid = document.createElement('div');
  grid.className = 'marks';
  desk.bookmarks.forEach((b, i) => {
    const m = document.createElement('div');
    m.className = 'mark';
    const open = document.createElement('button');
    open.textContent = b.title;
    const host = document.createElement('small');
    try { host.textContent = new URL(b.url).host; } catch (err) {}
    open.appendChild(host);
    open.title = b.url;
    open.onclick = () => go(id, b.url);
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = L.wsWebRemove;
    x.onclick = () => { desk.bookmarks.splice(i, 1); save(); for (const k in webs) drawWeb(k); };
    m.append(open, x);
    grid.appendChild(m);
  });
  if (!desk.bookmarks.length) { const n = document.createElement('div'); n.className = 'note-box'; n.textContent = L.wsWebNoBookmarks; home.insertBefore(n, form); }
  home.insertBefore(grid, form);
  if (w.url && !desk.bookmarks.some(b => b.url === w.url)) {
    const add = document.createElement('button');
    add.className = 'add';
    add.textContent = L.wsWebAddPage;
    add.onclick = () => addMark(w.title, w.url);
    home.insertBefore(add, form);
  }
}

function addMark(title, url) {
  if (desk.bookmarks.some(b => b.url === url)) return;
  desk.bookmarks.push({ title: String(title || '').trim().slice(0, 80) || hostOf(url), url });
  save();
  for (const k in webs) drawWeb(k);
}

// The one place an address is typed: a new bookmark.
function newMarkForm() {
  const form = document.createElement('form');
  form.className = 'new-mark';
  form.innerHTML = '<b></b><input class="mark-name"><input class="mark-url" spellcheck="false" autocapitalize="off"><button type="submit"></button><div class="why"></div>';
  form.querySelector('b').textContent = L.wsWebNewMark;
  form.querySelector('.mark-name').placeholder = L.wsWebNewName;
  form.querySelector('.mark-url').placeholder = L.wsWebNewUrl;
  form.querySelector('button').textContent = L.wsWebNewAdd;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const url = addressOf(form.querySelector('.mark-url').value);
    form.querySelector('.why').textContent = url ? '' : L.wsWebNewBad;
    if (!url) return;
    addMark(form.querySelector('.mark-name').value, url);
    form.querySelector('.mark-name').value = '';
    form.querySelector('.mark-url').value = '';
  });
  return form;
}
const hostOf = u => { try { return new URL(u).host; } catch (e) { return u; } };

// Where the app should draw each web pane's view, and whether to. Sent only
// when something changed.
let lastWeb = '';
function syncWeb() {
  if (!canWeb || !desk) return;
  const cover = menu ? menu.el.getBoundingClientRect() : null;
  const panes = [];
  for (const p of panesOf(desk.layout)) {
    if (p.kind !== 'web' || !els[p.pane]) continue;
    const w = webs[p.pane];
    const box = els[p.pane].body.querySelector('.web-box');
    const r = box ? box.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const covered = cover && cover.right > r.left && cover.left < r.left + r.width && cover.bottom > r.top && cover.top < r.top + r.height;
    const show = !!(w && w.url && !w.home && !els[p.pane].el.hidden && !covered && r.width > 0 && r.height > 0);
    panes.push({ id: p.pane, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), show, start: (w && w.url) || '' });
  }
  const json = JSON.stringify({ op: 'layout', panes });
  if (json === lastWeb) return;
  lastWeb = json;
  tell('webPane', json);
}

// From the app: where a web pane's page has got to.
function webEvent(ev) {
  const w = webs[ev.id];
  if (!w) return;
  if (typeof ev.url === 'string' && ev.url && ev.url !== 'about:blank') {
    w.url = ev.url;
    const p = findPane(ev.id);
    if (p && p.url !== ev.url) { p.url = ev.url; save(); }
  }
  if (typeof ev.title === 'string') w.title = ev.title;
  if (typeof ev.loading === 'boolean') w.loading = ev.loading;
  if (typeof ev.back === 'boolean') w.back = ev.back;
  if (typeof ev.forward === 'boolean') w.forward = ev.forward;
  if (typeof ev.downloaded === 'string') {
    w.said = L.wsWebDownloaded + ' ' + ev.downloaded;
    setTimeout(() => { if (webs[ev.id]) { webs[ev.id].said = ''; drawWeb(ev.id); } }, 6000);
  }
  drawWeb(ev.id);
  setTitle(ev.id);
  drawTabs(narrow());
}

// ── The AI pane (49-ai-sidebar.js) ──
// About the PDF pane last clicked: its PDF's chat, asked with the page most
// in view there. The answer shows as it's written: the main page reads it
// and posts it here.
const ai = { el: null, doc: null, messages: [], asking: null };
const toolWord = name => L['wsAiTool_' + name] || name;

function aiTarget() {
  const ids = [lastPdf, ...panesOf(desk.layout).filter(p => p.kind === 'pdf').map(p => p.pane)];
  for (const id of ids) if (id && pdfs[id] && pdfs[id].doc && findPane(id)) return pdfs[id];
  return null;
}

function makeAi(body) {
  body.innerHTML = '<div class="ai-head"><span class="about"></span>' +
    '<label><input type="checkbox" id="ai-hints" checked> <span></span></label><button class="small" id="ai-clear"></button></div>' +
    '<div id="ai-chat"></div><div id="ai-status"></div>' +
    '<div class="ai-form"><textarea id="ai-q" rows="2"></textarea><button id="ai-ask"></button></div>';
  body.querySelector('label').title = L.wsAiHintsTip;
  body.querySelector('label span').textContent = L.wsAiHints;
  body.querySelector('#ai-clear').textContent = L.wsAiClear;
  body.querySelector('#ai-q').placeholder = L.wsAiPlaceholder;
  body.querySelector('#ai-ask').textContent = L.wsAiAsk;
  ai.el = body;
  ai.doc = null;
  $('ai-ask').onclick = askAi;
  $('ai-q').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askAi(); }
  });
  $('ai-clear').onclick = async () => {
    if (ai.asking || !ai.doc) return;
    ai.messages = [];
    drawAi();
    $('ai-status').textContent = '';
    await bridge('workspaceChatClear', ai.doc);
  };
  $('ai-hints').onchange = () => { if (ai.doc) bridge('workspaceChatHints', ai.doc + ':' + ($('ai-hints').checked ? '1' : '0')); };
}

// The PDF it's about, or its page, changed: the chat follows the PDF.
async function aiTargetChanged() {
  if (!ai.el) return;
  const t = aiTarget();
  ai.el.querySelector('.about').textContent = t ? L.wsAiAbout + ' ' + t.title + ' · ' + L.wsAiPage + ' ' + t.page : '';
  $('ai-ask').disabled = !t || !!ai.asking;
  const doc = t ? t.doc : null;
  if (doc === ai.doc || ai.asking) return;
  ai.doc = doc;
  ai.messages = [];
  $('ai-status').textContent = '';
  drawAi();
  if (!doc) return;
  const r = await bridge('workspaceChat', doc);
  if (ai.doc !== doc || !ai.el) return;
  if (r.ok) {
    ai.messages = r.messages || [];
    $('ai-hints').checked = r.hints !== false;
    if (r.can && !r.can.ok) $('ai-status').textContent = r.can.why;
  } else $('ai-status').textContent = r.why || '';
  drawAi();
}

function aiThought(text, open) {
  const fold = document.createElement('details');
  fold.className = 'ai-thought';
  fold.open = open;
  const head = document.createElement('summary');
  head.textContent = L.wsAiThought;
  const body = document.createElement('div');
  body.textContent = text;
  fold.append(head, body);
  return fold;
}
function drawAi(extra) {
  if (!ai.el) return;
  const box = $('ai-chat');
  const follow = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  box.textContent = '';
  const list = ai.messages.concat(extra || []);
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = L.wsAiEmpty;
    box.appendChild(e);
  }
  for (const m of list) {
    const el = document.createElement('div');
    el.className = 'ai-msg ' + (m.role === 'ai' ? 'ai' : 'user') + (m.pending ? ' pending' : '');
    if (m.thinking) el.appendChild(aiThought(m.thinking, !!m.live));
    const said = document.createElement('span');
    said.className = 'ai-said';
    said.textContent = m.text;
    el.appendChild(said);
    const meta = m.role === 'ai' ? (m.used && m.used.length ? L.wsAiUsed + ' ' + m.used.map(toolWord).join(', ') : '')
      : (m.page ? L.wsAiPage + ' ' + m.page : '');
    if (meta) { const s = document.createElement('span'); s.className = 'ai-meta'; s.textContent = meta; el.appendChild(s); }
    box.appendChild(el);
  }
  if (follow || extra) box.scrollTop = box.scrollHeight;
}

async function askAi() {
  const field = $('ai-q');
  const question = field.value.trim();
  const t = aiTarget();
  if (!question || ai.asking || !t) return;
  const page = t.page || 1;
  const live = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  ai.asking = { live, question, page, doc: t.doc };
  $('ai-ask').disabled = true; field.disabled = true; $('ai-status').textContent = '';
  drawAi([{ role: 'user', text: question, page }, { role: 'ai', text: L.wsAiThinking, pending: true }]);
  const arg = b64(JSON.stringify({ doc: t.doc, page, question, hints: $('ai-hints').checked, live }));
  const r = await bridge('workspaceAsk', arg, { live });
  const asked = ai.asking;
  ai.asking = null;
  if (!ai.el) return;
  $('ai-ask').disabled = false; $('ai-q').disabled = false;
  if (asked.doc !== ai.doc) { aiTargetChanged(); return; }
  if (r.ok) {
    ai.messages = r.messages || ai.messages.concat([{ role: 'user', text: question, page }, { role: 'ai', text: r.answer }]);
    $('ai-q').value = '';
    drawAi();
  } else {
    drawAi([{ role: 'user', text: question, page }]);
    $('ai-status').textContent = L.wsAiFailed + ' ' + (r.why || '');
  }
  $('ai-q').focus();
  aiTargetChanged();
}

function showLive(live) {
  if (!ai.asking || live.id !== ai.asking.live) return;
  const text = live.text || (live.using ? L.wsAiUsing + ' ' + toolWord(live.using) + '…' : L.wsAiThinking);
  drawAi([{ role: 'user', text: ai.asking.question, page: ai.asking.page }, { role: 'ai', live: true, pending: !live.text, thinking: live.thinking, text }]);
}

// ── Starting ──
async function start() {
  $('close-btn').onclick = async () => { closePanel(); };
  document.addEventListener('keydown', e => {
    const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
    if (e.key === 'Escape') { if (menu) { closeMenu(); return; } if (!typing) closePanel(); }
  });
  document.addEventListener('pointerdown', e => { if (menu && !menu.el.contains(e.target)) closeMenu(); });
  wireDividers();
  const [d, caps] = await Promise.all([bridge('workspaceDesk'), bridge('webCaps')]);
  canWeb = !!(caps && caps.ok && caps.web);
  desk = d && d.ok && d.desk ? d.desk : { layout: { pane: 'p1', kind: 'pdf' }, focus: 'p1', bookmarks: [] };
  // Opened on a PDF (?doc=): it goes in the pane in front, or the first PDF pane.
  const want = new URLSearchParams(location.search).get('doc');
  if (want && /^[a-f0-9]{16}$/.test(want)) {
    const all = panesOf(desk.layout);
    const front = findPane(desk.focus);
    const target = front && front.kind === 'pdf' ? front : all.find(p => p.kind === 'pdf') || all[0];
    target.kind = 'pdf'; target.doc = want; delete target.url;
    desk.focus = target.pane;
  }
  const front = findPane(desk.focus);
  if (front && front.kind === 'pdf') lastPdf = front.pane;
  render();
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe($('panes'));
  else window.addEventListener('resize', layout);
}
start();
`;

module.exports = { PAGE, MAX_PANES, DEFAULT_BOOKMARKS, clean, readDesk, writeDesk, webUrl, writeDeskPage, pageHtml };
