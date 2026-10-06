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
 * on-device model, Ollama, LM Studio) it stays here; a cloud provider gets
 * a copy and keeps it under its own policy. So the local ones come first in
 * the panel and are the recommended ones, and the cloud ones work only
 * after the person has ticked that provider's own box (aiAgreed), which
 * states that provider's age rule:
 *
 *   OpenAI API, ChatGPT through Codex   13+, under 18 with a parent's or
 *                                       guardian's permission
 *   Anthropic API                       18+ (Claude's own apps are 18+, and
 *                                       apps minors use need safeguards
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
 *   codex      the person's own `codex` command (`codex exec`), signed in
 *              with their ChatGPT plan (`codex login`), in a read-only
 *              sandbox in an empty folder.
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
  lmstudio: { local: true, label: 'LM Studio', url: 'http://localhost:1234/v1' },
  codex: {
    local: false, label: 'ChatGPT (Codex)', company: 'OpenAI', minAge: 13, parent: true,
    terms: 'https://openai.com/policies/terms-of-use/', privacy: 'https://openai.com/policies/privacy-policy/',
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
    url: (String(settings.aiLocalUrl || '').trim() || (p && p.url) || '').replace(/\/+$/, ''),
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
  if (!res.ok) {
    const said = json && (json.error && (json.error.message || json.error) || json.message);
    const plain = res.status === 401 || res.status === 403 ? 'the key was refused'
      : res.status === 404 ? 'not found (check the model name)'
      : res.status === 429 ? 'too many requests, or out of credit'
      : `error ${res.status}`;
    throw new Error(said && typeof said === 'string' ? `${plain}: ${scrub(said, key)}` : plain);
  }
  if (!json) throw new Error('the answer wasn\'t JSON');
  return json;
}

const OPENAI = 'https://api.openai.com/v1';
const ANTHROPIC = 'https://api.anthropic.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const anthropicHeaders = key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' });

// Chat models only: OpenAI's list also holds speech, image and embedding ones.
const NOT_CHAT = /embed|tts|whisper|dall-e|audio|realtime|image|transcribe|moderation|search|sora|computer-use|rerank/;

/** The models this provider offers this person, or null where there's no list. */
async function listModels(config, deps) {
  const { provider: id, key, url } = config;
  if (id === 'ollama' || id === 'lmstudio') {
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

async function viaHttp(config, { system, prompt, maxTokens }, deps) {
  const { provider: id, key, url, model } = config;
  if (id === 'ollama' || id === 'lmstudio' || id === 'openai') {
    const base = id === 'openai' ? OPENAI : url;
    const json = await request(deps, `${base}/chat/completions`, {
      method: 'POST', key, local: id !== 'openai',
      headers: id === 'openai' ? { Authorization: `Bearer ${key}` } : {},
      body: { model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }] },
    });
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    return msg && typeof msg.content === 'string' ? msg.content : '';
  }
  if (id === 'anthropic') {
    const json = await request(deps, `${ANTHROPIC}/messages`, {
      method: 'POST', key, headers: anthropicHeaders(key),
      body: { model, max_tokens: maxTokens || 2048, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] },
    });
    return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }
  if (id === 'gemini') {
    const json = await request(deps, `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', key, headers: { 'x-goog-api-key': key },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      },
    });
    const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    return parts.map(p => p.text || '').join('');
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

/** Where the person's `codex` command is: on the PATH, or where installers put it. */
function findCodex(deps) {
  const env = deps.env || process.env;
  const win = deps.platform === 'win32';
  const names = win ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'];
  const home = deps.home || os.homedir();
  const dirs = [
    ...String(env.PATH || env.Path || '').split(path.delimiter),
    ...(win ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm')]
      : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin')]),
  ].filter(Boolean);
  for (const dir of dirs) for (const n of names) {
    const file = path.join(dir, n);
    if (deps.exists(file)) return file;
  }
  return null;
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
    // A .cmd (npm's Windows launcher) only runs through the shell; every
    // argument here is a flag or a path, quoted for it.
    const shell = /\.cmd$/i.test(bin);
    const { code, err } = await run(deps, shell ? `"${bin}"` : bin, shell ? args.map(a => `"${a}"`) : args,
      (system ? `${system}\n\n` : '') + prompt, { cwd: dir, shell });
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
 * Asks the chosen model. `ask` is { system, prompt, maxTokens }.
 * Resolves { ok: true, text } or { ok: false, why }; never throws.
 */
async function complete(ask, settings = require('./19-settings.js').read(), deps) {
  const d = withDefaults(deps);
  const config = configFrom(settings);
  const can = ready(config, d.platform);
  if (!can.ok) return can;
  try {
    const text = config.provider === 'apple' ? await viaApple(ask, d)
      : config.provider === 'codex' ? await viaCodex(config, ask, d)
      : await viaHttp(config, ask, d);
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
  try { models = await listModels(config, d); } catch (e) {
    return { ok: false, why: scrub(e && e.message, config.key) };
  }
  if (!config.model && models && models.length) config.model = models[0];
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
 * is installed, and the saved cloud provider's models when it may be asked
 * (its box ticked and a key saved). Only lists are asked for: nothing of
 * the person's goes anywhere. Quick, so the panel isn't kept waiting.
 *
 * { ollama: {url, models} | null, lmstudio: …, apple: {ok, why} | null,
 *   codex: bool, cloud: {provider, models} | {provider, why} | null }
 */
async function detect(settings = require('./19-settings.js').read(), deps = {}) {
  const d = withDefaults({ timeoutMs: 2500, ...deps });
  const saved = configFrom(settings);
  const local = async id => {
    const urls = [...new Set([saved.provider === id ? saved.url : null, PROVIDERS[id].url].filter(Boolean))]
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
  const cloud = async () => {
    const p = PROVIDERS[saved.provider];
    if (!p || p.local || !p.key || !ready(saved, d.platform).ok) return null;
    try { return { provider: saved.provider, models: await listModels(saved, d) }; } catch (e) {
      return { provider: saved.provider, why: scrub(e && e.message, saved.key) };
    }
  };
  const [ollama, lmstudio, appleResult, cloudResult] = await Promise.all([local('ollama'), local('lmstudio'), apple(), cloud()]);
  return { ollama, lmstudio, apple: appleResult, codex: !!findCodex(d), cloud: cloudResult };
}

module.exports = { PROVIDERS, PROVIDER_IDS, localAddress, configFrom, ready, scrub, listModels, findCodex, appBinary, complete, test, detect };
