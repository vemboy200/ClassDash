/**
 * Collects announcements from the Google Classroom stream tab.
 *
 * ── Why separate from assignments ──
 *
 * In the stream, teachers write things that aren't assignments: "the quiz
 * is moved", "bring your notebooks", "deadline extended". These posts have
 * no due date, but freshness matters.
 *
 * ── The main difficulty: the stream duplicates assignments ──
 *
 * Classroom itself posts every new assignment and material into the
 * stream. Taking everything as-is would turn the stream into a copy of
 * the assignment list: each one showing up twice, zero benefit, twice the
 * noise. The user noticed this before the code was even written.
 *
 * A clear signal was found — the FIRST LINE of the post:
 *
 *   Post by Kristine Lowe | Created Jun 4 | ...text...        ← real
 *   book | Material: "LA County Youth@Work" | ... posted a
 *          new material: ...                                  ← automatic
 *
 * Checked against the start of the first line specifically, not a
 * substring match anywhere: a teacher could easily write an announcement
 * containing the words "posted a new assignment", and that shouldn't be
 * lost.
 */

/**
 * @param page  browser page
 * @param cls   the class's {id, name}
 * @param U     account index in the multi-login
 */
async function collectFeed(page, cls, U = 0) {
  const url = `https://classroom.google.com/u/${U}/c/${cls.id}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('accounts.google.com')) {
    throw new Error('cookies expired, need to sign in again');
  }

  try {
    await page.waitForSelector('[data-stream-item-id]', { timeout: 45000 });
  } catch {
    return [];   // empty stream — that's normal
  }

  // Wait until the stream stops growing: same trap as with the assignment
  // list — Classroom renders posts in gradually.
  let previous = -1, stable = 0;
  for (let i = 0; i < 30; i++) {
    const current = await page.evaluate(
      () => document.querySelectorAll('[data-stream-item-id]').length);
    if (current === previous) { if (++stable >= 3) break; } else stable = 0;
    previous = current;
    await page.waitForTimeout(500);
  }

  const posts = await page.evaluate(({ className, classId, authuser }) => {
    // Only take the outer nodes: the attribute is also present on nested ones.
    const nodes = [...document.querySelectorAll('[data-stream-item-id]')]
      .filter(e => !e.parentElement.closest('[data-stream-item-id]'));

    // Interface chrome labels. "Add a comment" is a button under every
    // post, and it was ending up in the announcement text twice in a row.
    const junk = ['more_vert', 'More options', 'book', 'assignment',
                   'assignment_ind', 'help_outline', 'campaign',
                   'Add a comment', 'Add class comment', 'Add comment',
                   'send', 'Post', 'Cancel', 'Save', 'Delete'];

    return nodes.map(el => {
      const lines = (el.innerText || '')
        .split('\n').map(s => s.trim()).filter(Boolean)
        .filter(s => !junk.includes(s));

      if (!lines.length) return null;

      // THIS IS WHERE ASSIGNMENT DUPLICATES GET FILTERED OUT.
      // A real announcement starts with "Post by <name>".
      if (!/^Post by\s+/i.test(lines[0])) return null;

      const author = lines[0].replace(/^Post by\s+/i, '').trim();

      // Next comes the author's name again and the date in two forms
      // ("Created Jun 4" and "Jun 4"). Those get dropped, the rest is text.
      const date = lines.find(s => /^Created\s/i.test(s)) || null;
      const body = lines.slice(1).filter(s =>
        s !== author &&
        !/^Created\s/i.test(s) &&
        !/^[A-Z][a-z]{2}\s+\d{1,2}(\s|$)/.test(s) &&
        !/^\(Edited/i.test(s)
      );

      // Attachments: a block each, marked data-attachment-id, whose text is
      // its title and then its kind ("Image", "PDF", "Google Docs") or its
      // address. Those lines are taken out of the text and kept as
      // attachments instead. The aria-label says the same, as
      // "Attachment: <kind>: <title>".
      const attachments = [], attachmentLines = new Set(), seen = new Set();
      for (const att of el.querySelectorAll('[data-attachment-id]')) {
        const key = att.getAttribute('data-attachment-id');
        const a = att.querySelector('a[href]');
        if (!a || seen.has(key) || !/^https?:/.test(a.href)) continue;
        seen.add(key);
        const own = (att.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        own.forEach(s => attachmentLines.add(s));
        const parts = (a.getAttribute('aria-label') || '').split(':').map(s => s.trim());
        const label = parts[0] === 'Attachment' && parts.length >= 3 ? parts[1] : (own[1] || '');
        const icon = (att.querySelector('img') || {}).src || '';
        const kind = label === 'Image' || /mediatype\/icon_\d+_image/.test(icon) ? 'image'
          : label === 'PDF' || /_pdf_/.test(icon) ? 'pdf'
          : label === 'Google Docs' || label === 'Word' || /_word_/.test(icon) ? 'doc'
          : label === 'Google Slides' || label === 'PowerPoint' || /_powerpoint_/.test(icon) ? 'slides'
          : label === 'Google Sheets' || label === 'Excel' || /_excel_/.test(icon) ? 'sheet'
          : label === 'Google Forms' ? 'form'
          : /video/i.test(label) ? 'video'
          : /^https?:/.test(own[1] || '') ? 'link' : 'file';
        const fileId = (a.href.match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1] || null;
        // The preview, for an image: any Drive preview in the post that
        // links to the same file (Classroom shows some bigger than others).
        let preview = null;
        if (kind === 'image' && fileId) {
          const img = [...el.querySelectorAll('img[src*="drive-storage"]')]
            .find(i => { const l = i.closest('a[href]'); return l && l.href.includes(fileId); });
          preview = img ? img.src : null;
        }
        attachments.push({ kind, title: (own[0] || parts.slice(2).join(':') || a.href).slice(0, 200), link: a.href, fileId, preview });
      }
      // Photos are laid out differently: no block, just a link to the Drive
      // file labeled "Attachment: <file name>" around a big preview, with
      // the file name as its only text.
      for (const a of el.querySelectorAll('a[href*="drive.google.com/file/d/"]')) {
        if (a.closest('[data-attachment-id]')) continue;
        const img = a.querySelector('img[src*="drive-storage"]');
        const fileId = (a.href.match(/\/d\/([A-Za-z0-9_-]{10,})/) || [])[1];
        if (!img || !fileId || attachments.some(x => x.fileId === fileId)) continue;
        const own = (a.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        own.forEach(s => attachmentLines.add(s));
        const label = (a.getAttribute('aria-label') || '').replace(/^Attachment:\s*/, '').trim();
        attachments.push({ kind: 'image', title: (own[0] || label || 'Photo').slice(0, 200), link: a.href, fileId, preview: img.src });
      }

      const id = el.getAttribute('data-stream-item-id');
      const text = body.filter(s => !attachmentLines.has(s));

      return {
        platform: 'Classroom',
        type: 'announcement',
        class: className,
        id: `post-${id}`,
        author,
        date: date ? date.replace(/^Created\s+/i, '') : null,
        // The first line of the body is usually the announcement's title.
        title: text[0] || (attachments[0] && attachments[0].title) || 'Announcement',
        text: text.join('\n'),
        attachments,
        // Link to the class's MAIN page — that's where the stream lives.
        //
        // This used to point at the specific post (/sp/<id>/all/default),
        // but the user checked: that address dumps you into Classwork and
        // loads forever. The main page opens instantly and shows the
        // whole stream — the post you want is at the top if it's recent.
        link: `https://classroom.google.com/c/${classId}` +
              `?authuser=${encodeURIComponent(authuser)}`,
      };
    }).filter(Boolean);
  }, { className: cls.name, classId: cls.id, authuser: FEED_AUTHOR_EMAIL });

  // Photos: downloaded through this signed-in page, since Google won't
  // hand the preview to the summary page (see 39-announcement-photos.js).
  try {
    await require('./39-announcement-photos.js').fetchFor(posts, page.context().request);
  } catch (e) {
    for (const p of posts) for (const att of p.attachments) delete att.preview;
  }
  return posts;
}

// Set from the main script on first call.
let FEED_AUTHOR_EMAIL = '';
function setFeedEmail(email) { FEED_AUTHOR_EMAIL = email; }

module.exports = { collectFeed, setFeedEmail };
