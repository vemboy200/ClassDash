/**
 * Сбор заданий из Edpuzzle.
 *
 * ── Чем он отличается от двух других ──
 *
 * Edpuzzle не даёт работать невидимому браузеру. На headless-режим он
 * отвечает «Error 18» ещё до всякого входа — и с куками тоже. Причина
 * понятна: его защиту регулярно ломали ради обхода заданий, и он
 * недоверчив к автоматике.
 *
 * Мы это НЕ обходим. Мы просто открываем настоящее окно настоящего
 * браузера под аккаунтом пользователя и читаем его собственный список заданий.
 * Ответы на вопросы внутри видео не трогаем — договорённость с первого
 * дня, и она не пересматривается. Если Edpuzzle начнёт блокировать
 * сильнее, мы отступим, а не полезем воевать.
 *
 * Чтобы окно не мешало, оно открывается за пределами экрана
 * (--window-position=-3000,-3000 в 05-...js). Проверено: Edpuzzle такое
 * окно принимает, Classroom от этого не страдает.
 *
 * ── Адреса, подсмотренные у самого сайта ──
 *
 *   /api/v3/users/me                    — кто я, нужен мой id
 *   /api/v3/classrooms/active           — мои классы
 *   /api/v3/learning/assignment_learners/users/<uid>/classrooms/<cid>
 *       ?status[]=not-started&status[]=in-progress&isUpcoming=<bool>&cursor=0
 *
 * Значение status[]=completed сайт отвергает — не из списка допустимых.
 * Нам оно и не нужно: выполненное показывать незачем.
 *
 * ── Осторожно: строение задания пока не проверено ──
 *
 * На момент написания заданий не было ни в одном классе, ответ приходил
 * пустым списком. Поэтому поля берутся по нескольким возможным именам,
 * а строение ПЕРВОГО же настоящего задания печатается в лог — чтобы
 * поправить точно, а не гадать дальше.
 */

const САЙТ = 'https://edpuzzle.com';

/** Первое непустое значение из нескольких возможных названий поля. */
function поле(объект, ...имена) {
  for (const имя of имена) {
    const части = имя.split('.');
    let v = объект;
    for (const ч of части) v = (v && typeof v === 'object') ? v[ч] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

async function собратьEdpuzzle(page) {
  await page.goto(САЙТ + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Даём странице ожить: без этого запросы уходят до того, как
  // приложение поставит нужные заголовки.
  await page.waitForTimeout(5000);

  const сырое = await page.evaluate(async () => {
    const j = async (u) => {
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Edpuzzle ответил ${r.status} на ${u}`);
      return await r.json();
    };

    const я = await j('/api/v3/users/me');
    const uid = я._id;

    const ответ = await j('/api/v3/classrooms/active');
    const классы = ответ.classrooms || ответ || [];

    const собранное = [];
    for (const к of классы) {
      // Два прохода: ближайшие по сроку и все остальные.
      for (const скоро of [true, false]) {
        const список = await j(
          `/api/v3/learning/assignment_learners/users/${uid}/classrooms/${к._id}` +
          `?status[]=not-started&status[]=in-progress&isUpcoming=${скоро}&cursor=0`);
        const пункты = Array.isArray(список) ? список : (список.items || список.assignments || []);
        for (const п of пункты) собранное.push({ класс: к.name, пункт: п });
      }
    }
    return { собранное, классы: классы.map(к => к.name) };
  });

  const items = [];
  let строениеПоказано = false;

  for (const { класс, пункт } of сырое.собранное) {
    // Первое настоящее задание печатаем целиком: строение не проверено,
    // и это единственный способ узнать настоящие имена полей.
    if (!строениеПоказано) {
      console.log('  Edpuzzle: строение первого задания (проверить и поправить):');
      console.log('   ', JSON.stringify(пункт).slice(0, 900));
      строениеПоказано = true;
    }

    const задание = поле(пункт, 'assignment', 'media') || пункт;
    const id = поле(пункт, '_id', 'id', 'assignment._id');
    const срок = поле(пункт, 'dueDate', 'assignment.dueDate', 'deadline', 'endDate');
    const название = поле(задание, 'title', 'name', 'media.title') || 'Задание Edpuzzle';

    // ДАТА МОЖЕТ ПРИЙТИ НЕ ТА, И ЭТО НЕ ПОВОД РОНЯТЬ ВЕСЬ ИСТОЧНИК.
    //
    // Строение задания не проверено (заданий не было), поэтому «срок»
    // берётся по нескольким именам наугад. Раньше здесь стояло
    // new Date(срок).toISOString(), а оно на непонятной строке бросает
    // RangeError: Invalid time value — и это уносило ВЕСЬ Edpuzzle
    // целиком, а не одно задание с кривой датой.
    const дата = срок ? new Date(срок) : null;
    const годная = дата && !isNaN(дата.getTime());
    if (срок && !годная) {
      console.warn(`  Edpuzzle: не понял срок «${срок}» у «${название}» — считаю, что срока нет`);
    }

    // Без id задание не пропадает, но и не получает выдуманный ключ.
    // Раньше было `edpuzzle-${id}`, и при id === null ВСЕ задания получали
    // одинаковый ключ «edpuzzle-null» — они склеились бы в одно
    // при сравнении с памятью. Пустой id diffWithPrevious умеет:
    // там есть запасной ключ «класс::название».
    if (!id) console.warn(`  Edpuzzle: у задания «${название}» нет id — сверяю по названию`);

    items.push({
      платформа: 'Edpuzzle',
      class: класс,
      id: id ? `edpuzzle-${id}` : null,
      type: 'Assignment',
      title: название,
      link: id ? `${САЙТ}/assignments/${id}/watch` : САЙТ,
      due_iso: годная ? дата.toISOString() : null,
      due: null,
      posted: поле(пункт, 'createdAt', 'assignment.createdAt'),
    });
  }

  // СКЛАДЫВАЕМ ПОВТОРЫ.
  //
  // Список тянется двумя проходами: isUpcoming=true и isUpcoming=false.
  // Если задание попадёт в оба, оно ляжет в память ДВАЖДЫ: это дало бы
  // «новых 2» про одно задание и две одинаковые карточки на странице.
  // Ни current, ни итог нигде от повторов не чистятся, поэтому чистим
  // здесь, у источника.
  const поКлючу = new Map();
  for (const з of items) поКлючу.set(з.id || `${з.class}::${з.title}`, з);
  const безПовторов = [...поКлючу.values()];

  return { items: безПовторов, классы: сырое.классы };
}

module.exports = { собратьEdpuzzle, САЙТ };
