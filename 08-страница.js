/**
 * Сборка страницы-сводки.
 *
 * Страница пишется ЦЕЛИКОМ И В КОНЦЕ прохода, а не дописывается по
 * одному заданию. Если дописывать по ходу, то при падении на середине
 * останется полстраницы, выглядящая как настоящая сводка. А так файл
 * либо старый и правильный, либо новый и правильный, но никогда
 * не полуфабрикат.
 *
 * Здесь нет модели. Это обычная программа, которая печатает HTML.
 * Открывается кликом по всплывашке.
 */

const fs = require('fs');
const { т, локаль } = require('./18-язык.js');
const { прочитать: прочитатьНастройки } = require('./19-настройки.js');
const path = require('path');

// Подставляется, когда платформа у задания не указана — так приходят
// задания Classroom. У Canvas и Edpuzzle поле своё.
const ПЛАТФОРМА_ПО_УМОЛЧАНИЮ = 'Google Classroom';

const экранировать = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Разница в КАЛЕНДАРНЫХ днях, а не в сутках по часам.
 *
 * Раньше везде стояло `Math.round((due - now) / 864e5)` — деление на сутки
 * с округлением. Вопрос при этом задавался неправильный: «сколько часов
 * осталось» вместо «какой это день».
 *
 * Что из этого выходило (поймано 24 августа в 21:25): задание, которое надо
 * сдать ЗАВТРА в 8 утра, подписывалось «сегодня» — до него десять часов,
 * а это меньше половины суток, и округление давало ноль. Ровно так же
 * послезавтрашнее в 8:30 называлось «завтра». Вечером, когда как раз
 * и садишься за домашку, ошибалась каждая утренняя карточка.
 *
 * Лечится тем, что обе даты сдвигаются на полночь: тогда считается разница
 * между ДНЯМИ, а не между моментами. Округление оставлено ради перехода
 * на летнее время — там в сутках бывает 23 или 25 часов.
 */
function днейДо(от, до) {
  const д0 = new Date(от.getFullYear(), от.getMonth(), от.getDate());
  const д1 = new Date(до.getFullYear(), до.getMonth(), до.getDate());
  return Math.round((д1 - д0) / 864e5);
}

/** «через 3 дн.», «сегодня», «завтра», «просрочено на 2 дн.» */
function когда(due, now) {
  const дней = днейДо(now, due);
  if (дней < 0) return т('просроченоНа', -дней);
  if (дней === 0) return т('сегодня');
  if (дней === 1) return т('завтра');
  return т('черезДней', дней);
}

function карточка(x, now, пометка, раздел) {
  // Та же ловушка, что и в 05-...js: у Classroom дата приходит текстом,
  // у Canvas и Edpuzzle текстового поля нет вовсе — только машинное.
  // Обращение к x.due без проверки роняло скрипт целиком.
  const датаТекстом = x.due
    ? x.due.replace(/^Due\s+/, '')
    : (x.due_at
        ? x.due_at.toLocaleString(локаль(),
            { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '');

  const срок = x.note
    ? т(x.note)
    : (x.due_at ? `${датаТекстом} · ${когда(x.due_at, now)}` : '');

  // target="_blank" — открывать в новой вкладке, а не поверх сводки:
  // иначе, вернувшись назад, теряешь место в списке.
  // rel="noopener" — техническая мелочь, чтобы открытая страница
  // не получила доступ к этой.
  const ссылка = x.link
    ? ` href="${экранировать(x.link)}" target="_blank" rel="noopener"`
    : '';
  const тег = x.link ? 'a' : 'div';

  // Кнопка «не срочно» — только у заданий, которым учитель не проставил
  // срок и которые из-за этого считаются горящими. Клик уходит в
  // Напоминалку по ссылке napominalka://, она записывает id на диск.
  // Сама страница записать ничего не может: браузер не даёт.
  // Сравниваем с КЛЮЧОМ, а не с фразой: см. комментарий в 18-язык.js.
  //
  // У снятого задания кнопка обратная — «вернуть». Раньше её не было вовсе,
  // и снятое правилось только руками в `не-срочно.txt`: у скрытых
  // просроченных возврат был, у снятых нет. Несимметрично и неудобно.
  const кнопка = x.тихое
    ? `\n        <a class="quiet" href="napominalka://unquiet/${экранировать(x.id)}"
           onclick="вернутьСрочность(this)">${экранировать(т('вернуть'))}</a>`
    : (x.note === 'безСрока')
      ? `\n        <a class="quiet" href="napominalka://quiet/${экранировать(x.id)}"
           onclick="успокоить(event, this)">${экранировать(т('неСрочно'))}</a>`
      : '';

  // Невидимые подписи для фильтров. Имена латиницей намеренно: обращаться
  // к ним будет код внутри страницы, и с русскими именами он работает
  // не везде одинаково.
  //
  // data-days — сколько дней до срока: отрицательное значит просрочено,
  // «нет» значит срока нет вовсе. Считаем здесь, а не в браузере, потому
  // что здесь известно «сейчас» на момент сборки страницы.
  const дней = x.due_at ? днейДо(now, x.due_at) : 'нет';
  const подписи = ` data-cls="${экранировать(x.class)}"` +
                  ` data-type="${экранировать(x.type || '')}"` +
                  ` data-days="${дней}"` +
                  ` data-удалено="${x.удалено ? 'да' : 'нет'}"` +
                  ` data-sect="${экранировать(раздел || '')}"`;

  return `      <div class="row${x.удалено ? ' пропавшая' : ''}"${подписи}>
      <${тег}${ссылка} class="item${пометка ? ' new' : ''}">
        <div class="title">${экранировать(x.title)}</div>
        <div class="meta">
          <span class="plat">${экранировать(x.платформа || ПЛАТФОРМА_ПО_УМОЛЧАНИЮ)}</span>
          <span class="cls">${экранировать(x.class)}</span>
          ${срок ? `<span class="due">${экранировать(срок)}</span>` : ''}
          ${пометка ? `<span class="badge">${экранировать(т('новое'))}</span>` : ''}
          ${x.удалено ? `<span class="значок-удалено">${экранировать(т('значокУдалено'))}</span>` : ''}
        </div>
      </${тег}>${кнопка}
      </div>`;
}

/**
 * Правая колонка: объявления из лент Classroom.
 *
 * Показываются ВСЕ, а не только новые — в отличие от материалов.
 * Причина: объявление живёт неделями («экскурсия 20-го, принести
 * разрешение»), и убирать его с глаз после первого показа неправильно.
 * Новые просто помечаются.
 */
function секцияОбъявлений(объявления, новыеИд) {
  if (!объявления.length) {
    return `    <section>
      <h2>${экранировать(т('объявления'))}</h2>
      <p class="hint">${экранировать(т('объявленийНет'))}</p>
    </section>`;
  }

  // Карточка не ссылка целиком, а блок с кнопками. Иначе нажатие
  // на «раскрыть» уводило бы в Classroom вместо разворачивания текста.
  const карточки = объявления.map(п => {
    const новое = новыеИд.has(п.id);
    return `      <div class="пост" data-cls="${экранировать(п.class)}" data-new="${новое ? 'да' : 'нет'}">
        <div class="шапка">
          <span class="cls">${экранировать(п.class)}</span>
          <span>${экранировать(п.автор || '')}</span>
          ${п.дата ? `<span>${экранировать(п.дата)}</span>` : ''}
          ${новое ? `<span class="badge">${экранировать(т('новое'))}</span>` : ''}
        </div>
        <div class="текст свёрнут">${экранировать(п.текст || п.title || '')}</div>
        <div class="действия">
          <button class="раскрыть" onclick="развернуть(this)" hidden>${экранировать(т('раскрыть'))}</button>
          <a href="${экранировать(п.link)}" target="_blank" rel="noopener">${экранировать(т('открытьВClassroom'))}</a>
        </div>
      </div>`;
  }).join('\n');

  // Своя прокрутка: без неё девятнадцать объявлений растягивают
  // страницу так, что задания слева теряются где-то вверху.
  // Галочки по классам плюс «только новые». Отдельно от главной панели:
  // у объявлений нет ни срока, ни типа, и общие фильтры к ним неприменимы.
  const счёт = new Map();
  for (const п of объявления) счёт.set(п.class, (счёт.get(п.class) || 0) + 1);
  const поКлассам = [...счёт.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  const новых = объявления.filter(п => новыеИд.has(п.id)).length;

  const птичка = (группа, значение, подпись, сколько, ид) =>
    `        <label class="птичка"><input type="checkbox"` +
    (ид ? ` id="${ид}"` : ` data-group="${группа}" value="${экранировать(значение)}"`) +
    ` onchange="фильтрОбъявлений()">` +
    `<span class="что">${экранировать(подпись)}</span>` +
    `<span class="сколько">${сколько}</span></label>`;

  const галочки = поКлассам.map(([к, н]) => птичка('пост-cls', к, к, н));
  if (новых) галочки.push(птичка(null, null, т('фТолькоНовые'), новых, 'ф-пост-новые'));

  const полоска = поКлассам.length > 1 || новых
    ? `      <div class="фильтры-объявлений">\n${галочки.join('\n')}\n      </div>`
    : '';

  return `    <section>
      <h2>${экранировать(т('объявления'))} <span class="count объявления-счёт">${объявления.length}</span></h2>
      <p class="hint">${экранировать(т('подписьОбъявления'))}</p>
${полоска}
      <div class="лента">
${карточки}
      </div>
    </section>`;
}

/**
 * Просроченное. Отдельная секция, потому что вести себя должна иначе.
 *
 * Раньше просроченные задания молча выпадали — только цифра в статистике.
 * Для Classroom терпимо (там в прошлом лежит сданное), но Canvas и
 * Edpuzzle отдают только НЕСДАННОЕ: просрочено там значит «не сдал
 * и опоздал». пользователь попросил показывать, но ПОД «Горит», а не над —
 * горящее важнее уже проваленного.
 *
 * У каждого есть кнопка «скрыть»: смотреть вечно на то, что уже
 * не исправить, незачем. Кнопка нарочно неприметная и с переспросом,
 * чтобы не нажать случайно. Скрытые не удаляются — их можно показать
 * обратно кнопкой внизу секции.
 */
function секцияПросрочено(пункты, now) {
  if (!пункты.length) return '';

  const видимые = пункты.filter(x => !x.скрыто);
  const скрытые = пункты.filter(x => x.скрыто);

  const карточка = (x) => {
    const дней = Math.round((now - x.due_at) / 864e5);
    const когдаБыло = x.due
      ? x.due.replace(/^Due\s+/, '')
      : x.due_at.toLocaleString(локаль(), { day: 'numeric', month: 'short' });

    // data-id нужен странице, чтобы после нажатия «скрыть» самой
    // переложить карточку в скрытые, не дожидаясь следующего сбора.
    const подписи = ` data-cls="${экранировать(x.class)}"` +
                    ` data-type="${экранировать(x.type || '')}"` +
                    ` data-days="${-дней}"` +
                    ` data-sect="просрочено"`;

    return `      <div class="row${x.скрыто ? ' скрытая' : ''}" data-id="${экранировать(x.id)}"${подписи}>
      <a href="${экранировать(x.link || '#')}" target="_blank" rel="noopener" class="item просрочен">
        <div class="title">${экранировать(x.title)}</div>
        <div class="meta">
          <span class="plat">${экранировать(x.платформа || ПЛАТФОРМА_ПО_УМОЛЧАНИЮ)}</span>
          <span class="cls">${экранировать(x.class)}</span>
          <span class="было">${экранировать(когдаБыло)} · ${экранировать(т('опоздание', дней))}</span>
        </div>
      </a>
      ${x.скрыто
        ? `<a class="quiet" href="napominalka://unhide/${экранировать(x.id)}"
             onclick="вернуть(this)">${экранировать(т('вернуть'))}</a>`
        : `<a class="quiet тихая" href="napominalka://hide/${экранировать(x.id)}"
             onclick="return скрыть(event, this)">${экранировать(т('скрыть'))}</a>`}
      </div>`;
  };

  // Кнопка рисуется всегда, но пустая прячется. Так странице не нужно
  // создавать её на лету, когда пользователь скроет первое задание.
  const кнопкаСкрытых =
    `      <button class="показать-скрытые"${скрытые.length ? '' : ' hidden'}
              onclick="показатьСкрытые(this)">${экранировать(т('показатьСкрытые'))} (${скрытые.length})</button>`;

  return `    <section data-задания="да">
      <h2>${экранировать(т('просрочено'))} <span class="count">${видимые.length}</span></h2>
      <p class="hint">${экранировать(т('подписьПросрочено'))}</p>
${видимые.map(карточка).join('\n')}
${скрытые.map(карточка).join('\n')}
${кнопкаСкрытых}
    </section>`;
}

function секция(заголовок, пункты, now, freshIds, подпись) {
  if (!пункты.length) return '';
  const раздел = заголовок.toLowerCase();
  // data-задания — метка «в этом разделе живут карточки». Нужна пересчёту:
  // раздел, из которого убрали ПОСЛЕДНЮЮ карточку, иначе оставался висеть
  // пустым — с заголовком и подписью, но без содержимого.
  return `    <section data-задания="да">
      <h2>${экранировать(заголовок)} <span class="count">${пункты.length}</span></h2>
      ${подпись ? `<p class="hint">${экранировать(подпись)}</p>` : ''}
${пункты.map(x => карточка(x, now, freshIds.has(x.id), раздел)).join('\n')}
    </section>`;
}

/**
 * Панель настроек под шестерёнкой.
 *
 * Спрятана до нажатия. Значения подставляются текущие — из настройки.json,
 * а не из головы: иначе человек, открывший её, увидит пустые поля и решит,
 * что настроек нет вовсе.
 *
 * Сохранение идёт не отсюда: страница писать на диск не может. Кнопка
 * собирает всё в один кусок и зовёт Напоминалку ссылкой napominalka://config,
 * тем же способом, что «не срочно» и «скрыть».
 */
/**
 * Классы-исключения — ГАЛОЧКАМИ, а не строкой.
 *
 * Просьба пользователя, и она верная: имена вроде «AP World Hist 1 Per 2 - 6255D-1 (S1)»
 * руками не набрать без опечатки, а опечатка означает, что исключение просто
 * не сработает — молча. Список берём из `классы.json`, то есть из того, что
 * система реально видит.
 *
 * Имена, которых в списке уже нет (класс закрыли, а исключение осталось),
 * всё равно показываем отмеченными: иначе сохранение молча их потеряет.
 *
 * Если классы ещё ни разу не читались — оставляем обычное поле, чтобы вписать
 * руками. Пустой список галочек был бы тупиком.
 */
function полеИсключений(выбранные) {
  let классы = [];
  try {
    const файл = path.join(__dirname, 'классы.json');
    if (fs.existsSync(файл)) {
      классы = JSON.parse(fs.readFileSync(файл, 'utf8')).map(к => к.name).filter(Boolean);
    }
  } catch { /* не прочитались — покажем поле для ручного ввода */ }

  // Отмеченное, но уже неизвестное — вниз списка, чтобы не пропало.
  for (const имя of выбранные) if (!классы.includes(имя)) классы.push(имя);

  if (!классы.length) {
    return `      <label class="настройка">
        <span class="имя-поля">${экранировать(т('нИсключения'))}</span>
        <input type="text" data-ключ="исключения" value="${экранировать(выбранные.join(', '))}">
        <span class="подсказка-поля">${экранировать(т('нИсключенияПодсказка'))}</span>
      </label>`;
  }

  const строки = классы.map(имя =>
    `          <label class="птичка"><input type="checkbox" data-ключ="исключения"` +
    ` onchange="пересчитатьВыбор()"` +
    ` value="${экранировать(имя)}"${выбранные.includes(имя) ? ' checked' : ''}>` +
    `<span class="что">${экранировать(имя)}</span></label>`).join('\n');

  // <details> — РАСКРЫВАЮЩЕЕСЯ МЕНЮ САМОГО БРАУЗЕРА.
  //
  // Просьба пользователя: список галочек, всегда развёрнутый, занимал полпанели.
  // Своё меню на JavaScript писать незачем — <details> умеет это сам,
  // работает без единой строчки кода и не ломается, если скрипт упал.
  //
  // В заголовке — сколько отмечено, чтобы не раскрывать ради проверки.
  const отмечено = классы.filter(и => выбранные.includes(и)).length;
  return `      <div class="настройка широкая">
        <span class="имя-поля">${экранировать(т('нИсключения'))}</span>
        <details class="выбор-классов">
          <summary><span class="сводка-выбора">${отмечено}</span> ${экранировать(т('нИзНих'))} ${классы.length}</summary>
          <div class="список-классов">
${строки}
          </div>
        </details>
        <span class="подсказка-поля">${экранировать(т('нИсключенияГалочки'))}</span>
      </div>`;
}

function панельНастроек() {
  const н = прочитатьНастройки();
  const поле = (ключ, подпись, значение, подсказка) =>
    `      <label class="настройка">
        <span class="имя-поля">${экранировать(подпись)}</span>
        <input type="text" data-ключ="${ключ}" value="${экранировать(значение)}">
        <span class="подсказка-поля">${экранировать(подсказка || '')}</span>
      </label>`;

  return `  <div class="настройки" id="панель-настроек" hidden>
      <div class="имя">${экранировать(т('настройки'))}</div>
${поле('почта', т('нПочта'), н.почта, т('нПочтаПодсказка'))}
${поле('canvas', т('нCanvas'), н.canvas, т('нCanvasПодсказка'))}
${поле('часыСводки', т('нЧасы'), н.часыСводки.join(', '), т('нЧасыПодсказка'))}
${полеИсключений(н.исключения)}
      <label class="настройка">
        <span class="имя-поля">${экранировать(т('нЯзык'))}</span>
        <select data-ключ="язык">
          <option value="ru"${н.язык === 'ru' ? ' selected' : ''}>Русский</option>
          <option value="en"${н.язык === 'en' ? ' selected' : ''}>English</option>
        </select>
        <span class="подсказка-поля"></span>
      </label>
      <div class="действия-настроек">
        <button onclick="сохранитьНастройки()">${экранировать(т('нСохранить'))}</button>
        <button onclick="показатьНастройки()">${экранировать(т('нЗакрыть'))}</button>
        <span class="итог" id="итог-настроек"></span>
      </div>
  </div>`;
}

/**
 * Панель фильтров.
 *
 * Списки классов и типов собираются из того, что реально есть на странице,
 * а не из заранее известного перечня: классы теперь приходят с сайта сами,
 * и захардкоженный список устарел бы к сентябрю.
 */
function панельФильтров(всеПункты, now) {
  // Считаем, сколько карточек попадёт под каждую галочку. Цифра рядом
  // сразу показывает, есть ли там что-то — как в библиотеке Steam,
  // на которую пользователь и сослался.
  const посчитать = (ключ) => {
    const счёт = new Map();
    for (const x of всеПункты) {
      const к = ключ(x);
      if (!к) continue;
      счёт.set(к, (счёт.get(к) || 0) + 1);
    }
    return [...счёт.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  };

  const дней = x => (x.due_at ? днейДо(now, x.due_at) : null);
  const сколькоСрок = (проверка) => всеПункты.filter(x => проверка(дней(x))).length;

  const сроки = [
    ['1', т('фСегодняЗавтра'), сколькоСрок(д => д !== null && д >= 0 && д <= 1)],
    ['7', т('фНеделя'), сколькоСрок(д => д !== null && д >= 0 && д <= 7)],
    ['31', т('фМесяц'), сколькоСрок(д => д !== null && д >= 0 && д <= 31)],
    ['past', т('фПросрочено'), сколькоСрок(д => д !== null && д < 0)],
    ['none', т('фБезСрока'), сколькоСрок(д => д === null)],
  ];

  // ГАЛОЧКИ ОТМЕЧЕНЫ ИЗНАЧАЛЬНО. Просьба пользователя, и довод верный:
  // раньше не стояло ни одной, а показывалось всё — глазами это выглядит
  // как противоречие. И чтобы убрать один класс, приходилось отмечать
  // все остальные.
  //
  // Механизм при этом прежний: пусто в группе значит «подходит всё».
  // Поэтому «все отмечены» и «ни одна не отмечена» дают одинаковый
  // результат — просто первое честнее выглядит.
  const галочка = (группа, значение, подпись, сколько) =>
    `        <label class="птичка"><input type="checkbox" data-group="${группа}"` +
    ` value="${экранировать(значение)}" onchange="применитьФильтры()" checked>` +
    `<span class="что">${экранировать(подпись)}</span>` +
    `<span class="сколько">${сколько}</span></label>`;

  const группа = (имя, содержимое) =>
    `    <div class="группа">
      <div class="имя">${экранировать(имя)}</div>
${содержимое.join('\n')}
    </div>`;

  const части = [];

  части.push(группа(т('фКласс'), посчитать(x => x.class)
    .map(([з, н]) => галочка('cls', з, з, н))));

  части.push(группа(т('фТип'), посчитать(x => (x.type || '').trim())
    .map(([з, н]) => галочка('type', з, з, н))));

  части.push(группа(т('фСрок'), сроки
    .filter(([, , н]) => н > 0)
    .map(([з, п, н]) => галочка('days', з, п, н))));

  // Отдельная галочка: не фильтр по значению, а «показать то, что убрано».
  части.push(`    <div class="группа">
      <div class="имя">${экранировать(т('фСкрытые'))}</div>
        <label class="птичка"><input type="checkbox" id="ф-скрытые" onchange="применитьФильтры()">
          <span class="что">${экранировать(т('фПоказыватьСкрытые'))}</span></label>
        <label class="птичка"><input type="checkbox" id="ф-удалённые" onchange="применитьФильтры()">
          <span class="что">${экранировать(т('фПоказыватьУдалённые'))}</span></label>
      <button onclick="сброс()">${экранировать(т('фСброс'))}</button>
      <div class="итог" id="ф-итог"></div>
    </div>`);

  return `  <div class="фильтры">
${части.join('\n')}
  </div>`;
}

/**
 * @param {object} данные — {burning, later, undated, fresh, сломались, now}
 * @param {string} путь — куда записать html
 */
function записатьСтраницу(данные, путь) {
  const { burning, later, undated, freshIds, сломались, now } = данные;
  const читаем = данные.читаем || [];
  const отложенные = данные.отложенные || [];

  // Объявления из лент. Свежие — сверху.
  const просрочено = данные.просрочено || [];
  const пропавшие = данные.пропавшие || [];
  const объявления = [...(данные.объявления || [])];
  const новыеИд = данные.новыеОбъявления || new Set();

  // Какие платформы вообще участвуют — показываем в шапке.
  // Пока их две, дальше добавятся Edpuzzle и DeltaMath.
  // Материалы показываем только новые (старые уже прочитаны, висеть им
  // в списке незачем — та же логика, что и у всплывашки).
  //
  // Считается здесь, а не ниже, потому что галочки в фильтрах должны
  // совпадать с тем, что реально нарисовано. Иначе рядом с «без срока»
  // стояло бы 32, а на странице не было бы ни одной такой карточки.
  const новыеМатериалы = undated.filter(x => freshIds.has(x.id));

  // Всё, что реально попадёт на страницу — для списков в фильтрах.
  const всеПункты = [...burning, ...later, ...новыеМатериалы, ...отложенные, ...просрочено, ...пропавшие];

  const площадки = [...new Set(
    [...burning, ...later, ...undated, ...отложенные]
      .map(x => x.платформа || ПЛАТФОРМА_ПО_УМОЛЧАНИЮ)
  )].sort();
  if (!площадки.length) площадки.push(ПЛАТФОРМА_ПО_УМОЛЧАНИЮ);

  const время = now.toLocaleString(локаль(), {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  // новыеМатериалы посчитаны выше, вместе со списками для фильтров.

  // Страница переписывается после каждого прочитанного класса, чтобы
  // в неё можно было заглянуть, не дожидаясь конца прохода. Значит она
  // ОБЯЗАНА честно говорить о своём состоянии — иначе недочитанный
  // список выглядит как полный, и это хуже, чем ожидание.
  const идёт = читаем.length
    ? `  <div class="live"><span class="dot"></span>${экранировать(т('ещёЧитаю'))} ${экранировать(читаем.join(', '))}.
       ${экранировать(т('покаИзПамяти'))}</div>`
    : '';

  const предупреждение = сломались.length
    ? `  <div class="warn">${экранировать(т('неУдалось'))} ${экранировать(сломались.join(', '))}.
       ${экранировать(т('покаИзПамяти'))}</div>`
    : '';

  const пусто = !burning.length && !later.length && !новыеМатериалы.length
    ? `  <div class="empty">${экранировать(т('пусто'))}</div>`
    : '';

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${экранировать(т('заголовок'))}</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1a1c1e; --dim: #6b7280;
    --line: #e5e7eb; --hot: #d92d20; --new: #1570ef; --warn: #b54708;
    --warnbg: #fffaeb;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16181c; --card: #1f2226; --text: #e8eaed; --dim: #9aa0a6;
      --line: #2f3338; --hot: #ff6b5e; --new: #6aa9ff; --warn: #f5a524;
      --warnbg: #2a2314;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 60px;
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  main { max-width: 1180px; margin: 0 auto; }
  /* Слева задания, справа объявления. На узком экране — друг под другом. */
  .колонки { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 28px; }
  @media (max-width: 900px) { .колонки { grid-template-columns: 1fr; } }
  .пост {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 8px; display: block;
    text-decoration: none; color: inherit;
  }
  .пост:hover { border-color: var(--new); }
  .пост .шапка {
    display: flex; gap: 8px; font-size: 12px; color: var(--dim);
    margin-bottom: 6px; flex-wrap: wrap;
  }
  .пост .текст { font-size: 14px; white-space: pre-wrap; }
  /* Длинное объявление подрезаем; кнопка «раскрыть» снимает подрезку */
  .пост .текст.свёрнут {
    display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .действия {
    display: flex; gap: 12px; align-items: center; margin-top: 8px;
    font-size: 13px;
  }
  .действия a { color: var(--dim); text-decoration: none; }
  .действия a:hover { color: var(--new); }
  .раскрыть {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--new); font: inherit;
  }
  /* Своя прокрутка у ленты: иначе девятнадцать объявлений растягивают
     страницу, и задания слева уезжают куда-то вверх */
  .лента {
    max-height: calc(100vh - 220px); overflow-y: auto;
    padding-right: 6px;
  }
  header { margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .when { color: var(--dim); font-size: 13px; }
  /* Кнопка перезагрузки — как в браузере, но на самой странице: в окне
     Сводки браузерной нет вовсе. Только перечитывает файл, проверку
     не запускает (для этого «Проверить сейчас»). */
  .обновить {
    width: 26px; height: 26px; padding: 0; margin-left: 8px;
    vertical-align: middle; cursor: pointer;
    border: 1px solid var(--line); border-radius: 7px;
    background: var(--card); color: var(--dim);
    font-size: 15px; line-height: 1;
    transition: transform .3s ease, color .15s, border-color .15s;
  }
  .обновить:hover { color: var(--new); border-color: var(--new); }
  /* Крутится, пока идёт запущенная долгим нажатием проверка. Своего
     :active-поворота у кнопки нет намеренно — он спорил бы с этим. */
  .обновить.крутится {
    animation: вертится 1.1s linear infinite;
    color: var(--new); border-color: var(--new);
  }
  @keyframes вертится { to { transform: rotate(360deg); } }
  /* Фильтры объявлений — своя полоска в их же колонке. Отдельно от
     главной панели: у объявлений нет ни срока, ни типа, общие галочки
     к ним неприменимы. */
  .фильтры-объявлений {
    display: flex; flex-wrap: wrap; gap: 2px 14px; margin: -2px 0 10px;
    font-size: 13px;
  }
  .фильтры-объявлений .птичка { flex: 0 1 auto; gap: 6px; }
  .фильтры-объявлений .птичка .что { max-width: 210px; }
  /* Атрибут hidden сам по себе не спрячет .пост: у него задан display */
  .пост[hidden] { display: none; }
  .platform { color: var(--dim); font-size: 13px; margin-top: 2px; }
  section { margin-bottom: 28px; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--dim); margin: 0 0 10px; display: flex; gap: 8px;
    align-items: center;
  }
  .count {
    background: var(--line); color: var(--dim); border-radius: 10px;
    padding: 1px 7px; font-size: 12px; letter-spacing: 0;
  }
  .hint { color: var(--dim); font-size: 13px; margin: -4px 0 10px; }
  .item {
    display: block; background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 12px 14px; margin-bottom: 8px;
    text-decoration: none; color: inherit;
  }
  a.item:hover { border-color: var(--new); }
  .title { font-weight: 600; margin-bottom: 4px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 13px; color: var(--dim); }
  .due { color: var(--hot); }
  .plat {
    background: var(--line); border-radius: 6px; padding: 0 6px; font-size: 12px;
  }
  .badge {
    background: var(--new); color: #fff; border-radius: 6px;
    padding: 0 6px; font-size: 12px;
  }
  .warn {
    background: var(--warnbg); color: var(--warn); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 20px; font-size: 14px;
  }
  .live {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 20px; font-size: 14px; color: var(--dim);
    display: flex; gap: 9px; align-items: baseline;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--new);
    flex: 0 0 auto; animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: .25; } }
  .empty { color: var(--dim); padding: 20px 0; }
  .row { display: flex; gap: 8px; align-items: stretch; margin-bottom: 8px; }
  .row .item { flex: 1; margin-bottom: 0; }
  .quiet {
    flex: 0 0 auto; display: flex; align-items: center; padding: 0 12px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    color: var(--dim); font-size: 13px; text-decoration: none; white-space: nowrap;
  }
  .quiet:hover { color: var(--text); border-color: var(--dim); }
  .row.done { opacity: .45; }
  .row.done .quiet { pointer-events: none; }
  /* Карточка, снятая кнопкой «не срочно»: сначала тускнеет, потом уезжает
     и удаляется совсем. Раньше она просто гасла и висела до следующего
     сбора — пользователь справедливо сказал, что так нигде не делают. */
  .row { transition: opacity .25s ease, transform .25s ease; }
  .row.убрана { opacity: 0; transform: translateX(12px); }
  /* Не подошла под фильтр. !important — потому что .row.скрытая.видна
     тоже задаёт display, и без этого они бы спорили. */
  .row.отфильтрована { display: none !important; }
  section[hidden] { display: none; }
  /* Фильтры списками галочек, а не выпадашками: пользователь попросил как
     в библиотеке Steam — видно сразу все возможности и сколько под
     каждой лежит, а не по одному через раскрытие. */
  .фильтры {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 18px 24px;
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 20px; font-size: 13px;
  }
  .группа .имя {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--dim); margin-bottom: 7px;
  }
  .птичка {
    display: flex; gap: 7px; align-items: center; padding: 3px 0;
    cursor: pointer; color: var(--text);
  }
  .птичка:hover { color: var(--new); }
  .птичка input { flex: 0 0 auto; margin: 0; }
  /* Длинное имя класса подрезаем: иначе колонка расползается на пол-экрана */
  .птичка .что { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .птичка .сколько {
    margin-left: auto; color: var(--dim); font-size: 12px;
    background: var(--line); border-radius: 9px; padding: 0 6px;
  }
  .фильтры button {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 5px 10px;
    cursor: pointer; margin-top: 10px;
  }
  .фильтры button:hover { color: var(--text); border-color: var(--dim); }
  .фильтры .итог { color: var(--dim); font-size: 12px; margin-top: 8px; }
  /* Панель настроек. Спрятана до нажатия шестерёнки. */
  .настройки {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 20px; font-size: 13px;
  }
  .настройки[hidden] { display: none; }
  .настройка {
    display: grid; grid-template-columns: 190px minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 10px; align-items: center; margin-bottom: 8px;
  }
  @media (max-width: 700px) { .настройка { grid-template-columns: 1fr; gap: 4px; } }
  .имя-поля { color: var(--text); }
  .подсказка-поля { color: var(--dim); font-size: 12px; }
  /* ТОЛЬКО текстовые поля и списки. Раньше здесь стояло «.настройка input»,
     и правило цепляло ГАЛОЧКИ в списке классов: каждая растягивалась
     на всю ширину строки, а подписи места не оставалось. Сначала она
     схлопывалась в ноль (имена пропадали совсем), потом — в одно слово
     столбиком. Причина была не в подписи, а в соседе. */
  .настройка input[type="text"], .настройка select {
    font: inherit; font-size: 13px; padding: 5px 8px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
    width: 100%;
  }
  .настройка input[type="checkbox"] { flex: 0 0 auto; width: auto; margin: 2px 0 0; }
  .действия-настроек {
    display: flex; gap: 10px; align-items: center; margin-top: 12px;
    flex-wrap: wrap;
  }
  .действия-настроек button {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer;
  }
  .действия-настроек button:hover { color: var(--text); border-color: var(--dim); }
  #итог-настроек { color: var(--dim); font-size: 12px; }
  /* Раскрывающийся список классов. */
  .выбор-классов {
    border: 1px solid var(--line); border-radius: 7px; background: var(--bg);
  }
  .выбор-классов summary {
    cursor: pointer; padding: 5px 8px; color: var(--dim); font-size: 13px;
    user-select: none;
  }
  .выбор-классов summary:hover { color: var(--text); }
  .выбор-классов[open] summary { border-bottom: 1px solid var(--line); }
  .сводка-выбора { color: var(--text); }
  .список-классов { max-height: 190px; overflow-y: auto; padding: 6px 8px; }
  .список-классов .птичка { padding: 3px 0; align-items: flex-start; }
  /* ПОДПИСИ НЕ ОБРЕЗАЕМ. У общих фильтров имя класса подрезано в одну строку,
     и там это верно — колонка узкая. Здесь наоборот: имена вроде
     «AP World Hist 1 Per 2 - 6255D-1 (S1)» надо видеть целиком, иначе
     не поймёшь, что отмечаешь. Без этого правила флексбокс ужимал подпись
     до НУЛЕВОЙ ширины: у элемента с overflow:hidden минимальная ширина
     считается нулём, и текст исчезал совсем — проверено браузером. */
  .список-классов .птичка .что {
    overflow: visible; white-space: normal; text-overflow: clip;
    max-width: none; line-height: 1.35;
    /* flex: 1 — чтобы подпись занимала всю доступную ширину. Без него
       флексбокс ужимает её до самого длинного СЛОВА, и имя класса
       переносится столбиком по одному слову. */
    flex: 1;
  }
  /* Строка со списком классов шире прочих: имена длинные, и в узкой
     колонке они рассыпаются. Подсказка уезжает под список. */
  .настройка.широкая { grid-template-columns: 190px minmax(0, 1fr); }
  .настройка.широкая .подсказка-поля { grid-column: 2; margin-top: 4px; }
  .item.просрочен { border-left: 3px solid var(--hot); }
  .было { color: var(--hot); }
  /* Кнопка «скрыть» нарочно неприметная: чтобы не нажать мимоходом.
     Проявляется, когда ведёшь мышью по карточке. */
  .quiet.тихая { opacity: .25; }
  .row:hover .quiet.тихая { opacity: 1; }
  /* Удалённое учителем: видно, что запись есть, но она уже не про работу. */
  .row.пропавшая .item { opacity: .55; border-style: dashed; }
  .значок-удалено {
    background: var(--line); color: var(--dim); border-radius: 6px;
    padding: 0 6px; font-size: 12px;
  }
  .row.скрытая { display: none; }
  .row.скрытая.видна { display: flex; opacity: .5; }
  .показать-скрытые {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer; margin-top: 4px;
  }
  .показать-скрытые:hover { color: var(--text); border-color: var(--dim); }
  footer { color: var(--dim); font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${экранировать(т('заголовок'))}</h1>
    <div class="when">${экранировать(т('обновлено'))} ${экранировать(время)}<button class="обновить"
         id="кнопка-обновить"
         title="${экранировать(т('перечитать'))}">&#8635;</button><button class="обновить"
         id="кнопка-настройки" onclick="показатьНастройки()"
         title="${экранировать(т('настройки'))}">&#9881;</button></div>
    <div class="platform">${экранировать(площадки.join(' · '))}</div>
  </header>
${идёт}
${предупреждение}
  <div class="колонки">
  <div>
${панельНастроек()}
${панельФильтров(всеПункты, now)}
${пусто}
${секция(т('горит'), burning, now, freshIds, т('подписьГорит'))}
${секцияПросрочено(просрочено, now)}
${секция(т('впереди'), later, now, freshIds)}
${секция(т('новыеМатериалы'), новыеМатериалы, now, freshIds, т('подписьМатериалы'))}
${секция(т('безНапоминания'), отложенные, now, freshIds, т('подписьОтложенные'))}
${секция(т('удалено'), пропавшие, now, freshIds, т('подписьУдалённые'))}
  </div>
  <div>
${секцияОбъявлений(объявления, новыеИд)}
    <section>
      <h2>${экранировать(т('транскрипты'))}</h2>
      <p class="hint">${экранировать(т('подписьТранскрипты'))}</p>
    </section>
  </div>
  </div>
  <footer>${экранировать(т('подвал'))}</footer>
</main>
<script>
// СЛОВА — переводы для кода, который работает уже внутри страницы.
//
// Вклеивать перевод прямо в текст кода нельзя: апостроф в английской фразе
// («don't») оборвал бы строку и убил бы весь скрипт страницы — ровно так,
// как это уже случилось однажды с переносом в confirm(). JSON.stringify
// экранирует всё сам, поэтому безопасно при любом языке.
const СЛОВА = ${JSON.stringify({
  раскрыть: т('раскрыть'),
  свернуть: т('свернуть'),
  скрыть: т('скрыть'),
  вернуть: т('вернуть'),
  снято: т('снято'),
  переспрос: т('переспрос'),
  переспросХвост: т('переспросХвост'),
  показатьСкрытые: т('показатьСкрытые'),
  спрятатьОбратно: т('спрятатьОбратно'),
  показано: т('фПоказано'),
  проверяю: т('проверяю'),
  сохранено: т('нСохранено'),
  вернулось: т('нВернулось'),
})};

// Ссылка napominalka:// уходит в Напоминалку и там записывается на диск,
// но страница об этом не узнает до следующего сбора. Поэтому гасим
// карточку сразу — иначе непонятно, нажалось или нет.
// Кнопку «раскрыть» показываем только тем объявлениям, которые правда
// не поместились. Понять это можно лишь после отрисовки: сравниваем
// полную высоту текста с видимой.
for (const пост of document.querySelectorAll('.пост')) {
  const текст = пост.querySelector('.текст');
  const кнопка = пост.querySelector('.раскрыть');
  if (текст && кнопка && текст.scrollHeight > текст.clientHeight + 2) {
    кнопка.hidden = false;
  }
}

function развернуть(кнопка) {
  const текст = кнопка.closest('.пост').querySelector('.текст');
  const свёрнут = текст.classList.toggle('свёрнут');
  кнопка.textContent = свёрнут ? СЛОВА.раскрыть : СЛОВА.свернуть;
}

// Скрыть просроченное — с переспросом, чтобы не нажать случайно.
// Если человек передумал, ссылка не срабатывает вообще.
function скрыть(e, ссылка) {
  var строка = ссылка.closest('.row');
  var название = строка.querySelector('.title').textContent.trim();
  // ОБРАТНЫЕ СЛЭШИ ЗДЕСЬ УДВОЕНЫ, И ЭТО ОБЯЗАТЕЛЬНО.
  //
  // Этот код едет внутрь шаблонной строки, которая собирает страницу.
  // Одинарный \\n превратился бы в настоящий перенос строки ещё при сборке,
  // и в готовом HTML кавычка оказалась бы разорвана посередине. Браузер
  // на этом спотыкается и не выполняет ВЕСЬ код страницы — молча.
  // Так и было: кнопки и фильтры не работали с того дня, как появился
  // раздел «Просрочено», и заметили это только проверкой готовой страницы.
  if (!confirm(СЛОВА.переспрос + '\\n\\n' + название +
               '\\n\\n' + СЛОВА.переспросХвост)) {
    e.preventDefault();
    return false;
  }

  // Прячем СРАЗУ, не дожидаясь следующего сбора.
  //
  // Сначала карточка просто гасла, а исчезала через десять минут.
  // пользователь справедливо сказал, что так нигде не делают: нажал «скрыть» —
  // значит скрылось. Файл на диске всё равно обновит приложение,
  // просто страница больше не ждёт его, чтобы вести себя правильно.
  строка.classList.add('скрытая');
  строка.classList.remove('видна');
  ссылка.className = 'quiet';
  ссылка.textContent = СЛОВА.вернуть;
  ссылка.href = 'napominalka://unhide/' + encodeURIComponent(строка.dataset.id);
  ссылка.onclick = function () { вернуть(ссылка); };

  обновитьРаздел(строка.closest('section'));
  return true;
}

function вернуть(ссылка) {
  var строка = ссылка.closest('.row');
  строка.classList.remove('скрытая', 'видна');
  ссылка.className = 'quiet тихая';
  ссылка.textContent = СЛОВА.скрыть;
  ссылка.href = 'napominalka://hide/' + encodeURIComponent(строка.dataset.id);
  ссылка.onclick = function (e) { return скрыть(e, ссылка); };

  обновитьРаздел(строка.closest('section'));
}

// Пересчитывает кнопку «показать скрытые». Счётчики в заголовках
// считает пересчитать(): их теперь меняют и фильтры тоже, и держать
// две независимые счёталки — верный способ получить расхождение.
function обновитьРаздел(раздел) {
  пересчитать();
  if (!раздел) return;
  var скрытых = раздел.querySelectorAll('.row.скрытая').length;

  var кнопка = раздел.querySelector('.показать-скрытые');
  if (!кнопка) return;
  кнопка.hidden = (скрытых === 0);
  var раскрыты = раздел.querySelector('.row.скрытая.видна') !== null;
  кнопка.textContent = раскрыты
    ? СЛОВА.спрятатьОбратно
    : СЛОВА.показатьСкрытые + ' (' + скрытых + ')';
}

// ВНИМАНИЕ: этот код едет внутрь шаблонной строки, которая собирает
// всю страницу. Поэтому здесь НЕЛЬЗЯ пользоваться обратными кавычками
// и вставками «доллар с фигурной скобкой» — они оборвут внешнюю строку,
// и Node попытается выполнить кусок текста как код.
//
// Наступали дважды подряд: сначала в самом коде, потом в этом самом
// предупреждении, где такая вставка была написана буквально.
function показатьСкрытые(кнопка) {
  var раздел = кнопка.closest('section');
  var строки = [].slice.call(раздел.querySelectorAll('.row.скрытая'));
  var показаны = строки.length && строки[0].classList.contains('видна');
  for (var i = 0; i < строки.length; i++) строки[i].classList.toggle('видна', !показаны);
  обновитьРаздел(раздел);
}

// «Не срочно»: тускнеет, показывает «снято» и через секунду уезжает.
// Ссылку не отменяем — она должна дойти до приложения, оно запишет id
// на диск. Но ждать следующего сбора, чтобы карточка исчезла, незачем.
function успокоить(e, кнопка) {
  var строка = кнопка.closest('.row');
  строка.classList.add('done');
  кнопка.textContent = СЛОВА.снято;

  setTimeout(function () {
    строка.classList.add('убрана');
    setTimeout(function () {
      var раздел = строка.closest('section');
      строка.remove();
      обновитьРаздел(раздел);
    }, 300);
  }, 800);
}

// ── Фильтры ──
//
// Подписи у карточек латиницей (data-cls, data-type, data-days, data-sect),
// см. комментарий в карточке. data-days — сколько дней до срока: минус
// значит просрочено, «нет» значит срока нет вовсе.

function видима(строка) {
  if (строка.classList.contains('отфильтрована')) return false;
  if (строка.classList.contains('скрытая') && !строка.classList.contains('видна')) return false;
  return true;
}

// Счётчики в заголовках, пустые разделы и «показано: N» справа в панели.
function пересчитать() {
  var всего = 0;
  var разделы = document.querySelectorAll('section');
  for (var i = 0; i < разделы.length; i++) {
    var раздел = разделы[i];
    // Объявления и транскрипты не трогаем: у них своя жизнь и свои счётчики.
    // Проверяем МЕТКУ, а не количество карточек: раздел, из которого убрали
    // последнюю, тоже имеет ноль строк — и раньше просто пропускался,
    // оставаясь пустым на экране.
    if (раздел.getAttribute('data-задания') !== 'да') continue;
    var строки = раздел.querySelectorAll('.row');

    var видимых = 0;
    for (var j = 0; j < строки.length; j++) if (видима(строки[j])) видимых++;

    var счётчик = раздел.querySelector('h2 .count');
    if (счётчик) счётчик.textContent = видимых;

    // РАЗДЕЛ СО СКРЫТЫМИ КАРТОЧКАМИ НЕ ПРЯЧЕМ, ДАЖЕ ЕСЛИ ВИДИМЫХ НОЛЬ.
    //
    // Кнопка «показать скрытые (N)» живёт ВНУТРИ раздела. Пока условие
    // было просто «видимых ноль», скрытие последнего просроченного уносило
    // раздел целиком — вместе с единственной кнопкой, которой его можно
    // вернуть. А переспрос при этом обещал: «вернуть можно кнопкой внизу
    // этого раздела». Кнопка была, но на экране её не было.
    var естьСкрытые = раздел.querySelector('.row.скрытая') !== null;
    раздел.hidden = (видимых === 0 && !естьСкрытые);
    всего += видимых;
  }
  var итог = document.getElementById('ф-итог');
  if (итог) итог.textContent = СЛОВА.показано + ' ' + всего;
}

// Что отмечено в одной группе галочек.
// Пусто значит «ничего не выбрано» — то есть подходит всё.
// Несколько отмеченных внутри группы складываются по «или»: выбрал два
// класса — увидишь оба. А разные группы складываются по «и»: класс И срок.
function выбранные(группа) {
  var найденные = [];
  var поля = document.querySelectorAll('input[data-group="' + группа + '"]');
  for (var i = 0; i < поля.length; i++) {
    if (поля[i].checked) найденные.push(поля[i].value);
  }
  return найденные;
}

// Подходит ли карточка под отмеченные сроки.
function подходитПоСроку(значения, дни) {
  for (var i = 0; i < значения.length; i++) {
    var в = значения[i];
    if (в === 'none') {
      if (дни === 'нет') return true;
    } else if (в === 'past') {
      if (дни !== 'нет' && Number(дни) < 0) return true;
    } else if (дни !== 'нет' && Number(дни) >= 0 && Number(дни) <= Number(в)) {
      return true;
    }
  }
  return false;
}

// ЦИФРЫ РЯДОМ С ГАЛОЧКАМИ ЖИВЫЕ, А НЕ ПОСЧИТАННЫЕ ПРИ СБОРКЕ.
//
// Раньше они считались один раз, при печати страницы, и не знали про
// «показывать удалённые» и «показывать скрытые». Выходило враньё:
// рядом с классом стояло «3», а по нажатию показывалось НОЛЬ — все три
// задания лежали в «Больше не в Classroom», спрятанном по умолчанию.
// Так же вылезал тип «Completed Assignment», которого на странице нет.
//
// Считаем без учёта ДРУГИХ групп: цифра отвечает на вопрос «сколько
// станет видно, если отметить только это», а не «сколько останется
// с учётом всех прочих галочек». Второе честнее, но по нему невозможно
// выбирать — цифры прыгали бы от каждого щелчка.
function обновитьЦифры(показыватьСкрытые, показыватьУдалённые) {
  var поля = document.querySelectorAll('.фильтры input[data-group]');
  var строки = document.querySelectorAll('.row');

  for (var i = 0; i < поля.length; i++) {
    var метка = поля[i].parentElement.querySelector('.сколько');
    if (!метка) continue;
    var группа = поля[i].getAttribute('data-group');
    var значение = поля[i].value;
    var сколько = 0;

    for (var j = 0; j < строки.length; j++) {
      var р = строки[j];
      if (!показыватьУдалённые && р.getAttribute('data-удалено') === 'да') continue;
      if (!показыватьСкрытые && р.classList.contains('скрытая')) continue;
      if (группа === 'cls' && р.getAttribute('data-cls') !== значение) continue;
      if (группа === 'type' && р.getAttribute('data-type') !== значение) continue;
      if (группа === 'days' && !подходитПоСроку([значение], р.getAttribute('data-days'))) continue;
      сколько++;
    }
    метка.textContent = сколько;
  }
}

function применитьФильтры() {
  var клы = выбранные('cls');
  var тпы = выбранные('type');
  var сры = выбранные('days');
  var показыватьСкрытые = document.getElementById('ф-скрытые').checked;
  var полеУдалённых = document.getElementById('ф-удалённые');
  var показыватьУдалённые = полеУдалённых !== null && полеУдалённых.checked;

  var строки = document.querySelectorAll('.row');
  for (var i = 0; i < строки.length; i++) {
    var р = строки[i];
    var ок = true;

    // Удалённое прячем по умолчанию: оно не про работу, а про историю.
    // Раздел с ним спрячется сам — в нём станет ноль видимых карточек.
    if (!показыватьУдалённые && р.getAttribute('data-удалено') === 'да') ок = false;

    if (ок && клы.length && клы.indexOf(р.getAttribute('data-cls')) === -1) ок = false;
    if (ок && тпы.length && тпы.indexOf(р.getAttribute('data-type')) === -1) ок = false;
    if (ок && сры.length) ок = подходитПоСроку(сры, р.getAttribute('data-days'));

    р.classList.toggle('отфильтрована', !ок);
  }

  // Галочка «показывать скрытые» управляет всеми скрытыми сразу,
  // включая кнопку «показать скрытые» внутри раздела «Просрочено».
  var скрытые = document.querySelectorAll('.row.скрытая');
  for (var k = 0; k < скрытые.length; k++) {
    скрытые[k].classList.toggle('видна', показыватьСкрытые);
  }

  var кнопки = document.querySelectorAll('.показать-скрытые');
  for (var m = 0; m < кнопки.length; m++) {
    обновитьРаздел(кнопки[m].closest('section'));
  }

  обновитьЦифры(показыватьСкрытые, показыватьУдалённые);
  пересчитать();
}

// Вернуть срочность: задание уезжает из «Без напоминания» обратно.
// Как и «не срочно», карточка убирается сразу, не дожидаясь сбора —
// нажал, значит вернулось.
function вернутьСрочность(ссылка) {
  var строка = ссылка.closest('.row');
  строка.classList.add('done');
  ссылка.textContent = СЛОВА.вернулось;

  setTimeout(function () {
    строка.classList.add('убрана');
    setTimeout(function () {
      var раздел = строка.closest('section');
      строка.remove();
      обновитьРаздел(раздел);
    }, 300);
  }, 800);
  // Ссылку не отменяем: она должна дойти до Напоминалки.
}

// ── Настройки ──
//
// ВНИМАНИЕ: этот код едет внутрь шаблонной строки. Никаких обратных кавычек
// и вставок «доллар с фигурной скобкой» — они оборвут внешнюю строку.

function показатьНастройки() {
  var панель = document.getElementById('панель-настроек');
  if (!панель) return;
  панель.hidden = !панель.hidden;
  if (!панель.hidden) панель.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Текст -> base64url. Не шифрование: просто способ довезти почту и русские
// имена классов через адрес целыми. btoa умеет только «узкие» байты, поэтому
// сначала переводим строку в байты через TextEncoder, а «+» и «/» меняем
// на «-» и «_» — иначе кусок развалится при разборе адреса по слэшам.
function вBase64url(строка) {
  var байты = new TextEncoder().encode(строка);
  var двоичное = '';
  for (var i = 0; i < байты.length; i++) двоичное += String.fromCharCode(байты[i]);
  // РЕГУЛЯРОК ЗДЕСЬ НЕТ НАРОЧНО. Код едет внутрь шаблонной строки, и «\+»
  // в ней превращается в «+» ещё при сборке: регулярка /\+/g приезжает
  // на страницу как /+/g и роняет ВЕСЬ скрипт. Поймано проверкой готовой
  // страницы сразу после написания. split/join escape-последовательностей
  // не требует вовсе, поэтому ломаться тут нечему.
  return btoa(двоичное).split('+').join('-').split('/').join('_');
}

// Счётчик в заголовке раскрывашки. Пересчитывается сразу по клику,
// иначе заголовок врёт до следующего сбора.
function пересчитатьВыбор() {
  var коробка = document.querySelector('.выбор-классов');
  if (!коробка) return;
  var всего = коробка.querySelectorAll('input[type="checkbox"]');
  var сколько = 0;
  for (var i = 0; i < всего.length; i++) if (всего[i].checked) сколько++;
  var метка = коробка.querySelector('.сводка-выбора');
  if (метка) метка.textContent = сколько;
}

function сохранитьНастройки() {
  var панель = document.getElementById('панель-настроек');
  var поля = панель.querySelectorAll('[data-ключ]');
  var набор = {};
  var списки = {};
  for (var i = 0; i < поля.length; i++) {
    var ключ = поля[i].getAttribute('data-ключ');
    if (поля[i].type === 'checkbox') {
      // Галочки одного ключа собираются в список. Ни одной отмеченной —
      // должен уехать ПУСТОЙ список, а не отсутствие ключа: иначе снять
      // последнее исключение было бы невозможно.
      if (!списки[ключ]) списки[ключ] = [];
      if (поля[i].checked) списки[ключ].push(поля[i].value);
    } else {
      набор[ключ] = поля[i].value;
    }
  }
  for (var к in списки) набор[к] = списки[к];

  var итог = document.getElementById('итог-настроек');
  if (итог) итог.textContent = СЛОВА.сохранено;

  // Страница на диск писать не может — зовём Напоминалку, она запишет.
  location.href = 'napominalka://config/' + вBase64url(JSON.stringify(набор));

  // И перечитываем себя. Напоминалка после записи сразу перерисовывает
  // страницу заново (это занимает около секунды), поэтому ждём полторы
  // и обновляемся: иначе смена языка была бы видна только со следующего
  // сбора, а язык -- настройка интерфейса, ждать её десять минут глупо.
  setTimeout(function () { location.reload(); }, 1500);
}

function сброс() {
  // Возврат к тому, как страница выглядит при открытии: галочки списка
  // заданий отмечены все, а «показывать скрытые/удалённые» — сняты.
  // Снять всё подряд было бы неверно: получилось бы состояние, в которое
  // страница сама никогда не приходит.
  var поля = document.querySelectorAll('.фильтры input[data-group]');
  for (var i = 0; i < поля.length; i++) поля[i].checked = true;

  var скрытые = document.getElementById('ф-скрытые');
  if (скрытые) скрытые.checked = false;
  var удалённые = document.getElementById('ф-удалённые');
  if (удалённые) удалённые.checked = false;

  применитьФильтры();
}

// ── Объявления: свои галочки ──
//
// Отдельно от главной панели: у объявления нет ни срока, ни типа,
// общие фильтры к нему неприменимы. Фильтруем по классу и по свежести.
function фильтрОбъявлений() {
  var классы = выбранные('пост-cls');
  var поле = document.getElementById('ф-пост-новые');
  var толькоНовые = (поле !== null && поле.checked);

  var посты = document.querySelectorAll('.пост');
  var видно = 0;
  for (var i = 0; i < посты.length; i++) {
    var п = посты[i];
    var ок = true;
    if (классы.length && классы.indexOf(п.getAttribute('data-cls')) === -1) ок = false;
    if (ок && толькоНовые && п.getAttribute('data-new') !== 'да') ок = false;
    п.hidden = !ок;
    if (ок) видно++;
  }

  var счётчик = document.querySelector('.объявления-счёт');
  if (счётчик) счётчик.textContent = видно;
}

// ── Кнопка «обновить» ──
//
// Короткое нажатие перечитывает файл. Долгое (секунда) запускает
// настоящую проверку — полную, как «Проверить сейчас».
//
// Программу страница запустить не может, браузер не даёт. Но может позвать
// её ссылкой napominalka://, которую перехватывает Напоминалка — тем же
// способом работают «не срочно» и «скрыть».
(function () {
  var кнопка = document.getElementById('кнопка-обновить');
  if (!кнопка) return;

  var таймер = null;
  var былоДолгое = false;

  function нажали() {
    былоДолгое = false;
    таймер = setTimeout(function () {
      былоДолгое = true;
      кнопка.classList.add('крутится');
      кнопка.title = СЛОВА.проверяю;
      location.href = 'napominalka://check';
      // Полная проверка идёт около минуты. Страница перерисовывается после
      // каждого прочитанного источника, так что перечитать её можно смело:
      // увидишь хотя бы часть, а не пустоту.
      setTimeout(function () { location.reload(); }, 45000);
    }, 700);
  }
  function отпустили() { clearTimeout(таймер); }

  кнопка.addEventListener('mousedown', нажали);
  кнопка.addEventListener('mouseup', отпустили);
  кнопка.addEventListener('mouseleave', отпустили);
  кнопка.addEventListener('click', function () {
    // После долгого нажатия обычный клик приходит следом — гасим его,
    // иначе страница перечитается сразу и собьёт «крутится».
    if (былоДолгое) { былоДолгое = false; return; }
    location.reload();
  });
})();

// При загрузке сразу применяем фильтры, а не просто считаем: иначе
// удалённые показались бы до первого щелчка по галочке.
применитьФильтры();
</script>
</body>
</html>
`;

  fs.writeFileSync(путь, html);
  return путь;
}

module.exports = { записатьСтраницу, днейДо };
