/**
 * Interface language. Russian and English.
 *
 * ── What gets translated and what doesn't ──
 *
 * ONLY what a person actually sees gets translated: the summary page and
 * the notification popup.
 *
 * All the *code* around it — this file's own identifiers, the dictionary
 * key names, function names, log messages, CSS class names in the markup —
 * is English now, regardless of interface language, so contributors who
 * don't read Russian can follow it. That's a separate concern from the
 * dictionary's actual Russian-language VALUES below, which stay Russian on
 * purpose: they're the text a Russian-speaking user sees on the page.
 *
 * Two things still deliberately don't get touched by any of this: memory
 * file field names and the `napominalka://` scheme, because changing those
 * would break compatibility with old memory files and with the separate
 * macOS notifier app (not in this repo) that listens for that scheme.
 *
 * ── How the language gets picked ──
 *
 *   node 05-playwright-draft.js --language en   one-time
 *   echo en > language.txt                      permanently
 *
 * A file next to the script, one word inside. No file and no setting —
 * Russian. An unrecognized language code also falls back to Russian,
 * silently: an unclear setting is no reason to leave someone without
 * their digest.
 */

const fs = require('fs');
const path = require('path');

const LANGUAGE_FILE = path.join(__dirname, 'language.txt');

const DICTIONARIES = {
  ru: {
    locale: 'ru-RU',

    // Page header
    title: 'SHREK School Software',
    updated: 'обновлено',
    reloadHint: 'Нажать — перечитать. Держать секунду — проверить заново.',
    checking: 'проверяю…',
    checkFailed: 'не удалось запустить проверку',

    // Sections
    dueSoon: 'Горит',
    overdue: 'Просрочено',
    ahead: 'Впереди',
    newMaterials: 'Новые материалы',
    mutedSection: 'Без напоминания',
    removed: 'Больше не в Classroom',
    announcements: 'Объявления',
    transcripts: 'Транскрипты Edpuzzle',

    // Captions under sections
    dueSoonCaption: 'Неделя и ближе. Задания без проставленного срока считаются «до завтра».',
    overdueCaption: 'Срок прошёл. Если задание уже сдано или неактуально — скрой его.',
    materialsCaption: 'Показываются один раз — это то, что читают, а не сдают.',
    removedCaption: 'Эти задания перестали приходить: учитель их убрал либо класс ушёл в архив. Ничего не потеряно, просто больше не горит. Вернутся — отметка снимется сама.',
    removedBadge: 'нет в Classroom',
    filterShowRemoved: 'показывать удалённые',
    mutedCaption: 'Задания без проставленного срока, по которым ты нажал «не срочно». Не горят, но и не потеряны.',
    announcementsCaption: 'Сообщения учителей. Автоматические «добавлено задание» отсеяны.',
    transcriptsCaption: 'Место под разбор видео — сделаем позже.',
    noAnnouncements: 'Пока ничего. Здесь появятся сообщения учителей из лент классов.',

    // Buttons and badges
    newLabel: 'новое',
    notUrgent: 'не срочно',
    mutedBadge: 'снято',
    restoredBadge: 'вернулось',
    hide: 'скрыть',
    restore: 'вернуть',
    showHidden: 'показать скрытые',
    hideAgain: 'спрятать обратно',
    expand: 'раскрыть',
    collapse: 'свернуть',
    openInClassroom: 'открыть в Classroom',
    confirmRemove: 'Убрать из списка просроченных?',
    confirmRemoveHint: 'Вернуть можно кнопкой внизу этого раздела.',

    // Filters
    filterClass: 'Класс',
    filterType: 'Тип',
    filterDue: 'Срок',
    filterHidden: 'Скрытые',
    filterTodayTomorrow: 'сегодня и завтра',
    filterWeek: 'неделя',
    filterMonth: 'месяц',
    filterOverdue: 'просрочено',
    filterNoDueDate: 'без срока',
    filterShowHiddenMuted: 'показывать снятые и скрытые',
    filterNewOnly: 'только новые',
    filterResetAll: 'сбросить всё',
    filterShowingCount: 'показано:',

    // Settings (gear icon)
    settingsTitle: 'Настройки',
    settingsReveal: 'Показать',
    settingsEmail: 'Школьная почта',
    settingsEmailHint: 'подставляется в ссылки на задания',
    settingsCanvas: 'Адрес Canvas',
    settingsCanvasHint: 'пусто — Canvas не читается',
    settingsLanguage: 'Язык',
    settingsHours: 'Часы полной сводки',
    settingsHoursHint: 'через запятую',
    settingsExclusions: 'Не читать классы',
    settingsExclusionsHint: 'имена через запятую, пусто — читать все',
    settingsExclusionsCheckboxHint: 'отметь те, что читать не надо',
    settingsOf: 'из',
    settingsSave: 'Сохранить',
    settingsSaving: 'Сохраняю…',
    settingsSaveFailed: 'Не удалось сохранить',
    settingsSaved: 'Сохранено. Проверяю — секунд 20…',
    settingsClose: 'закрыть',
    settingsTreatUndated: 'Без срока — считать срочным',
    settingsTreatUndatedHint: 'выключи, чтобы такие задания просто показывались один раз, как материалы',
    settingsShowEmpty: 'Показывать классы без заданий',
    settingsShowEmptyHint: 'иначе класс, где сейчас ничего не горит, просто пропадает из списка',

    // States
    emptyState: 'Ничего не горит и ничего нового. Можно выдохнуть.',
    stillReading: 'Ещё читаю:',
    fromMemoryNotice: 'Пока показаны данные с прошлого раза.',
    couldNotRead: 'Не удалось прочитать:',
    footerNote: 'Собрано без модели, обычным скриптом. Клик по заданию открывает его в Classroom.',

    // Due-date notes. In code these live as KEYS, not text: the page
    // decides whether to show the "not urgent" button based on them, and
    // comparing against the translated phrase would break the moment the
    // language switches.
    noDueDateNote: 'срок не проставлен вообще — считаем: до завтра',
    placeholderDateNote: 'срок-заглушка (2031 и подобное) — считаем: до завтра',

    // Due dates
    today: 'сегодня',
    tomorrow: 'завтра',
    inDays: n => `через ${n} дн.`,
    overdueByDays: n => `просрочено на ${n} дн.`,
    lateByDays: n => `опоздание ${n} дн.`,

    // Notification popup
    schoolLabel: 'Школа',
    courseOpened: 'Открылся курс:',
    openDigestHint: 'открой сводку',
    signInRequired: 'нужен повторный вход',
    signInRequiredHint: 'Google разлогинил браузер. Запусти: node 05-playwright-draft.js --login',
    noDueDateSet: 'срок не проставлен',
    countNew: n => `${n} ${pluralizeRu(n, 'новое', 'новых', 'новых')}`,
    countCourses: n => `${n} ${pluralizeRu(n, 'новый курс', 'новых курса', 'новых курсов')}`,
    countPosts: n => `${n} ${pluralizeRu(n, 'сообщение', 'сообщения', 'сообщений')}`,
    countDue: n => `${n} горит`,
  },

  en: {
    locale: 'en-US',

    title: 'SHREK School Software',
    updated: 'updated',
    reloadHint: 'Click to reload. Hold for a second to run a fresh check.',
    checking: 'checking…',
    checkFailed: "couldn't start a check",

    dueSoon: 'Due soon',
    overdue: 'Overdue',
    ahead: 'Ahead',
    newMaterials: 'New materials',
    mutedSection: 'Muted',
    removed: 'No longer in Classroom',
    announcements: 'Announcements',
    transcripts: 'Edpuzzle transcripts',

    dueSoonCaption: 'A week out or closer. Assignments with no due date are treated as "by tomorrow".',
    overdueCaption: 'Past due. If it is already turned in or no longer relevant, hide it.',
    materialsCaption: 'Shown once — these are meant to be read, not turned in.',
    removedCaption: 'These stopped showing up: either the teacher removed them or the class was archived. Nothing is lost, they just no longer count. If they come back, the mark clears itself.',
    removedBadge: 'gone',
    filterShowRemoved: 'show removed',
    mutedCaption: 'Assignments with no due date that you muted. Not urgent, but not lost either.',
    announcementsCaption: 'Posts from teachers. Automatic "new assignment" notices are filtered out.',
    transcriptsCaption: 'Room for video breakdowns — coming later.',
    noAnnouncements: 'Nothing yet. Teacher posts from class streams will show up here.',

    newLabel: 'new',
    notUrgent: 'not urgent',
    mutedBadge: 'muted',
    restoredBadge: 'restored',
    hide: 'hide',
    restore: 'restore',
    showHidden: 'show hidden',
    hideAgain: 'hide again',
    expand: 'expand',
    collapse: 'collapse',
    openInClassroom: 'open in Classroom',
    confirmRemove: 'Remove from the overdue list?',
    confirmRemoveHint: 'You can restore it with the button at the bottom of this section.',

    filterClass: 'Class',
    filterType: 'Type',
    filterDue: 'Due',
    filterHidden: 'Hidden',
    filterTodayTomorrow: 'today and tomorrow',
    filterWeek: 'this week',
    filterMonth: 'this month',
    filterOverdue: 'overdue',
    filterNoDueDate: 'no due date',
    filterShowHiddenMuted: 'show muted and hidden',
    filterNewOnly: 'new only',
    filterResetAll: 'reset all',
    filterShowingCount: 'showing:',

    settingsTitle: 'Settings',
    settingsReveal: 'Show',
    settingsEmail: 'School email',
    settingsEmailHint: 'used in assignment links',
    settingsCanvas: 'Canvas address',
    settingsCanvasHint: 'empty — Canvas is skipped',
    settingsLanguage: 'Language',
    settingsHours: 'Digest hours',
    settingsHoursHint: 'comma separated',
    settingsExclusions: 'Skip classes',
    settingsExclusionsHint: 'names, comma separated; empty means read all',
    settingsExclusionsCheckboxHint: 'tick the ones to skip',
    settingsOf: 'of',
    settingsSave: 'Save',
    settingsSaving: 'Saving…',
    settingsSaveFailed: 'Save failed',
    settingsSaved: 'Saved. Checking now — about 20 seconds…',
    settingsClose: 'close',
    settingsTreatUndated: 'No due date counts as urgent',
    settingsTreatUndatedHint: 'turn off to show these once instead, like materials',
    settingsShowEmpty: 'Show classes with nothing due',
    settingsShowEmptyHint: 'otherwise a class with nothing going on right now just disappears from the list',

    emptyState: 'Nothing due and nothing new. You can relax.',
    stillReading: 'Still reading:',
    fromMemoryNotice: 'Showing data from the previous run for now.',
    couldNotRead: 'Could not read:',
    footerNote: 'Collected by a plain script, no model involved. Click an assignment to open it in Classroom.',

    noDueDateNote: 'no due date at all — treating as: by tomorrow',
    placeholderDateNote: 'placeholder due date (2031 and the like) — treating as: by tomorrow',

    today: 'today',
    tomorrow: 'tomorrow',
    inDays: n => `in ${n} ${n === 1 ? 'day' : 'days'}`,
    overdueByDays: n => `${n} ${n === 1 ? 'day' : 'days'} overdue`,
    lateByDays: n => `${n} ${n === 1 ? 'day' : 'days'} late`,

    schoolLabel: 'School',
    courseOpened: 'Course opened:',
    openDigestHint: 'open the digest',
    signInRequired: 'sign-in required',
    signInRequiredHint: 'Google signed the browser out. Run: node 05-playwright-draft.js --login',
    noDueDateSet: 'no due date set',
    countNew: n => `${n} new`,
    countCourses: n => `${n} new ${n === 1 ? 'course' : 'courses'}`,
    countPosts: n => `${n} ${n === 1 ? 'post' : 'posts'}`,
    countDue: n => `${n} due`,
  },
};

/**
 * Russian numeral endings: 1 новое, 2 новых, 5 новых.
 * English doesn't need this — singular and plural cover it there.
 */
function pluralizeRu(n, one, few, many) {
  const h = n % 100;
  if (h >= 11 && h <= 14) return many;
  const l = n % 10;
  return l === 1 ? one : (l >= 2 && l <= 4 ? few : many);
}

function detectLanguage() {
  const args = process.argv;
  const i = args.indexOf('--language');
  if (i !== -1 && args[i + 1] && DICTIONARIES[args[i + 1]]) return args[i + 1];

  // Settings first, then the old language.txt — kept around for anyone
  // who already has one. New setups don't need to create it.
  try {
    const from = require('./19-settings.js').read().language;
    if (DICTIONARIES[from]) return from;
  } catch { /* no settings — keep looking */ }

  if (fs.existsSync(LANGUAGE_FILE)) {
    try {
      const code = fs.readFileSync(LANGUAGE_FILE, 'utf8').trim().toLowerCase();
      if (DICTIONARIES[code]) return code;
    } catch { /* couldn't read it — Russian */ }
  }
  return 'ru';
}

let language = detectLanguage();
let dictionary = DICTIONARIES[language];

/**
 * Translate by key. If the key exists in neither dictionary, return the
 * key itself.
 *
 * WHY NOT THROW: a forgotten key should look like an odd label on the
 * page, not a crashed collection run. A missing word is something a
 * person will notice and mention; a silently broken system is worse.
 */
function t(key, ...args) {
  const value = dictionary[key] !== undefined ? dictionary[key] : DICTIONARIES.ru[key];
  if (value === undefined) return key;
  return typeof value === 'function' ? value(...args) : value;
}

function setLanguage(code) {
  if (!DICTIONARIES[code]) return false;
  language = code;
  dictionary = DICTIONARIES[code];
  return true;
}

const currentLanguage = () => language;
const locale = () => t('locale');

module.exports = { t, setLanguage, currentLanguage, locale, pluralizeRu, DICTIONARIES };
