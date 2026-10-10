/**
 * The Grades center: every assignment's score by class (from 40-grades.js,
 * Q's Assignments area and Canvas's assignments), and an AI sidebar to ask
 * about them.
 *
 * ── The chat ──
 *
 * Kept in grades-chat.json until Clear, at the person's choice. Every
 * provider answers one prompt at a time (37-ai.js complete), so each
 * question goes with the grades and the last few turns of the chat folded
 * into that one prompt. The grades are written out as text with the totals
 * already added up, so the model reads numbers instead of doing sums it
 * might get wrong; it's told that Q's current grade can be weighted by
 * categories it can't see.
 *
 * ── Who sees the grades ──
 *
 * A local AI (Apple Intelligence, Ollama, LM Studio) keeps them on this
 * computer. A cloud one only once its id is in gradesAiAgreed: the box in
 * the sidebar saying the grades and teacher comments go to that company.
 * That's separate from aiAgreed (announcement text), since grades are more
 * personal. Nothing here is logged but that a question was asked.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./00-project-root.js');

const CHAT_FILE = path.join(PROJECT_ROOT, 'grades-chat.json');
const MAX_SAVED = 200;
const HISTORY_TURNS = 12;
const MAX_QUESTION = 2000;
const MAX_PER_CLASS = 120;
const MAX_UPCOMING = 15;
// The model's thinking, kept with its answer to show under a fold-out;
// never sent back to it with later questions. Always asked of a cloud AI;
// a local one only while aiThinking is on (off is faster).
const MAX_THINKING = 20000;

const settings = () => require('./19-settings.js').read();
const qName = c => require('./40-grades.js').qName(c);

const SYSTEM = `You help a student understand their school grades. Answer from the grades below and nothing else; if something isn't in them, say so. ` +
  `The totals are already added up for you: use them rather than adding scores yourself, and show the arithmetic when you work something out. ` +
  `A class's current grade comes from the school's system and can be weighted by categories (tests count more than homework, say) that aren't listed, ` +
  `so a total of points can differ from it; say so when it matters, and don't present a guess as certain. Missing work is marked. ` +
  `Where a class lists its categories with weights, they're the teacher's own from Canvas, or ones the student typed in for a Q class (it says whether they reproduce Q's grade): use them for what-if questions. ` +
  `If the student gives you weights for a Q class's categories (pasted from a syllabus, say), you can save the ones that have no weight yet: ` +
  `end your answer with one line exactly like WEIGHTS: {"Class name": {"Category": 40}}, with the class and category names spelled as below. ` +
  `Only use numbers the student gave you, never guess one, and leave out categories that already have a weight. Leave the line out otherwise. ` +
  `Some classes also list work coming up, from the student's assignment list (Classroom, Canvas, Edpuzzle): it isn't graded yet and has no scores, but use it for what's next and how much is still to come. ` +
  `Be encouraging but honest, keep answers short, and write plain text, no tables or markdown.`;

function readChat() {
  try {
    const saved = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    return Array.isArray(saved.messages) ? saved.messages : [];
  } catch { return []; }
}
function writeChat(messages) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages: messages.slice(-MAX_SAVED) }, null, 2));
}
function clearChat() {
  try { fs.unlinkSync(CHAT_FILE); } catch { /* nothing saved */ }
  return { ok: true };
}

/**
 * Work that isn't graded yet, by class: what's overdue and what's due, from
 * the same buckets the page and the API sort assignments into, soonest
 * first. A Q class only has any once it's linked to its Classroom or Canvas
 * class in Settings → Classes, since both go by the linked name.
 */
function upcomingByClass() {
  let d;
  try { d = require('./17-api.js').gather(); } catch { return new Map(); }
  const out = new Map();
  const add = (x, overdue) => {
    if (!x.class || x.hidden) return;
    if (!out.has(x.class)) out.set(x.class, []);
    out.get(x.class).push({ title: x.title, due: x.due_at ? x.due_at.toISOString() : null, platform: x.platform || 'Google Classroom', overdue });
  };
  for (const x of d.overdue) add(x, true);
  for (const x of [...d.burning, ...d.later]) add(x, false);
  for (const [name, list] of out) out.set(name, list.sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, MAX_UPCOMING));
  return out;
}

/** What the Grades center shows: each class with its assignments, newest
 *  first, and the points added up over the graded ones. */
function centerData(s = settings()) {
  const view = require('./40-grades.js').gradesView(s, { assignments: true });
  const coming = upcomingByClass();
  return view.classes.map(c => {
    const work = [...(c.assignments || [])].sort((a, b) => String(b.due || '').localeCompare(String(a.due || '')));
    // A score with nothing possible (extra points) still adds; dropped and
    // not-graded work doesn't. Q's own points where a report gives them.
    const graded = work.filter(a => a.score !== null && a.score !== undefined && !a.omitted && !a.excused);
    const earned = graded.reduce((n, a) => n + (typeof a.points === 'number' ? a.points : a.score), 0);
    const possible = graded.reduce((n, a) => n + (a.extraCredit ? 0 : a.possible || 0), 0);
    return {
      ...c,
      assignments: work,
      typedWeights: (s.gradesWeights || {})[qName(c)] || null,
      upcoming: coming.get(c.class) || [],
      totals: {
        graded: graded.length,
        earned: Math.round(earned * 100) / 100,
        possible: Math.round(possible * 100) / 100,
        percent: possible ? Math.round(earned / possible * 10000) / 100 : null,
        missing: work.filter(a => a.missing).length,
      },
    };
  });
}

// One line per assignment: what the model reads.
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function gradesText(classes) {
  return classes.map(c => {
    const head = `${c.class}${c.period ? ` (period ${c.period})` : ''}, from ${{ q: 'Q', canvas: 'Canvas', classroom: 'Google Classroom' }[c.source]}${c.superseded ? ' (not the grade this class goes by, Q\'s or Canvas\'s is; listed for its assignments)' : ''}: current grade ` +
      `${c.grade || c.percent !== null ? `${c.grade || ''}${c.percent !== null ? ` ${c.percent}%` : ''}`.trim() : 'not shown'}` +
      `${c.term ? ` (${c.term})` : ''}. Totals over graded work: ${c.totals.earned}/${c.totals.possible} points` +
      `${c.totals.percent !== null ? ` = ${c.totals.percent}%` : ''} across ${c.totals.graded} graded, ${c.totals.missing} missing.` +
      (c.estimate ? `\nCategories (${c.estimate.weighted ? 'weighted' : 'not weighted, every point counts the same'}): ` +
        c.estimate.groups.map(g => `${g.name}${c.estimate.weighted ? ` weight ${g.weight}%` : ''}: ${g.possible ? `${g.earned}/${g.possible} = ${g.percent}%` : 'nothing graded'}${g.dropped ? `, ${g.dropped} lowest/highest dropped` : ''}`).join('; ') +
        `. ClassDash's estimate of the grade from these: ${c.estimate.percent}%` +
        (c.estimate.typed ? ` (weights typed in by the student; ${c.estimate.matches === true ? 'they reproduce Q\'s grade exactly' : c.estimate.matches === false ? 'they don\'t reproduce Q\'s grade, so they may be wrong' : 'nothing to check them against'})` : '') + '.' : '') +
      (c.source === 'q' && c.categories && c.categories.length ? `\nCategory weights the student has typed in: ` +
        c.categories.map(cat => `${cat} ${c.typedWeights && typeof c.typedWeights[cat] === 'number' ? c.typedWeights[cat] + '%' : '(no weight yet)'}`).join('; ') + '.' : '') +
      (c.report ? `\nQ's progress report for ${c.report.term} (${c.report.from} to ${c.report.to}): ${c.report.grade || ''} ${c.report.percent !== null ? c.report.percent + '%' : ''}, ${c.report.earned}/${c.report.possible} points as Q counts them.` : '');
    const lines = c.assignments.slice(0, MAX_PER_CLASS).map(a => {
      const score = a.excused ? 'excused' : a.score !== null ? `${a.score}${a.possible !== null ? `/${a.possible}` : ''}${a.percent !== null ? ` (${a.percent}%)` : ''}`
        : a.scoreText ? a.scoreText : `not graded${a.possible !== null ? `, out of ${a.possible}` : ''}`;
      const notes = `${typeof a.points === 'number' ? ` (Q counts it as ${a.points} points)` : ''}${a.extraCredit ? ' [extra credit]' : ''}${a.dropped ? ' [dropped by the teacher, doesn\'t count]' : a.omitted ? ' [doesn\'t count]' : ''}`;
      return `- ${a.due ? String(a.due).slice(0, 10) + ' ' : ''}${clip(a.title, 120)}${a.category ? ` [${clip(a.category, 40)}]` : ''}: ${score}${notes}${a.missing ? ' [MISSING]' : ''}${a.late ? ' [late]' : ''}` +
        `${a.comment ? ` — teacher: "${clip(a.comment, 200)}"` : ''}`;
    });
    if (c.assignments.length > MAX_PER_CLASS) lines.push(`- (${c.assignments.length - MAX_PER_CLASS} older ones left out)`);
    const coming = (c.upcoming || []).map(u => `- ${u.due ? 'due ' + u.due.slice(0, 10) + ' ' : ''}${clip(u.title, 120)} (${u.platform})${u.overdue ? ' [OVERDUE]' : ''}`);
    if (coming.length) coming.unshift('Coming up in this class, not graded yet:');
    return [head, ...lines, ...coming].join('\n');
  }).join('\n\n');
}

/** Whether the sidebar can ask, and if not, why: 'off' (no AI picked),
 *  'agree' (a cloud AI whose grades box isn't ticked). */
function canAsk(s = settings()) {
  const ai = require('./37-ai.js');
  const id = s.aiProvider;
  if (!id || id === 'none' || !ai.PROVIDERS[id]) return { ok: false, why: 'off' };
  const p = ai.PROVIDERS[id];
  if (!p.local && !(s.gradesAiAgreed || []).includes(id)) return { ok: false, why: 'agree', company: p.company };
  return { ok: true, local: !!p.local, label: p.label, company: p.company || null };
}

function promptFor(question, history, classes, today = new Date()) {
  const turns = history.slice(-HISTORY_TURNS).map(m => `${m.role === 'ai' ? 'You' : 'Student'}: ${m.text}`).join('\n\n');
  return `Today is ${today.toISOString().slice(0, 10)}.\n\nTHE GRADES\n\n${gradesText(classes)}\n\n` +
    (turns ? `THE CONVERSATION SO FAR\n\n${turns}\n\n` : '') + `Student: ${question}`;
}

/**
 * The answer as it's being written, for the page to show live: written to
 * chat-live/answer.js (a script the page loads every quarter second while
 * it waits; its own folder, so the app's watch on live/ isn't woken by it)
 * and gone once the answer is in. Tagged with the page's id for the
 * question, so a page never shows another question's answer.
 */
const LIVE_DIR = path.join(PROJECT_ROOT, 'chat-live');
const LIVE_FILE = path.join(LIVE_DIR, 'answer.js');
function liveWriter(id) {
  let last = 0, timer = null, latest = null;
  const write = () => {
    timer = null; last = Date.now();
    try {
      fs.mkdirSync(LIVE_DIR, { recursive: true });
      fs.writeFileSync(LIVE_FILE + '.tmp', `window.classdashGradesLive = ${JSON.stringify({ id, ...latest })};\n`);
      fs.renameSync(LIVE_FILE + '.tmp', LIVE_FILE);
    } catch { /* the page just shows it when it's done */ }
  };
  return {
    part(p) {
      latest = { thinking: p.thinking || '', text: p.text || '' };
      if (timer) return;
      timer = setTimeout(write, Math.max(0, 200 - (Date.now() - last)));
    },
    end() {
      if (timer) clearTimeout(timer);
      timer = null;
      try { fs.unlinkSync(LIVE_FILE); } catch { /* none written */ }
    },
  };
}

/**
 * The WEIGHTS line the AI can end an answer with. Taken out of the answer
 * either way; saved only for a Q class's own categories that have no
 * weight yet, and only numbers that are in the student's question, so a
 * weight the model made up, or one already typed in, never lands.
 */
const WEIGHTS_LINE = /^[ \t]*WEIGHTS:(.*)$/gm;
function takeWeights(text, question, classes, typed = {}) {
  const found = [...String(text).matchAll(WEIGHTS_LINE)].map(m => m[1].trim());
  const clean = String(text).replace(WEIGHTS_LINE, '').trim();
  const saved = {}, kept = [];
  const numbers = new Set((String(question).match(/\d+(?:\.\d+)?/g) || []).map(Number));
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  for (const raw of found) {
    let map;
    try { map = JSON.parse(raw); } catch { continue; }
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [name, cats] of Object.entries(map)) {
      // By the name it's shown under (a linked one's), or Q's own.
      const c = classes.find(x => x.source === 'q' && x.categories && x.categories.length && (same(x.class, name) || (x.sourceClass && same(x.sourceClass, name))));
      if (!c || !cats || typeof cats !== 'object' || Array.isArray(cats)) continue;
      const key = qName(c);
      for (const [catName, w] of Object.entries(cats)) {
        const cat = c.categories.find(x => same(x, catName));
        const n = Number(w);
        if (!cat || w === null || w === '' || !isFinite(n) || n < 0 || n > 100 || !numbers.has(n)) continue;
        if (typed[key] && typeof typed[key][cat] === 'number') { kept.push({ class: key, category: cat }); continue; }
        (saved[key] = saved[key] || {})[cat] = n;
      }
    }
  }
  return { text: clean, saved, kept };
}

/** Asks the AI about the grades; saves the question and the answer, and
 *  any category weights it filled in (takeWeights). */
async function ask(question, { s = settings(), complete, write, live, now = new Date() } = {}) {
  const q = String(question || '').trim();
  if (!q) return { ok: false, why: 'empty' };
  if (q.length > MAX_QUESTION) return { ok: false, why: 'long' };
  const can = canAsk(s);
  if (!can.ok) return { ok: false, why: can.why };
  const classes = centerData(s);
  if (!classes.length) return { ok: false, why: 'nograde' };
  const history = readChat();
  const run = complete || (a => require('./37-ai.js').complete(a, s));
  const shown = typeof live === 'string' && /^[a-z0-9]{1,40}$/i.test(live) ? liveWriter(live) : null;
  let answer;
  try {
    answer = await run({ system: SYSTEM, prompt: promptFor(q, history, classes, now), maxTokens: 1200, think: !can.local || s.aiThinking !== false,
      ...(shown ? { onPart: p => shown.part(p) } : {}) });
  } finally {
    if (shown) shown.end();
  }
  if (!answer.ok) return { ok: false, why: 'ai', detail: answer.why };
  const typed = s.gradesWeights || {};
  const taken = takeWeights(answer.text || '', q, classes, typed);
  let text = taken.text;
  let saved = null;
  if (Object.keys(taken.saved).length) {
    const merged = { ...typed };
    for (const [cls, cats] of Object.entries(taken.saved)) merged[cls] = { ...(typed[cls] || {}), ...cats };
    const w = (write || require('./19-settings.js').write)('gradesWeights', merged);
    if (w.ok) saved = taken.saved;
  }
  const { t } = require('./18-language.js');
  if (saved) text += '\n\n' + Object.entries(saved).map(([cls, cats]) => t('gcAiWeightsSaved', cls, Object.entries(cats).map(([k, v]) => `${k} ${v}%`).join(', '))).join('\n');
  if (taken.kept.length) text += '\n\n' + t('gcAiWeightsKept', taken.kept.map(k => k.category).join(', '));
  text = text.trim() || '…';
  const messages = [...history, { role: 'user', text: q, at: now.toISOString() }, { role: 'ai', text, ...(answer.thinking ? { thinking: String(answer.thinking).slice(0, MAX_THINKING) } : {}), at: new Date().toISOString() }];
  writeChat(messages);
  return { ok: true, answer: text, messages: messages.slice(-MAX_SAVED), ...(saved ? { savedWeights: saved } : {}) };
}

module.exports = { centerData, gradesText, canAsk, promptFor, ask, takeWeights, readChat, clearChat, SYSTEM, CHAT_FILE, LIVE_FILE };
