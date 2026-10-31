// The workspace's AI sidebar (49-ai-sidebar.js) and the tool calls under it
// (37-ai.js "with tools"): each kind of provider asked with the tools, a
// tool run and its answer sent back, until it answers; Codex and Claude Code
// handed the MCP server for one run; who may ask and who gets grades; hints
// only; the page sent with the question; the chat kept with the PDF; and the
// AI pane in the workspace's desk, with the main page passing the live
// answer on. Fake fetch and spawn stand in for the AIs, and the PDF is made up.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const { EventEmitter } = require('events');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = 'sk-made-up-SECRET-1234567890';
const proj = T.makeProject({
  'settings.json': { language: 'en', email: 'a@b', canvas: '' },
  'last-collection.json': [
    { platform: 'Canvas', class: 'Made-up Biology', id: 'canvas-1', type: 'Assignment', title: 'Cell worksheet', link: 'https://canvas.example.test/a/1', due_iso: new Date(Date.now() + 86400000).toISOString(), due: null, posted: null, description: 'Label the diagram on page 2.' },
  ],
});
process.chdir(proj);
const ai = require(path.join(proj, '37-ai.js'));
const side = require(path.join(proj, '49-ai-sidebar.js'));
const tools = require(path.join(proj, '47-ai-tools.js'));
const W = require(path.join(proj, '46-workspace.js'));
const writeSettings = s => fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(Object.assign({ language: 'en', email: 'a@b', canvas: '' }, s)));

function fakeFetch(answer) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, ...init, body });
    const a = answer(url, body, calls.length);
    return { ok: a.status < 400, status: a.status, text: async () => typeof a.raw === 'string' ? a.raw : JSON.stringify(a.json) };
  };
  return { fetch, calls };
}
const offered = { list: tools.toolsFor({}).map(t => ({ name: t.name, description: t.description, input: t.input })), call: (n, a) => tools.run(n, a, {}) };

(async () => {
  // ── the tool loop, each way ──
  {
    const f = fakeFetch((url, body, n) => n === 1
      ? { status: 200, json: { choices: [{ message: { content: '', reasoning_content: 'I should check.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_assignments', arguments: '{"which":"due_soon"}' } }] } }] } }
      : { status: 200, json: { choices: [{ message: { content: 'The cell worksheet is due tomorrow.' } }] } });
    const r = await ai.complete({ system: 's', prompt: 'What is due?', tools: offered }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: f.fetch });
    const second = f.calls[1].body.messages;
    ok('LM Studio and the like: the tools offered the OpenAI way', f.calls[0].body.tools.map(t => t.function.name).includes('read_pdf_pages') && f.calls[0].body.tools[0].type === 'function');
    ok('...a tool it asks for is run and its answer sent back with the call\'s id', second[2].role === 'assistant' && second[2].tool_calls[0].id === 'c1' &&
      second[3].role === 'tool' && second[3].tool_call_id === 'c1' && /Cell worksheet/.test(second[3].content), JSON.stringify(second.slice(2)));
    ok('...until it answers, with its thinking kept and the tools it used', r.ok && r.text === 'The cell worksheet is due tomorrow.' && r.thinking === 'I should check.' && r.used.join() === 'list_assignments', JSON.stringify(r));
  }
  {
    // Streamed: the call's pieces come in parts and are put back together.
    const sse = (...parts) => parts.map(p => 'data: ' + JSON.stringify({ choices: [{ delta: p }] })).join('\n') + '\ndata: [DONE]\n';
    const f = fakeFetch((url, body, n) => ({ status: 200, raw: n === 1
      ? sse({ tool_calls: [{ index: 0, id: 'x9', function: { name: 'get_assign', arguments: '{"id":' } }] }, { tool_calls: [{ index: 0, function: { name: 'ment', arguments: '"canvas-1"}' } }] })
      : sse({ content: 'It says to label ' }, { content: 'the diagram.' }) }));
    const parts = [];
    const r = await ai.complete({ prompt: 'Instructions?', tools: offered, onPart: p => parts.push(p.text) }, { aiProvider: 'ollama', aiModel: 'm' }, { fetch: f.fetch });
    ok('streamed: a tool call in pieces is put back together and run', r.ok && r.used.join() === 'get_assignment' && /Label the diagram/.test(f.calls[1].body.messages.find(m => m.role === 'tool').content), JSON.stringify(r));
    ok('...through Ollama\'s OpenAI-style address even though it would use its own without tools', /\/v1\/chat\/completions$/.test(f.calls[0].url));
    ok('...and the answer shows as it\'s written', r.text === 'It says to label the diagram.' && parts.includes('It says to label '));
  }
  {
    const f = fakeFetch((url, body, n) => n === 1
      ? { status: 200, json: { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'Look it up.', signature: 'sig' }, { type: 'tool_use', id: 'tu1', name: 'list_pdfs', input: {} }] } }
      : { status: 200, json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have no PDFs yet.' }] } });
    const r = await ai.complete({ prompt: 'PDFs?', tools: offered, think: true }, { aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'], aiModel: 'claude-made-up' }, { fetch: f.fetch });
    const back = f.calls[1].body.messages;
    ok('Anthropic: tools as input_schema, its whole turn sent back (thinking and signature too), the answer as a tool_result', f.calls[0].body.tools[0].input_schema &&
      back[1].content[0].signature === 'sig' && back[2].content[0].type === 'tool_result' && back[2].content[0].tool_use_id === 'tu1' && r.text === 'You have no PDFs yet.' && r.thinking === 'Look it up.', JSON.stringify(back));
  }
  {
    const f = fakeFetch((url, body, n) => n === 1
      ? { status: 200, json: { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'list_classes', args: {} }, thoughtSignature: 'ts' }] } }] } }
      : { status: 200, json: { candidates: [{ content: { role: 'model', parts: [{ text: 'One class: Made-up Biology.' }] } }] } });
    const r = await ai.complete({ prompt: 'Classes?', tools: offered }, { aiProvider: 'gemini', aiGeminiKey: KEY, aiAgreed: ['gemini'], aiModel: 'gemini-made-up' }, { fetch: f.fetch });
    const decl = f.calls[0].body.tools[0].functionDeclarations;
    ok('Gemini: tools declared (one without inputs has no parameters at all), its turn sent back with its signature, the answer as a functionResponse',
      !('parameters' in decl.find(d => d.name === 'list_pdfs')) && decl.find(d => d.name === 'get_assignment').parameters &&
      f.calls[1].body.contents[1].parts[0].thoughtSignature === 'ts' && f.calls[1].body.contents[2].parts[0].functionResponse.name === 'list_classes' && r.text === 'One class: Made-up Biology.', JSON.stringify(f.calls[1].body.contents));
  }
  {
    // A model that keeps asking for tools is stopped and asked without them.
    const f = fakeFetch((url, body) => body.tools
      ? { status: 200, json: { choices: [{ message: { content: '', tool_calls: [{ id: 'l', type: 'function', function: { name: 'list_pdfs', arguments: '{}' } }] } }] } }
      : { status: 200, json: { choices: [{ message: { content: 'Done looking.' } }] } });
    const r = await ai.complete({ prompt: 'Loop', tools: { ...offered, steps: 3 } }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: f.fetch });
    ok('a model that keeps asking for tools is asked without them after its rounds', r.ok && r.text === 'Done looking.' && f.calls.length === 4 && !f.calls[3].body.tools, f.calls.length);
    const bad = fakeFetch((url, body, n) => n === 1
      ? { status: 200, json: { choices: [{ message: { content: '', tool_calls: [{ id: 'b', type: 'function', function: { name: 'get_assignment', arguments: '{not json' } }] } }] } }
      : { status: 200, json: { choices: [{ message: { content: 'Sorry.' } }] } });
    await ai.complete({ prompt: 'x', tools: offered }, { aiProvider: 'lmstudio', aiModel: 'm' }, { fetch: bad.fetch });
    ok('...and arguments that aren\'t JSON come back as an error it can read, not a crash', /valid JSON/.test(bad.calls[1].body.messages.find(m => m.role === 'tool').content));
  }

  // ── Codex and Claude Code: the MCP server, for one run ──
  {
    const spawned = [];
    const fakeSpawn = answer => (file, args, opts) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => {};
      child.stdin = { on() {}, end(input) {
        const mcpAt = args.indexOf('--mcp-config');
        spawned.push({ file, args, input, cwd: opts.cwd, mcp: mcpAt >= 0 ? JSON.parse(fs.readFileSync(args[mcpAt + 1], 'utf8')) : null });
        setImmediate(() => { child.stdout.emit('data', answer); child.emit('close', 0); });
      } };
      return child;
    };
    const mcpArgs = { command: '/made/up/node', args: ['/made/up/48-mcp.js', '--run-file', '/made/up/run'], env: { ELECTRON_RUN_AS_NODE: '1' } };
    const env = { PATH: '/nowhere', HOME: '/Users/nobody' };
    const exists = f => /claude$|codex$/.test(f);
    await ai.complete({ prompt: 'q', tools: { ...offered, mcp: mcpArgs } }, { aiProvider: 'claudecode', aiAgreed: ['claudecode'] },
      { platform: 'darwin', env, home: '/Users/nobody', exists, spawn: fakeSpawn('answer') });
    const c = spawned[0];
    ok('Claude Code: given only ClassDash\'s server, from a file, and allowed to use it without asking', c.args.includes('--strict-mcp-config') && c.args[c.args.indexOf('--allowedTools') + 1] === 'mcp__classdash' &&
      c.mcp.mcpServers.classdash.command === '/made/up/node' && c.mcp.mcpServers.classdash.args.join(' ') === mcpArgs.args.join(' ') && c.mcp.mcpServers.classdash.env.ELECTRON_RUN_AS_NODE === '1' &&
      c.args[c.args.indexOf('--tools') + 1] === '', JSON.stringify(c.args));
    ok('...and without tools, no MCP at all, as before', await ai.complete({ prompt: 'q' }, { aiProvider: 'claudecode', aiAgreed: ['claudecode'] },
      { platform: 'darwin', env, home: '/Users/nobody', exists, spawn: fakeSpawn('answer') }).then(() => !spawned[1].args.includes('--mcp-config')));
    await ai.complete({ prompt: 'q', tools: { ...offered, mcp: mcpArgs } }, { aiProvider: 'codex', aiAgreed: ['codex'] },
      { platform: 'darwin', env, home: '/Users/nobody', exists, spawn: fakeSpawn('') });
    const x = spawned[2].args;
    const settingsOf = x.map((a, i) => x[i - 1] === '-c' ? a : null).filter(Boolean);
    ok('Codex: the server as -c settings in TOML (after medium effort)', settingsOf.join('\n') === 'model_reasoning_effort="medium"\nmcp_servers.classdash.command="/made/up/node"\nmcp_servers.classdash.args=["/made/up/48-mcp.js", "--run-file", "/made/up/run"]\nmcp_servers.classdash.env.ELECTRON_RUN_AS_NODE="1"', settingsOf.join('\n'));
  }

  // ── the sidebar: who may ask ──
  ok('no AI picked: off', side.canAsk({ aiProvider: 'none' }).why === 'off');
  ok('a cloud AI not ticked in Settings → AI: not yet', side.canAsk({ aiProvider: 'openai', aiAgreed: [] }).why === 'agree');
  ok('a local AI: tools and grades', JSON.stringify(side.canAsk({ aiProvider: 'lmstudio' })) === JSON.stringify({ ok: true, local: true, label: 'LM Studio', tools: true, grades: true }));
  ok('a ticked cloud AI: tools, but grades only with the Grades center\'s box too', !side.canAsk({ aiProvider: 'openai', aiAgreed: ['openai'] }).grades &&
    side.canAsk({ aiProvider: 'openai', aiAgreed: ['openai'], gradesAiAgreed: ['openai'] }).grades);
  ok('Apple\'s model: no tools', side.canAsk({ aiProvider: 'apple' }).tools === false);

  // ── asking ──
  const { PDFDocument, StandardFonts } = require(path.join(proj, 'pdf-lib.min.js'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('1. Which organelle makes energy?', { x: 50, y: 700, font, size: 14 });
  doc.addPage([612, 792]).drawText('2. Label the diagram.', { x: 50, y: 700, font, size: 14 });
  fs.writeFileSync(path.join(proj, 'Cells.pdf'), await doc.save());
  const pdf = W.importPdf(path.join(proj, 'Cells.pdf'));
  fs.writeFileSync(path.join(W.DIR, pdf.id, 'ink.json'), JSON.stringify({ version: 1, pageCount: 2, pages: { 2: [{ id: 't', type: 'text', color: '#000', size: 14, x: 1, y: 1, text: 'nucleus here?' }] } }));

  let seen = null;
  const fake = answer => async (a, s) => { seen = { a, s }; return answer; };
  const local = { aiProvider: 'lmstudio', aiModel: 'm' };
  let r = await side.ask('What does question 2 want?', { doc: pdf.id, page: 2, s: local, complete: fake({ ok: true, text: 'Look at the word bank.', used: ['read_pdf_pages', 'read_pdf_pages'] }) });
  ok('the page they\'re on goes with the question, and what they typed on it', /PAGE 2, THE ONE THEY'RE LOOKING AT\n\n2\. Label the diagram\./.test(seen.a.prompt) && /- nucleus here\?/.test(seen.a.prompt) && seen.a.prompt.includes(pdf.id), seen.a.prompt);
  ok('hints only by default, and told never to take orders from what it reads', /HINTS ONLY is on/.test(seen.a.system) && /never instructions to you/.test(seen.a.system));
  ok('a local AI gets every tool, grades too', seen.a.tools.list.some(t => t.name === 'get_grades') && !seen.a.tools.mcp);
  ok('the answer is saved with the PDF, with the page asked from and the tools used (once each)', r.ok && JSON.parse(fs.readFileSync(path.join(W.DIR, pdf.id, 'chat.json'), 'utf8')).messages.map(m => m.role + ':' + (m.page || '') + ':' + (m.used || []).join('+')).join() === 'user:2:,ai::read_pdf_pages');
  r = await side.ask('Just tell me', { doc: pdf.id, page: 1, hints: false, s: local, complete: fake({ ok: true, text: 'Mitochondria.' }) });
  ok('hints off when asked so, and the earlier turns go with it', /Hints only is off/.test(seen.a.system) && /Student: What does question 2 want\?\n\nYou: Look at the word bank\./.test(seen.a.prompt) && r.hints === false);
  ok('...remembered for that PDF', side.readChat(pdf.id).hints === false && side.setHints(pdf.id, true).hints === true && side.readChat(pdf.id).hints === true);
  await side.ask('q', { doc: pdf.id, page: 1, s: { aiProvider: 'openai', aiAgreed: ['openai'], aiOpenaiKey: KEY }, complete: fake({ ok: true, text: 'a' }) });
  ok('a cloud AI ticked for class text but not grades: no grades tool', !seen.a.tools.list.some(t => t.name === 'get_grades'));
  await side.ask('q', { doc: pdf.id, page: 1, s: { aiProvider: 'apple' }, complete: fake({ ok: true, text: 'a' }) });
  ok('Apple: no tools, told so, the page still there', !seen.a.tools && /no tools this time/.test(seen.a.system) && /Which organelle/.test(seen.a.prompt));
  r = await side.ask('What\'s due this week?', { doc: '', s: local, complete: fake({ ok: true, text: 'The cell worksheet.' }) });
  ok('no PDF open: asked about their schoolwork, with the tools and no page, told it can\'t see web pages', r.ok && !/THE PDF|PAGE \d/.test(seen.a.prompt) &&
    /No PDF is open/.test(seen.a.system) && /can't see web pages/.test(seen.a.system) && seen.a.tools.list.length > 0, seen.a.system);
  ok('...kept in a chat of its own, not any PDF\'s', side.readChat('').messages.length === 2 && side.readChat('').messages[0].page === null &&
    !side.readChat(pdf.id).messages.some(m => /due this week/.test(m.text)));
  ok('...cleared on its own too', side.clearChat('').ok && side.readChat('').messages.length === 0 && side.readChat(pdf.id).messages.length > 0);

  // ── web pages the student let it see ──
  const names = ctx => tools.toolsFor(ctx).map(t => t.name);
  ok('no web tools unless a page was shared; the picture only with Image', !names({}).some(n => /web_page/.test(n)) &&
    names({ web: true }).includes('read_web_page') && !names({ web: true }).includes('look_at_web_page') && names({ web: true, webImage: true }).includes('look_at_web_page'));
  const shareWeb = () => {
    fs.mkdirSync(tools.webDir(), { recursive: true });
    fs.writeFileSync(path.join(tools.webDir(), 'p3.json'), JSON.stringify({ title: 'Made-up Essay - Google Docs', url: 'https://docs.google.com/document/d/abc/edit', text: 'My made-up intro paragraph.', how: 'export' }));
    fs.writeFileSync(path.join(tools.webDir(), 'p3.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(tools.webDir(), 'p9.json'), JSON.stringify({ title: 'Not shared', url: 'https://example.test', text: 'x' }));
  };
  shareWeb();
  let duringWeb = null;
  r = await side.ask('Is my intro OK?', { doc: '', s: local, web: [{ pane: 'p3', image: true }], complete: async a => {
    duringWeb = { names: a.tools.list.map(t => t.name), system: a.system, read: JSON.parse((await a.tools.call('read_web_page', {})).text), pic: await a.tools.call('look_at_web_page', {}) };
    return { ok: true, text: 'Good start.' };
  } });
  ok('a shared page: both tools, and the AI told it may look when the question\'s about it', r.ok && duringWeb.names.includes('read_web_page') && duringWeb.names.includes('look_at_web_page') &&
    /let you see a web page/.test(duringWeb.system) && !/can't see web pages/.test(duringWeb.system), JSON.stringify(duringWeb && duringWeb.names));
  ok('...read_web_page gives the Doc\'s own text, and only the panes shared', duringWeb.read.pages.length === 1 && duringWeb.read.pages[0].pane === 'p3' &&
    duringWeb.read.pages[0].text === 'My made-up intro paragraph.' && duringWeb.read.pages[0].from === 'the document itself', JSON.stringify(duringWeb.read));
  ok('...look_at_web_page gives the picture apart from the text', duringWeb.pic.image && duringWeb.pic.image.mime === 'image/png' && duringWeb.pic.image.data === Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') && !duringWeb.pic.text.includes(duringWeb.pic.image.data));
  ok('...and what was on the page is gone after', !fs.existsSync(tools.webDir()));
  shareWeb();
  await side.ask('Is my intro OK?', { doc: '', s: local, web: [{ pane: 'p3', image: false }], complete: fake({ ok: true, text: 'a' }) });
  ok('Text only: no picture tool even with one saved', seen.a.tools.list.some(t => t.name === 'read_web_page') && !seen.a.tools.list.some(t => t.name === 'look_at_web_page'));
  await side.ask('q', { doc: '', s: local, complete: fake({ ok: true, text: 'a' }) });
  ok('nothing shared: no web tools, and told it can\'t see web pages', !seen.a.tools.list.some(t => /web_page/.test(t.name)) && /can't see web pages/.test(seen.a.system));
  side.clearChat('');

  // The picture reaches each kind of AI in its own shape.
  {
    const picture = { list: [{ name: 'look_at_web_page', description: 'd', input: { type: 'object', properties: {} } }], call: async () => ({ text: '{"title":"t"}', image: { mime: 'image/png', data: 'QUJD' } }) };
    const o = fakeFetch((url, body, n) => ({ status: 200, json: n === 1 ? { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'look_at_web_page', arguments: '{}' } }] } }] } : { choices: [{ message: { content: 'A parabola.' } }] } }));
    await ai.complete({ prompt: 'graph?', tools: picture }, { aiProvider: 'openai', aiOpenaiKey: KEY, aiAgreed: ['openai'], aiModel: 'gpt-made-up' }, { fetch: o.fetch });
    const after = o.calls[1].body.messages;
    ok('OpenAI-style: the tool\'s text, then the picture as the student\'s message', after.find(m => m.role === 'tool').content === '{"title":"t"}' &&
      after.slice(-1)[0].role === 'user' && after.slice(-1)[0].content[1].image_url.url === 'data:image/png;base64,QUJD', JSON.stringify(after.slice(-1)));
    const a = fakeFetch((url, body, n) => n === 1 ? { status: 200, json: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'look_at_web_page', input: {} }] } }
      : { status: 200, json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A parabola.' }] } });
    await ai.complete({ prompt: 'graph?', tools: picture }, { aiProvider: 'anthropic', aiAnthropicKey: KEY, aiAgreed: ['anthropic'], aiModel: 'claude-made-up' }, { fetch: a.fetch });
    const res = a.calls[1].body.messages.slice(-1)[0].content[0];
    ok('Anthropic: the picture inside the tool_result', res.type === 'tool_result' && res.content[1].type === 'image' && res.content[1].source.data === 'QUJD', JSON.stringify(res));
    const g = fakeFetch((url, body, n) => ({ status: 200, json: { candidates: [{ content: { role: 'model', parts: n === 1 ? [{ functionCall: { name: 'look_at_web_page', args: {} } }] : [{ text: 'A parabola.' }] } }] } }));
    await ai.complete({ prompt: 'graph?', tools: picture }, { aiProvider: 'gemini', aiGeminiKey: KEY, aiAgreed: ['gemini'], aiModel: 'gemini-made-up' }, { fetch: g.fetch });
    const gparts = g.calls[1].body.contents.slice(-1)[0].parts;
    ok('Gemini: the picture beside the function\'s answer', gparts[0].functionResponse && gparts[1].inlineData && gparts[1].inlineData.data === 'QUJD', JSON.stringify(gparts));
  }

  let during = null;
  await side.ask('q', { doc: pdf.id, page: 1, s: { aiProvider: 'claudecode', aiAgreed: ['claudecode'] }, complete: async a => {
    const file = a.tools.mcp.args[a.tools.mcp.args.indexOf('--run-file') + 1];
    // The server, started the way Claude Code would, during the run.
    const child = cp.spawnSync(a.tools.mcp.command, a.tools.mcp.args, { input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', encoding: 'utf8', cwd: proj });
    during = { file, mode: fs.statSync(file).mode & 0o777, inFile: fs.readFileSync(file, 'utf8'), tools: JSON.parse(child.stdout.trim()).result.tools.map(t => t.name), args: a.tools.mcp.args.join(' ') };
    return { ok: true, text: 'a' };
  } });
  ok('Claude Code: its server works for this run, with the switch for other apps off', during && during.tools.includes('list_pdfs') && during.mode === 0o600, JSON.stringify(during));
  ok('...the code in a file only this user can read, never on the command line', during && !during.args.includes(during.inFile) && during.inFile.length >= 40);
  ok('...and it\'s gone after: the file, and the code no longer works', !fs.existsSync(during.file) && !fs.readFileSync(path.join(proj, 'ai-runs.json'), 'utf8').includes('"hash"'));
  ok('...grades not in it for a cloud AI without the Grades center\'s box', !during.tools.includes('get_grades'));

  ok('refusals say why: off, a cloud AI not ticked, an empty question, a PDF that isn\'t there',
    (await side.ask('q', { doc: pdf.id, s: { aiProvider: 'none' } })).why === 'off' && (await side.ask('q', { doc: pdf.id, s: { aiProvider: 'gemini', aiAgreed: [] } })).why === 'agree' &&
    (await side.ask('  ', { doc: pdf.id, s: local })).why === 'empty' && (await side.ask('q', { doc: '../x', s: local })).why === 'nodoc');
  ok('an AI that fails is said, nothing saved', (await side.ask('q', { doc: pdf.id, s: local, complete: fake({ ok: false, why: 'couldn\'t connect' }) })).detail === 'couldn\'t connect' &&
    side.readChat(pdf.id).messages.slice(-1)[0].text === 'a');
  ok('Clear empties the chat but keeps Hints only', side.clearChat(pdf.id).ok && side.readChat(pdf.id).messages.length === 0 && side.readChat(pdf.id).hints === true);

  // ── the actions ──
  writeSettings({ aiProvider: 'none' });
  const chatNow = JSON.parse(T.run(proj, '21-notifier-actions.js', ['workspaceChat', pdf.id]).stdout.trim().split('\n').pop());
  ok('workspaceChat: the chat, and why it can\'t ask yet', chatNow.ok && chatNow.hints === true && Array.isArray(chatNow.messages) && /Settings → AI/.test(chatNow.can.why), JSON.stringify(chatNow));
  const asked = JSON.parse(T.run(proj, '21-notifier-actions.js', ['workspaceAsk', Buffer.from(JSON.stringify({ doc: pdf.id, page: 1, question: 'secret question text' })).toString('base64url')]).stdout.trim().split('\n').pop());
  ok('workspaceAsk: a refusal in words', !asked.ok && /Settings → AI/.test(asked.why));
  ok('...and the question is never logged', !fs.readFileSync(path.join(proj, 'notifier-log.txt'), 'utf8').includes('secret question') && /workspaceAsk \(payload not logged\)/.test(fs.readFileSync(path.join(proj, 'notifier-log.txt'), 'utf8')));

  // An action that loads the collector (through the Home API) still answers
  // with a line of plain JSON: the collector puts the time in front of every
  // console line, and the app couldn't read "12:01:20 {...}".
  writeSettings({ aiProvider: 'lmstudio', aiModel: 'm', aiLocalUrl: 'http://127.0.0.1:9/v1', canvas: 'https://canvas.example.test', canvasToken: 'x', canvasApiEnabled: true });
  fs.writeFileSync(path.join(proj, 'canvas-grades.json'), JSON.stringify({ checkedAt: new Date().toISOString(), classes: [{ class: 'Made-up Biology', grade: 'B', percent: 85, assignments: [], weighting: null }] }));
  const graded = T.run(proj, '21-notifier-actions.js', ['gradesAsk', Buffer.from(JSON.stringify({ question: 'How am I doing?' })).toString('base64url')]).stdout.trim().split('\n').pop();
  let parsed = null;
  try { parsed = JSON.parse(graded); } catch {}
  ok('an answer that loaded the collector is still a line of plain JSON (the Grades center\'s too)', parsed && parsed.action === 'gradesAsk' && /couldn't connect/.test(parsed.why), graded.slice(0, 120));
  writeSettings({ aiProvider: 'none' });

  // ── the AI pane in the desk ──
  fs.writeFileSync(path.join(W.DIR, pdf.id, 'chat.json'), JSON.stringify({ hints: true, messages: [{ role: 'user', text: 'Earlier?', page: 1 }, { role: 'ai', text: 'Earlier answer.', used: ['list_assignments'] }] }));
  const html = require(path.join(proj, '50-desk.js')).pageHtml();
  const posted = [];
  let answerAsk = null;
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message)));
  const runAction = (action, arg) => JSON.parse(T.run(proj, '21-notifier-actions.js', [action, arg]).stdout.trim().split('\n').pop());
  const dom = new JSDOM(html, { url: 'https://app.test/workspace.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const parent = { postMessage(m) {
        if (m.type !== 'action') return;
        posted.push(m);
        const reply = result => { const e = new w.Event('message'); Object.assign(e, { data: { cd: 'ws', type: 'result', id: m.id, result } }); Object.defineProperty(e, 'source', { value: parent }); w.dispatchEvent(e); };
        if (m.action === 'workspaceChat' || m.action === 'workspaceDesk') setTimeout(() => reply(runAction(m.action, m.arg)), 0);
        else if (m.action === 'webCaps') setTimeout(() => reply({ ok: true, web: false }), 0);
        else if (m.action === 'workspaceAsk') answerAsk = reply;
        else setTimeout(() => reply({ ok: true }), 0);
      } };
      Object.defineProperty(w, 'parent', { value: parent });
    } });
  const w = dom.window, d = w.document;
  await sleep(600);
  const aiPane = d.querySelector('.pane[data-id="p2"]');
  ok('the desk opens as it does at first: a PDF pane and the AI beside it', d.querySelector('.pane[data-id="p1"] iframe') && aiPane && d.getElementById('ai-q'));
  ok('...with no PDF open, the AI is about your schoolwork, and can be asked', /About your schoolwork \(no PDF open\)/.test(aiPane.querySelector('.about').textContent) && !d.getElementById('ai-ask').disabled &&
    /what's due this week/.test(d.querySelector('#ai-chat .empty').textContent), aiPane.querySelector('.about').textContent);
  ok('...no web page in front, so no note about web pages', d.getElementById('ai-web-note').hidden);
  // The PDF pane's frame says what it has open, as 46-workspace.js's page does.
  const frameWin = d.querySelector('.pane[data-id="p1"] iframe').contentWindow;
  const fromFrame = data => { const e = new w.Event('message'); Object.assign(e, { data: Object.assign({ cd: 'ws' }, data) }); Object.defineProperty(e, 'source', { value: frameWin }); w.dispatchEvent(e); };
  fromFrame({ type: 'pdf', doc: pdf.id, title: 'Made-up Worksheet', page: 1 });
  await sleep(300);
  const msgs = () => [...d.querySelectorAll('#ai-chat .ai-msg')].map(m => m.textContent);
  ok('then it\'s about that PDF and page, with its chat and what the AI looked at', /About Made-up Worksheet · Page 1/.test(aiPane.querySelector('.about').textContent) &&
    msgs().join('|') === 'Earlier?Page 1|Earlier answer.Looked at: your assignments', msgs().join('|'));
  ok('...and why it can\'t ask yet', /Settings → AI/.test(d.getElementById('ai-status').textContent));
  fromFrame({ type: 'pdf', doc: pdf.id, title: 'Made-up Worksheet', page: 2 });
  d.getElementById('ai-q').value = 'What\'s due?';
  d.getElementById('ai-q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(50);
  const ask = posted.find(m => m.action === 'workspaceAsk');
  const payload = ask && JSON.parse(Buffer.from(ask.arg, 'base64url').toString('utf8'));
  ok('Enter asks: that PDF, the page in view there now, Hints only, and a live id the main page can watch', payload && payload.doc === pdf.id && payload.page === 2 && payload.hints === true && payload.question === 'What\'s due?' && ask.live === payload.live, JSON.stringify(payload));
  ok('...showing the question and "Thinking…" at once', msgs().slice(-2).join('|') === 'What\'s due?Page 2|Thinking…');
  const live = data => { const e = new w.Event('message'); Object.assign(e, { data: { cd: 'ws', type: 'live', live: Object.assign({ id: payload.live }, data) } }); Object.defineProperty(e, 'source', { value: w.parent }); w.dispatchEvent(e); };
  live({ using: 'list_assignments', thinking: '', text: '' });
  ok('while it looks something up, it says what', msgs().slice(-1)[0] === 'Looking at your assignments…', msgs().slice(-1)[0]);
  live({ using: '', thinking: 'Checking the list.', text: 'The cell work' });
  ok('...then the answer as it\'s written, its thinking folded above', msgs().slice(-1)[0] === 'ThinkingChecking the list.The cell work');
  live({ id: 'someone-else', text: 'not mine' });
  ok('...never another question\'s', msgs().slice(-1)[0] === 'ThinkingChecking the list.The cell work');
  answerAsk({ ok: true, answer: 'The cell worksheet, tomorrow.', messages: [{ role: 'user', text: 'What\'s due?', page: 2 }, { role: 'ai', text: 'The cell worksheet, tomorrow.', used: ['list_assignments'] }] });
  await sleep(20);
  ok('the finished answer replaces it, and the box empties for the next one', msgs().join('|') === 'What\'s due?Page 2|The cell worksheet, tomorrow.Looked at: your assignments' && d.getElementById('ai-q').value === '');
  d.getElementById('ai-hints').checked = false;
  d.getElementById('ai-hints').dispatchEvent(new w.Event('change'));
  ok('turning off Hints only is remembered for this PDF', posted.slice(-1)[0].action === 'workspaceChatHints' && posted.slice(-1)[0].arg === pdf.id + ':0');
  fromFrame({ type: 'pdf', doc: '', title: '', page: 0 });
  await sleep(50);
  ok('back to the PDF list in that pane: the AI is about your schoolwork again, with that chat', /no PDF open/.test(aiPane.querySelector('.about').textContent) && !d.getElementById('ai-ask').disabled &&
    posted.slice(-1)[0].action === 'workspaceChat' && posted.slice(-1)[0].arg === '');
  d.getElementById('ai-q').value = 'Anything new?';
  d.getElementById('ai-ask').click();
  await sleep(20);
  const general = JSON.parse(Buffer.from(posted.filter(m => m.action === 'workspaceAsk').slice(-1)[0].arg, 'base64url').toString('utf8'));
  ok('...and asking then sends no PDF and no page', general.doc === '' && general.page === null && general.question === 'Anything new?', JSON.stringify(general));
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();

  // ── the main page passes the live answer on ──
  T.redraw(proj);
  const sent = [];
  const main = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { url: 'https://app.test/summary.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(mw) { mw.Element.prototype.scrollIntoView = function () {}; mw.webkit = { messageHandlers: { classdash: { postMessage(b) { sent.push(b); } } } }; } });
  await sleep(200);
  const mw = main.window, md = main.window.document;
  md.getElementById('workspace-button').click();
  mw.classdashBridgeResult(sent[0].id, { ok: true });
  const frame = md.getElementById('workspace-frame');
  const toFrame = [];
  Object.defineProperty(frame, 'contentWindow', { value: { postMessage: m => toFrame.push(m) } });
  // The live file, the way loadLiveFile finds it: answer.js sets the global.
  const realAppend = md.head.appendChild.bind(md.head);
  md.head.appendChild = el => { if (el.tagName === 'SCRIPT' && /chat-live\/answer\.js/.test(el.src)) { mw.classdashGradesLive = { id: 'L1', using: 'list_pdfs', thinking: '', text: '' }; setTimeout(() => el.onload(), 0); return el; } return realAppend(el); };
  const e = new mw.Event('message');
  Object.assign(e, { data: { cd: 'ws', type: 'action', id: 'a1', action: 'workspaceAsk', arg: 'xyz', live: 'L1' } });
  Object.defineProperty(e, 'origin', { value: 'classdash-ws://app' });
  Object.defineProperty(e, 'source', { value: frame.contentWindow });
  mw.dispatchEvent(e);
  await sleep(700);
  ok('the main page passes workspaceAsk on, and the live answer to the frame (once per change)', sent.slice(-1)[0].action === 'workspaceAsk' && toFrame.filter(m => m.type === 'live').length === 1 &&
    toFrame.find(m => m.type === 'live').live.using === 'list_pdfs', JSON.stringify(toFrame));
  mw.classdashBridgeResult(sent.slice(-1)[0].id, { ok: true, answer: 'x' });
  const before = toFrame.length;
  await sleep(600);
  ok('...and stops once the answer is in', toFrame.length === before + 0 && toFrame.slice(-1)[0].type === 'result', JSON.stringify(toFrame.slice(-2)));
  main.window.close();
})().catch(e => ok('ran without throwing', false, e.stack));
