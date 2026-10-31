// The chats' model picker: what it lists (37-ai.js choices(), with fake
// providers), the pick saved all or nothing and used by both chats but not
// the announcement scan (chatSettings), and the picker itself in jsdom
// (51-model-picker.js), opened, searched, a name typed in and picked.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const KEY = 'sk-made-up-SECRET-1234567890';
const proj = T.classProject(undefined, { 'settings.json': { language: 'en' } });
process.chdir(proj);
const ai = require(path.join(proj, '37-ai.js'));
const settings = require(path.join(proj, '19-settings.js'));
const act = (action, arg = '') => JSON.parse(T.run(proj, '21-notifier-actions.js', [action, arg]).stdout.trim().split('\n').pop());
const picker = require(path.join(proj, '51-model-picker.js'));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

// Ollama answers at its usual address, OpenAI with its models; nothing else is there.
const fetch = async url => {
  const json = url === 'http://localhost:11434/v1/models' ? { data: [{ id: 'llama3.2' }, { id: 'nomic-embed-text' }, { id: 'qwen3:8b' }, { id: 'phonon-40m-multilingual' }] }
    : url === 'https://api.openai.com/v1/models' ? { data: [{ id: 'gpt-5-mini' }, { id: 'gpt-5' }, { id: 'tts-1' }] } : null;
  if (!json) throw new Error('connection refused');
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
};
const deps = { fetch, exists: () => false, platform: 'linux' };

(async () => {
  // ── what it lists ──
  const s = { ...settings.read(), aiProvider: 'ollama', aiModel: 'llama3.2', aiOpenaiKey: KEY, aiAgreed: ['openai', 'anthropic'] };
  const r = await ai.choices(s, deps);
  const by = id => r.providers.find(p => p.id === id);
  ok('every provider is listed, in Settings → AI\'s order', r.providers.map(p => p.id).join() === ai.PROVIDER_IDS.join());
  ok('Ollama running: ready, with its chat models and where it is', by('ollama').ok && by('ollama').models.join() === 'llama3.2,qwen3:8b' && by('ollama').url === 'http://localhost:11434/v1', JSON.stringify(by('ollama')));
  ok('an API with its key and its box: ready, with its chat models', by('openai').ok && by('openai').models.join() === 'gpt-5,gpt-5-mini');
  ok('...ticked but no key: not ready, "key"', !by('anthropic').ok && by('anthropic').why === 'key');
  ok('...its box not ticked: "agree"', !by('gemini').ok && by('gemini').why === 'agree');
  ok('not running or not installed: "notFound"', ['lmstudio', 'foundry', 'codex', 'claudecode'].every(id => !by(id).ok && by(id).why === 'notFound'));
  ok('Apple Intelligence off a Mac: "mac"', by('apple').why === 'mac');
  ok('the chat uses Settings → AI\'s until something is picked', r.current.provider === 'ollama' && r.current.model === 'llama3.2');
  ok('the key is in nothing it sends back', !JSON.stringify(r).includes(KEY));

  // ── a pick ──
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(s));
  const bad = act('aiPick', b64({ provider: 'ollama', model: 'qwen3:8b', url: 'https://example.com/v1' }));
  ok('a "local" address that isn\'t: refused, and nothing written', !bad.ok && settings.read().aiChatProvider === '');
  const unknown = act('aiPick', b64({ provider: 'skynet', model: 'x' }));
  ok('an AI that isn\'t one: refused', !unknown.ok);
  const good = act('aiPick', b64({ provider: 'openai', model: 'gpt-5', url: '' }));
  const now = settings.read();
  ok('a good one is saved', good.ok && now.aiChatProvider === 'openai' && now.aiChatModel === 'gpt-5', JSON.stringify(good));
  ok('...the chats ask with it', ai.chatSettings(now).aiProvider === 'openai' && ai.chatSettings(now).aiModel === 'gpt-5');
  ok('...Settings → AI (and so the announcement scan) keeps its own', now.aiProvider === 'ollama' && now.aiModel === 'llama3.2');
  ok('...a local pick keeps the address it was found at', ai.chatSettings({ ...now, aiChatProvider: 'lmstudio', aiChatModel: 'm', aiChatUrl: 'http://localhost:1235/v1' }).aiLocalUrl === 'http://localhost:1235/v1');
  const scan = act('aiPick', b64({ for: 'scan', provider: 'lmstudio', model: 'qwen3:8b', url: 'http://localhost:1235/v1' }));
  const after = settings.read();
  ok('the announcement scan\'s pick is Settings → AI\'s own, and leaves the chats\' alone', scan.ok && after.aiProvider === 'lmstudio' && after.aiModel === 'qwen3:8b' &&
    after.aiLocalUrl === 'http://localhost:1235/v1' && after.aiChatProvider === 'openai', JSON.stringify(scan));
  ok('...and it can be turned off', act('aiPick', b64({ for: 'scan', provider: 'none' })).ok && settings.read().aiProvider === 'none');
  ok('...but a chat can\'t pick "none"', !act('aiPick', b64({ provider: 'none' })).ok);
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(now));
  ok('...and another provider doesn\'t borrow Settings → AI\'s address', ai.chatSettings({ ...now, aiLocalUrl: 'http://localhost:9999/v1', aiChatProvider: 'lmstudio', aiChatModel: 'm' }).aiLocalUrl === '');

  // Both chats: asked with the picked AI.
  const side = require(path.join(proj, '49-ai-sidebar.js'));
  ok('the AI pane says it asks with the picked one', side.canAsk(now).label === ai.PROVIDERS.openai.label);
  const center = require(path.join(proj, '41-grades-center.js'));
  ok('...and the Grades center wants the picked cloud AI\'s grades box', center.canAsk(now).why === 'agree' && center.canAsk(now).company === 'OpenAI');

  // ── the picker, in a page ──
  const dom = new JSDOM(`<style>${picker.CSS}</style><div id="host"></div>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  w.eval(picker.SCRIPT);
  const words = Object.fromEntries(picker.STRING_KEYS.map(k => [k, require(path.join(proj, '18-language.js')).t(k)]));
  const asked = [];
  let current = { provider: 'ollama', model: 'llama3.2' };
  const ask = async (action, arg) => {
    asked.push(action);
    if (action === 'aiChoices') return { ok: true, providers: JSON.parse(JSON.stringify(r.providers)), current, scan: { provider: 'none', model: '' } };
    if (action === 'aiPick') { asked.pick = JSON.parse(Buffer.from(arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return { ok: true }; }
  };
  let picked = null;
  w.modelPicker(d.getElementById('host'), { ask, words, onPick: c => { picked = c; } });
  await T.until(() => /Ollama/.test(d.querySelector('.mp-trigger').textContent));
  const trigger = d.querySelector('.mp-trigger');
  ok('the button shows the AI and model in use', trigger.textContent.includes('Ollama · llama3.2'), trigger.textContent);
  trigger.click();
  await T.until(() => d.querySelector('.mp-side'));
  const tabs = [...d.querySelectorAll('.mp-side button')];
  ok('opened: the providers down the side, the one in use chosen', tabs.length === ai.PROVIDER_IDS.length && tabs.find(b => b.getAttribute('aria-current') === 'true').textContent === 'Ollama');
  ok('...its models beside them, the one in use checked', [...d.querySelectorAll('.mp-list button')].map(b => b.textContent + (b.getAttribute('aria-selected') === 'true' ? '✓' : '')).join() === 'llama3.2✓,qwen3:8b');
  ok('...ones not ready greyed, saying why', tabs.find(b => b.textContent === ai.PROVIDERS.anthropic.label).className === 'off' && /API key/.test(tabs.find(b => b.textContent === ai.PROVIDERS.anthropic.label).title));
  tabs.find(b => b.textContent === ai.PROVIDERS.anthropic.label).click();
  ok('...and picking one shows the why instead of models', /API key/.test(d.querySelector('.mp-main').textContent) && !d.querySelector('.mp-list'));
  [...d.querySelectorAll('.mp-side button')].find(b => b.textContent === ai.PROVIDERS.openai.label).click();
  const box = d.querySelector('.mp-search');
  box.value = 'mini'; box.dispatchEvent(new w.Event('input'));
  ok('searching narrows the list', [...d.querySelectorAll('.mp-list button')].map(b => b.textContent).join() === 'default (gpt-5-mini),gpt-5-mini', [...d.querySelectorAll('.mp-list button')].map(b => b.textContent).join());
  box.value = 'gpt-6-preview'; box.dispatchEvent(new w.Event('input'));
  ok('a name not in the list can be typed in', d.querySelector('.mp-list button').textContent === 'Use "gpt-6-preview"');
  d.querySelector('.mp-list button').click();
  await T.until(() => picked);
  ok('picking saves it and closes', asked.pick.provider === 'openai' && asked.pick.model === 'gpt-6-preview' && !d.querySelector('.mp-pop') && picked.model === 'gpt-6-preview');
  ok('...and the button shows it', trigger.textContent.includes('OpenAI API · gpt-6-preview'), trigger.textContent);
  trigger.click();
  await T.until(() => d.querySelector('.mp-pop'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Escape closes it', !d.querySelector('.mp-pop'));

  // Thinking: the levels of the model in use, the usual one pressed until another is picked.
  current = { provider: 'openai', model: 'gpt-5', effort: '' };
  d.getElementById('host').textContent = '';
  const withLevels = JSON.parse(JSON.stringify(r.providers));
  w.modelPicker(d.getElementById('host'), { ask: async (action, arg) => action === 'aiChoices' ? { ok: true, providers: withLevels, current, scan: { provider: 'none', model: '' } } : ask(action, arg), words });
  await T.until(() => /OpenAI/.test(d.querySelector('.mp-trigger').textContent));
  ok('the button says how hard it thinks', /OpenAI API · gpt-5 · medium/.test(d.querySelector('.mp-trigger').textContent), d.querySelector('.mp-trigger').textContent);
  d.querySelector('.mp-trigger').click();
  await T.until(() => d.querySelector('.mp-effort'));
  const levelButtons = () => [...d.querySelectorAll('.mp-effort button')];
  ok('...its levels under the models, medium pressed', levelButtons().map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join() === 'low,medium*,high');
  asked.pick = null;
  levelButtons()[2].click();
  await T.until(() => / · high/.test(d.querySelector('.mp-trigger').textContent));
  ok('...picking high saves it and stays open', asked.pick.effort === 'high' && asked.pick.model === 'gpt-5' && !!d.querySelector('.mp-pop') && levelButtons().length === 3 &&
    levelButtons()[2].getAttribute('aria-pressed') === 'true' && / · high/.test(d.querySelector('.mp-trigger').textContent),
    JSON.stringify([asked.pick, !!d.querySelector('.mp-pop'), levelButtons().map(b => b.getAttribute('aria-pressed')), d.querySelector('.mp-trigger').textContent]));
  asked.pick = null;
  levelButtons()[1].click();
  await T.until(() => asked.pick);
  ok('...and medium, the usual, is saved as none picked', asked.pick.effort === '');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // Whether the model in use can see pictures, for a web page's Image.
  const told = [];
  d.getElementById('host').textContent = '';
  current = { provider: 'ollama', model: 'llama3.2' };
  const seeing = JSON.parse(JSON.stringify(r.providers)).map(p => p.id === 'ollama' ? { ...p, sees: ['qwen3:8b'] } : p);
  w.modelPicker(d.getElementById('host'), { ask: async (action, arg) => action === 'aiChoices' ? { ok: true, providers: seeing, current, scan: { provider: 'none', model: '' } } : ask(action, arg), words, onSees: s => told.push(s) });
  await T.until(() => told.length);
  ok('the picker says whether the model in use can see pictures', told[told.length - 1] === false);
  d.querySelector('.mp-trigger').click();
  await T.until(() => d.querySelector('.mp-list button'));
  [...d.querySelectorAll('.mp-list button')].find(b => b.textContent === 'qwen3:8b').click();
  await T.until(() => told[told.length - 1] === true);
  ok('...and again when another is picked', told[told.length - 1] === true);

  // The model in use deleted: still listed first, said to be gone, checked.
  current = { provider: 'ollama', model: 'gemma-gone' };
  d.getElementById('host').textContent = '';
  w.modelPicker(d.getElementById('host'), { ask, words });
  await T.until(() => /gemma-gone/.test(d.querySelector('.mp-trigger').textContent));
  d.querySelector('.mp-trigger').click();
  await T.until(() => d.querySelector('.mp-list button'));
  ok('a deleted model in use: listed first as not found, checked', [...d.querySelectorAll('.mp-list button')].map(b => b.textContent + (b.getAttribute('aria-selected') === 'true' ? '✓' : '')).join() === 'gemma-gone (not found)✓,llama3.2,qwen3:8b',
    [...d.querySelectorAll('.mp-list button')].map(b => b.textContent).join());

  // The scan's: Off at the top, checked while it's off, opening downward.
  d.getElementById('host').textContent = '';
  w.modelPicker(d.getElementById('host'), { ask, words, which: 'scan', off: true, down: true });
  await T.until(() => /Off/.test(d.querySelector('.mp-trigger').textContent));
  d.querySelector('.mp-trigger').click();
  await T.until(() => d.querySelector('.mp-none'));
  ok('the scan\'s picker: Off at the top, checked, opening downward', d.querySelector('.mp-none').textContent === '✓ Off' && d.querySelector('.mp-pop').classList.contains('down'));
  asked.pick = null;
  d.querySelector('.mp-none').click();
  await T.until(() => asked.pick);
  ok('...picking Off saves "none" for the scan', asked.pick.for === 'scan' && asked.pick.provider === 'none');

  // Both pages carry it (the Grades center is there once Q is set up).
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...settings.read(), gradesProvider: 'q' }));
  T.redraw(proj);
  ok('the main page has it for the Grades center', fs.readFileSync(path.join(proj, 'summary.html'), 'utf8').includes('function modelPicker') && fs.readFileSync(path.join(proj, 'summary.html'), 'utf8').includes('id="gc-pick"'));
  const desk = require(path.join(proj, '50-desk.js')).pageHtml();
  ok('...and the workspace for the AI pane', desk.includes('function modelPicker') && desk.includes('ai-foot'));
})().catch(e => ok('ran without throwing', false, e.stack));
