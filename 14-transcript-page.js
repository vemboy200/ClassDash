/**
 * A dedicated page for a single transcript.
 *
 * Why its own page instead of an expandable block on the main one: the
 * user's idea. A seven-minute video's transcript is six kilobytes of
 * text, and five of those on the main page would turn it into a wall of
 * text. On its own page there's room for both the plain text and the
 * timestamped breakdown.
 *
 * Note: unlike the rest of the app, this page's on-screen text is not run
 * through 18-language.js's translation system — it's hardcoded Russian,
 * same as it's always been, since this feature isn't wired into the
 * collector yet (see the README). Only the code around it — identifiers
 * and comments — is translated here.
 */

const fs = require('fs');
const path = require('path');

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** "155.7 seconds" -> "2:35" */
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Parses the timestamped markup into {time, text} pairs. */
function parseTimed(vtt) {
  if (!vtt) return [];
  const chunks = [];
  for (const block of vtt.split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find(s => s.includes('-->'));
    if (!timeLine) continue;
    const text = lines.filter(s => s !== timeLine && !/^WEBVTT/.test(s)).join(' ').trim();
    if (!text) continue;
    // "00:01:23.456 --> 00:01:27.890"
    const m = timeLine.match(/(\d{2}):(\d{2}):(\d{2})/);
    const seconds = m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0;
    chunks.push({ label: formatTime(seconds), seconds, text });
  }
  return chunks;
}

function writeTranscript(data, outputPath) {
  const { title, className, platform, link, text, timed, source, duration } = data;
  const chunks = parseTimed(timed);

  // Question markers: which seconds of the video Edpuzzle will pause at
  // and ask something. The user's request.
  //
  // ONLY the timestamp is taken — no question text, and definitely no
  // answer choices, even though they sit right there in the same API
  // response. The reason isn't technical: knowing the questions ahead of
  // time turns watching the video into a hunt for answers instead of the
  // content. A "you'll be asked here" marker, on the other hand, is
  // genuinely useful — it tells you where not to zone out. The player
  // already shows these same marks on its scrub bar anyway.
  const questions = (data.questions || []).map(Number).filter(t => !isNaN(t)).sort((a, b) => a - b);

  // Interleave the markers with the timed phrases.
  const withMarkers = [];
  let next = 0;
  for (const c of chunks) {
    while (next < questions.length && questions[next] <= c.seconds) {
      withMarkers.push({ question: true, label: formatTime(questions[next]) });
      next++;
    }
    withMarkers.push(c);
  }
  for (; next < questions.length; next++) {
    withMarkers.push({ question: true, label: formatTime(questions[next]) });
  }

  const warning = source === 'machine'
    ? `<div class="warn">Распознано машиной. Обычные слова записаны верно, но
       <b>имена и термины могут быть искажены</b> — если слово выглядит странно,
       перемотай видео по отметке времени и послушай сам. Изредка в паузах
       распознавалка выдумывает фразы вроде «Thanks for watching».</div>`
    : `<div class="ok">Субтитры автора видео — им можно верить.</div>`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — транскрипт</title>
<style>
  :root {
    --bg:#f6f7f9; --card:#fff; --text:#1a1c1e; --dim:#6b7280; --line:#e5e7eb;
    --new:#1570ef; --warn:#b54708; --warnbg:#fffaeb; --okbg:#ecfdf3; --ok:#027a48;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#16181c; --card:#1f2226; --text:#e8eaed; --dim:#9aa0a6; --line:#2f3338;
      --new:#6aa9ff; --warn:#f5a524; --warnbg:#2a2314; --okbg:#12271b; --ok:#6ee7a8;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px 60px; background:var(--bg); color:var(--text);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { max-width:760px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .meta { color:var(--dim); font-size:13px; margin-bottom:16px;
          display:flex; gap:10px; flex-wrap:wrap; }
  .warn { background:var(--warnbg); color:var(--warn); border-radius:10px;
          padding:12px 14px; margin-bottom:20px; font-size:14px; }
  .ok { background:var(--okbg); color:var(--ok); border-radius:10px;
        padding:10px 14px; margin-bottom:20px; font-size:14px; }
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tabs button {
    background:var(--card); border:1px solid var(--line); border-radius:8px;
    padding:7px 14px; cursor:pointer; color:var(--text); font:inherit; font-size:14px;
  }
  .tabs button.selected { border-color:var(--new); color:var(--new); }
  .text { background:var(--card); border:1px solid var(--line); border-radius:12px;
           padding:20px 22px; white-space:pre-wrap; }
  .row { display:flex; gap:14px; padding:3px 0; }
  .question {
    display:flex; gap:14px; padding:8px 0; margin:6px 0;
    color:var(--warn); border-top:1px dashed var(--line);
    border-bottom:1px dashed var(--line); font-size:14px;
  }
  .label { color:var(--new); font-variant-numeric:tabular-nums; flex:0 0 auto;
           font-size:14px; padding-top:2px; }
  a.back { color:var(--dim); text-decoration:none; font-size:14px; }
  a.back:hover { color:var(--new); }
  footer { margin-top:28px; font-size:12px; color:var(--dim); }
</style>
</head>
<body>
<main>
  <a class="back" href="../summary.html">← к сводке</a>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <span>${escapeHtml(platform || 'Edpuzzle')}</span>
    <span>${escapeHtml(className || '')}</span>
    ${duration ? `<span>${escapeHtml(duration)}</span>` : ''}
    ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">открыть задание</a>` : ''}
  </div>
  ${warning}

  <div class="tabs">
    <button class="selected" onclick="showTab('plain', this)">Читать</button>
    <button onclick="showTab('timed', this)">По времени</button>
  </div>

  <div class="text" id="plain">${escapeHtml(text)}</div>

  <div class="text" id="timed" hidden>
${withMarkers.map(c => c.question
    ? `    <div class="question"><span class="label">${escapeHtml(c.label)}</span><span>??? здесь Edpuzzle остановит видео и спросит</span></div>`
    : `    <div class="row"><span class="label">${escapeHtml(c.label)}</span><span>${escapeHtml(c.text)}</span></div>`).join('\n')}
  </div>

  <footer>Распознано на этом компьютере, без интернета и без затрат.</footer>
</main>
<script>
function showTab(which, button) {
  document.getElementById('plain').hidden = (which !== 'plain');
  document.getElementById('timed').hidden = (which !== 'timed');
  for (const b of document.querySelectorAll('.tabs button')) b.classList.remove('selected');
  button.classList.add('selected');
}
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return outputPath;
}

module.exports = { writeTranscript, parseTimed };
