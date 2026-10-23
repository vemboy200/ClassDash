/**
 * ClassDash's tools (47-ai-tools.js) as an MCP server, over stdin/stdout.
 *
 *   node 48-mcp.js
 *
 * ── Two kinds of caller ──
 *
 * Inside ClassDash: the AI sidebar starts Codex or Claude Code for a
 * question and hands them this server with `--run-file <file>`, a file
 * (readable only by this user, removed after the run) holding a code from
 * issueRun(), good for that run only; the code says whether grades may be
 * read (the same rule as the Grades center: a local AI, or one ticked in its
 * box). A file rather than the code itself, so it's never on a command line;
 * CLASSDASH_MCP_RUN works too. The code is kept only as a hash, in
 * ai-runs.json.
 *
 * Other AI apps (Antigravity, OpenCode, Claude Desktop...): the person adds
 * this command to that app themselves. It only works while Settings → AI →
 * "Let other AI apps use ClassDash" (aiMcpExternal) is on, and grades only
 * with its own box (aiMcpGrades) ticked too; ClassDash can't see which AI
 * that app sends things to, so this is the person's own choice, off until
 * they make it. Both are read again on every call, so turning one off works
 * at once, without restarting the other app.
 *
 * The files are on the computer anyway, so none of this is a wall against
 * someone at the keyboard. It makes sure ClassDash never hands schoolwork
 * to another app on its own.
 *
 * ── The protocol ──
 *
 * MCP over stdio is JSON-RPC, one message per line. Only what a tool server
 * needs is here: initialize, ping, tools/list, tools/call. stdout is only
 * for those messages, so anything else that prints (PDF.js's warnings) goes
 * to stderr when this runs as the server. Neither questions nor answers are
 * logged.
 *
 * ── Adding it to another app ──
 *
 * Settings → AI shows configs() ready to paste: the command is the same
 * Node that runs ClassDash's own scripts (for the Windows/Linux app, its
 * Electron run as Node), by a path that survives Node updates where it can.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./00-project-root.js');

const RUNS_FILE = path.join(PROJECT_ROOT, 'ai-runs.json');
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const RUN_MINUTES = 60;

const hash = code => crypto.createHash('sha256').update(String(code)).digest('hex');

function readRuns(now = Date.now()) {
  try {
    const runs = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
    return Array.isArray(runs) ? runs.filter(r => r && r.hash && r.until > now) : [];
  } catch { return []; }
}
function writeRuns(runs) {
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs), { mode: 0o600 });
}

/** A code for one sidebar run: { grades }. Ended by endRun, or in an hour. */
function issueRun({ grades = false } = {}, now = Date.now()) {
  const code = crypto.randomBytes(24).toString('hex');
  writeRuns([...readRuns(now), { hash: hash(code), grades: !!grades, until: now + RUN_MINUTES * 60000 }]);
  return code;
}
function endRun(code) {
  const h = hash(code);
  writeRuns(readRuns().filter(r => r.hash !== h));
}

/**
 * Who's asking, now: { ok, internal, grades } or { ok: false, why }.
 * A code that isn't (or no longer) good counts as another app, not as no one.
 */
function runCode(env, argv) {
  const at = argv.indexOf('--run-file');
  if (at >= 0 && argv[at + 1]) { try { return fs.readFileSync(argv[at + 1], 'utf8').trim(); } catch { return null; } }
  return env.CLASSDASH_MCP_RUN || null;
}
function access(env = process.env, argv = process.argv) {
  const code = runCode(env, argv);
  if (code) {
    const run = readRuns().find(r => r.hash === hash(code));
    if (run) return { ok: true, internal: true, grades: run.grades };
  }
  const s = require('./19-settings.js').read();
  if (!s.aiMcpExternal) return { ok: false, why: 'ClassDash isn\'t letting other AI apps use it. Turn on "Let other AI apps use ClassDash" in ClassDash\'s Settings → AI.' };
  return { ok: true, internal: false, grades: !!s.aiMcpGrades };
}

function version() {
  try { return require('./26-update-check.js').readUpdateStatus().currentVersion || '0'; } catch { return '0'; }
}

/** Answers one message; null for a notification (nothing to send back). */
async function handle(msg, env = process.env, argv = process.argv) {
  const tools = require('./47-ai-tools.js');
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
  }
  const notification = msg.id === undefined;
  if (notification) return null;
  const params = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'classdash', title: 'ClassDash', version: version() },
        instructions: 'Read-only access to a student\'s schoolwork in ClassDash: assignments, announcements, PDFs in the workspace, and (when allowed) grades. Nothing here can change or turn in anything.',
      });
    case 'ping':
      return reply({});
    case 'tools/list': {
      const who = access(env, argv);
      return reply({
        tools: who.ok ? tools.toolsFor(who).map(t => ({
          name: t.name, description: t.description, inputSchema: t.input,
          annotations: { readOnlyHint: true, openWorldHint: false },
        })) : [],
      });
    }
    case 'tools/call': {
      const who = access(env, argv);
      if (!who.ok) return reply({ content: [{ type: 'text', text: JSON.stringify({ error: who.why }) }], isError: true });
      const out = await tools.run(String(params.name || ''), params.arguments, who);
      return reply({ content: [{ type: 'text', text: out.text }], isError: out.isError });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

function serve(input = process.stdin, output = process.stdout) {
  const who = access();
  if (!who.ok) {
    console.error(who.why);
    process.exit(1);
  }
  let buffer = '';
  // Answers go out in the order questions came in, even when one takes longer.
  let queue = Promise.resolve();
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch {
          output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
          return;
        }
        const answer = await handle(msg).catch(e => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String(e && e.message || e).slice(0, 300) } }));
        if (answer) output.write(JSON.stringify(answer) + '\n');
      });
    }
  });
  input.on('end', () => queue.then(() => process.exit(0)));
}

/**
 * How another app starts this server: { command, args, env }. The Node
 * running now, by the name it has on PATH (/opt/homebrew/bin/node) when
 * that's the same file, not the versioned folder Homebrew keeps it in,
 * which a Node update would remove.
 */
function launch(env = process.env, execPath = process.execPath) {
  const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
  let command = execPath;
  const target = real(execPath);
  if (!env.ELECTRON_RUN_AS_NODE) {
    for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
      if (target && real(candidate) === target) { command = candidate; break; }
    }
  }
  return { command, args: [__filename], env: env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: '1' } : null };
}

/** What to paste into another app: the usual mcpServers JSON, and OpenCode's. */
function configs(l = launch()) {
  return {
    mcpServers: JSON.stringify({ mcpServers: { classdash: { command: l.command, args: l.args, ...(l.env ? { env: l.env } : {}) } } }, null, 2),
    opencode: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { classdash: { type: 'local', command: [l.command, ...l.args], enabled: true, ...(l.env ? { environment: l.env } : {}) } } }, null, 2),
  };
}

module.exports = { handle, access, issueRun, endRun, launch, configs, RUNS_FILE, PROTOCOLS };
if (require.main === module) {
  for (const level of ['log', 'info', 'warn', 'debug']) console[level] = (...a) => console.error(...a);
  serve();
}
