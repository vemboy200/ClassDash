/**
 * For other devices, the page's styling and main script are sent as their own
 * files, named after what's in them, so a browser can keep them and only fetch
 * the part of the page that changes. summary.html itself stays one whole file:
 * it's what the apps fall back to when they can't reach the server, and what
 * this computer is still sent.
 *
 * Anything in the main script that changes between redraws would give it a new
 * name every time, so those values sit in the small inline script before it
 * (writePage in 08-page.js). A browser that can't load one of these files asks
 * for the whole page instead.
 */
const crypto = require('crypto');

const STYLE_OPEN = '<style>', STYLE_CLOSE = '</style>';
const SCRIPT_OPEN = '<script id="page-main">', SCRIPT_CLOSE = '</script>';
const MOST_KEPT = 8;   // a page still open from before asks for its own files
const kept = new Map();
const recent = [];

function keep(type, extension, text) {
  const name = `/assets/page-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}.${extension}`;
  kept.delete(name);
  kept.set(name, { type, body: Buffer.from(text, 'utf8') });
  while (kept.size > MOST_KEPT) kept.delete(kept.keys().next().value);
  return name;
}

/** The page with its styling and main script replaced by links to their files.
 *  A page without them (nothing to split) comes back as it is. */
function splitPage(page) {
  const known = recent.find(r => r.page.equals(page));
  if (known && known.names.every(n => kept.has(n))) return known.html;

  const text = page.toString('utf8');
  const styleAt = text.indexOf(STYLE_OPEN);
  const styleEnd = text.indexOf(STYLE_CLOSE, styleAt);
  const scriptAt = text.lastIndexOf(SCRIPT_OPEN);
  const scriptEnd = text.indexOf(SCRIPT_CLOSE, scriptAt);
  if (styleAt < 0 || styleEnd < 0 || scriptAt < 0 || scriptEnd < 0 || scriptAt < styleEnd) return page;

  const css = keep('text/css; charset=utf-8', 'css', text.slice(styleAt + STYLE_OPEN.length, styleEnd));
  const js = keep('text/javascript; charset=utf-8', 'js', text.slice(scriptAt + SCRIPT_OPEN.length, scriptEnd));
  const whole = `onerror="location.replace(location.pathname + '?whole=1')"`;
  const html = Buffer.from(
    text.slice(0, styleAt) +
    `<link rel="stylesheet" href="${css}" ${whole}>` +
    text.slice(styleEnd + STYLE_CLOSE.length, scriptAt) +
    `<script src="${js}" ${whole}></script>` +
    text.slice(scriptEnd + SCRIPT_CLOSE.length), 'utf8');

  recent.unshift({ page, html, names: [css, js] });
  recent.length = Math.min(recent.length, 2);
  return html;
}

/** One of those files, or undefined when it isn't (or is no longer) known. */
function pageAsset(urlPath) {
  return kept.get(urlPath);
}

module.exports = { splitPage, pageAsset };
