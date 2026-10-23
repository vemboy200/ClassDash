/**
 * The tools an AI may use to look at a student's schoolwork: the
 * assignments, the announcements, the PDFs in the workspace, the grades.
 *
 * ── One list, two ways in ──
 *
 * The same TOOLS are handed out two ways, so they can't drift apart:
 *   - the AI sidebar's own loop (for AIs reached over HTTP: LM Studio,
 *     Ollama, a cloud key), which calls run() here directly;
 *   - 48-mcp.js, an MCP server, for AIs that run as programs of their own
 *     (Codex, Claude Code) and for other AI apps the person connects
 *     themselves (Antigravity, OpenCode, Claude Desktop...).
 *
 * ── Only looking ──
 *
 * Every tool only reads what ClassDash has already saved. None of them can
 * change, hide, mark done or turn in anything, write on a PDF, or start a
 * check, so whatever an AI is asked (or tricked into by text in an
 * assignment), the worst it can do is read. Grades are the most personal
 * part, so get_grades is only there when the caller allows it (ctx.grades):
 * the sidebar for a local AI or one ticked in the Grades center's box, the
 * MCP server for other apps only with its own box ticked.
 *
 * Assignments are sorted by the Home API's own gather() (17-api.js), so
 * "due soon" means here exactly what it means on the page and in the API.
 */
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

// What one answer may hold: enough for a long assignment or a few pages of a
// PDF, not so much that it fills a small local model's context on its own.
const MAX_TEXT = 24000;
const MAX_PAGES = 10;

const api = () => require('./17-api.js');
const workspace = () => require('./46-workspace.js');

/** An assignment in short, for lists. */
function brief(x) {
  return {
    id: x.id, title: x.title, class: x.class, platform: x.platform, type: x.type,
    due: x.due, daysUntilDue: x.daysUntilDue,
    ...(x.locked ? { locked: x.locked } : {}),
    ...(x.linked ? { linked: { done: x.linked.done, total: x.linked.total } } : {}),
    ...(x.tags.length ? { tags: x.tags } : {}),
  };
}

const sameClass = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const WHICH = {
  due_soon: d => d.burning,
  upcoming: d => d.later,
  overdue: d => d.overdue,
  no_date: d => d.undated,
  done: d => d.done,
};

// ── reading a PDF in the workspace ──

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import(path.join(PROJECT_ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  return pdfjs;
}

/** A page's words as lines, top to bottom, the way PDF.js finds them. */
function linesOf(items) {
  let out = '', lastY = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform ? Math.round(it.transform[5]) : null;
    if (lastY !== null && y !== null && y !== lastY && !out.endsWith('\n')) out += '\n';
    out += it.str;
    if (it.hasEOL) out += '\n';
    lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** What the student wrote on a page: typed text in full, pen marks counted. */
function inkOf(ink, page) {
  const items = (ink && ink.pages && ink.pages[String(page)]) || [];
  const typed = items.filter(i => i.type === 'text' && i.text).map(i => i.text);
  return { typed, penMarks: items.filter(i => i.type === 'pen').length, highlights: items.filter(i => i.type === 'hl').length };
}

async function pdfPages(id, from, to) {
  const W = workspace();
  if (!W.isId(id)) return { error: 'No PDF with that id. list_pdfs gives the ids.' };
  const dir = path.join(W.DIR, id);
  let data;
  try { data = new Uint8Array(fs.readFileSync(path.join(dir, 'source.pdf'))); } catch { return { error: 'No PDF with that id. list_pdfs gives the ids.' }; }
  let ink = null;
  try { ink = JSON.parse(fs.readFileSync(path.join(dir, 'ink.json'), 'utf8')); } catch { /* not written on */ }
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const count = doc.numPages;
    const first = Math.max(1, Math.min(count, Math.floor(Number(from) || 1)));
    const last = Math.max(first, Math.min(count, first + MAX_PAGES - 1, Math.floor(Number(to) || first)));
    const pages = [];
    for (let n = first; n <= last; n++) {
      const page = await doc.getPage(n);
      const text = linesOf((await page.getTextContent()).items);
      pages.push({ page: n, text: text || null, ...(text ? {} : { note: 'No text on this page: it may be a scan or a picture.' }), studentWrote: inkOf(ink, n) });
    }
    return { id, pageCount: count, pages, ...(last < Math.min(count, Math.floor(Number(to) || first)) ? { more: `Only ${MAX_PAGES} pages at a time; ask again from page ${last + 1}.` } : {}) };
  } finally {
    doc.destroy();
  }
}

// ── the tools ──

const TOOLS = [
  {
    name: 'list_assignments',
    description: 'Lists the student\'s assignments. "which" picks the list: due_soon (the page\'s Due soon), upcoming (due later), overdue, no_date, or done. Optionally only one class. Each has an id for get_assignment.',
    input: {
      type: 'object',
      properties: {
        which: { type: 'string', enum: Object.keys(WHICH), description: 'Which list. Default due_soon.' },
        class: { type: 'string', description: 'Only this class (its name as list_classes gives it).' },
      },
    },
    run(args) {
      const d = api().gather();
      const pick = WHICH[args.which] || WHICH.due_soon;
      const list = pick(d).filter(x => !args.class || sameClass(x.class, args.class)).map(x => brief(api().toPublic(x, d.now)));
      return { which: WHICH[args.which] ? args.which : 'due_soon', count: list.length, assignments: list, checkedAt: d.collectedAt ? d.collectedAt.toISOString() : null };
    },
  },
  {
    name: 'get_assignment',
    description: 'One assignment in full: its class, due date, link, and the teacher\'s instructions where the platform gave them (Canvas does; Classroom\'s aren\'t read yet).',
    input: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The id from list_assignments.' } },
      required: ['id'],
    },
    run(args) {
      const d = api().gather();
      // From the sorted lists first: that's where a due date has been read.
      const id = String(args.id || '');
      const x = [d.burning, d.later, d.undated, d.deferred, d.overdue, d.done, d.gone, d.items].map(l => (l || []).find(i => i.id === id)).find(Boolean);
      if (!x) return { error: 'No assignment with that id. list_assignments gives the ids.' };
      const out = api().toPublic(x, d.now);
      delete out.sourceClass;
      delete out.teacher;
      return { ...out, instructions: x.description || null, ...(x.description ? {} : { note: 'No instructions saved for this one: open its link to read them.' }) };
    },
  },
  {
    name: 'list_classes',
    description: 'The student\'s classes, with how many assignments each has due soon, upcoming and overdue.',
    input: { type: 'object', properties: {} },
    run(args, ctx) {
      const list = api().HANDLERS['/api/classes'](api().gather());
      // A class's grade comes with the class list in the API; here only with
      // grades allowed. Teachers' names aren't needed to help with the work.
      return { classes: list.map(c => { const o = { ...c }; if (!ctx.grades) delete o.grade; delete o.teacher; return o; }) };
    },
  },
  {
    name: 'list_announcements',
    description: 'Recent announcements teachers posted, newest first. Often where instructions, changes and reminders are. Optionally only one class.',
    input: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Only this class.' },
        limit: { type: 'number', description: 'How many, at most. Default 10, at most 30.' },
      },
    },
    run(args) {
      const all = api().HANDLERS['/api/announcements'](api().gather());
      const limit = Math.max(1, Math.min(30, Math.floor(Number(args.limit) || 10)));
      const list = all.filter(p => !args.class || sameClass(p.class, args.class))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, limit)
        .map(p => ({ class: p.class, date: p.date, title: p.title, text: p.text, link: p.link }));
      return { count: list.length, announcements: list };
    },
  },
  {
    name: 'list_pdfs',
    description: 'The PDFs in the student\'s workspace (worksheets and readings they opened in ClassDash), most recently written on first. Each has an id for read_pdf_pages.',
    input: { type: 'object', properties: {} },
    run() {
      return { pdfs: workspace().listDocs().map(d => ({ id: d.id, title: d.title, pageCount: d.pageCount, addedAt: d.addedAt, editedAt: d.editedAt })) };
    },
  },
  {
    name: 'read_pdf_pages',
    description: `The text of pages of a workspace PDF, and what the student typed on each page (pen marks and highlights are only counted). Up to ${MAX_PAGES} pages at a time.`,
    input: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id from list_pdfs.' },
        from: { type: 'number', description: 'First page, from 1. Default 1.' },
        to: { type: 'number', description: 'Last page. Default the same as from.' },
      },
      required: ['id'],
    },
    run: args => pdfPages(String(args.id || ''), args.from, args.to),
  },
  {
    name: 'get_grades',
    grades: true,
    description: 'The student\'s grades: each class\'s grade and percent, or one class\'s graded assignments in full.',
    input: {
      type: 'object',
      properties: { class: { type: 'string', description: 'One class, with its graded assignments. Leave out for every class\'s grade.' } },
    },
    run(args) {
      const view = require('./40-grades.js').gradesView(undefined, { assignments: !!args.class });
      const classes = view.classes.filter(c => !c.superseded && (!args.class || sameClass(c.class, args.class)));
      if (args.class && !classes.length) return { error: 'No grades for that class. Leave out "class" to see which classes have grades.' };
      return { classes: classes.map(c => { const o = { ...c }; delete o.sourceClass; return o; }) };
    },
  },
];

/** The tools this caller may use. ctx: { grades: boolean } */
function toolsFor(ctx = {}) {
  return TOOLS.filter(t => !t.grades || ctx.grades);
}

/**
 * Runs a tool for a caller. Always answers a string (JSON), never throws:
 * a model gets told what went wrong and can try something else.
 */
async function run(name, args, ctx = {}) {
  const tool = toolsFor(ctx).find(t => t.name === name);
  if (!tool) return { isError: true, text: JSON.stringify({ error: `No tool called ${name}.` }) };
  let result;
  try {
    result = await tool.run(args && typeof args === 'object' ? args : {}, ctx);
  } catch (e) {
    return { isError: true, text: JSON.stringify({ error: `${name} failed: ${String(e && e.message || e).slice(0, 300)}` }) };
  }
  let text = JSON.stringify(result);
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + ' …(cut short: ask for less at a time)';
  return { isError: !!(result && result.error), text };
}

module.exports = { TOOLS, toolsFor, run, linesOf, MAX_TEXT, MAX_PAGES };
