/**
 * Сбор объявлений из ленты Google Classroom (вкладка Stream).
 *
 * ── Зачем отдельно от заданий ──
 *
 * В ленте учителя пишут то, чего нет в заданиях: «контрольная
 * переносится», «принесите тетради», «дедлайн продлён». У таких
 * сообщений нет срока, зато важна свежесть.
 *
 * ── Главная сложность: лента дублирует задания ──
 *
 * Classroom сам постит в ленту каждое новое задание и материал.
 * Если брать всё подряд, лента станет копией списка заданий: каждое
 * появится дважды, пользы ноль, шума вдвое. пользователь заметил это раньше,
 * чем был написан код.
 *
 * Признак нашёлся, и чёткий — по ПЕРВОЙ СТРОКЕ поста:
 *
 *   Post by Kristine Lowe | Created Jun 4 | ...текст...      ← настоящее
 *   book | Material: "LA County Youth@Work" | ... posted a
 *          new material: ...                                 ← автоматическое
 *
 * Проверяем именно начало первой строки, а не вхождение подстроки
 * куда попало: учитель вполне может написать объявление со словами
 * «posted a new assignment», и терять его нельзя.
 */

/**
 * @param page  страница браузера
 * @param cls   {id, name} класса
 * @param U     номер аккаунта в мультивходе
 */
async function собратьЛенту(page, cls, U = 0) {
  const url = `https://classroom.google.com/u/${U}/c/${cls.id}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('accounts.google.com')) {
    throw new Error('куки протухли, нужен повторный вход');
  }

  try {
    await page.waitForSelector('[data-stream-item-id]', { timeout: 45000 });
  } catch {
    return [];   // в ленте пусто — это нормально
  }

  // Ждём, пока лента перестанет расти: та же грабля, что со списком
  // заданий — Classroom дорисовывает посты постепенно.
  let было = -1, стабильно = 0;
  for (let i = 0; i < 30; i++) {
    const стало = await page.evaluate(
      () => document.querySelectorAll('[data-stream-item-id]').length);
    if (стало === было) { if (++стабильно >= 3) break; } else стабильно = 0;
    было = стало;
    await page.waitForTimeout(500);
  }

  return await page.evaluate(({ className, classId, authuser }) => {
    // Берём только внешние узлы: атрибут висит и на вложенных.
    const узлы = [...document.querySelectorAll('[data-stream-item-id]')]
      .filter(e => !e.parentElement.closest('[data-stream-item-id]'));

    // Служебные подписи интерфейса. «Add a comment» — кнопка под каждым
    // постом, она попадала в текст объявления дважды подряд.
    const мусор = ['more_vert', 'More options', 'book', 'assignment',
                   'assignment_ind', 'help_outline', 'campaign',
                   'Add a comment', 'Add class comment', 'Add comment',
                   'send', 'Post', 'Cancel', 'Save', 'Delete'];

    return узлы.map(el => {
      const строки = (el.innerText || '')
        .split('\n').map(s => s.trim()).filter(Boolean)
        .filter(s => !мусор.includes(s));

      if (!строки.length) return null;

      // ВОТ ЗДЕСЬ ОТСЕИВАЕТСЯ ДУБЛИРОВАНИЕ ЗАДАНИЙ.
      // Настоящее объявление начинается с «Post by <имя>».
      if (!/^Post by\s+/i.test(строки[0])) return null;

      const автор = строки[0].replace(/^Post by\s+/i, '').trim();

      // Дальше идут имя автора ещё раз и дата в двух видах
      // («Created Jun 4» и «Jun 4»). Их выкидываем, остальное — текст.
      const дата = строки.find(s => /^Created\s/i.test(s)) || null;
      const тело = строки.slice(1).filter(s =>
        s !== автор &&
        !/^Created\s/i.test(s) &&
        !/^[A-Z][a-z]{2}\s+\d{1,2}(\s|$)/.test(s) &&
        !/^\(Edited/i.test(s)
      );

      const id = el.getAttribute('data-stream-item-id');

      return {
        платформа: 'Classroom',
        вид: 'объявление',
        class: className,
        id: `пост-${id}`,
        автор,
        дата: дата ? дата.replace(/^Created\s+/i, '') : null,
        // Первая строка тела обычно заголовок объявления.
        title: тело[0] || 'Объявление',
        текст: тело.join('\n'),
        // Ссылка на ГЛАВНУЮ страницу класса — там и есть лента.
        //
        // Сначала вела на конкретный пост (/sp/<id>/all/default), но
        // пользователь проверил: такой адрес кидает в Classwork и грузится
        // бесконечно. Главная открывается сразу и показывает ленту
        // целиком — нужный пост наверху, если он свежий.
        link: `https://classroom.google.com/c/${classId}` +
              `?authuser=${encodeURIComponent(authuser)}`,
      };
    }).filter(Boolean);
  }, { className: cls.name, classId: cls.id, authuser: АВТОР_ПОЧТА });
}

// Подставляется из основного скрипта при первом вызове.
let АВТОР_ПОЧТА = '';
function задатьПочту(п) { АВТОР_ПОЧТА = п; }

module.exports = { собратьЛенту, задатьПочту };
