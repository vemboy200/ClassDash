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
// The newest model of each cloud API's family, as if looked up today: the
// tests below ask with these and count their requests without that lookup
// (it has its own tests at the end).
const seedNewest = () => fs.writeFileSync(path.join(proj, 'ai-defaults.json'), JSON.stringify(Object.fromEntries(
  ['openai', 'anthropic', 'gemini'].map(id => [id, { model: ai.PROVIDERS[id].model, at: new Date().toISOString() }]))));
seedNewest();

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
    // LM Studio Bionic: 1235, tried when nothing answers on 1234 and no address is saved.
    const bionic = () => fakeFetch(url => /:1235\//.test(url) ? (/\/models$/.test(url) ? { status: 200, json: { data: [{ id: 'bionic-model' }] } } : chat('Bionic')) : { throws: new Error('ECONNREFUSED') });
    const f3 = bionic();
    let r2 = await ai.complete({ prompt: 'Hello?' }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: f3.fetch });
    ok('LM Studio Bionic: nothing on 1234, so 1235', r2.ok && r2.text === 'Bionic' && JSON.stringify(f3.calls.map(c => c.url)) === '["http://localhost:1234/v1/chat/completions","http://localhost:1235/v1/chat/completions"]', JSON.stringify(f3.calls.map(c => c.url)));
    const f4 = bionic();
    r2 = await ai.complete({ prompt: 'Hello?' }, { aiProvider: 'lmstudio', aiModel: 'm', aiLocalUrl: 'http://localhost:1234/v1' }, { fetch: f4.fetch });
    ok('...but a saved address is the only one asked', !r2.ok && f4.calls.length === 1);
    const f5 = bionic();
    r2 = await ai.test({ aiProvider: 'lmstudio' }, { fetch: f5.fetch });
    ok('...Test finds it there too, and its model', r2.ok && r2.model === 'bionic-model', JSON.stringify(r2));
    const f6 = bionic();
    const seen = await ai.detect({}, { fetch: f6.fetch, exists: () => false, spawn: () => { throw new Error('no'); } });
    ok('...and so does detect, with its address', seen.lmstudio && seen.lmstudio.url === 'http://localhost:1235/v1' && JSON.stringify(seen.lmstudio.models) === '["bionic-model"]', JSON.stringify(seen.lmstudio));
  }
  // A thinking model's reasoning comes back apart from its answer, so only
  // the answer is read as one (and the card's AI fold-out can show both).
  {
    const say = message => fakeFetch(() => ({ status: 200, json: { choices: [{ message }] } }));
    const ask = f => ai.complete({ prompt: 'x' }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: f.fetch });
    let r = await ask(say({ content: 'Yes', reasoning: '7 leaves 1 over.' }));
    ok('thinking beside the answer (Ollama\'s "reasoning")', r.ok && r.text === 'Yes' && r.thinking === '7 leaves 1 over.', JSON.stringify(r));
    r = await ask(say({ content: 'Yes', reasoning_content: 'Odd.' }));
    ok('...or LM Studio\'s "reasoning_content"', r.text === 'Yes' && r.thinking === 'Odd.', JSON.stringify(r));
    r = await ask(say({ content: '<think>Counting.</think>\n{"items":[]}' }));
    ok('...or inside the answer as <think>, taken out of it', r.text === '{"items":[]}' && r.thinking === 'Counting.', JSON.stringify(r));
    r = await ask(say({ content: 'Yes' }));
    ok('...and none when the model sends none', r.text === 'Yes' && r.thinking === undefined, JSON.stringify(r));
  }
  // Asked for its thinking (the Grades chat): Ollama's own API with think on,
  // since its OpenAI-style one doesn't send it; a model that can't think is
  // asked the usual way.
  {
    const f = fakeFetch(url => /\/api\/chat$/.test(url) ? { status: 200, json: { message: { content: 'Yes', thinking: ' 7 leaves 1. ' } } } : chat('no'));
    const r = await ai.complete({ system: 'Be brief.', prompt: 'x', think: true }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: f.fetch });
    ok('think: Ollama\'s own /api/chat, think on, no stream', f.calls.length === 1 && f.calls[0].url === 'http://localhost:11434/api/chat' && f.calls[0].body.think === true && f.calls[0].body.stream === false &&
      f.calls[0].body.messages[0].role === 'system' && r.text === 'Yes' && r.thinking === '7 leaves 1.', JSON.stringify([f.calls[0], r]));
    const g = fakeFetch(url => /\/api\/chat$/.test(url) ? { status: 400, json: { error: '"m" does not support thinking' } } : chat('Plain'));
    const r2 = await ai.complete({ prompt: 'x', think: true }, { aiProvider: 'ollama', aiModel: 'm', aiLocalUrl: 'http://192.168.1.20:11434/v1/' }, { fetch: g.fetch });
    ok('...a model that can\'t think: asked the usual way', g.calls[0].url === 'http://192.168.1.20:11434/api/chat' && g.calls[1].url === 'http://192.168.1.20:11434/v1/chat/completions' && r2.ok && r2.text === 'Plain' && !r2.thinking, JSON.stringify(g.calls.map(c => c.url)));
    const h = fakeFetch(() => ({ throws: new Error('down') }));
    const r3 = await ai.complete({ prompt: 'x', think: true }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: h.fetch });
    ok('...a server that\'s down: says so, no second try', !r3.ok && h.calls.length === 1, JSON.stringify(r3));
    const off = fakeFetch(url => /\/api\/chat$/.test(url) ? { status: 200, json: { message: { content: 'Fast', thinking: 'should not show' } } } : chat('no'));
    const r4 = await ai.complete({ prompt: 'x', think: false }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: off.fetch });
    ok('think off: Ollama asked not to think, and any thinking dropped', off.calls[0].body.think === false && r4.text === 'Fast' && !('thinking' in r4), JSON.stringify(r4));
    const lmOff = fakeFetch(() => ({ status: 200, json: { choices: [{ message: { content: 'A', reasoning_content: 'hidden' } }] } }));
    const r5 = await ai.complete({ prompt: 'x', think: false }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: lmOff.fetch });
    ok('...LM Studio\'s thinking dropped too', r5.text === 'A' && !('thinking' in r5));
    const l = fakeFetch(() => chat('lm'));
    await ai.complete({ prompt: 'x', think: true }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: l.fetch });
    ok('...LM Studio is asked as before', /\/v1\/chat\/completions$/.test(l.calls[0].url));
  }

  // ── cloud thinking, when asked ──
  {
    const cloud = { aiAnthropicKey: KEY, aiAgreed: ['anthropic', 'gemini'], aiGeminiKey: KEY };
    const a = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'thinking', thinking: 'Made-up summary.' }, { type: 'text', text: 'B+' }] } }));
    let r = await ai.complete({ prompt: 'x', maxTokens: 1200, think: true }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-x' }, { fetch: a.fetch });
    ok('Anthropic: adaptive thinking, summarized, with room for it', a.calls.length === 1 && a.calls[0].body.thinking.type === 'adaptive' && a.calls[0].body.thinking.display === 'summarized' &&
      a.calls[0].body.max_tokens === 16000 && r.text === 'B+' && r.thinking === 'Made-up summary.', JSON.stringify([a.calls[0].body, r]));
    const old = fakeFetch((url, init) => JSON.parse(init.body).thinking ? { status: 400, json: { error: { message: 'thinking.type: adaptive is not supported for this model' } } } : { status: 200, json: { content: [{ type: 'text', text: 'Plain' }] } });
    r = await ai.complete({ prompt: 'x', maxTokens: 1200, think: true }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-old' }, { fetch: old.fetch });
    ok('...an older model that refuses it: asked without', old.calls.length === 2 && !old.calls[1].body.thinking && old.calls[1].body.max_tokens === 1200 && r.ok && r.text === 'Plain' && !r.thinking, JSON.stringify(r));
    const bad = fakeFetch(() => ({ status: 401, json: { error: { message: 'invalid x-api-key' } } }));
    r = await ai.complete({ prompt: 'x', think: true }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-x' }, { fetch: bad.fetch });
    ok('...a refused key isn\'t retried', !r.ok && bad.calls.length === 1);
    const plain = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'text', text: 'Hi' }] } }));
    await ai.complete({ prompt: 'x' }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-x' }, { fetch: plain.fetch });
    ok('...not asked: no thinking sent (the announcement scan stays as it was)', !plain.calls[0].body.thinking && plain.calls[0].body.max_tokens === 2048);
    const g = fakeFetch(() => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: 'Made-up thought.', thought: true }, { text: 'A-' }] } }] } }));
    r = await ai.complete({ prompt: 'x', think: true }, { ...cloud, aiProvider: 'gemini' }, { fetch: g.fetch });
    ok('Gemini: thoughts asked for, kept apart from the answer', g.calls[0].body.generationConfig.thinkingConfig.includeThoughts === true && r.text === 'A-' && r.thinking === 'Made-up thought.', JSON.stringify(r));
    const g2 = fakeFetch((url, init) => JSON.parse(init.body).generationConfig ? { status: 400, json: { error: { message: 'Thinking is not supported for this model.' } } } : { status: 200, json: { candidates: [{ content: { parts: [{ text: 'Old' }] } }] } });
    r = await ai.complete({ prompt: 'x', think: true }, { ...cloud, aiProvider: 'gemini' }, { fetch: g2.fetch });
    ok('...a model that doesn\'t think: asked without', g2.calls.length === 2 && r.text === 'Old');
  }

  // ── streaming: the answer in pieces as it's written ──
  {
    // A body that arrives in chunks cut mid-line, the way a network does.
    const streamFetch = (lines, status = 200) => {
      const calls = [];
      const whole = lines.join('\n') + '\n';
      const chunks = []; for (let i = 0; i < whole.length; i += 7) chunks.push(Buffer.from(whole.slice(i, i + 7)));
      return { calls, fetch: async (url, init = {}) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: status < 400, status, text: async () => whole, body: (async function* () { for (const c of chunks) yield c; })() };
      } };
    };
    const seen = [];
    const onPart = p => seen.push(JSON.parse(JSON.stringify(p)));
    const cloud = { aiAnthropicKey: KEY, aiOpenaiKey: KEY, aiGeminiKey: KEY, aiAgreed: ['anthropic', 'gemini', 'openai'] };

    let f = streamFetch([JSON.stringify({ message: { thinking: 'Made-up ' } }), JSON.stringify({ message: { thinking: 'adding.' } }),
      JSON.stringify({ message: { content: 'B' } }), JSON.stringify({ message: { content: '+' }, done: true })]);
    let r = await ai.complete({ prompt: 'x', think: true, onPart }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: f.fetch });
    ok('Ollama streams: stream on, thinking then answer, piece by piece', f.calls[0].body.stream === true && r.text === 'B+' && r.thinking === 'Made-up adding.' &&
      seen.length === 4 && seen[0].thinking === 'Made-up' && seen[1].thinking === 'Made-up adding.' && seen[2].text === 'B' && seen[3].text === 'B+', JSON.stringify([r, seen]));

    seen.length = 0;
    f = streamFetch([JSON.stringify({ message: { thinking: 'hidden' } }), JSON.stringify({ message: { content: 'Fast' }, done: true })]);
    r = await ai.complete({ prompt: 'x', think: false, onPart }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: f.fetch });
    ok('...think off: no thinking shown even mid-stream', r.text === 'Fast' && !r.thinking && seen.every(p => p.thinking === ''), JSON.stringify(seen));

    seen.length = 0;
    f = streamFetch(['data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Hmm.' } }] }), '', 'data: ' + JSON.stringify({ choices: [{ delta: { content: '<think>more</think>A' } }] }), 'data: [DONE]']);
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: f.fetch });
    ok('LM Studio streams "data:" lines; <think> taken out of the answer', f.calls[0].body.stream === true && r.text === 'A' && r.thinking === 'Hmm.\nmore', JSON.stringify(r));

    seen.length = 0;
    f = streamFetch(['data: ' + JSON.stringify({ choices: [{ delta: { content: '<think>still go' } }] })]);
    await ai.complete({ prompt: 'x', onPart }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: f.fetch });
    ok('...a <think> not closed yet shows as thinking, not answer', seen[0].thinking === 'still go' && seen[0].text === '', JSON.stringify(seen));

    f = streamFetch(['event: content_block_delta', 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Made-up summary.' } }),
      'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'A-' } }), 'data: ' + JSON.stringify({ type: 'message_stop' })]);
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-x' }, { fetch: f.fetch });
    ok('Anthropic streams thinking and text deltas', f.calls[0].body.stream === true && f.calls[0].body.thinking.type === 'adaptive' && r.text === 'A-' && r.thinking === 'Made-up summary.', JSON.stringify(r));

    f = streamFetch(['data: ' + JSON.stringify({ type: 'error', error: { message: 'Overloaded' } })]);
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-x' }, { fetch: f.fetch });
    ok('...an error mid-stream says so', !r.ok && /Overloaded/.test(r.why), JSON.stringify(r));

    const refuse = streamFetch(['{"error":{"message":"thinking.type: adaptive is not supported"}}'], 400);
    const okAfter = streamFetch(['data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Plain' } })]);
    let n = 0;
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { ...cloud, aiProvider: 'anthropic', aiModel: 'claude-old' }, { fetch: (...a) => (n++ ? okAfter : refuse).fetch(...a) });
    ok('...an older model that refuses thinking: streamed without it', n === 2 && !okAfter.calls[0].body.thinking && r.text === 'Plain', JSON.stringify(r));

    f = streamFetch(['data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Made-up thought.', thought: true }] } }] }), 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'C' }] } }] })]);
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { ...cloud, aiProvider: 'gemini' }, { fetch: f.fetch });
    ok('Gemini streams from streamGenerateContent, thoughts apart', /:streamGenerateContent\?alt=sse$/.test(f.calls[0].url) && r.text === 'C' && r.thinking === 'Made-up thought.', JSON.stringify([f.calls[0].url, r]));

    f = streamFetch(['data: ' + JSON.stringify({ choices: [{ delta: { content: 'O' } }] }), 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'K' } }] }), 'data: [DONE]']);
    r = await ai.complete({ prompt: 'x', think: true, onPart }, { ...cloud, aiProvider: 'openai' }, { fetch: f.fetch });
    ok('OpenAI streams too, with its key', f.calls[0].url === 'https://api.openai.com/v1/chat/completions' && r.text === 'OK');

    f = streamFetch(['{"error":"made-up nope"}'], 401);
    r = await ai.complete({ prompt: 'x', onPart }, { ...cloud, aiProvider: 'openai' }, { fetch: f.fetch });
    ok('...a refused key reads the same as before, never with the key', !r.ok && /key was refused/.test(r.why) && !r.why.includes(KEY), r.why);
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
    ok('...no Codex, and no cloud provider asked when none is saved', r.codex === null && r.cloud === null && !f.calls.some(c => /anthropic|openai|google/.test(c.url)));
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

  // ── Foundry Local: its address asked of it, started when stopped, a model loaded when it isn't ──
  {
    const { EventEmitter } = require('events');
    // A stand-in foundry command: status prints its address only once it's
    // started (old-style output, colours and all), and load loads.
    const make = ({ running = false, loaded = false, oldCli = false } = {}) => {
      const state = { running, loaded, cmds: [] };
      state.spawn = (file, args, options) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        child.stdin = { on() {}, end() {
          const a = args.join(' ');
          state.cmds.push(a);
          let out = '', code = 0;
          if (oldCli && args[0] === 'server') { code = 1; out = 'Unknown command server'; }
          else if (/^(server|service) status$/.test(a)) out = state.running ? '\u001b[32m🟢 Model management service is running on http://127.0.0.1:5273/openai/status\u001b[0m\n' : 'Model management service is not running!\n';
          else if (/^(server|service) start$/.test(a)) state.running = true;
          else if (a === 'model load phi-4-mini-instruct-generic-cpu:1') state.loaded = true;
          else code = 1;
          setImmediate(() => { child.stdout.emit('data', out); child.emit('close', code); });
        } };
        child.kill = () => {};
        return child;
      };
      state.fetch = fakeFetch(url => {
        if (!state.running) return { throws: new Error('ECONNREFUSED') };
        if (/\/v1\/models$/.test(url)) return { status: 200, json: { data: state.loaded ? [{ id: 'phi-4-mini-instruct-generic-cpu:1' }] : [] } };
        return state.loaded ? chat('From Foundry') : { status: 404, json: { error: { message: 'Model phi-4-mini-instruct-generic-cpu:1 not loaded' } } };
      });
      return state;
    };
    const bin = path.join('/opt/homebrew/bin', 'foundry');
    const deps = st => ({ platform: 'darwin', env: { PATH: '/usr/bin' }, exists: f => f === bin, home: '/Users/nobody', spawn: st.spawn, fetch: st.fetch.fetch });
    const set = { aiProvider: 'foundry', aiModel: 'phi-4-mini-instruct-generic-cpu:1', aiLocalUrl: 'http://localhost:9999/v1' };

    ok('its address, from what its status prints', ai.foundryAddress('\u001b[32mrunning on http://127.0.0.1:5273/openai/status\u001b[0m') === 'http://127.0.0.1:5273/v1' &&
      ai.foundryAddress('Endpoint: http://localhost:52495/v1.') === 'http://localhost:52495/v1');
    ok('...but never one that isn\'t this computer, or one with no port', ai.foundryAddress('see https://aka.ms/foundry-local-docs and http://192.168.1.5:5273') === null &&
      ai.foundryAddress('http://localhost/v1') === null && ai.foundryAddress('not running') === null);
    ok('local: no box to tick', ai.ready(ai.configFrom(set)).ok && ai.PROVIDERS.foundry.local);

    let st = make();
    let r = await ai.complete({ system: 'Be brief.', prompt: 'Hi?' }, set, deps(st));
    ok('stopped: started, its address asked again, the saved address ignored, the model loaded and asked once more', r.ok && r.text === 'From Foundry' &&
      JSON.stringify(st.cmds) === JSON.stringify(['server status', 'service status', 'server start', 'server status', 'model load phi-4-mini-instruct-generic-cpu:1']) &&
      st.fetch.calls.length === 2 && st.fetch.calls.every(c => c.url === 'http://127.0.0.1:5273/v1/chat/completions') && st.fetch.calls[1].body.messages[0].content === 'Be brief.',
      JSON.stringify({ r, cmds: st.cmds, urls: st.fetch.calls.map(c => c.url) }));
    st = make({ running: true, loaded: true });
    r = await ai.complete({ prompt: 'Hi?' }, set, deps(st));
    ok('running and loaded: just its status, then the question', r.ok && JSON.stringify(st.cmds) === '["server status"]' && st.fetch.calls.length === 1);
    st = make({ running: true, oldCli: true, loaded: true });
    r = await ai.complete({ prompt: 'Hi?' }, set, deps(st));
    ok('an older Foundry Local: "service status" instead', r.ok && JSON.stringify(st.cmds) === '["server status","service status"]', JSON.stringify(st.cmds));
    st = make({ running: true });
    r = await ai.complete({ prompt: 'Hi?' }, { ...set, aiModel: 'not-downloaded' }, deps(st));
    ok('a model it can\'t load: says to download it', !r.ok && /foundry model download not-downloaded/.test(r.why), r.why);
    r = await ai.complete({ prompt: 'Hi?' }, { ...set, aiModel: 'phi; rm -rf ~' }, deps(make({ running: true })));
    ok('a model name with odd characters never reaches its command line', !r.ok && /model name/.test(r.why));
    r = await ai.complete({ prompt: 'Hi?' }, set, { ...deps(make()), exists: () => false });
    ok('not installed: says how to get it', !r.ok && /isn't installed.*winget install Microsoft\.FoundryLocal/.test(r.why), r.why);
    st = make({ running: true });
    r = await ai.test({ aiProvider: 'foundry' }, deps(st));
    ok('Test with nothing loaded: says to download and load one', !r.ok && /no model loaded yet/.test(r.why), r.why);
    st = make({ running: true, loaded: true });
    r = await ai.test({ aiProvider: 'foundry' }, deps(st));
    ok('Test with one loaded: picks it', r.ok && r.model === 'phi-4-mini-instruct-generic-cpu:1', JSON.stringify(r));

    const nofetch = async () => { throw new Error('nothing'); };
    st = make({ running: true, loaded: true });
    let found = await ai.detect({}, { ...deps(st), fetch: (u, i) => /5273/.test(u) ? st.fetch.fetch(u, i) : nofetch() });
    ok('detect: running, with its address and models', found.foundry && found.foundry.url === 'http://127.0.0.1:5273/v1' && JSON.stringify(found.foundry.models) === '["phi-4-mini-instruct-generic-cpu:1"]', JSON.stringify(found.foundry));
    st = make();
    found = await ai.detect({}, { ...deps(st), fetch: nofetch });
    ok('...stopped: found, not started just to look', found.foundry && found.foundry.url === null && !st.cmds.some(c => /start/.test(c)));
    found = await ai.detect({}, { ...deps(st), exists: () => false, fetch: nofetch });
    ok('...not installed: null', found.foundry === null);
    const win = path.join('C:\\Users\\kid\\AppData\\Local', 'Microsoft', 'WindowsApps', 'foundry.exe');
    ok('Windows: found where winget puts it', ai.findFoundry({ platform: 'win32', env: { PATH: '', LOCALAPPDATA: 'C:\\Users\\kid\\AppData\\Local' }, exists: f => f === win }) === win);
  }

  // ── detect: Codex installed, and whether it's signed in ──
  {
    const { EventEmitter } = require('events');
    const asked = [];
    const status = code => (file, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end() { asked.push(args); setImmediate(() => child.emit('close', code)); } };
      child.kill = () => {};
      return child;
    };
    const bin = '/opt/homebrew/bin/codex';
    const deps = { platform: 'darwin', env: { PATH: '/usr/bin' }, exists: f => f === bin, home: '/Users/nobody', fetch: async () => { throw new Error('nothing'); } };
    let found = await ai.detect({}, { ...deps, spawn: status(0) });
    ok('detect: Codex signed in, asked through codex login status', found.codex.ok === true && asked[0].join(' ') === 'login status', JSON.stringify(found.codex));
    found = await ai.detect({}, { ...deps, spawn: status(1) });
    ok('...installed but signed out: not ok', found.codex.ok === false && found.codex.why === 'signedOut');
    found = await ai.detect({}, { ...deps, exists: () => false, spawn: status(0) });
    ok('...not installed: null', found.codex === null);
  }

  // ── Claude Code: the person's own claude, no tools, in an empty folder ──
  {
    const runs = [];
    const fakeSpawn = ({ code = 0, out = 'Done\n', err = '' } = {}) => (file, args, options) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { on() {}, end(input) {
        runs.push({ file, args, options, input, folderFiles: options.cwd ? fs.readdirSync(options.cwd) : null });
        setImmediate(() => { if (out) child.stdout.emit('data', out); if (err) child.stderr.emit('data', err); child.emit('close', code); });
      } };
      child.kill = () => {};
      return child;
    };
    const bin = '/Users/nobody/.local/bin/claude';
    const deps = { platform: 'darwin', env: { PATH: '/usr/bin', CLAUDECODE: '1' }, exists: f => f === bin, home: '/Users/nobody' };
    const set = { aiProvider: 'claudecode', aiAgreed: ['claudecode'] };
    const notAgreed = await ai.complete({ prompt: 'x' }, { aiProvider: 'claudecode' }, { ...deps, spawn: fakeSpawn() });
    ok('Claude Code: nothing runs before its box is ticked', !notAgreed.ok && runs.length === 0);
    const r = await ai.complete({ system: 'Be brief.', prompt: 'Hello?' }, set, { ...deps, spawn: fakeSpawn() });
    const run = runs[0];
    const after = flag => run.args[run.args.indexOf(flag) + 1];
    ok('...found where its installer puts it, the answer from its output', r.ok && r.text === 'Done' && run.file === bin, JSON.stringify(r));
    ok('...print mode, no tools, no settings or MCP servers, nothing saved, Haiku unless told', run.args.includes('-p') && after('--tools') === '' && after('--setting-sources') === '' &&
      run.args.includes('--strict-mcp-config') && run.args.includes('--no-session-persistence') && after('--model') === 'haiku' && after('--output-format') === 'text', JSON.stringify(run.args));
    ok('...its coding system prompt replaced, ClassDash\'s instructions and the prompt on stdin', /^Follow the instructions/.test(after('--system-prompt')) && run.input === 'Be brief.\n\nHello?');
    ok('...run in an empty folder, removed after, not told it\'s nested', run.folderFiles.length === 0 && !fs.existsSync(run.options.cwd) && !('CLAUDECODE' in run.options.env));
    const signedOut = await ai.complete({ prompt: 'x' }, set, { ...deps, spawn: fakeSpawn({ code: 1, out: 'Failed to authenticate: OAuth session expired and could not be refreshed\n' }) });
    ok('not signed in: says to run claude auth login', !signedOut.ok && /claude auth login/.test(signedOut.why), signedOut.why);
    const limit = await ai.complete({ prompt: 'x' }, set, { ...deps, spawn: fakeSpawn({ code: 1, out: '', err: 'Claude usage limit reached. Your limit will reset at 5pm.\n' }) });
    ok('any other stop: in its own words', !limit.ok && /usage limit reached/.test(limit.why), limit.why);
    const missing = await ai.complete({ prompt: 'x' }, set, { ...deps, exists: () => false, spawn: fakeSpawn() });
    ok('not installed: says so', !missing.ok && /isn't installed/.test(missing.why));
    const odd = await ai.complete({ prompt: 'x' }, { ...set, aiModel: 'opus; rm -rf' }, { ...deps, spawn: fakeSpawn() });
    ok('a model name with odd characters never reaches its command line', !odd.ok && runs.length === 2 + 1 + 0 + 0 && /model name/.test(odd.why), odd.why);
    const winBin = path.join('C:\\Users\\kid\\AppData\\Roaming', 'npm', 'claude.cmd');
    await ai.complete({ prompt: 'x' }, { ...set, aiModel: 'sonnet' },
      { platform: 'win32', env: { PATH: '', APPDATA: 'C:\\Users\\kid\\AppData\\Roaming' }, exists: f => f === winBin, spawn: fakeSpawn() });
    const w = runs[runs.length - 1];
    ok('Windows: npm\'s claude.cmd, through the shell, every argument quoted', w.file === `"${winBin}"` && w.options.shell === true &&
      w.args.every(a => /^".*"$/.test(a)) && w.args.includes('"sonnet"') && w.args.includes('""'), JSON.stringify(w && { file: w.file, args: w.args }));
    const nofetch = async () => { throw new Error('nothing'); };
    const before = runs.length;
    let found = await ai.detect({}, { ...deps, fetch: nofetch, spawn: fakeSpawn({ out: '{"loggedIn":true,"authMethod":"claude.ai"}' }) });
    ok('detect: Claude Code installed and signed in, asked through claude auth status', found.claudeCode.ok === true && found.codex === null &&
      runs[before].args.slice(0, 2).join(' ') === 'auth status' && !('CLAUDECODE' in runs[before].options.env));
    found = await ai.detect({}, { ...deps, fetch: nofetch, spawn: fakeSpawn({ out: '{"loggedIn":false,"authMethod":"none"}' }) });
    ok('...installed but signed out: not ok', found.claudeCode.ok === false);
    found = await ai.detect({}, { ...deps, exists: () => false, fetch: nofetch, spawn: fakeSpawn() });
    ok('...not installed: null', found.claudeCode === null);
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

  // ── Settings → AI on the page: setting each AI up ──
  const page = settingsJson => {
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(settingsJson));
    T.redraw(proj);
    const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
    const { JSDOM, VirtualConsole } = T.jsdom();
    const posted = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; w.setTimeout = () => 0; },
    });
    return { w: dom.window, d: dom.window.document, posted };
  };
  const tick = () => new Promise(r => setImmediate(r));
  {
    const { w, d, posted } = page({ language: 'en', aiOpenaiKey: KEY });
    const row = id => d.querySelector(`[data-section="ai"] .ai-prov[data-ai="${id}"]`);
    const rows = [...d.querySelectorAll('[data-section="ai"] .ai-prov')].map(e => e.getAttribute('data-ai'));
    ok('a row for every AI, local ones first, then cloud', rows.join() === ai.PROVIDER_IDS.filter(id => id !== 'apple' || process.platform === 'darwin').join(), rows.join());
    ok('...no picking one here: no AI dropdown, no Model field', !d.querySelector('[data-key="aiProvider"]') && !d.querySelector('[data-key="aiModel"]'));
    ok('...the announcement scan\'s picker is under Announcements', !!d.querySelector('#ai-scan #ai-scan-pick'));
    const notice = row('openai').querySelector('.ai-notice');
    ok('OpenAI: what it gets, its age rule and its links', /OpenAI gets a copy/.test(notice.textContent) && /13 or older/.test(notice.textContent) &&
      [...notice.querySelectorAll('a')].map(a => a.href).join() === 'https://openai.com/policies/terms-of-use/,https://openai.com/policies/privacy-policy/', notice.textContent);
    ok('...its key, masked, in its own row', row('openai').querySelector('[data-key="aiOpenaiKey"]').type === 'password' && !row('openai').querySelector('[data-key="aiAnthropicKey"]'));
    const anth = row('anthropic').querySelector('.ai-notice').textContent;
    ok('Anthropic: 18 or older, about the student, with a note for parents', /18 or older/.test(anth) && /The student this ClassDash is for is 18 or older/.test(anth) && /your child/.test(anth));
    const why = [...d.querySelectorAll('[data-section="ai"] .ai-why')];
    ok('one "which to pick" fold-out at the top: local first, the age rules, Claude Code\'s gray area and why no Google plan',
      why.length === 1 && !why[0].closest('.ai-prov') && why[0] === d.querySelector('[data-section="ai"] .hint').nextElementSibling &&
      /A local one if you can/.test(why[0].textContent) && /13 or older/.test(why[0].textContent) && /18 or older/.test(why[0].textContent) &&
      /Claude through Claude Code a gray area/.test(why[0].textContent) && /Google AI Pro/.test(why[0].textContent) && /with a key is the sure way/.test(why[0].textContent));
    const cc = row('claudecode').querySelector('.ai-notice');
    ok('Claude Code: the gray area first, 18 or older, and its box says both',
      cc.querySelector('p').classList.contains('ai-gray') && /A gray area/.test(cc.querySelector('p').textContent) && /18 or older/.test(cc.textContent) &&
      /18 or older.*gray area in Anthropic's terms/.test(cc.querySelector('.ai-agree').textContent) && /claude auth login/.test(row('claudecode').querySelector('.field-hint').textContent));
    ok('...and only the Anthropic API\'s box has no gray area', !/gray area/.test(row('anthropic').querySelector('.ai-notice').textContent));
    const gem = row('gemini').querySelector('.ai-notice').textContent;
    ok('Gemini: 18 or older, and the free tier\'s training', /18 or older/.test(gem) && /free tier/.test(gem));
    ok('Ollama and LM Studio: an address of their own, no age box', !!row('ollama').querySelector('[data-key="aiOllamaUrl"]') && !!row('lmstudio').querySelector('[data-key="aiLmstudioUrl"]') &&
      !row('ollama').querySelector('.ai-notice') && !row('foundry').querySelector('[data-key$="Url"]'));
    ok('nothing asked until the section is shown', posted.length === 0);

    // Test with the box unticked: nothing sent.
    const button = row('openai').querySelector('.ai-test');
    const status = row('openai').querySelector('.ai-test-status');
    w.testAi(button);
    ok('Test with the box unticked: asks for it, sends nothing', posted.length === 0 && /Tick the box/.test(status.textContent));
    row('openai').querySelector('[data-key="aiAgreed"]').checked = true;
    w.testAi(button);
    const sent = JSON.parse(Buffer.from(posted[0].arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    ok('ticked: saves first, the box in aiAgreed', posted[0].action === 'config' && JSON.stringify(sent.aiAgreed) === '["openai"]' && !('aiProvider' in sent) && !('aiModel' in sent), JSON.stringify(sent));
    w.classdashBridgeResult(posted[0].id, { ok: true, accepted: [], rejected: [] });
    ok('...then tests that AI, with no key in the test\'s own message', posted[1] && posted[1].action === 'aiTest' && posted[1].arg === 'openai' && !JSON.stringify(posted[1]).includes(KEY), JSON.stringify(posted[1]));
    w.classdashBridgeResult(posted[1].id, { ok: true, model: 'gpt-5-mini', ms: 1234, reply: 'OK' });
    ok('...says it works, in its own row', /Works: answered in 1\.2 s\. \(gpt-5-mini\)/.test(status.textContent), status.textContent);
    ok('...and looks again at every AI\'s state', posted.some(m => m.action === 'aiChoices'));
    ok('saved means closing the panel doesn\'t save again', w.settingsDirty() === false);
    w.close();
  }

  // ── the states, and the announcement scan's picker ──
  {
    const { w, d, posted } = page({ language: 'en' });
    w.showSettingsSection('ai', null);
    w.showSettingsSection('ai', null);
    const asks = posted.filter(m => m.action === 'aiChoices');
    ok('showing the AI section looks once, for the states and the scan\'s picker together', asks.length === 1 && posted.length === 1, JSON.stringify(posted.map(m => m.action)));
    const p = (id, extra) => ({ id, label: ai.PROVIDERS[id].label, local: !!ai.PROVIDERS[id].local, ok: true, models: [], model: ai.PROVIDERS[id].model || '', ...extra });
    w.classdashBridgeResult(asks[0].id, { ok: true, providers: [
      p('apple', { ok: false, why: 'unavailable', detail: 'Apple Intelligence is off (turn it on in System Settings)' }),
      p('ollama', { models: ['big:8b', 'small:1b'], url: 'http://localhost:11434/v1' }), p('lmstudio', { ok: false, why: 'notFound' }),
      p('foundry', { stopped: true }), p('codex'), p('claudecode', { ok: false, why: 'signedOut' }),
      p('openai', { ok: false, why: 'agree' }), p('anthropic', { ok: false, why: 'agree' }), p('gemini', { ok: false, why: 'agree' }),
    ], current: { provider: 'none', model: '' }, scan: { provider: 'none', model: '' } });
    await tick();
    const state = id => (d.querySelector(`.ai-prov[data-ai="${id}"] .ai-state`) || {}).textContent;
    ok('ready ones say so, local ones with their models', state('ollama') === '✓ 2 models' && state('codex') === '✓ ready', state('ollama') + ' | ' + state('codex'));
    ok('Foundry Local stopped: ready anyway, saying ClassDash starts it', /✓ not running, ClassDash starts it/.test(state('foundry')));
    ok('not found, and signed out with the command to sign in', /Not on this computer/.test(state('lmstudio')) && /claude auth login/.test(state('claudecode')));
    ok('a cloud one not ticked says so', /Tick its box/.test(state('openai')));
    if (process.platform === 'darwin') ok('Apple Intelligence that can\'t be used says why', /Not available here: Apple Intelligence is off/.test(state('apple')));
    ok('the scan\'s picker shows it\'s off', /Off ▾/.test(d.querySelector('#ai-scan-pick .mp-trigger').textContent));
    posted.length = 0;
    w.refreshAiStates(true);
    ok('Look again asks again', posted.filter(m => m.action === 'aiChoices').length === 1 && d.getElementById('ai-look').disabled);
    w.close();
  }

  // ── no model picked: the cloud API's newest ──
  {
    ok('the newest of a family, by the version in its name', ai.newestOf('anthropic', ['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-5-5']) === 'claude-haiku-5-5' &&
      ai.newestOf('openai', ['gpt-4.1-mini', 'gpt-5-mini', 'gpt-5', 'gpt-4o-mini', 'gpt-5-mini-2025-08-07']) === 'gpt-5-mini' &&
      ai.newestOf('openai', ['gpt-6-mini', 'gpt-5.6-luna', 'gpt-6-luna', 'gpt-5.6-luna-20260709', 'gpt-6']) === 'gpt-6-luna' &&
      ai.newestOf('gemini', ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-3-pro', 'gemini-2.5-flash-lite']) === 'gemini-3-flash' &&
      ai.newestOf('ollama', ['x']) === null);
    fs.rmSync(path.join(proj, 'ai-defaults.json'), { force: true });
    const f = fakeFetch(url => /\/models/.test(url) ? { status: 200, json: { data: [{ id: 'claude-haiku-4-5-20251001' }, { id: 'claude-haiku-6-0' }, { id: 'claude-opus-5-5' }] } }
      : { status: 200, json: { content: [{ type: 'text', text: 'OK' }] } });
    const s = { aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'] };
    const r = await ai.complete({ prompt: 'x' }, s, { fetch: f.fetch });
    ok('none picked: asked with the newest Haiku in its list', r.ok && f.calls[0].url.endsWith('/models?limit=100') && f.calls[1].body.model === 'claude-haiku-6-0', JSON.stringify(f.calls.map(c => c.body && c.body.model)));
    const again = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'text', text: 'OK' }] } }));
    await ai.complete({ prompt: 'x' }, s, { fetch: again.fetch });
    ok('...kept a day: the next question doesn\'t look again', again.calls.length === 1 && again.calls[0].body.model === 'claude-haiku-6-0');
    const picked = fakeFetch(() => ({ status: 200, json: { content: [{ type: 'text', text: 'OK' }] } }));
    await ai.complete({ prompt: 'x' }, { ...s, aiModel: 'claude-opus-5-5' }, { fetch: picked.fetch });
    ok('a picked model is used as it is', picked.calls.length === 1 && picked.calls[0].body.model === 'claude-opus-5-5');
    fs.rmSync(path.join(proj, 'ai-defaults.json'), { force: true });
    const down = fakeFetch(url => /\/models/.test(url) ? { status: 500, json: {} } : { status: 200, json: { content: [{ type: 'text', text: 'OK' }] } });
    await ai.complete({ prompt: 'x' }, s, { fetch: down.fetch });
    ok('...the list unreadable: ClassDash\'s own default', down.calls[down.calls.length - 1].body.model === 'claude-haiku-5-5');
    seedNewest();
  }

  // ── effort: medium where it can be told, unless another is picked ──
  {
    const e = (provider, model, effort = '') => ai.effortToSend(ai.configFrom({ aiProvider: provider, aiModel: model, aiEffort: effort }));
    ok('Codex, Claude Code and the APIs\' thinking models: medium unless picked', e('codex', '') === 'medium' && e('claudecode', 'haiku') === 'medium' && e('claudecode', 'opus', 'high') === 'high' &&
      e('openai', 'gpt-6-luna') === 'medium' && e('anthropic', 'claude-haiku-5-5', 'low') === 'low');
    ok('...not told at all where the model can\'t take it', e('openai', 'gpt-4.1-mini') === null && e('anthropic', 'claude-haiku-4-5') === null && e('gemini', 'gemini-3-flash') === null);
    ok('LM Studio and Ollama: only told when one was picked', e('lmstudio', 'm') === null && e('lmstudio', 'm', 'off') === 'off' && e('ollama', 'm') === null && e('ollama', 'm', 'off') === 'off');
    const answer = { status: 200, json: { content: [{ type: 'text', text: 'OK' }], choices: [{ message: { content: 'OK' } }], message: { content: 'OK' } } };
    const a = fakeFetch(() => answer);
    await ai.complete({ prompt: 'x' }, { aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'] }, { fetch: a.fetch });
    ok('Anthropic: output_config.effort medium on Haiku 5.5', a.calls[0].body.output_config && a.calls[0].body.output_config.effort === 'medium', JSON.stringify(a.calls[0].body));
    const o = fakeFetch(() => answer);
    await ai.complete({ prompt: 'x' }, { aiProvider: 'openai', aiModel: 'gpt-6-luna', aiEffort: 'high', aiOpenaiKey: KEY, aiAgreed: ['openai'] }, { fetch: o.fetch });
    ok('OpenAI: reasoning_effort as picked', o.calls[0].body.reasoning_effort === 'high');
    const l = fakeFetch(() => answer);
    await ai.complete({ prompt: 'x' }, { aiProvider: 'lmstudio', aiModel: 'nemo', aiEffort: 'off' }, { fetch: l.fetch });
    const l2 = fakeFetch(() => answer);
    await ai.complete({ prompt: 'x' }, { aiProvider: 'lmstudio', aiModel: 'nemo' }, { fetch: l2.fetch });
    ok('LM Studio: off sent as reasoning_effort "none" (what it takes), nothing when none picked', l.calls[0].body.reasoning_effort === 'none' && !('reasoning_effort' in l2.calls[0].body));
    const ol = fakeFetch(() => answer);
    await ai.complete({ prompt: 'x', think: true }, { aiProvider: 'ollama', aiModel: 'm', aiEffort: 'off' }, { fetch: ol.fetch });
    ok('Ollama: off is think false', ol.calls[0].body.think === false);

    // LM Studio's own list: chat models only, and each one's levels.
    const lm = fakeFetch(url => url === 'http://localhost:1234/api/v1/models' ? { status: 200, json: { models: [
      { type: 'llm', key: 'nvidia/nemotron-made-up', capabilities: { reasoning: { allowed_options: ['off', 'on'], default: 'on' } } },
      { type: 'llm', key: 'plain-made-up', capabilities: { vision: true } },
      { type: 'embedding', key: 'embed-made-up' }] } }
      : url === 'http://localhost:1234/v1/models' ? { status: 200, json: { data: [{ id: 'nvidia/nemotron-made-up' }, { id: 'plain-made-up' }, { id: 'phonon-40m-multilingual' }] } } : { throws: new Error('connection refused') });
    const c = await ai.choices({ aiProvider: 'none' }, { fetch: lm.fetch, exists: () => false, platform: 'linux' });
    const lmp = c.providers.find(p => p.id === 'lmstudio');
    ok('LM Studio\'s own list: chat models only, and the levels each takes', lmp.ok && lmp.models.join() === 'nvidia/nemotron-made-up,plain-made-up' &&
      JSON.stringify(lmp.efforts) === '{"nvidia/nemotron-made-up":{"levels":["off","on"],"usual":"on"}}', JSON.stringify(lmp));
    ok('...and which can see pictures', JSON.stringify(lmp.sees) === '["plain-made-up"]', JSON.stringify(lmp.sees));
    const cloud = await ai.choices({ aiProvider: 'none', aiOpenaiKey: KEY, aiAgreed: ['openai'] }, { fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-5-mini' }] }) }), exists: () => false, platform: 'linux' });
    ok('...a cloud one sees with every model', cloud.providers.find(p => p.id === 'openai').sees === true);
  }
})();
