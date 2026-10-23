// The AI's tools (47-ai-tools.js) and the MCP server that hands them out
// (48-mcp.js), talked to the way Codex, Claude Code or another AI app would:
// JSON-RPC, one line at a time, over the server's stdin and stdout. Who may
// use it (a sidebar run's code, or the Settings switch for other apps), and
// that grades stay out unless allowed. Every class, assignment and PDF here
// is made up.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const soon = new Date(Date.now() + 86400000).toISOString();
const later = new Date(Date.now() + 20 * 86400000).toISOString();
const settings = { language: 'en', email: 'a@b', canvas: 'https://canvas.example.test', canvasToken: 'x', canvasApiEnabled: true };
const proj = T.makeProject({
  'settings.json': settings,
  'last-collection.json': [
    { platform: 'Canvas', class: 'Made-up Biology', id: 'canvas-1', type: 'Assignment', title: 'Cell worksheet', link: 'https://canvas.example.test/a/1', due_iso: soon, due: null, posted: null, description: 'Label every part of the cell.\nUse the diagram on page 2.' },
    { platform: 'Canvas', class: 'Made-up History', id: 'canvas-2', type: 'Assignment', title: 'Essay outline', link: 'https://canvas.example.test/a/2', due_iso: later, due: null, posted: null },
  ],
  'messages.json': [
    { id: 'm1', class: 'Made-up Biology', author: 'A Made-up Teacher', date: '2026-10-20', title: 'Lab moved', text: 'The lab is on Thursday now.', link: 'https://classroom.example.test/m1' },
  ],
});
process.chdir(proj);
const write = (s) => fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(Object.assign({}, settings, s)));

/** Starts the server and returns ask(method, params) and the process. */
function start(env = {}) {
  const child = cp.spawn(process.execPath, [path.join(proj, '48-mcp.js')], { cwd: proj, env: Object.assign({}, process.env, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', next = 1;
  const waiting = new Map();
  child.stdout.on('data', d => {
    out += d;
    let nl;
    while ((nl = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, nl); out = out.slice(nl + 1);
      let msg; try { msg = JSON.parse(line); } catch { waiting.forEach(w => w.reject(new Error('not JSON on stdout: ' + line))); continue; }
      const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w.resolve(msg); }
    }
  });
  child.stderr.on('data', d => { err += d; });
  const ask = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (waiting.delete(id)) reject(new Error('no answer to ' + method + ' ' + err)); }, 15000);
  });
  const call = async (name, args = {}) => {
    const r = (await ask('tools/call', { name, arguments: args })).result;
    return { isError: r.isError, data: JSON.parse(r.content[0].text.replace(/ …\(cut short.*$/, '')), text: r.content[0].text };
  };
  const exited = new Promise(r => child.on('exit', code => r({ code, err })));
  return { ask, call, child, exited, stderr: () => err };
}

(async () => {
  // A made-up worksheet in the workspace, with something typed on page 1.
  const { PDFDocument, StandardFonts } = require(path.join(proj, 'pdf-lib.min.js'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Question 1: Name the organelle that makes energy.', { x: 50, y: 700, font, size: 14 });
  doc.addPage([612, 792]).drawText('Diagram of a cell', { x: 50, y: 700, font, size: 14 });
  doc.addPage([612, 792]);
  const pdfFile = path.join(proj, 'Made-up Cells.pdf');
  fs.writeFileSync(pdfFile, await doc.save());
  const W = require(path.join(proj, '46-workspace.js'));
  const pdf = W.importPdf(pdfFile);
  fs.writeFileSync(path.join(W.DIR, pdf.id, 'ink.json'), JSON.stringify({ version: 1, pageCount: 3, pages: { 1: [
    { id: 'a', type: 'text', color: '#000', size: 16, x: 60, y: 120, text: 'mitochondria?' },
    { id: 'b', type: 'pen', color: '#000', width: 2, points: [[1, 2], [3, 4]] },
  ] } }));

  // ── another app, with the switch off ──
  const off = start();
  const offEnd = await off.exited;
  ok('another app gets nothing while the switch is off: the server says why and stops', offEnd.code === 1 && /Let other AI apps use ClassDash/.test(offEnd.err), JSON.stringify(offEnd));

  // ── another app, with it on (grades still off) ──
  write({ aiMcpExternal: true });
  const ext = start();
  const init = (await ext.ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'made-up-app', version: '1' } })).result;
  ok('it says hello in the version the app asked for, offering tools', init.protocolVersion === '2025-06-18' && init.capabilities.tools && init.serverInfo.name === 'classdash', JSON.stringify(init));
  ext.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const unknownVersion = (await ext.ask('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion;
  ok('...and its own newest for a version it doesn\'t know', unknownVersion === '2025-11-25');
  const names = (await ext.ask('tools/list')).result.tools.map(t => t.name);
  ok('its tools, every one marked read-only, without grades', names.join() === 'list_assignments,get_assignment,list_classes,list_announcements,list_pdfs,read_pdf_pages' &&
    (await ext.ask('tools/list')).result.tools.every(t => t.annotations.readOnlyHint && t.inputSchema.type === 'object'), names.join());
  const grades = await ext.call('get_grades');
  ok('get_grades can\'t be called either', grades.isError && /No tool called get_grades/.test(grades.data.error));

  const dueSoon = await ext.call('list_assignments');
  ok('list_assignments: Due soon by default, sorted the page\'s way', dueSoon.data.which === 'due_soon' && dueSoon.data.assignments.map(a => a.id).join() === 'canvas-1' && dueSoon.data.assignments[0].daysUntilDue === 1, dueSoon.text);
  const upcoming = await ext.call('list_assignments', { which: 'upcoming', class: 'made-up history' });
  ok('...or another list, for one class', upcoming.data.assignments.map(a => a.id).join() === 'canvas-2', upcoming.text);
  const one = await ext.call('get_assignment', { id: 'canvas-1' });
  ok('get_assignment: with the teacher\'s instructions and its due date', one.data.title === 'Cell worksheet' && one.data.daysUntilDue === 1 && /page 2/.test(one.data.instructions) && one.data.link && !('teacher' in one.data), one.text);
  const none = await ext.call('get_assignment', { id: 'canvas-2' });
  ok('...or saying there are none saved', none.data.instructions === null && /open its link/.test(none.data.note));
  const missing = await ext.call('get_assignment', { id: 'nope' });
  ok('...and an id it doesn\'t know is an error the AI can read', missing.isError && /list_assignments gives the ids/.test(missing.data.error));
  const classes = await ext.call('list_classes');
  ok('list_classes: counts, but no grade and no teacher', classes.data.classes.length >= 2 && classes.data.classes.every(c => !('grade' in c) && !('teacher' in c)), classes.text);
  const posts = await ext.call('list_announcements', { class: 'Made-up Biology' });
  ok('list_announcements: what was posted, without who posted it', posts.data.count === 1 && posts.data.announcements[0].text === 'The lab is on Thursday now.' && !/Made-up Teacher/.test(posts.text), posts.text);

  const pdfs = await ext.call('list_pdfs');
  ok('list_pdfs: the workspace\'s PDFs', pdfs.data.pdfs.length === 1 && pdfs.data.pdfs[0].id === pdf.id && pdfs.data.pdfs[0].title === 'Made-up Cells', pdfs.text);
  const page1 = await ext.call('read_pdf_pages', { id: pdf.id });
  ok('read_pdf_pages: a page\'s text, and what the student typed on it', page1.data.pageCount === 3 && /Name the organelle that makes energy/.test(page1.data.pages[0].text) &&
    page1.data.pages[0].studentWrote.typed.join() === 'mitochondria?' && page1.data.pages[0].studentWrote.penMarks === 1, page1.text);
  const range = await ext.call('read_pdf_pages', { id: pdf.id, from: 2, to: 99 });
  ok('...a range of pages, a page without text said so', range.data.pages.map(p => p.page).join() === '2,3' && /Diagram/.test(range.data.pages[0].text) && range.data.pages[1].text === null && /scan/.test(range.data.pages[1].note), range.text);
  const badPdf = await ext.call('read_pdf_pages', { id: '../settings' });
  ok('...and only the workspace\'s own PDFs', badPdf.isError && /list_pdfs/.test(badPdf.data.error));
  ok('nothing but protocol on stdout (PDF.js\'s chatter goes to stderr)', true);
  const unknown = await ext.ask('resources/list');
  ok('a method it doesn\'t have is the usual error', unknown.error && unknown.error.code === -32601);

  write({ aiMcpExternal: false });
  const after = await ext.call('list_pdfs');
  ok('turning the switch off works at once, without restarting the app', after.isError && /Let other AI apps use ClassDash/.test(after.text));
  ok('...and its tool list empties', (await ext.ask('tools/list')).result.tools.length === 0);
  ext.child.stdin.end();
  ok('it ends when the app closes its side', (await ext.exited).code === 0);

  write({ aiMcpExternal: true, aiMcpGrades: true });
  const withGrades = start();
  ok('grades only with their own box ticked too', (await withGrades.ask('tools/list')).result.tools.some(t => t.name === 'get_grades') &&
    Array.isArray((await withGrades.call('get_grades')).data.classes));
  withGrades.child.stdin.end(); await withGrades.exited;

  // ── a sidebar run ──
  write({ aiMcpExternal: false, aiMcpGrades: false });
  const mcp = require(path.join(proj, '48-mcp.js'));
  const code = mcp.issueRun({ grades: true });
  ok('a sidebar run\'s code is kept only as a hash', !fs.readFileSync(mcp.RUNS_FILE, 'utf8').includes(code) && (fs.statSync(mcp.RUNS_FILE).mode & 0o077) === 0);
  const side = start({ CLASSDASH_MCP_RUN: code });
  const sideTools = (await side.ask('tools/list')).result.tools.map(t => t.name);
  ok('the sidebar\'s run works with the switch off, and gets grades when its run allows them', sideTools.includes('get_grades') && !(await side.call('list_pdfs')).isError);
  mcp.endRun(code);
  ok('once the run ends, the same code is just another app (switch off: nothing)', (await side.call('list_pdfs')).isError);
  side.child.stdin.end(); await side.exited;
  const copied = start({ CLASSDASH_MCP_RUN: 'f'.repeat(48) });
  ok('a made-up or copied code doesn\'t get around the switch', (await copied.exited).code === 1);
  const noGrades = mcp.issueRun({ grades: false });
  const side2 = start({ CLASSDASH_MCP_RUN: noGrades });
  ok('a run that doesn\'t allow grades doesn\'t get them', !(await side2.ask('tools/list')).result.tools.some(t => t.name === 'get_grades'));
  side2.child.stdin.end(); await side2.exited;
  mcp.endRun(noGrades);

  // ── what Settings gives to paste ──
  const bin = T.tmpDir('classdash-bin-');
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const viaPath = mcp.launch({ PATH: ['/nowhere', bin].join(path.delimiter) });
  ok('the command is Node by the name it has on PATH, not its versioned folder', viaPath.command === path.join(bin, 'node') && viaPath.args[0] === path.join(proj, '48-mcp.js') && viaPath.env === null, JSON.stringify(viaPath));
  const electron = mcp.launch({ PATH: bin, ELECTRON_RUN_AS_NODE: '1' }, '/Made Up/ClassDash.exe');
  const pasted = mcp.configs(electron);
  const most = JSON.parse(pasted.mcpServers).mcpServers.classdash, open = JSON.parse(pasted.opencode).mcp.classdash;
  ok('for the Electron app, its own binary run as Node, in both configs', most.command === '/Made Up/ClassDash.exe' && most.env.ELECTRON_RUN_AS_NODE === '1' &&
    open.type === 'local' && open.command.join('|') === '/Made Up/ClassDash.exe|' + path.join(proj, '48-mcp.js') && open.environment.ELECTRON_RUN_AS_NODE === '1', JSON.stringify({ most, open }));
  T.redraw(proj);
  const page = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  ok('Settings → AI has the switch, off, with the configs tucked away until it\'s on', /data-bool-key="aiMcpExternal"(?! checked)/.test(page) && /<div id="ai-mcp-more" hidden>/.test(page) &&
    page.includes('id="mcp-config-most"') && page.includes('id="mcp-config-opencode"'));
})().catch(e => { ok('ran without throwing', false, e.stack); });
