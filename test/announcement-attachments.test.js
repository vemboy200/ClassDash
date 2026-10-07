// Announcement attachments (12-feed.js, 39-announcement-photos.js, the
// page): attachments read off a made-up Classroom stream and taken out of
// the text, image previews downloaded once through the signed-in browser,
// kept only for each class's newest posts, and shown on the page as
// pictures that open whole, with chips for the rest. The stream's markup
// copies the shape a structure-only look at real Classroom found
// (data-attachment-id blocks, "Attachment: <kind>: <title>" labels, Drive
// previews on lh3.googleusercontent.com/drive-storage).
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en' } });
process.chdir(proj);
const photos = require(path.join(proj, '39-announcement-photos.js'));
const { collectFeed } = require(path.join(proj, '12-feed.js'));
const { JSDOM, VirtualConsole } = T.jsdom();

const ICON = k => `https://ssl.gstatic.com/docs/doclist/images/mediatype/${k}_x16.png`;
const attachment = (id, kind, title, href, icon, preview) => `
  <div data-attachment-id="${id}"><div><a href="${href}" aria-label="Attachment: ${kind}: ${title}"><img src="${icon}"></a></div>
    <div>${title}</div><div>${kind}</div></div>
  ${preview ? `<div><a href="${href}"><img src="${preview}"></a></div>` : ''}`;
const post = (id, text, atts = '') => `<div data-stream-item-id="${id}">
  <div>Post by Made-up Teacher</div><div>Made-up Teacher</div><div>Created Oct 5</div><div>Oct 5</div>
  ${text.split('\n').map(l => `<div>${l}</div>`).join('')}
  ${atts}
  <div>Add class comment</div></div>`;
const drive = id => `https://drive.google.com/file/d/${id}/view?usp=drive_web`;
const preview = id => `https://lh3.googleusercontent.com/drive-storage/${id}=h360`;

// A browser page that's really jsdom, with a stand-in innerText: jsdom has
// none, and the feed reads lines the way a browser breaks them, at blocks.
function fakePage(html, request) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only', url: 'https://classroom.google.com/u/0/c/1', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() {
    const out = [];
    const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) out.push(c.textContent); else if (c.nodeType === 1) { const block = /^(DIV|P|LI|BR)$/.test(c.tagName); if (block) out.push('\n'); walk(c); if (block) out.push('\n'); } } };
    walk(this); return out.join('');
  } });
  return {
    goto: async () => {}, url: () => 'https://classroom.google.com/u/0/c/1', waitForSelector: async () => {}, waitForTimeout: async () => {},
    evaluate: async (fn, arg) => w.eval(`(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`),
    context: () => ({ request }),
  };
}
const asked = [];
const request = { get: async (url) => { asked.push(url); return { ok: () => true, headers: () => ({ 'content-type': 'image/jpeg' }), body: async () => Buffer.from('made-up jpeg ' + url) }; } };

(async () => {
  // ── reading attachments ──
  const stream = [
    post('p1', 'Here is the board from today.\nCopy it into your notes.',
      attachment('a1', 'Image', 'board.jpg', drive('fileAAAAAAAAAAAA1'), ICON('icon_1_image'), preview('prevAAAAAAAAAAAAAAAA1')) +
      attachment('a2', 'PDF', 'Worksheet 4.pdf', drive('fileBBBBBBBBBBBB2'), ICON('icon_3_pdf'))),
    post('p0', 'First period left this behind.', `<div data-parent-id="x"><div><a href="${drive('fileBIGBIGBIGBIG0')}" aria-label="Attachment: Oct 1 at 10.21 AM.jpg" target="_blank"><div><img src="${preview('prevBIGBIGBIGBIGBIGB0')}"></div><div>Oct 1 at 10.21 AM.jpg</div></a></div></div>`),
    post('p2', 'Sign up here', attachment('a3', 'Google Forms', 'Field trip form', 'https://docs.google.com/forms/d/e/x/viewform', 'https://www.gstatic.com/x/192px.svg')),
    post('p3', 'A link only', attachment('a4', 'Made-up Site', 'Made-up site', 'https://example.com/page', 'https://classroom.google.com/webthumbnail?url=x')
      .replace('<div>Made-up Site</div></div>', '<div>https://example.com/page</div></div>').replace('Attachment: Made-up Site: Made-up site', 'Attachment: Link: Made-up site')),
    ...Array.from({ length: 11 }, (_, i) => post(`q${i}`, `Older post ${i}`,
      attachment(`b${i}`, 'Image', `photo ${i}.png`, drive(`fileQQQQQQQQQQQQ${i}`), ICON('icon_1_image'), preview(`prevQQQQQQQQQQQQQQQQ${i}`)))),
  ].join('\n');
  const posts = await collectFeed(fakePage(stream, request), { id: '1', name: 'Made-up Bio' });
  const p1 = posts.find(p => p.id === 'post-p1');
  ok('attachments are read with their kind, title and link', JSON.stringify(p1.attachments.map(a => [a.kind, a.title])) === '[["image","board.jpg"],["pdf","Worksheet 4.pdf"]]' && p1.attachments[1].link === drive('fileBBBBBBBBBBBB2'), JSON.stringify(p1.attachments));
  ok('...and taken out of the text', p1.text === 'Here is the board from today.\nCopy it into your notes.', JSON.stringify(p1.text));
  const p0 = posts.find(p => p.id === 'post-p0');
  ok('a photo shown big, outside an attachment block, is read too', JSON.stringify(p0.attachments.map(a => [a.kind, a.title])) === '[["image","Oct 1 at 10.21 AM.jpg"]]' && p0.text === 'First period left this behind.', JSON.stringify(p0));
  ok('...and gets its photo', photos.PHOTO_PATH.test(p0.attachments[0].photo || '') && asked.includes('https://lh3.googleusercontent.com/drive-storage/prevBIGBIGBIGBIGBIGB0=w1600'));
  ok('forms and plain links too', posts.find(p => p.id === 'post-p2').attachments[0].kind === 'form' && posts.find(p => p.id === 'post-p3').attachments[0].kind === 'link');
  ok('an image\'s preview is downloaded at 1600 px wide, through the signed-in browser', asked[0] === 'https://lh3.googleusercontent.com/drive-storage/prevAAAAAAAAAAAAAAAA1=w1600');
  ok('...saved in the photos folder, and the post points at it', photos.PHOTO_PATH.test(p1.attachments[0].photo) && fs.existsSync(path.join(proj, p1.attachments[0].photo)));
  ok('...and the preview address isn\'t kept', !JSON.stringify(posts).includes('drive-storage'));
  ok('a PDF gets no photo', !p1.attachments[1].photo);
  const got = posts.filter(p => p.attachments.some(a => a.photo)).map(p => p.id);
  ok(`only each class's newest ${photos.DOWNLOAD_PER_CLASS} posts get photos`, got.length === photos.DOWNLOAD_PER_CLASS - 4 + 2 && !got.includes('post-q10') && asked.length === got.length, JSON.stringify(got));

  asked.length = 0;
  const again = await collectFeed(fakePage(stream, request), { id: '1', name: 'Made-up Bio' });
  ok('the next check uses the saved file, nothing downloaded again', asked.length === 0 && again.find(p => p.id === 'post-p1').attachments[0].photo === p1.attachments[0].photo);

  const failing = { get: async () => ({ ok: () => false, headers: () => ({}), body: async () => Buffer.alloc(0) }) };
  const html = post('r1', 'New photo', attachment('c1', 'Image', 'new.jpg', drive('fileNNNNNNNNNNNN1'), ICON('icon_1_image'), preview('prevNNNNNNNNNNNNNNNN1')));
  const failed = await collectFeed(fakePage(html, failing), { id: '1', name: 'Made-up Bio' });
  ok('a download that fails: the attachment is still there, without a photo', failed[0].attachments.length === 1 && !failed[0].attachments[0].photo);

  // ── keeping only the newest ──
  {
    const all = posts.map((p, i) => ({ ...p, sortTime: 1e12 - i }));
    const other = { id: 'post-z', class: 'Made-up Math', sortTime: 1, attachments: [{ kind: 'image', photo: p1.attachments[0].photo }] };
    fs.writeFileSync(path.join(photos.DIR, 'ffffffffffffffffffff.png'), 'stray');
    const keptBefore = all.filter(p => p.attachments.some(a => a.photo)).length;
    const deleted = photos.prune([...all, other]);
    ok('files nothing points at are deleted', deleted === 1 && !fs.existsSync(path.join(photos.DIR, 'ffffffffffffffffffff.png')), String(deleted));
    ok('...a photo still in use isn\'t', fs.existsSync(path.join(proj, p1.attachments[0].photo)) && keptBefore === all.filter(p => p.attachments.some(a => a.photo)).length);
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, class: 'Made-up Art', sortTime: 100 - i, attachments: [{ kind: 'image', photo: `${photos.DIR_NAME}/${String(i).padStart(20, 'a')}.jpg` }] }));
    for (const m of many) fs.writeFileSync(path.join(proj, m.attachments[0].photo), 'x');
    photos.prune(many);
    ok(`each class keeps its newest ${photos.KEEP_PER_CLASS} posts' photos; older ones lose theirs`, many.filter(m => m.attachments[0].photo).length === photos.KEEP_PER_CLASS && !many[14].attachments[0].photo && !fs.existsSync(path.join(photos.DIR, `${String(14).padStart(20, 'a')}.jpg`)));
  }

  // ── the page ──
  {
    const page = T.makeProject({
      'settings.json': { language: 'en' },
      'messages.json': [
        { platform: 'Classroom', type: 'announcement', class: 'Made-up Bio', id: 'post-1', author: 'Made-up Teacher', date: 'Oct 5', title: 'Board', text: 'Here is the board.', link: 'https://classroom.example/1', sortTime: Date.now(),
          attachments: [
            { kind: 'image', title: 'board.jpg', link: drive('fileAAAAAAAAAAAA1'), photo: `${photos.DIR_NAME}/aaaaaaaaaaaaaaaaaaaa.jpg` },
            { kind: 'pdf', title: 'Worksheet 4.pdf', link: drive('fileBBBBBBBBBBBB2') },
            { kind: 'image', title: 'not downloaded.jpg', link: drive('fileCCCCCCCCCCCC3') },
            { kind: 'image', title: 'sneaky', link: 'javascript:alert(1)', photo: '../../etc/x.jpg' },
          ] },
        { platform: 'Classroom', type: 'announcement', class: 'Made-up Bio', id: 'post-2', author: 'Made-up Teacher', date: 'Oct 4', title: 'Old', text: 'Older, from before attachments were read.', link: 'https://classroom.example/2', sortTime: Date.now() - 864e5 },
      ],
    });
    T.redraw(page);
    const dom = new JSDOM(fs.readFileSync(path.join(page, 'summary.html'), 'utf8'), {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.setTimeout = () => 0; },
    });
    const w = dom.window, d = w.document;
    const pics = [...d.querySelectorAll('.post-photo img')];
    ok('a saved photo shows on its announcement', pics.length === 1 && pics[0].getAttribute('src') === `${photos.DIR_NAME}/aaaaaaaaaaaaaaaaaaaa.jpg` && pics[0].alt === 'board.jpg');
    const chips = [...d.querySelectorAll('.att-chip')].map(a => [a.querySelector('.att-kind').textContent, a.getAttribute('href')]);
    ok('the rest are chips that open them, an image not downloaded among them', JSON.stringify(chips.map(c => c[0])) === '["PDF","Photo"]' && chips[0][1] === drive('fileBBBBBBBBBBBB2'), JSON.stringify(chips));
    ok('a photo path outside the folder and a non-web link are left out', !d.body.innerHTML.includes('etc/x.jpg') && !d.body.innerHTML.includes('javascript:alert'));
    ok('an announcement without attachments looks as before', !d.querySelectorAll('.post')[1].querySelector('.post-attachments'));
    const viewer = d.getElementById('photo-viewer');
    ok('the viewer starts closed', viewer.hidden);
    d.querySelector('.post-photo').click();
    ok('clicking the picture opens it whole, with a link to it in Drive', !viewer.hidden && viewer.querySelector('img').getAttribute('src') === pics[0].getAttribute('src') && d.getElementById('photo-viewer-link').getAttribute('href') === drive('fileAAAAAAAAAAAA1'));
    let reached = false;
    d.addEventListener('keydown', () => { reached = true; });
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '1', bubbles: true }));
    ok('...the filter keys don\'t act on the page behind it', !reached);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('...and Escape closes it', viewer.hidden && !viewer.querySelector('img').getAttribute('src'));
    d.querySelector('.post-photo').click();
    viewer.click();
    ok('...so does a click beside the photo', viewer.hidden);
    w.close();
  }
})();
