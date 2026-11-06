// The dashboard from the API: the served page holds no schoolwork, /api/dashboard
// does, a page's stream sends only what changed, and a program's stream is as it
// was. Against a real server, with made-up classes.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https'), cp = require('child_process');
const day = 86400000;
const item = (id, title, days) => ({ platform: 'Canvas', class: 'Made-up Biology', id, type: 'Assignment', title, link: `https://canvas.demo.test/${id}`, due_iso: new Date(Date.now() + days * day).toISOString(), due: null, posted: new Date().toISOString() });
const proj = T.makeProject({
  'settings.json': { language: 'en', classroomEnabled: true },
  'last-collection.json': [item('a1', 'Worksheet about cells', 1), item('a2', 'Essay about frogs', 20), item('o1', 'Late lab report', -2)],
  'messages.json': [{ id: 'p1', class: 'Made-up Biology', author: 'Made-up Teacher', date: 'Nov 1', text: 'Bring a notebook', link: 'https://classroom.demo.test/p1' }],
});
process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  T.redraw(proj);
  const shell = fs.readFileSync('page-shell.html', 'utf8');
  const whole = fs.readFileSync('summary.html', 'utf8');
  ok('the copy on disk has the schoolwork', ['Worksheet about cells', 'Bring a notebook'].every(t => whole.includes(t)));
  ok('the served page has none of it', !['Worksheet about cells', 'Essay about frogs', 'Bring a notebook'].some(t => shell.includes(t)));
  ok('...and is much smaller for it', shell.length < whole.length);
  ok('it has the shape of the cards to show while waiting', /class="dash-skeleton/.test(shell));
  ok('the copy on disk doesn\'t need that', !/class="dash-skeleton/.test(whole));

  const hash = () => /var SHELL_HASH = "([0-9a-f]+)"/.exec(fs.readFileSync('page-shell.html', 'utf8'))[1];
  const h1 = hash();
  const items = JSON.parse(fs.readFileSync('last-collection.json', 'utf8'));
  fs.writeFileSync('last-collection.json', JSON.stringify([...items, item('a3', 'Quiz about moss', 3)]));
  T.redraw(proj);
  ok('new schoolwork does not change the page itself', hash() === h1);
  // The timestamps every check leaves: a real page reloaded after each check over these.
  const stamp = new Date(Date.now() + 3600e3).toISOString();
  fs.writeFileSync('check-status.json', JSON.stringify({ canvas: { status: 'ok', at: stamp }, classroom: { status: 'ok', at: stamp } }));
  T.redraw(proj);
  ok('nor does a check saying when it ran', hash() === h1);
  fs.writeFileSync('last-collection.json', JSON.stringify(items));
  T.redraw(proj);

  const port = 19600 + Math.floor(Math.random() * 300);
  const srv = cp.spawn('node', ['17-api.js', '--port', String(port)], { cwd: proj, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} });
  let token = ''; for (let i = 0; i < 60 && !token; i++) { await sleep(150); try { token = fs.readFileSync('api-token.txt', 'utf8').trim(); } catch {} }
  const auth = { Authorization: `Bearer ${token}` };
  const request = (urlPath, headers = {}) => new Promise((resolve) => {
    https.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers }, (res) => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    }).on('error', e => resolve({ error: e.message }));
  });
  // Collects a stream's events until it's closed.
  const stream = (urlPath) => {
    const events = [];
    let close = () => {};
    https.get({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers: auth }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      close = () => res.destroy();
      res.on('data', (c) => {
        buffer += c;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (name) events.push({ name: name[1], data: JSON.parse(data[1]), size: block.length });
        }
      });
    }).on('error', () => {});
    return { events, close: () => close() };
  };

  const first = await request('/api/dashboard', auth);
  const { rev, shell: shellNow, view } = JSON.parse(first.body);
  ok('/api/dashboard answers', first.status === 200 && !!rev);
  ok('...with the page\'s hash', shellNow === h1);
  ok('...and the cards, by section', view.lists.dueSoon.some(x => x.id === 'a1') && view.lists.ahead.some(x => x.id === 'a2') && view.lists.announcements[0].id === 'p1');
  ok('...as it stands, asked twice', JSON.parse((await request('/api/dashboard', auth)).body).rev === rev);

  const page = stream('/api/stream?view=dashboard');
  const program = stream('/api/stream');
  for (let i = 0; i < 40 && (!page.events.length || !program.events.length); i++) await sleep(100);
  ok('a page\'s stream starts by saying where things are', page.events[0] && page.events[0].name === 'dash' && page.events[0].data.rev === rev && !page.events[0].data.lists);
  ok('a program\'s stream starts with the whole snapshot, as ever', program.events[0] && program.events[0].name === 'update' && !!program.events[0].data.status);

  const before = page.events.length, programBefore = program.events.length;
  fs.writeFileSync('last-collection.json', JSON.stringify([...items, item('a3', 'Quiz about moss', 3)]));
  T.redraw(proj);
  for (let i = 0; i < 60 && (page.events.length === before || program.events.length === programBefore); i++) await sleep(100);
  const change = page.events.slice(before).find(e => e.name === 'dash');
  ok('a new assignment reaches the page', !!change && change.data.from === rev && change.data.rev !== rev);
  const set = change ? change.data.lists.dueSoon.set : [];
  ok('...as only that assignment', set.length === 1 && set[0].id === 'a3', JSON.stringify(set).slice(0, 200));
  ok('...in its place', change && change.data.lists.dueSoon.order.includes('a3'));
  ok('...and no other list is sent', change && !change.data.lists.announcements && !change.data.lists.ahead, JSON.stringify(Object.keys((change || { data: { lists: {} } }).data.lists)));
  const program2 = program.events.slice(programBefore).find(e => e.name === 'update');
  ok('a program still gets the whole snapshot', !!program2 && !!program2.data.status);
  ok('a page never gets the snapshot', !page.events.some(e => e.name === 'update'));
  ok('...and what it gets is far smaller', change && program2 && change.size * 3 < program2.size, `${change && change.size} vs ${program2 && program2.size}`);

  // A click: the server answers at once, the page hears right after, and the
  // copy on disk catches up by itself.
  const post = (urlPath, body) => new Promise((resolve) => {
    const r = https.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', rejectUnauthorized: false, headers: { ...auth, 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); });
    r.end(JSON.stringify(body));
  });
  const heardBefore = page.events.length, diskBefore = fs.statSync('summary.html').mtimeMs;
  const clicked = Date.now();
  await post('/api/action', { action: 'hide', arg: 'o1' });
  const answered = Date.now() - clicked;
  ok('a card action doesn\'t wait for the redraw', answered < 200, `${answered} ms`);
  for (let i = 0; i < 100 && page.events.length === heardBefore; i++) await sleep(10);
  const heard = Date.now() - clicked;
  ok('...and the page hears quickly', page.events.length > heardBefore && heard < 400, `${heard} ms`);
  const moved = page.events.slice(heardBefore).find(e => e.data.lists && e.data.lists.overdue);
  ok('...with the card marked', !!moved && moved.data.lists.overdue.set.some(x => x.id === 'o1' && x.hidden));
  for (let i = 0; i < 40 && fs.statSync('summary.html').mtimeMs === diskBefore; i++) await sleep(100);
  ok('...and the copy on disk catches up', fs.statSync('summary.html').mtimeMs !== diskBefore);

  // A page holding what the diff starts from ends up with what /api/dashboard says.
  const latest = JSON.parse((await request('/api/dashboard', auth)).body);
  ok('the stream and the API agree', page.events[page.events.length - 1].data.rev === latest.rev);

  // Signing out still counts.
  ok('the data needs signing in', (await request('/api/dashboard')).status === 401);
  page.close(); program.close();
  srv.kill('SIGKILL');
  process.exit(process.exitCode || 0);
})();
