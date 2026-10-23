// A ClassDash project full of made-up schoolwork, for trying things with a
// real AI app (or showing ClassDash off) without anyone's real data in it.
//
//   node test/demo-project.js <folder>
//
// The folder is made (or emptied of a previous demo) and gets this repo's
// scripts, a link to its node_modules, and made-up classes, assignments,
// announcements, grades and a worksheet PDF in the workspace. "Let other AI
// apps use ClassDash" is on, grades too, so an MCP app pointed at the
// folder's 48-mcp.js sees only this. Nothing here is a real person, class or
// school; the Canvas address is a .test one, which can't exist.
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');

const target = process.argv[2];
if (!target) { console.error('Usage: node test/demo-project.js <folder>'); process.exit(1); }
const dir = path.resolve(target);
if (fs.existsSync(dir) && fs.readdirSync(dir).length && !fs.existsSync(path.join(dir, '.classdash-demo'))) {
  console.error(`${dir} isn't empty and isn't a demo project; pick another folder.`);
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, '.classdash-demo'), 'Made by test/demo-project.js. Everything in here is made up.\n');

// The same files the apps ship as a project (see test/helpers.js).
fs.copyFileSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
for (const name of fs.readdirSync(path.join(REPO, 'src'))) {
  if (name.endsWith('.js') || name.endsWith('.png') || name === 'settings.example.json') fs.copyFileSync(path.join(REPO, 'src', name), path.join(dir, name));
}
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

const day = 86400000, now = Date.now();
const at = (days, hour = 23, minute = 59) => { const d = new Date(now + days * day); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
const SITE = 'https://canvas.demo.test';

write('settings.json', {
  language: 'en', email: 'student@demo.test', canvas: SITE, canvasToken: 'demo', canvasApiEnabled: true, canvasSsoEnabled: false,
  classroomEnabled: false, edpuzzleEnabled: false, aiMcpExternal: true, aiMcpGrades: true,
});

let n = 100;
const assignment = (cls, title, dueDays, description, extra = {}) => ({
  platform: 'Canvas', class: cls, id: `canvas-${n}`, type: 'Assignment', title, link: `${SITE}/courses/1/assignments/${n++}`,
  due_iso: dueDays === null ? null : at(dueDays), due: null, posted: at(-5, 9, 0), description, ...extra,
});
write('last-collection.json', [
  assignment('Biology', 'Cell Organelles Worksheet', 1, 'Complete the worksheet on organelles (in the workspace as "Cell Organelles Worksheet").\nLabel every part of the diagram on page 2, then answer questions 1-6 in full sentences.\nTurn in a PDF.'),
  assignment('Biology', 'Lab report: Osmosis in potatoes', 6, 'Write up the osmosis lab.\nSections: Hypothesis, Materials, Procedure, Data (table of mass change for each salt concentration), Analysis, Conclusion.\n2-3 pages. Graph the percent change in mass against salt concentration.'),
  assignment('Algebra II', 'Problem Set 4.3: Quadratic functions', 2, 'Page 214, problems 1-29 odd. Show all work.\nFor 21-29, also sketch the graph and label the vertex and axis of symmetry.'),
  assignment('Algebra II', 'Unit 4 Test', 9, 'Covers 4.1-4.5: graphing quadratics, vertex form, factoring, the quadratic formula, and the discriminant. Calculators allowed on part 2 only.'),
  assignment('World History', 'Essay outline: Causes of World War I', 3, 'Outline a 5-paragraph essay on the main causes of WWI (militarism, alliances, imperialism, nationalism, and the assassination of Franz Ferdinand).\nThesis statement plus 3 body points with 2 pieces of evidence each.'),
  assignment('World History', 'Reading quiz: Chapter 12', -2, null),
  assignment('English 10', 'Reading journal: Of Mice and Men ch. 3-4', 4, 'One page per chapter. For each: a quote that stood out, why, and one question you still have.'),
  assignment('English 10', 'Vocabulary set 8', null, 'Learn the 20 words on the class page. Quiz next week.'),
  assignment('Chemistry', 'Stoichiometry practice', 12, 'Worksheet problems 1-15. Use the molar masses on the back of the periodic table handout.'),
]);

write('messages.json', [
  { id: 'demo-m1', class: 'Biology', author: 'Demo Teacher', date: at(-1, 15, 10), sortTime: now - day, title: 'Lab moved to Thursday', text: 'Heads up: the osmosis lab is moving to Thursday because of the assembly. Bring your lab notebook. The report due date moves back a day too.', link: `${SITE}/courses/1/announcements/1`, attachments: [] },
  { id: 'demo-m2', class: 'Algebra II', author: 'Demo Teacher', date: at(-2, 8, 0), sortTime: now - 2 * day, title: 'Test review session', text: 'Review session for the Unit 4 test after school on Monday in room 214. Bring questions from 4.4 and 4.5, those were the toughest on the quiz.', link: `${SITE}/courses/2/announcements/1`, attachments: [] },
  { id: 'demo-m3', class: 'English 10', author: 'Demo Teacher', date: at(-3, 12, 0), sortTime: now - 3 * day, title: 'Reading schedule', text: 'Finish chapter 4 by Friday. We will discuss the ending of chapter 3 in class, so no spoilers in the journals please.', link: `${SITE}/courses/3/announcements/1`, attachments: [] },
]);

const graded = (title, score, possible, extra = {}) => ({ id: `g${n++}`, title, due: at(-10), assigned: at(-20), possible, score, scoreText: null, percent: Math.round(score / possible * 1000) / 10, comment: null, missing: false, late: false, excused: false, link: `${SITE}/grades`, group: 1, omitted: false, ...extra });
const gradeClass = (cls, grade, percent, assignments) => ({ class: cls, grade, percent, assignments, weighting: null });
write('canvas-grades.json', {
  checkedAt: new Date(now - 3600000).toISOString(),
  classes: [
    gradeClass('Biology', 'B+', 88.4, [graded('Cell membrane quiz', 17, 20), graded('Microscope lab', 45, 50), graded('Unit 2 test', 81, 100, { comment: 'Review the parts of the cell membrane.' })]),
    gradeClass('Algebra II', 'B-', 81.2, [graded('Problem Set 4.1', 18, 25, { late: true }), graded('Quiz 4.1-4.2', 15, 20), graded('Unit 3 test', 84, 100)]),
    gradeClass('World History', 'A-', 91.0, [graded('Chapter 11 reading quiz', 9, 10), graded('Map project', 47, 50)]),
    gradeClass('English 10', 'A', 94.6, [graded('Reading journal ch. 1-2', 20, 20), graded('Vocabulary quiz 7', 18, 20)]),
    gradeClass('Chemistry', 'C+', 78.3, [graded('Moles worksheet', 12, 20, { comment: 'Show your units.' }), graded('Lab safety quiz', 10, 10)]),
  ],
});

(async () => {
  const { PDFDocument, StandardFonts } = require(path.join(dir, 'pdf-lib.min.js'));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdf.addPage([612, 792]);
  const lines = [
    [bold, 18, 'Cell Organelles Worksheet'], [font, 11, 'Name: ____________________   Period: ____'], [font, 11, ''],
    [bold, 12, 'Answer each question in a full sentence.'], [font, 11, ''],
    [font, 12, '1. Which organelle makes most of the cell\'s energy (ATP)?'], [font, 11, ''], [font, 11, ''],
    [font, 12, '2. What does the cell membrane control?'], [font, 11, ''], [font, 11, ''],
    [font, 12, '3. Where are proteins made?'], [font, 11, ''], [font, 11, ''],
    [font, 12, '4. Name two organelles found in plant cells but not animal cells.'], [font, 11, ''], [font, 11, ''],
    [font, 12, '5. What is the job of the nucleus?'], [font, 11, ''], [font, 11, ''],
    [font, 12, '6. How is the Golgi apparatus like a post office?'],
  ];
  let y = 740;
  for (const [f, size, text] of lines) { if (text) page1.drawText(text, { x: 54, y, font: f, size }); y -= size + 10; }
  const page2 = pdf.addPage([612, 792]);
  page2.drawText('Diagram: label the animal cell', { x: 54, y: 740, font: bold, size: 16 });
  page2.drawEllipse({ x: 306, y: 420, xScale: 200, yScale: 150, borderWidth: 2 });
  page2.drawEllipse({ x: 300, y: 430, xScale: 50, yScale: 40, borderWidth: 1.5 });
  page2.drawText('Word bank: nucleus, mitochondria, ribosome, cell membrane, Golgi apparatus, endoplasmic reticulum', { x: 54, y: 200, font, size: 10 });
  const pdfFile = path.join(dir, 'Cell Organelles Worksheet.pdf');
  fs.writeFileSync(pdfFile, await pdf.save());
  const W = require(path.join(dir, '46-workspace.js'));
  const doc = W.importPdf(pdfFile);
  fs.unlinkSync(pdfFile);
  fs.writeFileSync(path.join(W.DIR, doc.id, 'ink.json'), JSON.stringify({ version: 1, pageCount: 2, pages: { 1: [
    { id: 'd1', type: 'text', color: '#1d4ed8', size: 14, x: 70, y: 175, text: 'The mitochondria makes most of the ATP.' },
    { id: 'd2', type: 'text', color: '#1d4ed8', size: 14, x: 70, y: 245, text: 'What goes in and out of the cell?' },
    { id: 'd3', type: 'hl', color: '#facc15', width: 16, points: [[54, 302], [380, 302]] },
  ] } }));

  const run = require('child_process').spawnSync(process.execPath, [path.join(dir, '05-playwright-draft.js'), '--redraw'], { cwd: dir, encoding: 'utf8' });
  if (run.status !== 0) console.error('(the page wasn\'t drawn: ' + (run.stderr || run.stdout).trim().split('\n').pop() + ')');
  const { launch } = require(path.join(dir, '48-mcp.js'));
  const l = launch();
  console.log(`Demo project in ${dir}\nIts MCP server: ${[l.command, ...l.args].map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
})();
