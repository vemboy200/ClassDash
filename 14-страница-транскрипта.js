/**
 * Отдельная страница под один транскрипт.
 *
 * Почему отдельная, а не раскрывающийся блок на главной: идея пользователя.
 * Транскрипт семиминутного видео — это шесть килобайт текста, и пять
 * таких на главной превратят её в простыню. А на своей странице можно
 * спокойно положить и сплошной текст, и разметку по времени.
 */

const fs = require('fs');
const path = require('path');

const экранировать = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** «155.7 секунд» -> «2:35» */
function форматВремени(сек) {
  const м = Math.floor(сек / 60);
  const с = Math.floor(сек % 60);
  return `${м}:${String(с).padStart(2, '0')}`;
}

/** Разбор разметки по времени в пары «время — фраза». */
function разобратьПоВремени(vtt) {
  if (!vtt) return [];
  const куски = [];
  for (const блок of vtt.split(/\n\n+/)) {
    const строки = блок.split('\n').filter(Boolean);
    const время = строки.find(s => s.includes('-->'));
    if (!время) continue;
    const текст = строки.filter(s => s !== время && !/^WEBVTT/.test(s)).join(' ').trim();
    if (!текст) continue;
    // «00:01:23.456 --> 00:01:27.890»
    const м = время.match(/(\d{2}):(\d{2}):(\d{2})/);
    const секунды = м ? (+м[1] * 3600 + +м[2] * 60 + +м[3]) : 0;
    куски.push({ метка: форматВремени(секунды), секунды, текст });
  }
  return куски;
}

function записатьТранскрипт(данные, путь) {
  const { название, класс, платформа, ссылка, текст, поВремени, происхождение, длительность } = данные;
  const куски = разобратьПоВремени(поВремени);

  // Отметки вопросов: в какие секунды видео Edpuzzle остановится
  // и что-то спросит. Просьба пользователя.
  //
  // Берём ТОЛЬКО время, без текста вопроса и тем более без вариантов
  // ответа — хотя лежат они в том же ответе API, рядом. Причина не
  // техническая: зная вопросы заранее, смотришь видео ради ответов,
  // а не ради содержания. А отметка «здесь спросят» наоборот полезна —
  // подсказывает, где не зевать. В плеере эти метки и так видны
  // на полосе перемотки.
  const вопросы = (данные.вопросы || []).map(Number).filter(t => !isNaN(t)).sort((a, b) => a - b);

  // Вставляем отметки между фразами по времени
  const сОтметками = [];
  let след = 0;
  for (const к of куски) {
    while (след < вопросы.length && вопросы[след] <= к.секунды) {
      сОтметками.push({ вопрос: true, метка: форматВремени(вопросы[след]) });
      след++;
    }
    сОтметками.push(к);
  }
  for (; след < вопросы.length; след++) {
    сОтметками.push({ вопрос: true, метка: форматВремени(вопросы[след]) });
  }

  const предупреждение = происхождение === 'машина'
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
<title>${экранировать(название)} — транскрипт</title>
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
  .мета { color:var(--dim); font-size:13px; margin-bottom:16px;
          display:flex; gap:10px; flex-wrap:wrap; }
  .warn { background:var(--warnbg); color:var(--warn); border-radius:10px;
          padding:12px 14px; margin-bottom:20px; font-size:14px; }
  .ok { background:var(--okbg); color:var(--ok); border-radius:10px;
        padding:10px 14px; margin-bottom:20px; font-size:14px; }
  .вкладки { display:flex; gap:8px; margin-bottom:16px; }
  .вкладки button {
    background:var(--card); border:1px solid var(--line); border-radius:8px;
    padding:7px 14px; cursor:pointer; color:var(--text); font:inherit; font-size:14px;
  }
  .вкладки button.выбрана { border-color:var(--new); color:var(--new); }
  .текст { background:var(--card); border:1px solid var(--line); border-radius:12px;
           padding:20px 22px; white-space:pre-wrap; }
  .строка { display:flex; gap:14px; padding:3px 0; }
  .вопрос {
    display:flex; gap:14px; padding:8px 0; margin:6px 0;
    color:var(--warn); border-top:1px dashed var(--line);
    border-bottom:1px dashed var(--line); font-size:14px;
  }
  .метка { color:var(--new); font-variant-numeric:tabular-nums; flex:0 0 auto;
           font-size:14px; padding-top:2px; }
  a.назад { color:var(--dim); text-decoration:none; font-size:14px; }
  a.назад:hover { color:var(--new); }
  footer { margin-top:28px; font-size:12px; color:var(--dim); }
</style>
</head>
<body>
<main>
  <a class="назад" href="../сводка.html">← к сводке</a>
  <h1>${экранировать(название)}</h1>
  <div class="мета">
    <span>${экранировать(платформа || 'Edpuzzle')}</span>
    <span>${экранировать(класс || '')}</span>
    ${длительность ? `<span>${экранировать(длительность)}</span>` : ''}
    ${ссылка ? `<a href="${экранировать(ссылка)}" target="_blank" rel="noopener">открыть задание</a>` : ''}
  </div>
  ${предупреждение}

  <div class="вкладки">
    <button class="выбрана" onclick="показать('сплошной', this)">Читать</button>
    <button onclick="показать('время', this)">По времени</button>
  </div>

  <div class="текст" id="сплошной">${экранировать(текст)}</div>

  <div class="текст" id="время" hidden>
${сОтметками.map(к => к.вопрос
    ? `    <div class="вопрос"><span class="метка">${экранировать(к.метка)}</span><span>??? здесь Edpuzzle остановит видео и спросит</span></div>`
    : `    <div class="строка"><span class="метка">${экранировать(к.метка)}</span><span>${экранировать(к.текст)}</span></div>`).join('\n')}
  </div>

  <footer>Распознано на этом компьютере, без интернета и без затрат.</footer>
</main>
<script>
function показать(что, кнопка) {
  document.getElementById('сплошной').hidden = (что !== 'сплошной');
  document.getElementById('время').hidden = (что !== 'время');
  for (const b of document.querySelectorAll('.вкладки button')) b.classList.remove('выбрана');
  кнопка.classList.add('выбрана');
}
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(путь), { recursive: true });
  fs.writeFileSync(путь, html);
  return путь;
}

module.exports = { записатьТранскрипт, разобратьПоВремени };
