/**
 * The PDF workspace: open a PDF, write on it, keep it, export it.
 *
 * ── Where things live ──
 *
 * Each PDF gets a folder of its own, workspace/<id>/ in the project:
 *   source.pdf  the PDF exactly as it was opened, never changed
 *   meta.json   { id, title, fileName, addedAt }
 *   ink.json    what was written on it, saved by the window as you go
 *               ({ version, pageCount, pages: { "1": [item, ...] } })
 * Writing is kept apart from the PDF so it can always be undone, moved or
 * exported again; only Export makes a PDF with it baked in.
 *
 * An item's numbers are in the page's own units at 100% (PDF points, as
 * the page is shown, rotation included), so zoom never changes them:
 *   { id, type: 'pen' | 'hl', color, width, points: [[x, y], ...] }
 *   { id, type: 'text', color, size, x, y, text }
 *
 * ── Who does what ──
 *
 * This file writes workspace.html and does the file work that's easy to
 * test here (adding a PDF, the list, removing one), as actions in
 * 21-notifier-actions.js. The workspace is a panel over the main page, like
 * the Grades center (openWorkspace in 08-page.js), but this page sits in a
 * frame of its own, served by the app (16-summary.swift, electron/main.js)
 * from its classdash-ws:// address, which answers only the page, PDF.js,
 * pdf-lib and the workspace's own files, nothing else in the project. A
 * file:// page can't load PDF.js's module and worker, or fetch() the PDF.
 * The frame can't reach the app's bridge, so it posts its actions to the
 * main page, which passes them on. The two that are too big for a command
 * line, a save and an export, the app does itself (wsSave, wsExport).
 *
 * ── Drawing and exporting ──
 *
 * PDF.js draws the pages; the writing is drawn on a canvas over each one,
 * by the same drawItem() on screen and in an export, so what's exported is
 * what was on screen. An export is the original PDF (still sharp, text
 * still selectable) with each page's writing laid over it as a picture
 * drawn at 3x, by pdf-lib (vendored as src/pdf-lib.min.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./00-project-root.js');

const DIR = path.join(PROJECT_ROOT, 'workspace');
const PAGE = path.join(PROJECT_ROOT, 'workspace.html');
const MAX_BYTES = 200 * 1024 * 1024;
const isId = id => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Copies a PDF into the workspace. Answers { ok, id } or { ok: false, why }. */
function importPdf(file, now = new Date()) {
  let stat;
  try { stat = fs.statSync(file); } catch { return { ok: false, why: 'notFound' }; }
  if (!stat.isFile()) return { ok: false, why: 'notFound' };
  if (stat.size > MAX_BYTES) return { ok: false, why: 'tooBig' };
  const head = Buffer.alloc(1024);
  const fd = fs.openSync(file, 'r');
  let n;
  try { n = fs.readSync(fd, head, 0, 1024, 0); } finally { fs.closeSync(fd); }
  // "%PDF-" is meant to be first, but readers allow junk before it.
  if (!head.subarray(0, n).includes('%PDF-')) return { ok: false, why: 'notPdf' };
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'source.pdf'));
  const fileName = path.basename(file);
  const title = fileName.replace(/\.pdf$/i, '').trim() || 'PDF';
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, title, fileName, addedAt: now.toISOString() }, null, 2));
  return { ok: true, id, title };
}

/** Every PDF in the workspace, the last one written on first. */
function listDocs() {
  let names;
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const docs = [];
  for (const id of names) {
    if (!isId(id)) continue;
    const meta = readJson(path.join(DIR, id, 'meta.json'));
    if (!meta || !fs.existsSync(path.join(DIR, id, 'source.pdf'))) continue;
    const inkFile = path.join(DIR, id, 'ink.json');
    let editedAt = null, pageCount = null;
    try {
      editedAt = fs.statSync(inkFile).mtime.toISOString();
      pageCount = (readJson(inkFile) || {}).pageCount || null;
    } catch { /* not written on yet */ }
    docs.push({ id, title: String(meta.title || id), addedAt: meta.addedAt || null, editedAt, pageCount });
  }
  return docs.sort((a, b) => String(b.editedAt || b.addedAt).localeCompare(String(a.editedAt || a.addedAt)));
}

/** Removes a PDF and everything written on it. */
function removeDoc(id) {
  if (!isId(id)) return { ok: false, why: 'badId' };
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
  return { ok: true };
}

/** The words the page uses, in the current language. */
function strings() {
  const { t } = require('./18-language.js');
  const keys = ['wsTitle', 'wsOpenPdf', 'wsEmpty', 'wsAdded', 'wsEdited', 'wsRemove', 'wsRemoveSure', 'wsAllFiles',
    'wsPen', 'wsHighlighter', 'wsText', 'wsEraser', 'wsUndo', 'wsRedo', 'wsZoomIn', 'wsZoomOut', 'wsFit', 'wsExport',
    'wsSaving', 'wsSaved', 'wsSaveFailed', 'wsExporting', 'wsExported', 'wsExportFailed', 'wsLoadFailed', 'wsNotPdf',
    'wsTooBig', 'wsWithNotes', 'wsSize', 'wsNoBridge', 'wsLoading', 'wsClose',
    'wsAi', 'wsAiTitle', 'wsAiHints', 'wsAiHintsTip', 'wsAiClear', 'wsAiCleared', 'wsAiAsk', 'wsAiPlaceholder', 'wsAiThinking', 'wsAiThought',
    'wsAiPage', 'wsAiUsed', 'wsAiUsing', 'wsAiFailed', 'wsAiEmpty', 'wsAiHide',
    'wsAiTool_list_assignments', 'wsAiTool_get_assignment', 'wsAiTool_list_classes', 'wsAiTool_list_announcements',
    'wsAiTool_list_pdfs', 'wsAiTool_read_pdf_pages', 'wsAiTool_get_grades'];
  const out = { locale: t('locale') };
  for (const k of keys) out[k] = t(k);
  out.wsPages = [1, 2, 5].map(n => t('wsPages', n));
  return out;
}

function pageHtml() {
  const { PIXEL_THEME } = require('./08-page.js');
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
  body { background: var(--desk); color: var(--text); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
  button { font: inherit; color: inherit; background: var(--card); border: 2px solid var(--ink); border-radius: 0; padding: 4px 9px; cursor: pointer; box-shadow: 2px 2px 0 var(--ink); }
  button:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 var(--ink); }
  button:disabled { opacity: .4; cursor: default; }
  button.on { background: var(--accent); color: var(--card); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg); border-bottom: 2px solid var(--ink); position: relative; z-index: 2; }
  .bar .group { display: flex; gap: 4px; align-items: center; }
  .bar .sep { width: 2px; align-self: stretch; background: var(--line); }
  .bar .title { font-weight: 600; max-width: 28ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar .grow { flex: 1; }
  .swatch { width: 22px; height: 22px; padding: 0; }
  .swatch.on { outline: 2px solid var(--accent); outline-offset: 2px; }
  .size { width: 30px; padding: 4px 0; text-align: center; }
  .size i { display: inline-block; background: currentColor; border-radius: 50%; vertical-align: middle; }
  #zoom-label { min-width: 4.5ch; text-align: center; font-variant-numeric: tabular-nums; }
  #status { color: var(--dim); font-size: 12px; min-width: 10ch; text-align: right; }
  #status.bad { color: var(--hot); }
  #desk { flex: 1; overflow: auto; position: relative; }
  #pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 20px; min-width: min-content; }
  .page { position: relative; background: #fff; box-shadow: 0 0 0 2px var(--ink), 4px 4px 0 2px var(--ink); flex: none; }
  .page canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .page canvas.ink { touch-action: none; }
  body[data-tool="pen"] .page canvas.ink, body[data-tool="hl"] .page canvas.ink { cursor: crosshair; }
  body[data-tool="text"] .page canvas.ink { cursor: text; }
  body[data-tool="eraser"] .page canvas.ink { cursor: cell; }
  .page textarea { position: absolute; margin: 0; padding: 0; border: 1px dashed var(--accent); background: rgba(255,255,255,.85); outline: none; resize: none; overflow: hidden; white-space: pre; line-height: 1.25; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; z-index: 1; }
  .home { max-width: 720px; width: 100%; margin: 0 auto; padding: 28px 20px; }
  .home-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 16px; }
  .home h1 { font-size: 22px; margin: 0; }
  .home .empty { color: var(--dim); margin: 24px 0; }
  .doc-row { display: flex; align-items: center; gap: 12px; background: var(--card); border: 2px solid var(--ink); padding: 10px 12px; margin-top: 10px; box-shadow: 3px 3px 0 var(--ink); }
  .doc-row .name { flex: 1; min-width: 0; cursor: pointer; }
  .doc-row .name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doc-row .name span { color: var(--dim); font-size: 12px; }
  .doc-row .remove.sure { background: var(--hot); color: #fff; }
  .message { padding: 40px; text-align: center; color: var(--dim); }
  .message.bad { color: var(--hot); }
  #main { flex: 1; display: flex; min-height: 0; }
  #ai-side { width: var(--ai-width, clamp(280px, 28vw, 400px)); flex: none; display: flex; flex-direction: column; background: var(--bg); border-left: 2px solid var(--ink); min-height: 0; position: relative; }
  #ai-grip { position: absolute; left: -5px; top: 0; bottom: 0; width: 8px; cursor: col-resize; touch-action: none; z-index: 1; }
  #ai-grip:hover, #ai-grip.dragging { background: var(--accent); opacity: .5; }
  @media (max-width: 760px) { #ai-side { position: fixed; inset: 52px 0 0 0; width: auto; z-index: 3; border-left: 0; } #ai-grip { display: none; } }
  .ai-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 2px solid var(--line); }
  .ai-head b { flex: 1; }
  .ai-head label { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; }
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
  .ai-foot { color: var(--dim); font-size: 11px; padding: 0 10px 8px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="bar" id="doc-bar" hidden>
  <div class="group"><button id="home-btn" title="${escapeHtml(L.wsAllFiles)}">‹ ${escapeHtml(L.wsAllFiles)}</button><span class="title" id="doc-title"></span></div>
  <div class="sep"></div>
  <div class="group" id="tools">
    <button data-tool="pen" title="${escapeHtml(L.wsPen)} (P)">${escapeHtml(L.wsPen)}</button>
    <button data-tool="hl" title="${escapeHtml(L.wsHighlighter)} (H)">${escapeHtml(L.wsHighlighter)}</button>
    <button data-tool="text" title="${escapeHtml(L.wsText)} (T)">${escapeHtml(L.wsText)}</button>
    <button data-tool="eraser" title="${escapeHtml(L.wsEraser)} (E)">${escapeHtml(L.wsEraser)}</button>
  </div>
  <div class="group" id="colors"></div>
  <div class="group" id="sizes" title="${escapeHtml(L.wsSize)}"></div>
  <div class="sep"></div>
  <div class="group">
    <button id="undo-btn" title="${escapeHtml(L.wsUndo)}">↶</button>
    <button id="redo-btn" title="${escapeHtml(L.wsRedo)}">↷</button>
  </div>
  <div class="group">
    <button id="zoom-out" title="${escapeHtml(L.wsZoomOut)}">−</button>
    <span id="zoom-label"></span>
    <button id="zoom-in" title="${escapeHtml(L.wsZoomIn)}">+</button>
    <button id="zoom-fit">${escapeHtml(L.wsFit)}</button>
  </div>
  <div class="grow"></div>
  <span id="status"></span>
  <button id="ai-btn" title="${escapeHtml(L.wsAiTitle)}">${escapeHtml(L.wsAi)}</button>
  <button id="export-btn">${escapeHtml(L.wsExport)}</button>
  <button id="close-btn">${escapeHtml(L.wsClose)}</button>
</div>
<div id="main">
<div id="desk"><div id="pages"></div></div>
<aside id="ai-side" hidden>
  <div id="ai-grip"></div>
  <div class="ai-head">
    <b>${escapeHtml(L.wsAiTitle)}</b>
    <label title="${escapeHtml(L.wsAiHintsTip)}"><input type="checkbox" id="ai-hints" checked> ${escapeHtml(L.wsAiHints)}</label>
    <button id="ai-clear">${escapeHtml(L.wsAiClear)}</button>
    <button id="ai-hide" title="${escapeHtml(L.wsAiHide)}">×</button>
  </div>
  <div id="ai-chat"></div>
  <div id="ai-status"></div>
  <div class="ai-form">
    <textarea id="ai-q" rows="2" placeholder="${escapeHtml(L.wsAiPlaceholder)}"></textarea>
    <button id="ai-ask">${escapeHtml(L.wsAiAsk)}</button>
  </div>
  <div class="ai-foot" id="ai-foot"></div>
</aside>
</div>
<script src="pdf-lib.min.js"></script>
<script>
${PAGE_SCRIPT.replace('__STRINGS__', () => JSON.stringify(L).replace(/</g, '\\u003c'))}
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Writes workspace.html for the window to open. */
function writeWorkspacePage() {
  fs.writeFileSync(PAGE, pageHtml());
  return PAGE;
}

// The page's own script. Plain JS (no build step), like 08-page.js's.
const PAGE_SCRIPT = String.raw`
'use strict';
const L = __STRINGS__;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const LINE = 1.25;
const HL_ALPHA = 0.35;
const EXPORT_SCALE = 3;
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const COLORS = {
  pen: ['#1d1d1f', '#1f5eff', '#e0262b', '#1a9b4b'],
  hl: ['#ffd400', '#5cf07a', '#ff7ad9', '#5ad1ff'],
};
COLORS.text = COLORS.pen;
const SIZES = { pen: [1.5, 2.5, 4], hl: [10, 16, 24], text: [12, 16, 22], eraser: [6, 12, 20] };

const docId = new URLSearchParams(location.search).get('doc');
const $ = id => document.getElementById(id);

// ── Talking to the app, through the main page ──
// This page is a frame in the main page (its Workspace panel), which passes
// {action, arg} on through its bridge and sends the answer back. Messages
// count only from that page, and go only to it.
const embedded = window.parent !== window;
let seq = 0;
const waiting = {};
function toParent(message) { window.parent.postMessage(Object.assign({ cd: 'ws' }, message), '*'); }
window.addEventListener('message', e => {
  const m = e.data;
  if (e.source !== window.parent || !m || m.cd !== 'ws') return;
  if (m.type === 'result') { const cb = waiting[m.id]; delete waiting[m.id]; if (cb) cb(m.result || { ok: false }); }
  else if (m.type === 'flush') flushAndTell();
  else if (m.type === 'live' && m.live) showLive(m.live);
});
// extra: more for the main page to read, beside the action (an AI question's live id).
function bridge(action, arg, extra) {
  return new Promise(resolve => {
    if (!embedded) { resolve({ ok: false, why: L.wsNoBridge }); return; }
    const id = 'w' + Date.now().toString(36) + '-' + (++seq);
    waiting[id] = resolve;
    toParent(Object.assign({ type: 'action', id, action, arg: arg || '' }, extra || {}));
  });
}
const closePanel = () => toParent({ type: 'close' });
const whyText = why => ({ notPdf: L.wsNotPdf, tooBig: L.wsTooBig }[why] || why || '');
const pagesText = n => { const f = L.wsPages; const one = f[0], few = f[1], many = f[2]; const pick = /^ru/.test(L.locale) ? ((n % 100 >= 11 && n % 100 <= 14) ? many : (n % 10 === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 ? few : many))) : (n === 1 ? one : few); return pick.replace(/\d+/, n); };

function message(text, bad) {
  $('pages').innerHTML = '';
  const div = document.createElement('div');
  div.className = 'message' + (bad ? ' bad' : '');
  div.textContent = text;
  $('pages').appendChild(div);
}

// ── Home: the list of PDFs ──
async function showHome() {
  document.title = L.wsTitle;
  const desk = $('desk');
  desk.innerHTML = '';
  const home = document.createElement('div');
  home.className = 'home';
  home.innerHTML = '<div class="home-head"><h1></h1><button id="home-close"></button></div><button id="open-btn"></button><div id="open-why" class="message bad" hidden></div><div id="doc-list"></div>';
  home.querySelector('h1').textContent = L.wsTitle;
  home.querySelector('#home-close').textContent = L.wsClose;
  home.querySelector('#home-close').onclick = closePanel;
  toParent({ type: 'doc', doc: '' });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  home.querySelector('#open-btn').textContent = L.wsOpenPdf;
  desk.appendChild(home);
  $('open-btn').onclick = async () => {
    const r = await bridge('wsImport');
    if (r.ok && r.id) location.search = '?doc=' + r.id;
    else if (!r.cancelled) { $('open-why').hidden = false; $('open-why').textContent = L.wsLoadFailed + whyText(r.why); }
  };
  const r = await bridge('workspaceList');
  const list = $('doc-list');
  if (!r.ok) { list.className = 'message bad'; list.textContent = whyText(r.why); return; }
  if (!r.docs.length) { list.className = 'empty'; list.textContent = L.wsEmpty; return; }
  const when = iso => new Date(iso).toLocaleString(L.locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  for (const d of r.docs) {
    const row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML = '<div class="name"><b></b><span></span></div><button class="remove"></button>';
    row.querySelector('b').textContent = d.title;
    const bits = [];
    if (d.pageCount) bits.push(pagesText(d.pageCount));
    if (d.editedAt) bits.push(L.wsEdited + ' ' + when(d.editedAt));
    else if (d.addedAt) bits.push(L.wsAdded + ' ' + when(d.addedAt));
    row.querySelector('span').textContent = bits.join(' · ');
    row.querySelector('.name').onclick = () => { location.search = '?doc=' + d.id; };
    const remove = row.querySelector('.remove');
    remove.textContent = L.wsRemove;
    remove.onclick = async () => {
      if (!remove.classList.contains('sure')) {
        remove.classList.add('sure'); remove.textContent = L.wsRemoveSure;
        setTimeout(() => { remove.classList.remove('sure'); remove.textContent = L.wsRemove; }, 4000);
        return;
      }
      const res = await bridge('workspaceRemove', d.id);
      if (res.ok) row.remove();
    };
    list.appendChild(row);
  }
}

// ── A document ──
const state = { tool: 'pen', color: { pen: COLORS.pen[0], hl: COLORS.hl[0], text: COLORS.pen[0] }, size: { pen: 1, hl: 1, text: 1, eraser: 1 }, zoom: 1, fit: 'auto' };
let pdf = null, sourceBytes = null, meta = null;
let pages = [];          // { num, page, vp1, el, pdfCanvas, inkCanvas, renderedZoom, task, visible }
let ink = {};            // page number -> items
const undoStack = [], redoStack = [];
let observer = null;

const newId = () => Math.random().toString(36).slice(2, 10);
const round = n => Math.round(n * 100) / 100;
const itemsOf = num => ink[num] || (ink[num] = []);

async function openDoc() {
  $('doc-bar').hidden = false;
  message(L.wsLoading);
  let saved = null;
  try {
    let m, bytes;
    [m, saved, bytes] = await Promise.all([
      fetch('doc/' + docId + '/meta.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('doc/' + docId + '/ink.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('doc/' + docId + '/source.pdf').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    ]);
    meta = m;
    sourceBytes = new Uint8Array(bytes);
    if (saved && saved.pages && typeof saved.pages === 'object') ink = saved.pages;
    document.title = meta.title;
    $('doc-title').textContent = meta.title;
    toParent({ type: 'doc', doc: docId });
    const pdfjs = await import('./pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', location.href).href;
    // A copy: PDF.js hands the bytes it's given to its worker, which empties them.
    pdf = await pdfjs.getDocument({ data: sourceBytes.slice(), isEvalSupported: false, enableXfa: false }).promise;
  } catch (e) {
    message(L.wsLoadFailed + (e && e.message || e), true);
    return;
  }
  $('pages').innerHTML = '';
  for (let num = 1; num <= pdf.numPages; num++) {
    const page = await pdf.getPage(num);
    const vp1 = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.num = num;
    const pdfCanvas = document.createElement('canvas');
    const inkCanvas = document.createElement('canvas');
    inkCanvas.className = 'ink';
    el.append(pdfCanvas, inkCanvas);
    $('pages').appendChild(el);
    const p = { num, page, vp1, el, pdfCanvas, inkCanvas, renderedZoom: null, task: null, visible: false };
    pages.push(p);
    hookPointer(p);
  }
  if (!saved || saved.pageCount !== pdf.numPages) scheduleSave(true);
  observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      const p = pages[e.target.dataset.num - 1];
      p.visible = e.isIntersecting;
      if (p.visible) { renderPdf(p); drawInk(p); } else releasePage(p);
    }
  }, { root: $('desk'), rootMargin: '600px 0px' });
  pages.forEach(p => observer.observe(p.el));
  fitWidth('auto');
  window.addEventListener('resize', () => { if (state.fit) fitWidth(state.fit); });
}

function layout() {
  for (const p of pages) {
    p.el.style.width = Math.round(p.vp1.width * state.zoom) + 'px';
    p.el.style.height = Math.round(p.vp1.height * state.zoom) + 'px';
  }
  $('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  $('zoom-fit').classList.toggle('on', state.fit === 'width');
  for (const p of pages) if (p.visible) { renderPdf(p); drawInk(p); }
}

function setZoom(z, fit) {
  const desk = $('desk');
  // Keeps the same spot in the middle of the window, once there is one:
  // the very first fit has nothing laid out yet and stays at the top.
  const middle = state.laidOut ? (desk.scrollTop + desk.clientHeight / 2) / Math.max(1, desk.scrollHeight) : null;
  state.zoom = Math.min(4, Math.max(0.25, z));
  state.fit = fit || false;
  layout();
  if (middle !== null) desk.scrollTop = middle * desk.scrollHeight - desk.clientHeight / 2;
  state.laidOut = true;
}

// 'width' fills the width (Fit width, ⌘0); 'auto', how a PDF opens, is
// its actual size (100%), smaller only when the window is too narrow for
// that. Either one refits when the window or the AI sidebar changes width.
function fitWidth(mode = 'width') {
  const widest = Math.max(...pages.map(p => p.vp1.width), 1);
  const width = Math.max(0.25, ($('desk').clientWidth - 48) / widest);
  setZoom(mode === 'auto' ? Math.min(width, 1) : width, mode);
}

function stepZoom(dir) {
  const z = state.zoom;
  const next = dir > 0 ? ZOOMS.find(v => v > z + 0.001) : [...ZOOMS].reverse().find(v => v < z - 0.001);
  setZoom(next || z, false);
}

async function renderPdf(p) {
  if (p.renderedZoom === state.zoom) return;
  if (p.task) { p.task.cancel(); p.task = null; }
  const dpr = window.devicePixelRatio || 1;
  // At most ~16 million pixels a page: a big page at 400% would otherwise
  // ask for more canvas than WebKit gives.
  const scale = Math.min(state.zoom * dpr, Math.sqrt(16e6 / (p.vp1.width * p.vp1.height)));
  const vp = p.page.getViewport({ scale });
  const zoom = state.zoom;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const task = p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  p.task = task;
  try {
    await task.promise;
  } catch { return; }
  if (p.task !== task) return;
  p.task = null;
  // Drawn off screen and swapped in, so a zoom never flashes a blank page.
  const ctx = p.pdfCanvas.getContext('2d');
  p.pdfCanvas.width = canvas.width;
  p.pdfCanvas.height = canvas.height;
  ctx.drawImage(canvas, 0, 0);
  p.renderedZoom = zoom;
  if (zoom !== state.zoom && p.visible) renderPdf(p);
}

function releasePage(p) {
  if (p.task) { p.task.cancel(); p.task = null; }
  p.pdfCanvas.width = p.pdfCanvas.height = 0;
  p.inkCanvas.width = p.inkCanvas.height = 0;
  p.renderedZoom = null;
}

// ── Drawing ──
function drawItem(ctx, it) {
  if (it.type === 'text') {
    ctx.fillStyle = it.color;
    ctx.font = it.size + 'px ' + FONT;
    ctx.textBaseline = 'top';
    String(it.text).split('\n').forEach((line, i) => ctx.fillText(line, it.x, it.y + i * it.size * LINE));
    return;
  }
  const pts = it.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.globalAlpha = it.type === 'hl' ? HL_ALPHA : 1;
  ctx.strokeStyle = it.color;
  ctx.lineWidth = it.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
  else {
    // Smoothed through the midpoints between samples.
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  ctx.stroke();
  ctx.restore();
}

function drawInk(p, extra) {
  if (!p.visible) return;
  const dpr = window.devicePixelRatio || 1;
  const s = state.zoom * dpr;
  const w = Math.round(p.vp1.width * s), h = Math.round(p.vp1.height * s);
  if (p.inkCanvas.width !== w || p.inkCanvas.height !== h) { p.inkCanvas.width = w; p.inkCanvas.height = h; }
  const ctx = p.inkCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  for (const it of ink[p.num] || []) if (!(editing && editing.item && editing.item.id === it.id)) drawItem(ctx, it);
  if (extra) drawItem(ctx, extra);
}

let measureCtx = null;
function textBox(it) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = it.size + 'px ' + FONT;
  const lines = String(it.text).split('\n');
  const w = Math.max(...lines.map(l => measureCtx.measureText(l).width), it.size / 2);
  return { x: it.x, y: it.y, w, h: lines.length * it.size * LINE };
}

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - px, y = a[1] + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

function hits(it, x, y, r) {
  if (it.type === 'text') {
    const b = textBox(it);
    return x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r;
  }
  const pts = it.points, reach = r + it.width / 2;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= reach;
  for (let i = 1; i < pts.length; i++) if (distToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  return false;
}

// ── Undo / redo: every change is one op ──
function apply(op, undo) {
  const list = itemsOf(op.page);
  if (op.kind === 'add') {
    if (undo) ink[op.page] = list.filter(it => it.id !== op.item.id);
    else list.push(op.item);
  } else if (op.kind === 'remove') {
    if (undo) {
      for (const { index, item } of [...op.items].sort((a, b) => a.index - b.index)) list.splice(index, 0, item);
    } else {
      const gone = new Set(op.items.map(r => r.item.id));
      ink[op.page] = list.filter(it => !gone.has(it.id));
    }
  } else if (op.kind === 'edit') {
    const i = list.findIndex(it => it.id === op.before.id);
    if (i !== -1) list[i] = undo ? op.before : op.after;
  }
  const p = pages[op.page - 1];
  if (p) drawInk(p);
}
function commit(op) {
  apply(op, false);
  undoStack.push(op);
  redoStack.length = 0;
  updateUndo();
  scheduleSave();
}
function undo() { const op = undoStack.pop(); if (!op) return; apply(op, true); redoStack.push(op); updateUndo(); scheduleSave(); }
function redo() { const op = redoStack.pop(); if (!op) return; apply(op, false); undoStack.push(op); updateUndo(); scheduleSave(); }
function updateUndo() { $('undo-btn').disabled = !undoStack.length; $('redo-btn').disabled = !redoStack.length; }

// ── Pointer ──
let editing = null;   // { p, item (existing or null), x, y, area }

function hookPointer(p) {
  const c = p.inkCanvas;
  let stroke = null, erased = null, pan = null;
  const at = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom]; };
  // Capture keeps a stroke going past the page's edge; a pointer the
  // browser no longer counts as down can't be captured, which is fine.
  const capture = e => { try { c.setPointerCapture(e.pointerId); } catch { /* not down any more */ } };
  c.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    // A finger scrolls; a pen or a mouse writes.
    if (e.pointerType === 'touch') { pan = { x: e.clientX, y: e.clientY, id: e.pointerId }; capture(e); return; }
    const [x, y] = at(e);
    if (state.tool === 'text') { e.preventDefault(); startText(p, x, y); return; }
    if (editing) finishText();
    capture(e);
    if (state.tool === 'eraser') { erased = { before: itemsOf(p.num).slice(), items: [] }; eraseAt(p, x, y, erased); return; }
    const kind = state.tool;
    stroke = { id: newId(), type: kind, color: state.color[kind], width: SIZES[kind][state.size[kind]], points: [[round(x), round(y)]] };
    drawInk(p, stroke);
  });
  c.addEventListener('pointermove', e => {
    if (pan && e.pointerId === pan.id) {
      $('desk').scrollBy(pan.x - e.clientX, pan.y - e.clientY);
      pan.x = e.clientX; pan.y = e.clientY;
      return;
    }
    if (!stroke && !erased) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = at(ev);
      if (erased) { eraseAt(p, x, y, erased); continue; }
      const last = stroke.points[stroke.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) * state.zoom >= 1) stroke.points.push([round(x), round(y)]);
    }
    if (stroke) drawInk(p, stroke);
  });
  const end = () => {
    pan = null;
    if (stroke) { const s = stroke; stroke = null; commit({ kind: 'add', page: p.num, item: s }); }
    if (erased) {
      const items = erased.items; erased = null;
      if (items.length) { undoStack.push({ kind: 'remove', page: p.num, items }); redoStack.length = 0; updateUndo(); scheduleSave(); }
    }
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

function eraseAt(p, x, y, erased) {
  const r = SIZES.eraser[state.size.eraser] / 2;
  const list = itemsOf(p.num);
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (hits(list[i], x, y, r)) {
      // Where it was before this drag began: undo puts them back in that
      // order, so everything ends up stacked the way it was.
      erased.items.push({ index: erased.before.indexOf(list[i]), item: list[i] });
      list.splice(i, 1);
      changed = true;
    }
  }
  if (changed) drawInk(p);
}

// ── Text ──
function startText(p, x, y) {
  if (editing) finishText();
  const list = itemsOf(p.num);
  const existing = [...list].reverse().find(it => it.type === 'text' && hits(it, x, y, 2));
  const size = existing ? existing.size : SIZES.text[state.size.text];
  const color = existing ? existing.color : state.color.text;
  const ax = existing ? existing.x : x, ay = existing ? existing.y : y - size * LINE / 2;
  const area = document.createElement('textarea');
  area.value = existing ? existing.text : '';
  area.spellcheck = true;
  area.style.color = color;
  p.el.appendChild(area);
  editing = { p, item: existing || null, x: ax, y: ay, size, color, area };
  placeText();
  drawInk(p);
  area.addEventListener('input', placeText);
  area.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishText(); }
  });
  area.addEventListener('blur', () => setTimeout(() => { if (editing && editing.area === area) finishText(); }, 0));
  // At once, so the first keys land in it and not on the tool shortcuts,
  // and again after the click is over, in case it took the focus back.
  area.focus();
  setTimeout(() => area.focus(), 0);
}

function placeText() {
  if (!editing) return;
  const { area, x, y, size } = editing;
  const z = state.zoom;
  const box = textBox({ x, y, size, text: area.value || ' ' });
  area.style.left = x * z + 'px';
  area.style.top = y * z + 'px';
  area.style.fontSize = size * z + 'px';
  area.style.width = Math.ceil((box.w + size) * z) + 'px';
  area.style.height = Math.ceil(box.h * z + 2) + 'px';
}

function finishText() {
  if (!editing) return;
  const { p, item, x, y, size, color, area } = editing;
  editing = null;
  area.remove();
  const text = area.value.replace(/\s+$/, '');
  if (!item && text) commit({ kind: 'add', page: p.num, item: { id: newId(), type: 'text', color, size, x: round(x), y: round(y), text } });
  else if (item && !text) {
    const index = itemsOf(p.num).findIndex(it => it.id === item.id);
    commit({ kind: 'remove', page: p.num, items: [{ index, item }] });
  } else if (item && text !== item.text) commit({ kind: 'edit', page: p.num, before: item, after: { ...item, text } });
  else drawInk(p);
}

// ── Saving ──
let dirty = false, saveTimer = null, saving = null;
function status(text, bad) { const s = $('status'); s.textContent = text; s.classList.toggle('bad', !!bad); }
function inkPayload() { return JSON.stringify({ doc: docId, ink: { version: 1, pageCount: pdf ? pdf.numPages : null, pages: ink } }); }
function scheduleSave(quiet) {
  dirty = true;
  if (!quiet) status(L.wsSaving);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (!dirty) return true;
  dirty = false;
  saving = bridge('wsSave', inkPayload());
  const r = await saving;
  saving = null;
  if (r.ok) status(L.wsSaved);
  else { dirty = true; status(L.wsSaveFailed + whyText(r.why), true); }
  return r.ok;
}
// Closing the panel, or quitting: the main page asks for the last save now,
// and closes once it's answered (see closeWorkspace in 08-page.js).
async function flushAndTell() {
  if (editing) finishText();
  if (docId && pdf) await saveNow();
  toParent({ type: 'flushed' });
}
// Leaving for the list, or the frame going away: sent at once, no answer.
window.addEventListener('pagehide', () => {
  if (editing) finishText();
  if (!dirty || !docId) return;
  dirty = false;
  toParent({ type: 'action', id: 'flush', action: 'wsSave', arg: inkPayload() });
});

// ── Export ──
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function buildExport() {
  const { PDFDocument, degrees } = window.PDFLib;
  const out = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
  const outPages = out.getPages();
  for (const p of pages) {
    const items = ink[p.num];
    if (!items || !items.length) continue;
    const vw = p.vp1.width, vh = p.vp1.height;
    const s = Math.min(EXPORT_SCALE, 5000 / Math.max(vw, vh));
    const c = document.createElement('canvas');
    c.width = Math.ceil(vw * s);
    c.height = Math.ceil(vh * s);
    const ctx = c.getContext('2d');
    ctx.setTransform(s, 0, 0, s, 0, 0);
    items.forEach(it => drawItem(ctx, it));
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    const png = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const page = outPages[p.num - 1];
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    // The picture is drawn the way the page is shown; a rotated page shows
    // its own space turned clockwise, so the picture is laid in turned the
    // other way, from the corner that ends up top-left.
    const at = {
      0: [box.x, box.y],
      90: [box.x + box.width, box.y],
      180: [box.x + box.width, box.y + box.height],
      270: [box.x, box.y + box.height],
    }[rot] || [box.x, box.y];
    page.drawImage(png, { x: at[0], y: at[1], width: vw, height: vh, rotate: degrees(rot) });
  }
  return out.save();
}

async function exportPdf() {
  if (editing) finishText();
  await saveNow();
  status(L.wsExporting);
  $('export-btn').disabled = true;
  try {
    const bytes = await buildExport();
    const r = await bridge('wsExport', JSON.stringify({ doc: docId, name: meta.title + L.wsWithNotes + '.pdf', data: toBase64(bytes) }));
    if (r.ok) status(L.wsExported);
    else if (r.cancelled) status(L.wsSaved);
    else status(L.wsExportFailed + whyText(r.why), true);
  } catch (e) {
    status(L.wsExportFailed + (e && e.message || e), true);
  } finally {
    $('export-btn').disabled = false;
  }
}

// ── Toolbar ──
function setTool(tool) {
  if (editing && tool !== 'text') finishText();
  state.tool = tool;
  document.body.dataset.tool = tool;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  const colors = $('colors');
  colors.innerHTML = '';
  for (const col of COLORS[tool] || []) {
    const b = document.createElement('button');
    b.className = 'swatch' + (state.color[tool] === col ? ' on' : '');
    b.style.background = col;
    b.title = col;
    b.onclick = () => { state.color[tool] = col; if (editing && tool === 'text') { editing.color = col; editing.area.style.color = col; } setTool(tool); };
    colors.appendChild(b);
  }
  const sizes = $('sizes');
  sizes.innerHTML = '';
  SIZES[tool].forEach((_, i) => {
    const b = document.createElement('button');
    b.className = 'size' + (state.size[tool] === i ? ' on' : '');
    const dot = [4, 7, 11][i];
    b.innerHTML = '<i style="width:' + dot + 'px;height:' + dot + 'px"></i>';
    b.onclick = () => { state.size[tool] = i; setTool(tool); };
    sizes.appendChild(b);
  });
}

function wireToolbar() {
  document.querySelectorAll('#tools button').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $('undo-btn').onclick = undo;
  $('redo-btn').onclick = redo;
  $('zoom-in').onclick = () => stepZoom(1);
  $('zoom-out').onclick = () => stepZoom(-1);
  $('zoom-fit').onclick = () => fitWidth('width');
  $('export-btn').onclick = exportPdf;
  $('close-btn').onclick = closePanel;
  $('home-btn').onclick = async () => { if (editing) finishText(); await saveNow(); location.search = ''; };
  document.addEventListener('keydown', e => {
    const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); stepZoom(1); return; }
    if (mod && e.key === '-') { e.preventDefault(); stepZoom(-1); return; }
    if (mod && e.key === '0') { e.preventDefault(); fitWidth('width'); return; }
    if (e.key === 'Escape' && !typing) { closePanel(); return; }
    if (mod || typing) return;
    const tool = { p: 'pen', h: 'hl', t: 'text', e: 'eraser' }[e.key.toLowerCase()];
    if (tool) setTool(tool);
  });
  $('desk').addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    // A pinch on a trackpad arrives as a wheel with Ctrl held.
    e.preventDefault();
    setZoom(state.zoom * Math.exp(-e.deltaY / 200), false);
  }, { passive: false });
  setTool('pen');
  updateUndo();
}

// ── The AI sidebar (49-ai-sidebar.js) ──
// This PDF's chat, asked with the page that's most in view. The answer
// shows as it's written: the main page reads it and posts it here.
const ai = { loaded: false, messages: [], asking: null };
const toolWord = name => L['wsAiTool_' + name] || name;

// The page whose middle is nearest the middle of the view.
function currentPage() {
  const desk = $('desk');
  if (!pages.length) return 1;
  const mid = desk.getBoundingClientRect().top + desk.clientHeight / 2;
  let best = pages[0], gap = Infinity;
  for (const p of pages) {
    const r = p.el.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < gap) { gap = d; best = p; }
  }
  return best.num;
}
function showPageNote() { if (!$('ai-side').hidden) $('ai-foot').textContent = L.wsAiPage + ' ' + currentPage(); }

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

async function openAi(show) {
  $('ai-side').hidden = !show;
  $('ai-btn').classList.toggle('on', show);
  try { localStorage.setItem('classdash-ws-ai', show ? '1' : ''); } catch (e) {}
  if (state.fit && pages.length) fitWidth(state.fit);
  if (!show) return;
  showPageNote();
  if (!ai.loaded) {
    ai.loaded = true;
    drawAi();
    const r = await bridge('workspaceChat', docId);
    if (r.ok) {
      ai.messages = r.messages || [];
      $('ai-hints').checked = r.hints !== false;
      if (r.can && !r.can.ok) $('ai-status').textContent = r.can.why;
    } else $('ai-status').textContent = r.why || '';
    drawAi();
  }
  $('ai-q').focus();
}

async function askAi() {
  const field = $('ai-q');
  const question = field.value.trim();
  if (!question || ai.asking) return;
  const page = currentPage();
  const live = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  ai.asking = { live, question, page };
  $('ai-ask').disabled = true; field.disabled = true; $('ai-status').textContent = '';
  drawAi([{ role: 'user', text: question, page }, { role: 'ai', text: L.wsAiThinking, pending: true }]);
  const arg = toBase64(new TextEncoder().encode(JSON.stringify({ doc: docId, page, question, hints: $('ai-hints').checked, live })))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await bridge('workspaceAsk', arg, { live });
  ai.asking = null;
  $('ai-ask').disabled = false; field.disabled = false;
  if (r.ok) {
    ai.messages = r.messages || ai.messages.concat([{ role: 'user', text: question, page }, { role: 'ai', text: r.answer }]);
    field.value = '';
    drawAi();
  } else {
    drawAi([{ role: 'user', text: question, page }]);
    $('ai-status').textContent = L.wsAiFailed + ' ' + (r.why || '');
  }
  field.focus();
}

function showLive(live) {
  if (!ai.asking || live.id !== ai.asking.live) return;
  const text = live.text || (live.using ? L.wsAiUsing + ' ' + toolWord(live.using) + '…' : L.wsAiThinking);
  drawAi([{ role: 'user', text: ai.asking.question, page: ai.asking.page }, { role: 'ai', live: true, pending: !live.text, thinking: live.thinking, text }]);
}

function wireAi() {
  $('ai-btn').onclick = () => openAi($('ai-side').hidden);
  $('ai-hide').onclick = () => openAi(false);
  $('ai-ask').onclick = askAi;
  $('ai-q').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askAi(); }
  });
  $('ai-clear').onclick = async () => {
    if (ai.asking) return;
    ai.messages = [];
    drawAi();
    $('ai-status').textContent = '';
    await bridge('workspaceChatClear', docId);
  };
  $('ai-hints').onchange = () => bridge('workspaceChatHints', docId + ':' + ($('ai-hints').checked ? '1' : '0'));
  $('desk').addEventListener('scroll', () => { clearTimeout(wireAi.t); wireAi.t = setTimeout(showPageNote, 150); });
  wireAiGrip();
  let open = false;
  try { open = localStorage.getItem('classdash-ws-ai') === '1'; } catch (e) {}
  if (open) openAi(true);
}

// Its left edge drags it wider or narrower, kept for next time. The PDF
// refits once, when the drag ends, not on every move.
function setAiWidth(px) {
  const w = Math.round(Math.max(260, Math.min(px, window.innerWidth - 320)));
  document.documentElement.style.setProperty('--ai-width', w + 'px');
  return w;
}
function wireAiGrip() {
  try { const saved = Number(localStorage.getItem('classdash-ws-ai-width')); if (saved) setAiWidth(saved); } catch (e) {}
  const grip = $('ai-grip');
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    grip.classList.add('dragging');
    const move = ev => setAiWidth(window.innerWidth - ev.clientX);
    const up = ev => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.classList.remove('dragging');
      const w = setAiWidth(window.innerWidth - ev.clientX);
      try { localStorage.setItem('classdash-ws-ai-width', String(w)); } catch (err) {}
      if (state.fit && pages.length) fitWidth(state.fit);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}

if (docId && /^[a-f0-9]{16}$/.test(docId)) { wireToolbar(); wireAi(); openDoc(); }
else showHome();
`;

module.exports = { DIR, PAGE, isId, importPdf, listDocs, removeDoc, writeWorkspacePage, pageHtml };
