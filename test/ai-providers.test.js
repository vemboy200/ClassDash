// AI providers (37-ai.js) and Settings → AI: each provider asked the way it
// expects, a cloud one never reached before its box is ticked, keys never
// in an error or a log, "local" only for local addresses, and the panel
// showing the right rows and testing what it saved. Fake fetch and spawn
// stand in for the providers; the real ones (Apple, Ollama) were checked
// by hand.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), os = require('os');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const KEY = 'sk-made-up-SECRET-1234567890';
const proj = T.classProject(undefined, { 'settings.json': { language: 'en' } });
process.chdir(proj);
const ai = require(path.join(proj, '37-ai.js'));
const settings = require(path.join(proj, '19-settings.js'));

// A fetch that records what it was asked and answers from a table.
function fakeFetch(answer) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const a = answer(url, init) || { status: 200, json: {} };
    if (a.throws) throw a.throws;
    return { ok: a.status < 400, status: a.status, text: async () => JSON.stringify(a.json) };
  };
  return { fetch, calls };
}
const chat = text => ({ status: 200, json: { choices: [{ message: { content: text } }] } });

(async () => {
  // ── what counts as local ──
  ok('this computer and the home network are local',
    ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234', 'http://192.168.1.20:11434', 'http://10.0.0.5', 'http://172.20.1.1', 'http://box.local:1234']
      .every(ai.localAddress));
  ok('a server on the internet isn\'t, nor a VPN address, nor nonsense',
    !['https://example.com/v1', 'http://8.8.8.8', 'http://172.32.0.1', 'http://100.96.0.1', 'ftp://localhost', 'not a url', ''].some(ai.localAddress));

  // ── nothing is sent before it may be ──
  {
    const f = fakeFetch(() => chat('hi'));
    const deps = { fetch: f.fetch };
    const off = await ai.complete({ prompt: 'x' }, { aiProvider: 'none' }, deps);
    ok('off: refused', !off.ok && /off/.test(off.why));
    const unagreed = await ai.complete({ prompt: 'x' }, { aiProvider: 'openai', aiOpenaiKey: KEY }, deps);
    ok('a cloud provider with its box unticked: refused', !unagreed.ok && /tick the box/.test(unagreed.why), unagreed.why);
    const otherBox = await ai.complete({ prompt: 'x' }, { aiProvider: 'gemini', aiGeminiKey: KEY, aiAgreed: ['openai'] }, deps);
    ok('...another provider\'s box doesn\'t count', !otherBox.ok && /Google/.test(otherBox.why), otherBox.why);
    const noKey = await ai.complete({ prompt: 'x' }, { aiProvider: 'anthropic', aiAgreed: ['anthropic'] }, deps);
    ok('no key: refused', !noKey.ok && /key/.test(noKey.why));
    const far = await ai.complete({ prompt: 'x' }, { aiProvider: 'ollama', aiLocalUrl: 'https://example.com/v1', aiModel: 'm' }, deps);
    ok('a "local" server that isn\'t local: refused', !far.ok && /home network/.test(far.why), far.why);
    const apple = await ai.complete({ prompt: 'x' }, { aiProvider: 'apple' }, { ...deps, platform: 'win32' });
    ok('Apple Intelligence on Windows: refused', !apple.ok && /Mac/.test(apple.why));
    ok('...and none of those sent anything', f.calls.length === 0, JSON.stringify(f.calls.map(c => c.url)));
  }

  // ── each provider asked the way it expects ──
  {
    const f = fakeFetch(() => chat('Answer'));
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, { aiProvider: 'openai', aiOpenaiKey: KEY, aiAgreed: ['openai'] }, { fetch: f.fetch });
    const c = f.calls[0];
    ok('OpenAI: chat completions, the key as a bearer, the default model', r.ok && r.text === 'Answer' && c.url === 'https://api.openai.com/v1/chat/completions' &&
      c.headers.Authorization === `Bearer ${KEY}` && c.body.model === 'gpt-5-mini', JSON.stringify({ r, url: c.url, model: c.body.model }));
    ok('...with the instructions as a system message', c.body.messages[0].role === 'system' && c.body.messages[1].content === 'Hello?');
  }
  {
    const f = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there' }] } }));
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, { aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'], aiModel: 'claude-x' }, { fetch: f.fetch });
    const c = f.calls[0];
    ok('Anthropic: messages, x-api-key and a version, the chosen model', r.ok && r.text === 'Hi there' && c.url === 'https://api.anthropic.com/v1/messages' &&
      c.headers['x-api-key'] === KEY && c.headers['anthropic-version'] && c.body.model === 'claude-x' && c.body.max_tokens > 0 && c.body.system === 'Be brief.', JSON.stringify(r));
  }
  {
    const f = fakeFetch(() => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: 'Yo' }] } }] } }));
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, { aiProvider: 'gemini', aiGeminiKey: KEY, aiAgreed: ['gemini'] }, { fetch: f.fetch });
    const c = f.calls[0];
    ok('Gemini: generateContent, the key in a header (never the address)', r.ok && r.text === 'Yo' && /models\/gemini-2\.5-flash:generateContent$/.test(c.url) &&
      !c.url.includes(KEY) && c.headers['x-goog-api-key'] === KEY && c.body.systemInstruction.parts[0].text === 'Be brief.', JSON.stringify({ r, url: c.url }));
  }
  {
    const f = fakeFetch(() => chat('Local'));
    const r = await ai.complete({ prompt: 'Hello?' }, { aiProvider: 'ollama', aiModel: 'small:1b' }, { fetch: f.fetch });
    const c = f.calls[0];
    ok('Ollama: its usual address, no key, no box needed', r.ok && c.url === 'http://localhost:11434/v1/chat/completions' && !c.headers.Authorization && c.body.model === 'small:1b', JSON.stringify(c));
    const f2 = fakeFetch(() => chat('Local'));
    await ai.complete({ prompt: 'Hello?' }, { aiProvider: 'lmstudio', aiLocalUrl: 'http://192.168.1.20:1234/v1/', aiModel: 'm' }, { fetch: f2.fetch });
    ok('LM Studio at a home-network address', f2.calls[0].url === 'http://192.168.1.20:1234/v1/chat/completions', f2.calls[0].url);
  }

  // ── errors: plain, and never with the key ──
  {
    const f = fakeFetch(() => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${KEY}. Also sk-other-key-abcdef.` } } }));
    const r = await ai.complete({ prompt: 'x' }, { aiProvider: 'openai', aiOpenaiKey: KEY, aiAgreed: ['openai'] }, { fetch: f.fetch });
    ok('a refused key says so', !r.ok && /key was refused/.test(r.why), r.why);
    ok('...and the error never carries a key', !r.why.includes(KEY) && !r.why.includes('sk-other'), r.why);
    const down = fakeFetch(() => ({ throws: new TypeError('fetch failed') }));
    const d = await ai.complete({ prompt: 'x' }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: down.fetch });
    ok('a local server that isn\'t running: asks whether it is', !d.ok && /running/.test(d.why), d.why);
  }

  // ── models and the Test button ──
  {
    const f = fakeFetch(url => /models$|models\?/.test(url)
      ? { status: 200, json: { data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'tts-1' }, { id: 'gpt-4.1' }] } }
      : chat('OK'));
    const r = await ai.test({ aiProvider: 'openai', aiOpenaiKey: KEY, aiAgreed: ['openai'] }, { fetch: f.fetch });
    ok('OpenAI test: works, chat models only', r.ok && r.reply === 'OK' && JSON.stringify(r.models) === '["gpt-4.1","gpt-5-mini"]' && r.model === 'gpt-5-mini', JSON.stringify(r));
    const g = fakeFetch(url => /models\?/.test(url)
      ? { status: 200, json: { models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] } }
      : { status: 200, json: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } });
    const gr = await ai.test({ aiProvider: 'gemini', aiGeminiKey: KEY, aiAgreed: ['gemini'] }, { fetch: g.fetch });
    ok('Gemini test: models that can answer, without the "models/" prefix', gr.ok && JSON.stringify(gr.models) === '["gemini-x"]', JSON.stringify(gr));
    const l = fakeFetch(url => /models$/.test(url) ? { status: 200, json: { data: [{ id: 'zeta' }, { id: 'alpha' }] } } : chat('OK'));
    const lr = await ai.test({ aiProvider: 'ollama' }, { fetch: l.fetch });
    ok('Ollama test with no model picked: tries the first one downloaded', lr.ok && lr.model === 'alpha' && l.calls[1].body.model === 'alpha', JSON.stringify(lr));
    const none = fakeFetch(() => ({ status: 200, json: { data: [] } }));
    const nr = await ai.test({ aiProvider: 'lmstudio' }, { fetch: none.fetch });
    ok('...and with none downloaded, says so', !nr.ok && /no model/.test(nr.why), JSON.stringify(nr));
  }

  // ── finding what's on this computer ──
  {
    const f = fakeFetch(url => {
      if (url === 'http://localhost:11434/v1/models') return { status: 200, json: { data: [{ id: 'small:1b' }, { id: 'nomic-embed-text' }, { id: 'big:8b' }] } };
      if (url.startsWith('http://localhost:1234')) return { throws: new TypeError('fetch failed') };
      if (url.startsWith('https://api.anthropic.com/v1/models')) return { status: 200, json: { data: [{ id: 'claude-a' }] } };
      return { status: 404, json: {} };
    });
    const spawnCheck = (file, args) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end(x) { child.input = x; setImmediate(() => { child.stdout.emit('data', JSON.parse(x).check ? '{"ok":true}' : '{"ok":false}'); child.emit('close', 0); }); } };
      child.kill = () => {};
      return child;
    };
    const env = { CLASSDASH_APP_BINARY: '/Made/Up/ClassDash', PATH: '/nowhere' };
    const r = await ai.detect({ aiProvider: 'none' }, { fetch: f.fetch, platform: 'darwin', env, home: '/Users/nobody', exists: x => x === env.CLASSDASH_APP_BINARY, spawn: spawnCheck });
    ok('finds Ollama at its usual address, with chat models only', r.ollama && r.ollama.url === 'http://localhost:11434/v1' && JSON.stringify(r.ollama.models) === '["big:8b","small:1b"]', JSON.stringify(r.ollama));
    ok('...LM Studio not running: not found', r.lmstudio === null);
    ok('...Apple Intelligence asked only whether it can be used', r.apple && r.apple.ok === true);
    ok('...no Codex, and no cloud provider asked when none is saved', r.codex === false && r.cloud === null && !f.calls.some(c => /anthropic|openai|google/.test(c.url)));
    const off = await ai.detect({ aiProvider: 'anthropic', aiAnthropicKey: KEY }, { fetch: f.fetch, platform: 'win32', env, exists: () => false });
    ok('a saved cloud provider with its box unticked isn\'t asked, and no Apple on Windows', off.cloud === null && off.apple === null && !f.calls.some(c => /anthropic/.test(c.url)));
    const on = await ai.detect({ aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'] }, { fetch: f.fetch, platform: 'win32', env, exists: () => false });
    ok('...ticked: its models are listed', on.cloud && on.cloud.provider === 'anthropic' && JSON.stringify(on.cloud.models) === '["claude-a"]', JSON.stringify(on.cloud));
    const elsewhere = fakeFetch(url => url === 'http://192.168.1.20:11434/v1/models' ? { status: 200, json: { data: [{ id: 'm' }] } } : { throws: new TypeError('fetch failed') });
    const lan = await ai.detect({ aiProvider: 'ollama', aiLocalUrl: 'http://192.168.1.20:11434/v1' }, { fetch: elsewhere.fetch, platform: 'win32', env, exists: () => false });
    ok('...and Ollama at the saved home-network address', lan.ollama && lan.ollama.url === 'http://192.168.1.20:11434/v1');
  }

  // ── Apple: through the Mac app ──
  {
    const spawned = [];
    const fakeSpawn = (answer) => (file, args) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      let input = '';
      child.stdin = { on() {}, end(x) { input = x; spawned.push({ file, args, input }); setImmediate(() => { child.stdout.emit('data', answer); child.emit('close', 0); }); } };
      child.kill = () => {};
      return child;
    };
    const env = { CLASSDASH_APP_BINARY: '/Made/Up/ClassDash.app/Contents/MacOS/ClassDash' };
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, { aiProvider: 'apple' },
      { platform: 'darwin', env, exists: f => f === env.CLASSDASH_APP_BINARY, spawn: fakeSpawn('{"ok":true,"text":"Hi"}\n') });
    ok('Apple: the app run with --ai-respond, the question on stdin', r.ok && r.text === 'Hi' && spawned[0].file === env.CLASSDASH_APP_BINARY &&
      spawned[0].args.join() === '--ai-respond' && JSON.parse(spawned[0].input).instructions === 'Be brief.', JSON.stringify({ r, s: spawned[0] }));
    const off = await ai.complete({ prompt: 'x' }, { aiProvider: 'apple' },
      { platform: 'darwin', env, exists: () => true, spawn: fakeSpawn('{"ok":false,"why":"Apple Intelligence is off (turn it on in System Settings)"}') });
    ok('...and its own reason when it can\'t', !off.ok && /turn it on/.test(off.why), off.why);
    const missing = await ai.complete({ prompt: 'x' }, { aiProvider: 'apple' }, { platform: 'darwin', env, exists: () => false, spawn: fakeSpawn('') });
    ok('...or that the app isn\'t there', !missing.ok && /wasn't found/.test(missing.why));
  }

  // ── Codex: the person's own codex, read-only, in an empty folder ──
  {
    const runs = [];
    const fakeSpawn = ({ code = 0, err = '', write = 'Done' } = {}) => (file, args, options) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end(input) {
        const out = args[args.indexOf(args.find(a => /--output-last-message/.test(a))) + 1].replace(/^"|"$/g, '');
        runs.push({ file, args, options, input, folderFiles: fs.readdirSync(options.cwd) });
        if (write) fs.writeFileSync(out, write);
        setImmediate(() => { if (err) child.stderr.emit('data', err); child.emit('close', code); });
      } };
      child.kill = () => {};
      return child;
    };
    const bin = '/opt/homebrew/bin/codex';
    const deps = { platform: 'darwin', env: { PATH: '/usr/bin' }, exists: f => f === bin, home: '/Users/nobody' };
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, { aiProvider: 'codex', aiAgreed: ['codex'] }, { ...deps, spawn: fakeSpawn() });
    const run = runs[0];
    ok('Codex: found where Homebrew puts it, answer from its last message', r.ok && r.text === 'Done' && run.file === bin, JSON.stringify(r));
    ok('...exec, read-only sandbox, nothing kept, the prompt on stdin', ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check'].every(a => run.args.includes(a)) &&
      run.args[run.args.length - 1] === '-' && run.input === 'Be brief.\n\nHello?', JSON.stringify(run.args));
    ok('...run in an empty folder, removed after', run.folderFiles.length === 0 && !fs.existsSync(run.options.cwd));
    const signedOut = await ai.complete({ prompt: 'x' }, { aiProvider: 'codex', aiAgreed: ['codex'] },
      { ...deps, spawn: fakeSpawn({ code: 1, write: '', err: 'Error: not logged in, run codex login' }) });
    ok('not signed in: says to run codex login', !signedOut.ok && /codex login/.test(signedOut.why), signedOut.why);
    const missing = await ai.complete({ prompt: 'x' }, { aiProvider: 'codex', aiAgreed: ['codex'] }, { ...deps, exists: () => false, spawn: fakeSpawn() });
    ok('not installed: says so', !missing.ok && /isn't installed/.test(missing.why));
    const winBin = path.join('C:\\Users\\kid\\AppData\\Roaming', 'npm', 'codex.cmd');
    await ai.complete({ prompt: 'x' }, { aiProvider: 'codex', aiAgreed: ['codex'], aiModel: 'gpt-5' },
      { platform: 'win32', env: { PATH: '', APPDATA: 'C:\\Users\\kid\\AppData\\Roaming' }, exists: f => f === winBin, spawn: fakeSpawn() });
    const w = runs[runs.length - 1];
    ok('Windows: npm\'s codex.cmd, through the shell, every argument quoted', w.file === `"${winBin}"` && w.options.shell === true &&
      w.args.every(a => /^".*"$/.test(a)) && w.args.includes('"gpt-5"'), JSON.stringify(w && { file: w.file, args: w.args }));
  }

  // ── settings ──
  {
    const v = (k, x) => settings.validate(k, x);
    ok('a provider id or none', v('aiProvider', 'ollama').ok && v('aiProvider', 'none').ok && !v('aiProvider', 'skynet').ok);
    ok('the agreed list: known ids, once each', JSON.stringify(v('aiAgreed', ['openai', 'openai', 'gemini']).value) === '["openai","gemini"]' && !v('aiAgreed', ['evil']).ok);
    ok('a server address: empty or local only', v('aiLocalUrl', '').ok && v('aiLocalUrl', 'http://localhost:1234/v1').ok && !v('aiLocalUrl', 'https://example.com').ok);
    ok('a model name: no spaces or quotes', v('aiModel', 'llama3.2:3b').ok && !v('aiModel', 'a b').ok && !v('aiModel', 'x"y').ok);
    ok('keys are tokens', v('aiGeminiKey', ' AIzaMadeUp ').value === 'AIzaMadeUp' && !v('aiOpenaiKey', 'two words').ok);
    ok('off by default', settings.read().aiProvider === 'none' && settings.read().aiAgreed.length === 0);
  }

  // ── the API can't tick the box for the person ──
  {
    const api = require(path.join(proj, '17-api.js'));
    const r = api.WRITE_HANDLERS['/api/settings']({ aiAgreed: ['openai'] });
    ok('/api/settings refuses aiAgreed', r.status === 400 && settings.read().aiAgreed.length === 0, JSON.stringify(r));
    const notifier = require(path.join(proj, '21-notifier-actions.js'));
    const t = await notifier.main('aiTest', '');
    ok('the aiTest action answers with the test result', t.action === 'aiTest' && !t.ok && /off/.test(t.why), JSON.stringify(t));
  }

  // ── Settings → AI on the page ──
  {
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', aiOpenaiKey: KEY }));
    T.redraw(proj);
    const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
    const { JSDOM, VirtualConsole } = T.jsdom();
    const posted = [];
    const vc = new VirtualConsole();
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: vc,
      beforeParse(w) { w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; w.setTimeout = () => 0; },
    });
    const w = dom.window, d = w.document;
    const select = d.querySelector('[data-key="aiProvider"]');
    const groups = [...select.querySelectorAll('optgroup')];
    ok('an AI section with the picker, off', !!d.querySelector('[data-section="ai"]') && select.value === 'none');
    ok('local ones first, then cloud', /computer/.test(groups[0].label) && /Cloud/.test(groups[1].label) &&
      [...groups[1].children].every(o => o.hasAttribute('data-cloud')) && ![...groups[0].children].some(o => o.hasAttribute('data-cloud')));
    ok('Apple Intelligence only offered on a Mac', !!select.querySelector('option[value="apple"]') === (process.platform === 'darwin'));
    // Only the AI rows' own hiding: the panel itself is closed in this test.
    const visible = () => [...d.querySelectorAll('[data-ai-for]')].filter(e => !e.hidden).map(e => e.getAttribute('data-ai-for'));
    ok('off: none of the provider rows', visible().length === 0 && d.getElementById('ai-test-row').hidden);

    select.value = 'openai'; w.updateAiRows();
    const notice = [...d.querySelectorAll('[data-ai-for="openai"] .ai-notice')].find(e => !e.closest('[data-ai-for][hidden]'));
    ok('OpenAI picked: what it gets, its age rule and its links', notice && /OpenAI gets a copy/.test(notice.textContent) && /13 or older/.test(notice.textContent) &&
      [...notice.querySelectorAll('a')].map(a => a.href).join() === 'https://openai.com/policies/terms-of-use/,https://openai.com/policies/privacy-policy/', notice && notice.textContent);
    ok('...its key row, masked, and no other provider\'s', !d.querySelector('[data-key="aiOpenaiKey"]').closest('[data-ai-for][hidden]') &&
      d.querySelector('[data-key="aiOpenaiKey"]').type === 'password' && !!d.querySelector('[data-key="aiAnthropicKey"]').closest('[data-ai-for][hidden]'));
    ok('...and not the local note', !!d.querySelector('.ai-local-note').closest('[data-ai-for][hidden]'));

    select.value = 'anthropic'; w.updateAiRows();
    const anth = d.querySelector('[data-ai-for="anthropic"] .ai-notice').textContent;
    ok('Anthropic: 18 or older, about the student, with a note for parents', /18 or older/.test(anth) && /The student this ClassDash is for is 18 or older/.test(anth) && /your child/.test(anth));
    const why = [...d.querySelectorAll('[data-section="ai"] .ai-why')];
    ok('one "which to pick" fold-out at the top, whatever is picked: local first, the age rules, and why no Claude or Google plan',
      why.length === 1 && !why[0].closest('[data-ai-for]') && why[0] === d.querySelector('[data-section="ai"] .hint').nextElementSibling &&
      /A local one if you can/.test(why[0].textContent) && /13 or older/.test(why[0].textContent) && /18 or older/.test(why[0].textContent) &&
      /Claude Pro\/Max or Google AI Pro/.test(why[0].textContent) && /Antigravity/.test(why[0].textContent) && /API key/.test(why[0].textContent) && /own model/.test(why[0].textContent));
    select.value = 'gemini'; w.updateAiRows();
    const gem = d.querySelector('[data-ai-for="gemini"] .ai-notice').textContent;
    ok('Gemini: 18 or older, and the free tier\'s training', /18 or older/.test(gem) && /free tier/.test(gem));
    select.value = 'ollama'; w.updateAiRows();
    ok('Ollama: the local note, address and model, no age box', !d.querySelector('.ai-local-note').closest('[data-ai-for][hidden]') &&
      !d.querySelector('[data-key="aiLocalUrl"]').closest('[data-ai-for][hidden]') && !d.querySelector('[data-key="aiModel"]').closest('[data-ai-for][hidden]') &&
      d.querySelectorAll('.ai-notice').length === [...d.querySelectorAll('.ai-notice')].filter(e => e.closest('[data-ai-for][hidden]')).length);

    // Switching providers asked once what's on this computer; covered below.
    ok('picking a provider asks once what\'s on this computer', posted.filter(m => m.action === 'aiDetect').length === 1 && posted.length === 1);
    posted.length = 0;

    // Test with the box unticked: nothing sent.
    select.value = 'openai'; w.updateAiRows();
    const button = d.getElementById('ai-test');
    w.testAi(button);
    ok('Test with the box unticked: asks for it, sends nothing', posted.length === 0 && /Tick the box/.test(d.getElementById('ai-test-status').textContent));

    d.querySelector('[data-key="aiAgreed"][value="openai"]').checked = true;
    w.testAi(button);
    const sent = JSON.parse(Buffer.from(posted[0].arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    ok('ticked: saves first, the box in aiAgreed', posted[0].action === 'config' && sent.aiProvider === 'openai' && JSON.stringify(sent.aiAgreed) === '["openai"]', JSON.stringify(sent.aiAgreed));
    w.classdashBridgeResult(posted[0].id, { ok: true, accepted: [], rejected: [] });
    ok('...then tests what it saved, with no key in the test\'s own message', posted[1] && posted[1].action === 'aiTest' && posted[1].arg === '' && !JSON.stringify(posted[1]).includes(KEY), JSON.stringify(posted[1]));
    w.classdashBridgeResult(posted[1].id, { ok: true, model: 'gpt-5-mini', ms: 1234, reply: 'OK', models: ['gpt-4.1', 'gpt-5-mini'] });
    const modelList = d.getElementById('ai-model-select');
    ok('...and says it works, the model now a dropdown: the default, then the list', /Works: answered in 1\.2 s\. \(gpt-5-mini\)/.test(d.getElementById('ai-test-status').textContent) &&
      !d.getElementById('ai-model-wrap').hidden && d.querySelector('[data-key="aiModel"]').hidden &&
      JSON.stringify([...modelList.options].map(o => o.value)) === '["","gpt-4.1","gpt-5-mini"]' && /Default \(gpt-5-mini\)/.test(modelList.options[0].textContent),
      d.getElementById('ai-test-status').textContent + ' ' + [...modelList.options].map(o => o.value));
    ok('saved means closing the panel doesn\'t save again', w.settingsDirty() === false);
    modelList.value = 'gpt-4.1'; w.aiModelPicked(modelList);
    ok('picking from the dropdown is what gets saved', w.collectSettings().aiModel === 'gpt-4.1');
    w.close();
  }

  // ── the panel filling itself in ──
  {
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en' }));
    T.redraw(proj);
    const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
    const { JSDOM, VirtualConsole } = T.jsdom();
    const posted = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; w.setTimeout = () => 0; },
    });
    const w = dom.window, d = w.document;
    w.showSettingsSection('ai', null);
    ok('showing the AI section asks what\'s on this computer, once', posted.length === 1 && posted[0].action === 'aiDetect' && posted[0].arg === '');
    w.showSettingsSection('ai', null);
    ok('...not again while it\'s asking', posted.length === 1);
    w.classdashBridgeResult(posted[0].id, { ok: true, ollama: { url: 'http://localhost:11434/v1', models: ['big:8b', 'small:1b'] }, lmstudio: null, apple: { ok: false, why: 'Apple Intelligence is off (turn it on in System Settings)' }, codex: true, cloud: null });
    const select = d.querySelector('[data-key="aiProvider"]');
    const label = v => select.querySelector(`option[value="${v}"]`).textContent;
    ok('found ones get a ✓, others don\'t', /✓$/.test(label('ollama')) && /✓$/.test(label('codex')) && !/✓/.test(label('lmstudio')) && !/✓/.test(label('openai')));
    ok('...and a line says what was found', /Found: Ollama \(2 models\), ChatGPT \(through Codex\)/.test(d.getElementById('ai-found').textContent), d.getElementById('ai-found').textContent);
    if (process.platform === 'darwin') ok('Apple Intelligence that can\'t be used says why', /Not available here: Apple Intelligence is off/.test(d.getElementById('ai-apple-status').textContent));
    select.value = 'ollama'; w.updateAiRows();
    const list = d.getElementById('ai-model-select');
    ok('picking Ollama fills in its first model, as a dropdown', !d.getElementById('ai-model-wrap').hidden && list.value === 'big:8b' && w.collectSettings().aiModel === 'big:8b' &&
      JSON.stringify([...list.options].map(o => o.value)) === '["big:8b","small:1b"]');
    ok('...and fills in the address it was found at', w.collectSettings().aiLocalUrl === 'http://localhost:11434/v1');
    select.value = 'codex'; w.updateAiRows();
    ok('Codex: no list, so a text field, and Ollama\'s model doesn\'t follow', d.getElementById('ai-model-wrap').hidden && !d.querySelector('[data-key="aiModel"]').hidden && w.collectSettings().aiModel === '');
    select.value = 'lmstudio'; w.updateAiRows();
    ok('LM Studio not found: a text field', d.getElementById('ai-model-wrap').hidden);

    // Find: looks again and fills in the address.
    posted.length = 0;
    const find = d.getElementById('ai-find');
    w.findAi(find);
    ok('Find asks again', posted.length === 1 && posted[0].action === 'aiDetect' && find.disabled);
    w.classdashBridgeResult(posted[0].id, { ok: true, ollama: null, lmstudio: null, apple: null, codex: false, cloud: null });
    ok('...not running: says where it looked and asks whether it\'s running', /LM Studio isn't at http:\/\/localhost:1234\/v1\. Is its server running\?/.test(d.getElementById('ai-find-status').textContent) && !find.disabled,
      d.getElementById('ai-find-status').textContent);
    posted.length = 0;
    w.findAi(find);
    w.classdashBridgeResult(posted[0].id, { ok: true, ollama: null, lmstudio: { url: 'http://localhost:1234/v1', models: ['qwen-x'] }, apple: null, codex: false, cloud: null });
    ok('...started since: fills in the address and the model dropdown', w.collectSettings().aiLocalUrl === 'http://localhost:1234/v1' && w.collectSettings().aiModel === 'qwen-x' &&
      !d.getElementById('ai-model-wrap').hidden && /Found LM Studio at http:\/\/localhost:1234\/v1/.test(d.getElementById('ai-find-status').textContent));
    w.close();
  }
})();
