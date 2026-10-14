/**
 * AI providers: one way to ask a language model something, whichever one
 * the person picked in Settings → AI.
 *
 * ── What it's for ──
 *
 * Some teachers post homework as an announcement instead of an assignment,
 * so it never shows up as due. Reading those announcements for homework is
 * the job this is for; this file only connects to a model and answers
 * complete() and test(). Nothing calls a model unless the person picked a
 * provider.
 *
 * ── Local first ──
 *
 * What goes to a model is class text: announcements, class names, and
 * through class names often a teacher's name. On this computer (Apple's
 * on-device model, Ollama, LM Studio, Foundry Local) it stays here; a cloud provider gets
 * a copy and keeps it under its own policy. So the local ones come first in
 * the panel and are the recommended ones, and the cloud ones work only
 * after the person has ticked that provider's own box (aiAgreed), which
 * states that provider's age rule:
 *
 *   OpenAI API, ChatGPT through Codex   13+, under 18 with a parent's or
 *                                       guardian's permission
 *   Anthropic API, Claude through       18+ (Claude's own apps are 18+, and
 *   Claude Code                         apps minors use need safeguards
 *                                       ClassDash doesn't have)
 *   Gemini API                          18+, and not in apps likely used by
 *                                       under-18s (Google's API terms)
 *
 * The age rules are the providers' own, checked 2026-10-05; the page links
 * to each provider's terms rather than restating them as law.
 *
 * ── How each is reached ──
 *
 *   apple      the ClassDash Mac app itself, run as `ClassDash --ai-respond`
 *              (16-summary.swift): Node can't load Apple's framework, the
 *              app can. Needs macOS 26+, Apple silicon, Apple Intelligence on.
 *   ollama,    their OpenAI-style API on this computer or the home network;
 *   lmstudio   only a local or private address is accepted, so "local" in
 *              the panel stays true.
 *   foundry    Microsoft's Foundry Local (Windows, and Macs with Apple
 *              silicon): the same OpenAI-style API, but on a port that
 *              changes each time it starts, so the address is asked of its
 *              own `foundry server status` before each use (`foundry
 *              service status` on its older versions), and it's started
 *              (`foundry server start`) when it isn't running: it stops
 *              itself when idle. Only an address on this computer is used.
 *              A model it hasn't loaded is loaded (`foundry model load`)
 *              and asked again once. Built from Microsoft's docs, not yet
 *              tried against the real thing.
 *   codex      the person's own `codex` command (`codex exec`), signed in
 *              with their ChatGPT plan (`codex login`), in a read-only
 *              sandbox in an empty folder.
 *   claudecode the person's own `claude` command (`claude -p`), signed in
 *              with their Claude plan (`claude auth login`), with no tools,
 *              settings, MCP servers or saved session, in an empty folder.
 *              A gray area, said on the panel: Anthropic's Agent SDK docs
 *              say other apps may not offer Claude plan logins or rate
 *              limits without its approval. ClassDash never signs in or
 *              sees the login, like T3 Code, but the requests still use
 *              the person's plan and its rate limits indirectly, through
 *              Claude Code: gray, not clearly against the rules.
 *   openai,    their HTTP APIs with the person's own key.
 *   anthropic,
 *   gemini
 *
 * Keys are credentials, like the Canvas token: masked in the panel, never
 * logged, and scrubbed out of any error a provider sends back. Prompts and
 * answers aren't logged either: they're class text.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 120 * 1000;

const PROVIDERS = {
  apple: { local: true, label: 'Apple Intelligence', mac: true },
  ollama: { local: true, label: 'Ollama', url: 'http://localhost:11434/v1' },
  // LM Studio Bionic, LM Studio's agent app on the same engine, serves on
  // 1235 (seen on a real install; one of the two runs at a time).
  lmstudio: { local: true, label: 'LM Studio', url: 'http://localhost:1234/v1', also: ['http://localhost:1235/v1'] },
  foundry: { local: true, label: 'Foundry Local' },
  codex: {
    local: false, label: 'ChatGPT (Codex)', company: 'OpenAI', minAge: 13, parent: true,
    terms: 'https://openai.com/policies/terms-of-use/', privacy: 'https://openai.com/policies/privacy-policy/',
  },
  claudecode: {
    local: false, label: 'Claude (Claude Code)', company: 'Anthropic', minAge: 18, grayZone: true, model: 'haiku',
    terms: 'https://www.anthropic.com/legal/consumer-terms', privacy: 'https://www.anthropic.com/legal/privacy',
  },
  openai: {
    local: false, label: 'OpenAI API', company: 'OpenAI', minAge: 13, parent: true,
    key: 'aiOpenaiKey', model: 'gpt-5-mini',
    terms: 'https://openai.com/policies/terms-of-use/', privacy: 'https://openai.com/policies/privacy-policy/',
  },
  anthropic: {
    local: false, label: 'Anthropic API (Claude)', company: 'Anthropic', minAge: 18,
    key: 'aiAnthropicKey', model: 'claude-haiku-4-5',
    terms: 'https://www.anthropic.com/legal/commercial-terms', privacy: 'https://www.anthropic.com/legal/privacy',
  },
  gemini: {
    local: false, label: 'Google Gemini API', company: 'Google', minAge: 18, freeTierTraining: true,
    key: 'aiGeminiKey', model: 'gemini-2.5-flash',
    terms: 'https://ai.google.dev/gemini-api/terms', privacy: 'https://policies.google.com/privacy',
  },
};
const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Whether an address for Ollama or LM Studio really is local: this computer
 * (localhost, 127.x, ::1), a private home-network address (10.x, 172.16-31.x,
 * 192.168.x) or a .local name. Anything else would send class text to some
 * other server while the panel calls it local, so it's refused.
 */
function localAddress(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The settings that describe a provider choice, with defaults filled in. */
function configFrom(settings) {
  const id = settings.aiProvider || 'none';
  const p = PROVIDERS[id];
  return {
    provider: id,
    model: String(settings.aiModel || '').trim() || (p && p.model) || '',
    // Foundry Local's address is asked of it each time (foundryUrl()).
    url: id === 'foundry' ? '' : (String(settings.aiLocalUrl || '').trim() || (p && p.url) || '').replace(/\/+$/, ''),
    key: p && p.key ? String(settings[p.key] || '').trim() : '',
    agreed: Array.isArray(settings.aiAgreed) ? settings.aiAgreed : [],
  };
}

/**
 * Whether this choice may be used at all, before anything is sent:
 * { ok } or { ok: false, why }. Every request goes through this, so a
 * cloud provider can't be reached without its box ticked.
 */
function ready(config, platform = process.platform) {
  const p = PROVIDERS[config.provider];
  if (!p) return { ok: false, why: 'AI is off' };
  if (p.mac && platform !== 'darwin') return { ok: false, why: 'Apple Intelligence is only on a Mac' };
  if (!p.local && !config.agreed.includes(config.provider)) {
    return { ok: false, why: `tick the box about ${p.company}'s terms first` };
  }
  if (p.key && !config.key) return { ok: false, why: 'no API key' };
  if (p.url && !localAddress(config.url)) return { ok: false, why: 'that address isn\'t on this computer or the home network' };
  return { ok: true };
}

/** An error a provider sent back, in one short line, with no key in it. */
function scrub(text, key) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (key) s = s.split(key).join('[key]');
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{4,}|AIza[A-Za-z0-9_-]{8,})/g, '[key]');
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

async function request(deps, url, { method = 'GET', headers = {}, body, key, local } = {}) {
  let res;
  try {
    res = await deps.fetch(url, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(deps.timeoutMs || TIMEOUT_MS),
    });
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? 'no answer in time'
      : local ? 'couldn\'t connect: is its server running?' : `couldn't connect (${scrub(e && e.message, key)})`;
    throw new Error(why);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: said below */ }
  if (!res.ok) throw refused(res.status, json, key);
  if (!json) throw new Error('the answer wasn\'t JSON');
  return json;
}

// What a provider said when it turned a request down, in plain words.
function refused(status, json, key) {
  const said = json && (json.error && (json.error.message || json.error) || json.message);
  const plain = status === 401 || status === 403 ? 'the key was refused'
    : status === 404 ? 'not found (check the model name)'
    : status === 429 ? 'too many requests, or out of credit'
    : `error ${status}`;
  return new Error(said && typeof said === 'string' ? `${plain}: ${scrub(said, key)}` : plain);
}

/**
 * Like request(), for an answer sent in pieces as it's written (stream on):
 * calls onLine with each line of it as it arrives, Ollama's JSON lines or
 * the others' "data:" lines. A refusal reads the same as request()'s.
 */
async function requestLines(deps, url, { method = 'POST', headers = {}, body, key, local } = {}, onLine) {
  let res;
  try {
    res = await deps.fetch(url, {
      method, headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs || TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e && e.name === 'TimeoutError' ? 'no answer in time'
      : local ? 'couldn\'t connect: is its server running?' : `couldn't connect (${scrub(e && e.message, key)})`);
  }
  if (!res.ok) {
    let json = null;
    try { json = JSON.parse(await res.text()); } catch { /* said in plain words */ }
    throw refused(res.status, json, key);
  }
  let rest = '';
  const take = chunk => {
    rest += chunk;
    for (let i; (i = rest.indexOf('\n')) >= 0;) {
      const line = rest.slice(0, i).replace(/\r$/, '');
      rest = rest.slice(i + 1);
      if (line.trim()) onLine(line);
    }
  };
  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
      const decoder = new TextDecoder();
      for await (const chunk of res.body) take(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    } else {
      take(await res.text());
    }
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw new Error('no answer in time');
    throw e;
  }
  if (rest.trim()) onLine(rest.replace(/\r$/, ''));
}

// The answer so far, as it streams in: its thinking kept apart from the
// answer, including any inside <think>…</think> (one still open counts as
// thinking until it closes). Each piece calls onPart with the whole of it.
function streamed(onPart) {
  let thinking = '', text = '';
  const view = () => {
    let t = thinking;
    let out = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, x) => { t = (t ? t + '\n' : '') + x; return ''; });
    const open = out.search(/<think>/i);
    if (open >= 0) { t = (t ? t + '\n' : '') + out.slice(open + 7); out = out.slice(0, open); }
    return { thinking: t.trim(), text: out };
  };
  return {
    add(kind, piece) {
      if (typeof piece !== 'string' || !piece) return;
      if (kind === 'thinking') thinking += piece; else text += piece;
      try { onPart(view()); } catch { /* showing it is a nicety */ }
    },
    result() { const v = view(); return v.thinking ? v : v.text; },
  };
}
// A "data:" line's JSON, or null for anything else ([DONE], event: lines).
const dataLine = line => {
  const m = /^data:\s*(.*)$/.exec(line);
  if (!m || m[1] === '[DONE]') return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

const OPENAI = 'https://api.openai.com/v1';
const ANTHROPIC = 'https://api.anthropic.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const anthropicHeaders = key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' });

// Chat models only: OpenAI's list also holds speech, image and embedding ones.
const NOT_CHAT = /embed|tts|whisper|dall-e|audio|realtime|image|transcribe|moderation|search|sora|computer-use|rerank/;

/** The models this provider offers this person, or null where there's no list. */
async function listModels(config, deps) {
  const { provider: id, key, url } = config;
  if (id === 'ollama' || id === 'lmstudio' || id === 'foundry') {
    const json = await request(deps, `${url}/models`, { local: true });
    return (json.data || []).map(m => m.id).filter(m => m && !NOT_CHAT.test(m)).sort();
  }
  if (id === 'openai') {
    const json = await request(deps, `${OPENAI}/models`, { headers: { Authorization: `Bearer ${key}` }, key });
    return (json.data || []).map(m => m.id).filter(m => m && !NOT_CHAT.test(m)).sort();
  }
  if (id === 'anthropic') {
    const json = await request(deps, `${ANTHROPIC}/models?limit=100`, { headers: anthropicHeaders(key), key });
    return (json.data || []).map(m => m.id).filter(Boolean);
  }
  if (id === 'gemini') {
    const json = await request(deps, `${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, key });
    return (json.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  return null;
}

// ── each provider's way of answering ──

async function viaHttp(config, { system, prompt, maxTokens, think, onPart }, deps) {
  const { provider: id, key, url, model } = config;
  // think true/false (the Grades center chat): Ollama sends its thinking
  // only through its own API with think on, never through the OpenAI-style
  // one below, and with think off it skips thinking, which is faster. A
  // model that can't think refuses either, and is asked the usual way.
  if (id === 'ollama' && typeof think === 'boolean') {
    try {
      const chatUrl = `${String(url).replace(/\/v1\/?$/, '')}/api/chat`;
      const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
      if (onPart) {
        const got = streamed(onPart);
        await requestLines(deps, chatUrl, { local: true, body: { model, stream: true, think, messages } }, line => {
          let part;
          try { part = JSON.parse(line); } catch { return; }
          if (part.error) throw new Error(typeof part.error === 'string' ? part.error : 'failed');
          got.add('thinking', part.message && part.message.thinking);
          got.add('text', part.message && part.message.content);
        });
        return got.result();
      }
      const json = await request(deps, chatUrl, {
        method: 'POST', local: true,
        body: { model, stream: false, think, messages },
      });
      const msg = json.message || {};
      const text = typeof msg.content === 'string' ? msg.content : '';
      const thinking = typeof msg.thinking === 'string' ? msg.thinking.trim() : '';
      return thinking ? { text, thinking } : text;
    } catch (e) {
      if (!/think/i.test(e && e.message)) throw e;
    }
  }
  if (id === 'ollama' || id === 'lmstudio' || id === 'foundry' || id === 'openai') {
    const base = id === 'openai' ? OPENAI : url;
    if (onPart) {
      const got = streamed(onPart);
      await requestLines(deps, `${base}/chat/completions`, {
        key, local: id !== 'openai',
        headers: id === 'openai' ? { Authorization: `Bearer ${key}` } : {},
        body: { model, stream: true, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] },
      }, line => {
        const part = dataLine(line);
        const delta = part && part.choices && part.choices[0] && part.choices[0].delta;
        if (!delta) return;
        got.add('thinking', delta.reasoning !== undefined ? delta.reasoning : delta.reasoning_content);
        got.add('text', delta.content);
      });
      return got.result();
    }
    const json = await request(deps, `${base}/chat/completions`, {
      method: 'POST', key, local: id !== 'openai',
      headers: id === 'openai' ? { Authorization: `Bearer ${key}` } : {},
      body: { model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] },
    });
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    // A thinking model's reasoning, when it sends one: beside the answer
    // (Ollama's "reasoning", LM Studio's "reasoning_content") or inside it
    // as <think>…</think>. Kept apart so only the answer is read as one.
    let text = msg && typeof msg.content === 'string' ? msg.content : '';
    let thinking = msg && (typeof msg.reasoning === 'string' ? msg.reasoning : typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '');
    text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, t) => { thinking = (thinking ? thinking + '\n' : '') + t; return ''; });
    return thinking ? { text, thinking: thinking.trim() } : text;
  }
  if (id === 'anthropic') {
    const body = thinking => ({ model, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }],
      // Its thinking, summarized (the newer models leave it out unless
      // asked); thinking counts against max_tokens, so there's room for it.
      ...(thinking ? { max_tokens: Math.max(maxTokens || 0, 16000), thinking: { type: 'adaptive', display: 'summarized' } } : { max_tokens: maxTokens || 2048 }) });
    const ask = onPart ? async thinking => {
      const got = streamed(onPart);
      await requestLines(deps, `${ANTHROPIC}/messages`, { key, headers: anthropicHeaders(key), body: { ...body(thinking), stream: true } }, line => {
        const ev = dataLine(line);
        if (!ev) return;
        if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'failed');
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'thinking_delta') got.add('thinking', ev.delta.thinking);
          if (ev.delta.type === 'text_delta') got.add('text', ev.delta.text);
        }
      });
      return { streamed: got.result() };
    } : thinking => request(deps, `${ANTHROPIC}/messages`, { method: 'POST', key, headers: anthropicHeaders(key), body: body(thinking) });
    let json;
    // An older model that can't think that way refuses it: asked without.
    if (think) { try { json = await ask(true); } catch (e) { if (!/think|adaptive|display/i.test(e && e.message)) throw e; } }
    if (!json) json = await ask(false);
    if (json.streamed !== undefined) return json.streamed;
    const blocks = json.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    const thinking = blocks.filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking).join('\n').trim();
    return thinking ? { text, thinking } : text;
  }
  if (id === 'gemini') {
    const body = thoughts => ({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // A summary of its thinking, as parts marked thought.
      ...(thoughts ? { generationConfig: { thinkingConfig: { includeThoughts: true } } } : {}),
    });
    const at = `${GEMINI}/models/${encodeURIComponent(model)}`;
    const ask = onPart ? async thoughts => {
      const got = streamed(onPart);
      await requestLines(deps, `${at}:streamGenerateContent?alt=sse`, { key, headers: { 'x-goog-api-key': key }, body: body(thoughts) }, line => {
        const part = dataLine(line);
        const parts = (part && part.candidates && part.candidates[0] && part.candidates[0].content && part.candidates[0].content.parts) || [];
        for (const p of parts) got.add(p.thought ? 'thinking' : 'text', p.text);
      });
      return { streamed: got.result() };
    } : thoughts => request(deps, `${at}:generateContent`, { method: 'POST', key, headers: { 'x-goog-api-key': key }, body: body(thoughts) });
    let json;
    // A model that doesn't think refuses it: asked without.
    if (think) { try { json = await ask(true); } catch (e) { if (!/think|thought/i.test(e && e.message)) throw e; } }
    if (!json) json = await ask(false);
    if (json.streamed !== undefined) return json.streamed;
    const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('');
    const thinking = parts.filter(p => p.thought).map(p => p.text || '').join('\n').trim();
    return thinking ? { text, thinking } : text;
  }
  throw new Error(`no such provider: ${id}`);
}

/** Runs a program with `input` on stdin; resolves with what it printed. */
function run(deps, file, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = deps.spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...options }); } catch (e) { reject(e); return; }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('no answer in time')); }, deps.timeoutMs || TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** The ClassDash Mac app's own program, which answers --ai-respond. */
function appBinary(env = process.env) {
  return env.CLASSDASH_APP_BINARY || '/Applications/ClassDash.app/Contents/MacOS/ClassDash';
}

async function viaApple({ system, prompt }, deps) {
  const bin = appBinary(deps.env);
  if (!deps.exists(bin)) throw new Error('the ClassDash Mac app wasn\'t found');
  const { out } = await run(deps, bin, ['--ai-respond'], JSON.stringify({ instructions: system || '', prompt }));
  let answer = null;
  try { answer = JSON.parse(out.trim().split('\n').pop()); } catch { /* said below */ }
  if (!answer) throw new Error('Apple Intelligence didn\'t answer');
  if (!answer.ok) throw new Error(answer.why || 'Apple Intelligence didn\'t answer');
  return String(answer.text || '');
}

/** Where one of the person's commands is: on the PATH, or where installers put it. */
function findCommand(deps, command) {
  const env = deps.env || process.env;
  const win = deps.platform === 'win32';
  const names = win ? [`${command}.cmd`, `${command}.exe`, command] : [command];
  const home = deps.home || os.homedir();
  const dirs = [
    ...String(env.PATH || env.Path || '').split(path.delimiter),
    // WindowsApps: where an app installed with winget (Foundry Local) puts its command.
    ...(win ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(home, '.local', 'bin'),
      path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'WindowsApps')]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.claude', 'local')]),
  ].filter(Boolean);
  for (const dir of dirs) for (const n of names) {
    const file = path.join(dir, n);
    if (deps.exists(file)) return file;
  }
  return null;
}
const findCodex = deps => findCommand(deps, 'codex');
const findClaude = deps => findCommand(deps, 'claude');
const findFoundry = deps => findCommand(deps, 'foundry');

// Foundry Local's address, from its own status: the first address on this
// computer it prints, as its /v1 API. Its colours are taken out first.
function foundryAddress(text) {
  const plain = String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const m of plain.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
    let u;
    try { u = new URL(m[0].replace(/[.,;:]+$/, '')); } catch { continue; }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (u.port && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return `${u.origin}/v1`;
  }
  return null;
}

/**
 * Where Foundry Local answers right now: asks `foundry server status`
 * (`foundry service status` on older versions) and, with start, starts it
 * when neither prints an address. Throws in plain words when it's not
 * installed or doesn't start.
 */
async function foundryUrl(deps, start) {
  const bin = findFoundry(deps);
  if (!bin) throw new Error('Foundry Local isn\'t installed (on Windows: winget install Microsoft.FoundryLocal)');
  const quick = { ...deps, timeoutMs: 15000 };
  const status = async () => {
    for (const group of ['server', 'service']) {
      try {
        const { out, err } = await runCommand(quick, bin, [group, 'status'], '');
        const url = foundryAddress(`${out}\n${err}`);
        if (url) return url;
      } catch { /* the other one, or not running */ }
    }
    return null;
  };
  let url = await status();
  if (url || !start) return url;
  for (const group of ['server', 'service']) {
    try {
      const { code } = await runCommand({ ...deps, timeoutMs: 60000 }, bin, [group, 'start'], '');
      if (code === 0) break;
    } catch { /* the other one */ }
  }
  url = await status();
  if (!url) throw new Error('Foundry Local didn\'t start (try "foundry server start" in a terminal)');
  return url;
}

// A model Foundry Local hasn't loaded is loaded with its own command, once.
async function viaFoundry(config, ask, deps) {
  if (config.model && !MODEL_NAME.test(config.model)) throw new Error('that model name has characters Foundry Local won\'t take');
  const url = await foundryUrl(deps, true);
  const asking = { ...config, url };
  try {
    return await viaHttp(asking, ask, deps);
  } catch (e) {
    if (!config.model || !/not found|not loaded|load/i.test(e && e.message)) throw e;
    const { code } = await runCommand({ ...deps, timeoutMs: TIMEOUT_MS }, findFoundry(deps), ['model', 'load', config.model], '');
    if (code !== 0) throw new Error(`Foundry Local couldn't load ${config.model} (download it first: foundry model download ${config.model})`);
    return viaHttp(asking, ask, deps);
  }
}

// A .cmd (npm's Windows launcher) only runs through the shell; every
// argument given to one is a flag, a path or a fixed sentence, quoted for it.
function runCommand(deps, bin, args, input, options) {
  const shell = /\.cmd$/i.test(bin);
  return run(deps, shell ? `"${bin}"` : bin, shell ? args.map(a => `"${a}"`) : args, input, { ...options, shell });
}

// With no address saved, LM Studio's usual one, then Bionic's when nothing
// answers there.
async function viaUsualAddress(config, settings, ask, deps) {
  const p = PROVIDERS[config.provider];
  const others = String(settings.aiLocalUrl || '').trim() || !p || !p.also ? [] : p.also;
  for (const url of others) {
    try { return await viaHttp(config, ask, deps); } catch (e) {
      if (!/couldn't connect/.test(e && e.message)) throw e;
      config = { ...config, url };
    }
  }
  return viaHttp(config, ask, deps);
}

// A model name goes on Codex's command line, so only a plain one.
const MODEL_NAME = /^[A-Za-z0-9._:\/-]+$/;

async function viaCodex(config, { system, prompt }, deps) {
  const bin = findCodex(deps);
  if (!bin) throw new Error('Codex isn\'t installed (install it, then run "codex login" once)');
  if (config.model && !MODEL_NAME.test(config.model)) throw new Error('that model name has characters Codex won\'t take');
  // An empty folder of its own, read-only, nothing kept: Codex is an agent
  // that can look around where it runs, and there's nothing here for it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classdash-codex-'));
  const outFile = path.join(dir, 'answer.txt');
  try {
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral',
      '--output-last-message', outFile, ...(config.model ? ['-m', config.model] : []), '-'];
    const { code, err } = await runCommand(deps, bin, args, (system ? `${system}\n\n` : '') + prompt, { cwd: dir });
    let text = '';
    try { text = fs.readFileSync(outFile, 'utf8'); } catch { /* none: said below */ }
    if (code !== 0 && !text) {
      const said = scrub(err.split('\n').filter(l => /error|login|auth/i.test(l)).pop() || '');
      throw new Error(/login|auth/i.test(said) ? 'Codex isn\'t signed in (run "codex login")' : `Codex stopped${said ? `: ${said}` : ''}`);
    }
    return text;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// Claude Code's own system prompt is for writing code; this one replaces
// it, and ClassDash's instructions go first in the message, like Codex's.
const CLAUDE_SYSTEM = 'Follow the instructions in the message. Answer with text only.';

async function viaClaudeCode(config, { system, prompt }, deps) {
  const bin = findClaude(deps);
  if (!bin) throw new Error('Claude Code isn\'t installed (install it, then run "claude auth login" once)');
  if (config.model && !MODEL_NAME.test(config.model)) throw new Error('that model name has characters Claude Code won\'t take');
  // No tools, none of the person's settings, hooks or MCP servers, nothing
  // saved, in an empty folder: it can only answer.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classdash-claude-'));
  try {
    const args = ['-p', '--output-format', 'text', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
      '--no-session-persistence', '--system-prompt', CLAUDE_SYSTEM, ...(config.model ? ['--model', config.model] : [])];
    // Started from inside a Claude Code session (a developer's), it would
    // think it's nested.
    const env = { ...(deps.env || process.env) };
    delete env.CLAUDECODE;
    const { code, out, err } = await runCommand(deps, bin, args, (system ? `${system}\n\n` : '') + prompt, { cwd: dir, env });
    if (code !== 0) {
      const said = scrub(`${err}\n${out}`.split('\n').filter(l => l.trim()).pop() || '');
      throw new Error(/auth|log ?in|oauth/i.test(said) ? 'Claude Code isn\'t signed in (run "claude auth login")' : `Claude Code stopped${said ? `: ${said}` : ''}`);
    }
    return out;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function withDefaults(deps = {}) {
  return {
    fetch: deps.fetch || globalThis.fetch,
    spawn: deps.spawn || require('child_process').spawn,
    exists: deps.exists || (f => { try { return fs.statSync(f).isFile(); } catch { return false; } }),
    platform: deps.platform || process.platform,
    env: deps.env || process.env,
    home: deps.home,
    timeoutMs: deps.timeoutMs,
  };
}

/**
 * Asks the chosen model. `ask` is { system, prompt, maxTokens, think? }:
 * think true asks for its thinking where the provider can send it (Ollama,
 * Anthropic, Gemini; LM Studio sends it on its own), false asks Ollama not
 * to think and drops any that comes; left out, nothing changes. onPart,
 * where the provider can stream (all but Apple, Codex and Claude Code), is called with
 * { thinking, text } so far as the answer is written.
 * Resolves { ok: true, text, thinking? } or { ok: false, why }; never
 * throws. `thinking` is the model's reasoning, only when it sent one.
 */
async function complete(ask, settings = require('./19-settings.js').read(), deps) {
  const d = withDefaults(deps);
  // Pieces as they come; with think off, only the answer's.
  if (ask.onPart && ask.think === false) { const show = ask.onPart; ask = { ...ask, onPart: part => show({ thinking: '', text: part.text }) }; }
  const config = configFrom(settings);
  const can = ready(config, d.platform);
  if (!can.ok) return can;
  try {
    const text = config.provider === 'apple' ? await viaApple(ask, d)
      : config.provider === 'codex' ? await viaCodex(config, ask, d)
      : config.provider === 'claudecode' ? await viaClaudeCode(config, ask, d)
      : config.provider === 'foundry' ? await viaFoundry(config, ask, d)
      : await viaUsualAddress(config, settings, ask, d);
    // Asked not to show it (think false): any thinking sent anyway is dropped.
    if (text && typeof text === 'object') return { ok: true, text: String(text.text || '').trim(), ...(ask.think === false ? {} : { thinking: text.thinking }) };
    return { ok: true, text: String(text || '').trim() };
  } catch (e) {
    return { ok: false, why: scrub(e && e.message, config.key) || 'failed' };
  }
}

/**
 * The panel's Test button, for the choice as it is on the panel (not yet
 * saved): lists the models where the provider can, then asks for one word.
 * { ok, models?, model, reply?, ms } or { ok: false, why, models? }.
 */
async function test(settings, deps) {
  const d = withDefaults(deps);
  const config = configFrom(settings);
  const can = ready(config, d.platform);
  if (!can.ok) return can;
  let models = null;
  try {
    if (config.provider === 'foundry') config.url = await foundryUrl(d, true);
    const p = PROVIDERS[config.provider];
    const others = String(settings.aiLocalUrl || '').trim() || !p.also ? [] : p.also;
    for (const url of others) {
      try { models = await listModels(config, d); break; } catch (e) {
        if (!/couldn't connect/.test(e && e.message)) throw e;
        config.url = url;
      }
    }
    if (!models) models = await listModels(config, d);
  } catch (e) {
    return { ok: false, why: scrub(e && e.message, config.key) };
  }
  if (!config.model && models && models.length) config.model = models[0];
  if (!config.model && config.provider === 'foundry') {
    return { ok: false, why: 'no model loaded yet (for example: foundry model download qwen2.5-1.5b, then foundry model load qwen2.5-1.5b)', models: models || [] };
  }
  if (!config.model && (config.provider === 'ollama' || config.provider === 'lmstudio')) {
    return { ok: false, why: 'no model downloaded yet', models: models || [] };
  }
  const started = Date.now();
  const answer = await complete({ prompt: 'Reply with just the word OK.', maxTokens: 20 },
    { ...settings, aiModel: config.model }, deps);
  if (!answer.ok) return { ...answer, ...(models ? { models } : {}) };
  return { ok: true, model: config.model, reply: answer.text.slice(0, 60), ms: Date.now() - started, ...(models ? { models } : {}) };
}

/**
 * What Settings → AI can fill in by itself: Ollama and LM Studio running
 * at their usual addresses (or the saved one) with the models downloaded
 * there, whether Apple Intelligence can be used on this Mac, whether Codex
 * and Claude Code are installed and signed in (`codex login status`'s exit
 * code, `claude auth status`'s loggedIn: never the login itself), and the
 * saved cloud provider's models when it may be asked
 * (its box ticked and a key saved). Only lists are asked for: nothing of
 * the person's goes anywhere. Quick, so the panel isn't kept waiting.
 *
 * { ollama: {url, models} | null, lmstudio: …, foundry: {url, models} (url null: not running) | null, apple: {ok, why} | null,
 *   codex: {ok, why} | null, claudeCode: {ok, why} | null, cloud: {provider, models} | {provider, why} | null }
 */
async function detect(settings = require('./19-settings.js').read(), deps = {}) {
  const d = withDefaults({ timeoutMs: 2500, ...deps });
  const saved = configFrom(settings);
  const local = async id => {
    const urls = [...new Set([saved.provider === id ? saved.url : null, PROVIDERS[id].url, ...(PROVIDERS[id].also || [])].filter(Boolean))]
      .filter(localAddress);
    for (const url of urls) {
      try { return { url, models: await listModels({ provider: id, url }, d) }; } catch { /* not there */ }
    }
    return null;
  };
  const apple = async () => {
    if (d.platform !== 'darwin') return null;
    const bin = appBinary(d.env);
    if (!d.exists(bin)) return { ok: false, why: 'the ClassDash Mac app wasn\'t found' };
    try {
      const { out } = await run({ ...d, timeoutMs: 10000 }, bin, ['--ai-respond'], JSON.stringify({ check: true }));
      const answer = JSON.parse(out.trim().split('\n').pop());
      return answer.ok ? { ok: true } : { ok: false, why: answer.why || 'not available' };
    } catch { return { ok: false, why: 'not available' }; }
  };
  // `codex login status` exits 0 when signed in (its output, which can
  // name the login, isn't read).
  const codex = async () => {
    const bin = findCodex(d);
    if (!bin) return null;
    try {
      const { code } = await runCommand({ ...d, timeoutMs: 10000 }, bin, ['login', 'status'], '');
      return code === 0 ? { ok: true } : { ok: false, why: 'signedOut' };
    } catch { return { ok: false, why: 'signedOut' }; }
  };
  const claudeCode = async () => {
    const bin = findClaude(d);
    if (!bin) return null;
    const env = { ...d.env };
    delete env.CLAUDECODE;
    try {
      const { out } = await runCommand({ ...d, timeoutMs: 10000 }, bin, ['auth', 'status', '--json'], '', { env });
      return JSON.parse(out).loggedIn === true ? { ok: true } : { ok: false, why: 'signedOut' };
    } catch { return { ok: false, why: 'signedOut' }; }
  };
  // Foundry Local: installed, and where it's running with its models; not
  // started just to look (it's started when it's used).
  const foundry = async () => {
    if (!findFoundry(d)) return null;
    let url = null;
    try { url = await foundryUrl(d, false); } catch { /* not running */ }
    if (!url) return { url: null, models: [] };
    try { return { url, models: await listModels({ provider: 'foundry', url }, d) }; } catch { return { url, models: [] }; }
  };
  const cloud = async () => {
    const p = PROVIDERS[saved.provider];
    if (!p || p.local || !p.key || !ready(saved, d.platform).ok) return null;
    try { return { provider: saved.provider, models: await listModels(saved, d) }; } catch (e) {
      return { provider: saved.provider, why: scrub(e && e.message, saved.key) };
    }
  };
  const [ollama, lmstudio, foundryResult, appleResult, codexResult, claudeResult, cloudResult] = await Promise.all([local('ollama'), local('lmstudio'), foundry(), apple(), codex(), claudeCode(), cloud()]);
  return { ollama, lmstudio, foundry: foundryResult, apple: appleResult, codex: codexResult, claudeCode: claudeResult, cloud: cloudResult };
}

module.exports = { PROVIDERS, PROVIDER_IDS, localAddress, configFrom, ready, scrub, listModels, findCodex, findClaude, findFoundry, foundryAddress, appBinary, complete, test, detect };
