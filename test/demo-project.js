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
  if (name.endsWith('.js') || name === 'settings.example.json') fs.copyFileSync(path.join(REPO, 'src', name), path.join(dir, name));
}
for (const folder of ['services', 'icons']) fs.cpSync(path.join(REPO, 'src', folder), path.join(dir, folder), { recursive: true });
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

const day = 86400000, now = Date.now();
const at = (days, hour = 23, minute = 59) => { const d = new Date(now + days * day); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
const SITE = 'https://canvas.demo.test';

write('settings.json', {
  language: 'en', email: 'student@demo.test', canvas: SITE, canvasToken: 'demo', canvasApiEnabled: true, canvasSsoEnabled: false,
  classroomEnabled: true, edpuzzleEnabled: true, aiMcpExternal: true, aiMcpGrades: true,
});

let n = 100;
const assignment = (cls, title, dueDays, description, extra = {}) => ({
  platform: 'Canvas', class: cls, id: `canvas-${n}`, type: 'Assignment', title, link: `${SITE}/courses/1/assignments/${n++}`,
  due_iso: dueDays === null ? null : at(dueDays), due: null, posted: at(-5, 9, 0), description, ...extra,
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const classroomDue = days => {
  if (days === null) return null;
  const d = new Date(at(days));
  const h = d.getHours() % 12 || 12, ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `Due ${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};
// Classroom shows a post's date as "Nov 18".
const shortDate = days => { const d = new Date(at(days)); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const classroom = (cls, title, dueDays, description, extra = {}) => ({
  class: cls, id: String(900000000000 + n++), type: 'Assignment', title, link: `https://classroom.demo.test/c/${n}`,
  due: classroomDue(dueDays), posted: at(-4, 8, 30), description, descriptionAt: at(-1), ...extra,
});
const edpuzzle = (cls, title, dueDays) => ({
  platform: 'Edpuzzle', class: cls, id: `edpuzzle-demo${n++}`, type: 'Assignment', title,
  link: `https://edpuzzle.demo.test/assignments/${n}/watch`, due_iso: at(dueDays), due: null, posted: at(-3, 7, 45),
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
  // Google Classroom: no platform field and a due date written the way
  // Classroom shows it ("Due Nov 21, 11:59 PM"), like the real collector.
  classroom('Spanish II', 'Vocabulario: la comida', 2, 'Study the food vocabulary list and complete the Quizlet set. Quiz on Friday.'),
  classroom('Spanish II', 'Presentación oral: mi familia', 8, 'A 2-minute presentation about your family, in Spanish. Bring 3 photos or drawings.'),
  classroom('Spanish II', 'Unit 5 slides', null, 'Slides from class, for review.', { type: 'Material' }),
  classroom('Digital Art', 'Pixel portrait project', 5, 'Draw a self-portrait on a 32x32 pixel grid. Limit yourself to 8 colors. Export as PNG at 10x size.'),
  classroom('Digital Art', 'Color theory reflection', -1, 'One paragraph: which color scheme did you use in your last project, and why?'),
  // Edpuzzle videos.
  edpuzzle('Biology', 'How cells divide: mitosis', 1),
  edpuzzle('World History', 'The assassination that started World War I', 3),
]);

write('messages.json', [
  { platform: 'Classroom', type: 'announcement', id: 'post-demo-m4', class: 'Spanish II', author: 'Demo Teacher', date: shortDate(0), sortTime: now - 0.3 * day, title: '¡Hola! Quiz moved', text: '¡Hola! The vocabulary quiz is moving to Monday. The review slides are attached, and the practice set is linked below.', link: 'https://classroom.demo.test/c/spanish', attachments: [
    { kind: 'slides', title: 'Unidad 5: la comida (review)', link: 'https://docs.demo.test/presentation/demo-slides' },
    { kind: 'link', title: 'Practice set: la comida', link: 'https://practice.demo.test/la-comida' },
  ] },
  { platform: 'Classroom', type: 'announcement', id: 'post-demo-m5', class: 'Digital Art', author: 'Demo Teacher', date: shortDate(-2), sortTime: now - 1.5 * day, title: 'Gallery walk next week', text: 'Gallery walk next Wednesday! Finish your pixel portraits by Tuesday so I can print them. The rubric is attached.', link: 'https://classroom.demo.test/c/art', attachments: [
    { kind: 'pdf', title: 'Pixel portrait rubric.pdf', link: 'https://drive.demo.test/file/d/demo-rubric/view' },
  ] },
  { platform: 'Classroom', type: 'announcement', id: 'post-demo-m1', class: 'Biology', author: 'Demo Teacher', date: shortDate(-1), sortTime: now - day, title: 'Lab moved to Thursday', text: 'Heads up: the osmosis lab is moving to Thursday because of the assembly. Bring your lab notebook. The report due date moves back a day too.', link: 'https://classroom.demo.test/c/biology', attachments: [] },
  { platform: 'Classroom', type: 'announcement', id: 'post-demo-m2', class: 'Algebra II', author: 'Demo Teacher', date: shortDate(-2), sortTime: now - 2 * day, title: 'Test review session', text: 'Review session for the Unit 4 test after school on Monday in room 214. Bring questions from 4.4 and 4.5, those were the toughest on the quiz.', link: 'https://classroom.demo.test/c/algebra', attachments: [] },
  { platform: 'Classroom', type: 'announcement', id: 'post-demo-m3', class: 'English 10', author: 'Demo Teacher', date: shortDate(-3), sortTime: now - 3 * day, title: 'Reading schedule', text: 'Finish chapter 4 by Friday. We will discuss the ending of chapter 3 in class, so no spoilers in the journals please.', link: 'https://classroom.demo.test/c/english', attachments: [] },
]);

// Due dates spread over the past month (4, 12, 20, 28 days ago, in turn).
let k = 0;
const gradedDaysAgo = () => 4 + (k++ % 4) * 8;
const graded = (title, score, possible, extra = {}) => { const d = gradedDaysAgo(); return { id: `g${n++}`, title, due: at(-d), assigned: at(-d - 7), possible, score, scoreText: null, percent: Math.round(score / possible * 1000) / 10, comment: null, missing: false, late: false, excused: false, link: `${SITE}/grades`, group: 1, omitted: false, ...extra }; };
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

// Grade history, so the Grades center draws its graphs: each class's grade
// as it changed over the past couple of months, ending at the grade above.
// Only changes are kept (see 45-grade-history.js), so the points are uneven.
const letter = p => p >= 93 ? 'A' : p >= 90 ? 'A-' : p >= 87 ? 'B+' : p >= 83 ? 'B' : p >= 80 ? 'B-' : p >= 77 ? 'C+' : p >= 73 ? 'C' : p >= 70 ? 'C-' : 'D';
const history = (cls, points, last) => ({ class: cls, source: 'canvas', points: [
  ...points.map(([daysAgo, percent]) => ({ at: at(-daysAgo, 16, 0), percent, grade: letter(percent) })),
  { at: new Date(now - 3600000).toISOString(), percent: last[1], grade: last[0] }] });
write('grade-history.json', { series: {
  'canvas:Biology': history('Biology', [[58, 92], [51, 90.5], [44, 91.2], [37, 87.6], [30, 86.1], [23, 88.9], [12, 87.2]], ['B+', 88.4]),
  'canvas:Algebra II': history('Algebra II', [[58, 76], [49, 78.4], [41, 74.9], [33, 77.5], [26, 79.8], [17, 82.6], [8, 80.3]], ['B-', 81.2]),
  'canvas:World History': history('World History', [[56, 95], [47, 93.8], [38, 89.5], [29, 90.7], [19, 92.4], [10, 90.2]], ['A-', 91.0]),
  'canvas:English 10': history('English 10', [[57, 90], [45, 92.3], [34, 93.1], [22, 95.8], [11, 94.1]], ['A', 94.6]),
  'canvas:Chemistry': history('Chemistry', [[59, 85], [50, 82.7], [43, 80.1], [35, 76.4], [27, 74.8], [18, 77.9], [9, 76.5]], ['C+', 78.3]),
} });

// A few things marked new since the last check, like a real collection would.
write('new.json', { assignments: [], announcements: ['post-demo-m4'] });

// Reminders typed in by hand, through the app's own code so they're stored
// exactly like real ones.
const reminders = require(path.join(dir, '24-virtual-assignments.js'));
reminders.create({ title: 'Bring the signed field trip form', class: 'Biology', due: at(2, 8, 0) });
reminders.create({ title: 'Ask about the extra credit lab', class: 'Chemistry' });

// An Edpuzzle transcript page (the dashboard's Transcripts card isn't wired
// up yet, so this is the page on its own): transcripts/mitosis.html.
const vtt = ['WEBVTT', '',
  ['00:00:00.000', '00:00:06.000', 'Every second, millions of cells in your body are dividing.'],
  ['00:00:06.000', '00:00:13.500', "Today we're looking at mitosis: how one cell becomes two identical cells."],
  ['00:00:13.500', '00:00:21.000', 'It starts with prophase. The DNA, which is normally loose, coils up into chromosomes you can see under a microscope.'],
  ['00:00:21.000', '00:00:30.000', 'In metaphase, the chromosomes line up in the middle of the cell, along what we call the metaphase plate.'],
  ['00:00:30.000', '00:00:38.500', 'Anaphase is when the copies are pulled apart, toward opposite ends of the cell.'],
  ['00:00:38.500', '00:00:47.000', 'Finally, telophase: two new nuclei form, and the cell pinches in two. That last split is called cytokinesis.'],
  ['00:00:47.000', '00:00:53.000', 'An easy way to remember the order: PMAT. Prophase, metaphase, anaphase, telophase.'],
].map(x => Array.isArray(x) ? `${x[0]} --> ${x[1]}\n${x[2]}\n` : x).join('\n');
fs.mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
require(path.join(dir, 'services', 'edpuzzle', '14-transcript-page.js')).writeTranscript({
  title: 'How cells divide: mitosis', className: 'Biology', platform: 'Edpuzzle',
  link: 'https://edpuzzle.demo.test/assignments/demo/watch', source: 'machine', duration: '0:53',
  text: vtt.split('\n').filter(l => l && !l.includes('-->') && l !== 'WEBVTT').join(' '),
  timed: vtt, questions: [22, 48],
}, path.join(dir, 'transcripts', 'mitosis.html'));

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
  console.log(`Demo project in ${dir}\nA transcript page: ${path.join(dir, 'transcripts', 'mitosis.html')}\nIts MCP server: ${[l.command, ...l.args].map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
})();
