/**
 * Photos attached to announcements. Classroom shows an image attachment as
 * a Drive file with a preview, and that preview only loads signed in (an
 * anonymous request gets 403), so the page, which isn't signed in, can't
 * show it straight from Google. The collector downloads it during a check,
 * through the signed-in browser, into announcement-photos/, once.
 *
 * One size, 1600 px wide, as a JPEG at 80% quality ("-rj-l80" asks Google
 * for that): the card shows it small and a click shows it whole, from the
 * same file. Tried on real previews, that's about 40% smaller than what
 * Google sends by default (some of it PNG), with no difference to see.
 *
 * ── How many are kept ──
 *
 * The announcementPhotos setting (Settings → Display, 0–100, default 10):
 * downloaded for each class's newest that-many announcements, kept for
 * two more. Keeping a little more than is downloaded means a post at the
 * edge isn't deleted on one check and downloaded again on the next.
 * Anything else in the folder is deleted; 0 deletes them all.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./00-project-root.js');

const DIR_NAME = 'announcement-photos';
const DIR = path.join(PROJECT_ROOT, DIR_NAME);
const DEFAULT_PER_CLASS = 10;
const KEEP_EXTRA = 2;
const MAX_PER_POST = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const WIDTH = 1600;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const EXTS = Object.values(TYPES);

/** What the page may load: a file in that folder, named the way it names them. */
const PHOTO_PATH = new RegExp(`^${DIR_NAME}/[0-9a-f]{20}\\.(${EXTS.join('|')})$`);

/** The announcementPhotos setting, 0–100. */
function perClass() {
  try {
    const n = require('./19-settings.js').read().announcementPhotos;
    return Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULT_PER_CLASS;
  } catch { return DEFAULT_PER_CLASS; }
}

const baseName = fileId => crypto.createHash('sha1').update(String(fileId)).digest('hex').slice(0, 20);

function existing(fileId) {
  const base = baseName(fileId);
  for (const ext of EXTS) {
    if (fs.existsSync(path.join(DIR, `${base}.${ext}`))) return `${DIR_NAME}/${base}.${ext}`;
  }
  return null;
}

/** The preview address at WIDTH as a JPEG: Google's image addresses end in "=<options>". */
function sized(url) {
  const options = `=w${WIDTH}-rj-l80`;
  return /=[^/=]*$/.test(url) ? url.replace(/=[^/=]*$/, options) : `${url}${options}`;
}

/**
 * Sets `photo` on the image attachments of a class's newest posts, from
 * the folder or downloaded with `request` (the signed-in browser's
 * page.context().request). `posts` is one class's stream, newest first,
 * as read. The preview address is dropped either way: it's only good for
 * this download, and nothing else needs it.
 */
async function fetchFor(posts, request, limit = perClass()) {
  let downloaded = 0;
  for (const [i, post] of posts.entries()) {
    let tried = 0;
    for (const att of post.attachments || []) {
      const preview = att.preview;
      delete att.preview;
      if (att.kind !== 'image' || !att.fileId || i >= limit || tried >= MAX_PER_POST) continue;
      tried++;
      att.photo = existing(att.fileId);
      if (att.photo || !preview || !request) continue;
      try {
        const res = await request.get(sized(preview), { timeout: 20000 });
        const ext = TYPES[String(res.headers()['content-type'] || '').split(';')[0].trim()];
        if (!res.ok() || !ext) continue;
        const body = await res.body();
        if (!body.length || body.length > MAX_BYTES) continue;
        fs.mkdirSync(DIR, { recursive: true });
        const name = `${baseName(att.fileId)}.${ext}`;
        fs.writeFileSync(path.join(DIR, name), body);
        att.photo = `${DIR_NAME}/${name}`;
        downloaded++;
      } catch { /* no photo this time; the attachment still shows */ }
    }
  }
  return downloaded;
}

/**
 * Before announcements are written: drops `photo` from posts past each
 * class's newest limit + KEEP_EXTRA (by sortTime; with 0, from all) and deletes every file in
 * the folder no post points at any more. Returns how many were deleted.
 */
function prune(posts, limit = perClass()) {
  const keepPerClass = limit > 0 ? limit + KEEP_EXTRA : 0;
  const byClass = new Map();
  for (const p of posts) {
    if (!byClass.has(p.class)) byClass.set(p.class, []);
    byClass.get(p.class).push(p);
  }
  const keep = new Set();
  for (const list of byClass.values()) {
    list.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
    list.forEach((p, i) => {
      for (const att of p.attachments || []) {
        if (!att.photo) continue;
        if (i < keepPerClass && PHOTO_PATH.test(att.photo)) keep.add(path.basename(att.photo));
        else delete att.photo;
      }
    });
  }
  let deleted = 0;
  let files = [];
  try { files = fs.readdirSync(DIR); } catch { return 0; }
  for (const f of files) {
    if (keep.has(f)) continue;
    try { fs.unlinkSync(path.join(DIR, f)); deleted++; } catch { /* next time */ }
  }
  return deleted;
}

/**
 * Right after the setting changes, rather than at the next check: prunes
 * the saved announcements with the new number and writes them back, so
 * lowering it (or 0) clears the photos at once. Raising it downloads more
 * at the next check.
 */
function pruneSaved(limit = perClass()) {
  const file = path.join(PROJECT_ROOT, 'messages.json');
  let posts;
  try { posts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  if (!Array.isArray(posts)) return 0;
  const deleted = prune(posts, limit);
  fs.writeFileSync(file, JSON.stringify(posts, null, 2));
  return deleted;
}

module.exports = { DIR, DIR_NAME, PHOTO_PATH, DEFAULT_PER_CLASS, KEEP_EXTRA, MAX_PER_POST, perClass, existing, sized, fetchFor, prune, pruneSaved };
