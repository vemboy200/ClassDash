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
    title: 'ClassDash',
    updated: 'обновлено',
    refreshLabel: 'Обновить',
    refreshHint: 'Перечитать страницу — без новой проверки',
    freshCheckLabel: 'Свежая проверка',
    freshCheckHint: 'Проверить всё заново, включая Edpuzzle — займёт около минуты',
    stopLabel: 'Стоп',
    stopCheckHint: 'Остановить текущую проверку',
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
    reminders: 'Напоминания',
    reminderCaption: 'Свои собственные — учитель что-то сказал в классе, а ClassDash об этом никогда не узнает. Сделано — исчезает через 7 дней; скрыто — остаётся, пока не вернёшь.',
    reminderTitlePlaceholder: 'Что сказал учитель…',
    reminderClassPlaceholder: 'Класс (необязательно)',
    reminderDueHint: 'Срок (необязательно)',
    reminderDueClear: 'Убрать срок',
    reminderEdit: 'изменить',
    reminderCancelEdit: 'отмена',
    reminderSave: 'Сохранить',
    reminderSaving: 'сохраняю…',
    reminderAdd: 'Добавить',
    reminderNoDue: 'без срока',
    reminderPlatform: 'Напоминание',
    reminderDone: 'сделано',
    reminderUndo: 'вернуть',
    reminderDelete: 'удалить',
    reminderShowDone: 'показать сделанные',
    confirmDeleteReminder: 'Удалить напоминание насовсем? Это не отменить.',
    reminderTitleRequired: 'нужен текст',
    reminderAdding: 'добавляю…',
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
    // Sidebar section labels — settingsAdvanced above doubles as the
    // fourth one, it already said exactly this before the sidebar existed.
    settingsSectionAccount: 'Аккаунт',
    settingsSectionDisplay: 'Отображение',
    settingsSectionApi: 'Домашний API',
    settingsSectionFetching: 'Проверки',
    settingsReveal: 'Показать',
    settingsSources: 'Источники',
    settingsSourcesNone: 'ничего не выбрано',
    teacherLabel: 'Учитель',
    settingsSourcesHint: 'отметьте то, что использует ваша школа',
    settingsClassroomEnabled: 'Google Classroom',
    settingsClassroomEnabledHint: 'нужен браузер: ClassDash входит в школьный аккаунт Google через него. Выключите, если школа не использует Classroom',
    settingsCanvasSsoEnabled: 'Canvas — вход через Google',
    settingsCanvasSsoEnabledHint: 'читает Canvas через браузер, под вашим школьным аккаунтом Google — поэтому тоже нужен браузер. Если ниже включён и заполнен Canvas API, это только запасной вариант: он сработает, когда API прочитать не удалось (например, токен истёк)',
    settingsCanvasApiEnabled: 'Canvas — API (токен доступа)',
    settingsCanvasApiEnabledHint: 'читает Canvas по токену доступа — без браузера и входа. Токен создаётся в Canvas → Учётная запись → Настройки → «Новый токен доступа». У токена есть срок действия — когда он истечёт, создайте новый',
    settingsEmail: 'Школьная почта',
    settingsEmailHint: 'подставляется в ссылки на задания',
    settingsCanvas: 'Адрес Canvas',
    settingsCanvasHint: 'адрес школьного Canvas — нужен для любого способа. Пусто — Canvas не читается',
    settingsCanvasToken: 'Токен доступа Canvas',
    settingsCanvasTokenHint: 'вставьте токен целиком — Canvas показывает его только один раз',
    settingsAccount: 'Номер аккаунта Google',
    settingsAccountHint: 'если в браузере несколько аккаунтов Google — какой из них использовать, обычно 0',
    settingsLanguage: 'Язык',
    settingsHours: 'Часы полной сводки',
    settingsHoursHint: 'через запятую',
    settingsExclusions: 'Не читать классы',
    settingsExclusionsHint: 'имена через запятую, пусто — читать все',
    settingsExclusionsCheckboxHint: 'отметь те, что читать не надо',
    settingsOf: 'из',
    settingsSaving: 'Сохраняю…',
    settingsSaveFailed: 'Не удалось сохранить',
    settingsSaved: 'Сохранено.',
    settingsDone: 'Готово',
    pendingFetchText: 'Часть настроек вступит в силу после проверки.',
    pendingFetchNow: 'Проверить сейчас',
    pendingFetchStarting: 'Проверяю…',
    progressChecking: 'Проверяю',
    progressStarting: 'Запускаю…',
    progressFinishing: 'Заканчиваю…',
    settingsTreatUndated: 'Без срока — считать срочным',
    settingsTreatUndatedHint: 'выключи, чтобы такие задания просто показывались один раз, как материалы',
    settingsShowEmpty: 'Показывать классы без заданий',
    settingsShowEmptyHint: 'иначе класс, где сейчас ничего не горит, просто пропадает из списка',
    settingsHideInactive: 'Скрывать классы без истории',
    settingsHideInactiveHint: 'класс, где никогда не было ни заданий, ни объявлений — не «сейчас тихо», а вообще ничего не было',
    settingsSkipStale: 'Пропускать неактивные классы',
    settingsSkipStaleHint: 'класс без заданий и объявлений дольше срока ниже — считается закрытым и больше не проверяется',
    settingsStaleMonths: 'Срок неактивности',
    settingsStaleMonthsHint: 'сколько классу можно молчать, прежде чем его пометят неактивным',
    settingsKeyHints: 'Показывать подсказки клавиш',
    settingsKeyHintsHint: 'маленькая клавиша рядом с каждым фильтром и подсказки на кнопках. Сами сочетания клавиш работают в любом случае',
    // "мес." — an abbreviation, not "месяц/месяца/месяцев" — sidesteps
    // Russian's three plural forms entirely, same trick lateByDays
    // already uses below with "дн." instead of "день/дня/дней". Plain
    // strings, not a function like lateByDays: this exact label also
    // has to be built client-side, live, as the slider moves — see
    // WORDS.monthWord/monthsWord in 08-page.js.
    monthWord: 'мес.',
    monthsWord: 'мес.',
    settingsApiEnabled: 'Включить домашний API',
    settingsApiEnabledHint: 'локальный HTTPS-сервер для других устройств (например, Home Assistant) — с шифрованием и ключом',
    settingsApiNetwork: 'Доступ по локальной сети',
    settingsApiNetworkHint: 'включено по умолчанию — иначе с других устройств (например, Home Assistant) до него не достучаться. Защищено ключом и шифрованием, но открывайте только в сети, которой доверяете',
    settingsApiRunning: '(запущен)',
    settingsApiNotRunning: '(не запущен)',
    settingsApiToken: 'Ключ доступа',
    settingsApiTokenHint: 'вставьте этот ключ в настройки клиента, который будет читать этот API',
    settingsApiFingerprint: 'Отпечаток сертификата',
    settingsApiFingerprintHint: 'сертификат самоподписанный — клиент должен доверять именно этому отпечатку, а не любому сертификату',
    settingsApiNotGenerated: 'ещё не создан',
    settingsCopy: 'Скопировать',
    settingsCopied: 'Скопировано',
    settingsRoll: 'Обновить',
    confirmRollToken: 'Создать новый ключ?',
    confirmRollTokenHint: 'Старый ключ перестанет работать сразу — всё, что уже настроено с ним (например, интеграция в Home Assistant), нужно будет обновить.',
    settingsEdpuzzleEnabled: 'Edpuzzle',
    settingsEdpuzzleEnabledHint: 'нужен браузер: Edpuzzle читается только через настоящее окно браузера, которое открывается во время полной проверки. Выключите, если учителя и так дублируют задания Edpuzzle через Google Classroom',
    settingsFreshCheckAwake: 'Свежая проверка — экран включён (мин.)',
    settingsFreshCheckAwakeHint: '0 — выключено, иначе не меньше 10 минут. Открывает окно браузера (Edpuzzle) и занимает около минуты сама по себе, поэтому пока кто-то может быть за компьютером — с осторожностью',
    settingsFreshCheckAsleep: 'Свежая проверка — экран выключен (мин.)',
    settingsFreshCheckAsleepHint: '0 — выключено, иначе не меньше 10 минут. Никто не смотрит на экран, но это всё ещё настоящий запуск браузера — раз в 5 минут часами подряд реально перегружало систему на практике. На ноутбуке от батареи чаще проверки быстрее сажают её, пока никто не видит',
    settingsFreshCheckCharging: 'Только от сети',
    settingsFreshCheckChargingHint: 'применяется к обеим настройкам выше. На настольном компьютере без батареи ничего не меняет — он всегда «от сети»',
    checkStatusOk: 'ОК',
    checkStatusFallback: 'Запасной способ',
    checkStatusProblem: 'Проблема',
    checkStatusUnknown: 'Неизвестно',
    checkStatusNeverChecked: 'ещё не проверялось',
    checkStatusTitle: 'Статус проверки',
    updateAvailable: 'Доступно обновление',
    updateCurrentlyRunning: 'сейчас установлена',
    updateViewRelease: 'Открыть релиз',
    updateDismiss: 'Скрыть',
    updateCheckFailed: 'Проверка обновлений не удалась',
    setupIncomplete: 'Настройка не завершена',
    setupIncompleteHint: 'Укажи свою школьную почту (и адрес Canvas, если он используется) в настройках.',
    setupOpenSettings: 'Открыть настройки',
    signInNeeded: 'Похоже, нужно снова войти — сессия истекла.',
    signInNow: 'Войти',
    signInOpening: 'Открываю окно входа…',
    signInFailed: 'не удалось открыть окно входа',
    settingsAdvanced: 'Дополнительно',
    settingsClassTimeout: 'Таймаут класса (мс)',
    settingsClassTimeoutHint: 'сколько ждать загрузки страницы обычного класса',
    settingsEmptyTimeout: 'Таймаут пустого класса (мс)',
    settingsEmptyTimeoutHint: 'короче обычного — для классов, где никогда не было заданий',
    settingsPassLimit: 'Предел одного прохода (мс)',
    settingsPassLimitHint: 'проход длиннее этого считается зависшим и прерывается',
    settingsBrowserPath: 'Путь к браузеру',
    settingsBrowserPathHint: 'какой браузер запускать. Пусто — собственный Brave ClassDash, если он установлен, иначе Chrome. Обычно менять не нужно, см. README',
    settingsBrowserPathDefault: 'по умолчанию — Brave от ClassDash, иначе Chrome',
    settingsBrowserPathChoose: 'Выбрать приложение…',
    settingsBrowserPathClear: 'Сбросить',
    settingsSetup: 'Настройка',
    settingsSetupBrowser: 'Браузер',
    settingsSetupBrowserButton: 'Выбрать браузер…',
    settingsSetupBrowserNow: 'сейчас',
    settingsSetupBrowserHint: 'Установить Brave, использовать Chrome или выбрать другой. Нужен для Google Classroom, Edpuzzle и входа в Canvas через Google',
    settingsSetupSignIn: 'Вход',
    settingsSetupSignInButton: 'Войти…',
    settingsSetupSignInHint: 'открывает окно браузера, где вы входите в школьный аккаунт Google. Вход сохраняется на несколько недель; когда он истечёт, ClassDash скажет об этом',
    browserOwnBrave: 'Brave (установлен ClassDash)',
    browserSystemChrome: 'Google Chrome (системный)',

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
    signInRequiredHint: 'Google разлогинил браузер. Открой ClassDash → Настройки → «Вход…».',
    noDueDateSet: 'срок не проставлен',
    countNew: n => `${n} ${pluralizeRu(n, 'новое', 'новых', 'новых')}`,
    countCourses: n => `${n} ${pluralizeRu(n, 'новый курс', 'новых курса', 'новых курсов')}`,
    countPosts: n => `${n} ${pluralizeRu(n, 'сообщение', 'сообщения', 'сообщений')}`,
    countDue: n => `${n} горит`,
  },

  en: {
    locale: 'en-US',

    title: 'ClassDash',
    updated: 'updated',
    refreshLabel: 'Refresh',
    refreshHint: 'Rereads the page — no new check',
    freshCheckLabel: 'Fresh check',
    freshCheckHint: 'Checks everything again, Edpuzzle included — takes about a minute',
    stopLabel: 'Stop',
    stopCheckHint: 'Stop the check that\'s running',
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
    reminders: 'Reminders',
    reminderCaption: "Your own — a teacher said something in class, and ClassDash would never know. Done ones clear themselves after 7 days; hidden ones stay hidden until you bring them back.",
    reminderTitlePlaceholder: 'What the teacher said…',
    reminderClassPlaceholder: 'Class (optional)',
    reminderDueHint: 'Due (optional)',
    reminderDueClear: 'Clear due date',
    reminderEdit: 'edit',
    reminderCancelEdit: 'cancel',
    reminderSave: 'Save',
    reminderSaving: 'saving…',
    reminderAdd: 'Add',
    reminderNoDue: 'no due date',
    reminderPlatform: 'Reminder',
    reminderDone: 'done',
    reminderUndo: 'undo',
    reminderDelete: 'delete',
    reminderShowDone: 'show done',
    confirmDeleteReminder: "Delete this reminder for good? This can't be undone.",
    reminderTitleRequired: 'needs some text',
    reminderAdding: 'adding…',
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
    settingsSectionAccount: 'Account',
    settingsSectionDisplay: 'Display',
    settingsSectionApi: 'Home API',
    settingsSectionFetching: 'Checking',
    settingsReveal: 'Show',
    settingsSources: 'Sources',
    settingsSourcesNone: 'nothing selected',
    teacherLabel: 'Teacher',
    settingsSourcesHint: 'tick what your school uses',
    settingsClassroomEnabled: 'Google Classroom',
    settingsClassroomEnabledHint: "needs a browser — ClassDash signs in to your school Google account through one. Turn off if your school doesn't use Classroom",
    settingsCanvasSsoEnabled: 'Canvas — Google sign-in',
    settingsCanvasSsoEnabledHint: "reads Canvas through the browser, signed in with your school Google account, so it needs a browser too. If Canvas API below is on and filled in, this is only the fallback: it's used when the API can't be read (an expired token, say)",
    settingsCanvasApiEnabled: 'Canvas — API (access token)',
    settingsCanvasApiEnabledHint: "reads Canvas with an access token — no browser or sign-in. Make one in Canvas → Account → Settings → New Access Token. A token expires, so make a new one when it does",
    settingsEmail: 'School email',
    settingsEmailHint: 'used in assignment links',
    settingsCanvas: 'Canvas address',
    settingsCanvasHint: "your school's Canvas address — needed for either way. Empty — Canvas is skipped",
    settingsCanvasToken: 'Canvas access token',
    settingsCanvasTokenHint: "paste the whole token — Canvas only shows it once",
    settingsAccount: 'Google account number',
    settingsAccountHint: 'if the browser has more than one Google account signed in, which one to use — usually 0',
    settingsLanguage: 'Language',
    settingsHours: 'Digest hours',
    settingsHoursHint: 'comma separated',
    settingsExclusions: 'Skip classes',
    settingsExclusionsHint: 'names, comma separated; empty means read all',
    settingsExclusionsCheckboxHint: 'tick the ones to skip',
    settingsOf: 'of',
    settingsSaving: 'Saving…',
    settingsSaveFailed: 'Save failed',
    settingsSaved: 'Saved.',
    settingsDone: 'Done',
    pendingFetchText: 'Some of your settings take effect after a fresh check.',
    pendingFetchNow: 'Check now',
    pendingFetchStarting: 'Checking…',
    progressChecking: 'Checking',
    progressStarting: 'Starting…',
    progressFinishing: 'Finishing…',
    settingsTreatUndated: 'No due date counts as urgent',
    settingsTreatUndatedHint: 'turn off to show these once instead, like materials',
    settingsShowEmpty: 'Show classes with nothing due',
    settingsShowEmptyHint: 'otherwise a class with nothing going on right now just disappears from the list',
    settingsHideInactive: 'Hide classes with no history',
    settingsHideInactiveHint: "a class with no assignment and no announcement ever — not just quiet right now, genuinely nothing recorded",
    settingsSkipStale: 'Skip inactive classes',
    settingsSkipStaleHint: "a class with no assignment or announcement longer than the setting below is treated as done, and stops being checked",
    settingsStaleMonths: 'How long counts as inactive',
    settingsStaleMonthsHint: 'how long a class can go quiet before it gets marked inactive',
    settingsKeyHints: 'Show shortcut keys',
    settingsKeyHintsHint: "the small key beside each filter, and the shortcut in the header buttons' tooltips. The shortcuts themselves work either way",
    monthWord: 'month',
    monthsWord: 'months',
    settingsApiEnabled: 'Enable home API',
    settingsApiEnabledHint: 'a local HTTPS server for other devices (e.g. Home Assistant) — encrypted, with its own key',
    settingsApiNetwork: 'Allow LAN access',
    settingsApiNetworkHint: "on by default — otherwise other devices (like Home Assistant) can't reach it at all. Still protected by the key and encryption, but only open this to a network you actually trust",
    settingsApiRunning: '(running)',
    settingsApiNotRunning: '(not running)',
    settingsApiToken: 'Access key',
    settingsApiTokenHint: "paste this into the settings of whatever client will be reading this API",
    settingsApiFingerprint: 'Certificate fingerprint',
    settingsApiFingerprintHint: "the certificate is self-signed — a client should trust exactly this fingerprint, not just any certificate",
    settingsApiNotGenerated: 'not generated yet',
    settingsCopy: 'Copy',
    settingsCopied: 'Copied',
    settingsRoll: 'Roll',
    confirmRollToken: 'Generate a new key?',
    confirmRollTokenHint: "The old one stops working immediately — anything already configured with it (like a Home Assistant integration) will need updating.",
    settingsEdpuzzleEnabled: 'Edpuzzle',
    settingsEdpuzzleEnabledHint: "needs a browser — Edpuzzle can only be read through a real browser window, which opens during a full check. Turn off if teachers already post Edpuzzle assignments through Google Classroom too",
    settingsFreshCheckAwake: 'Fresh check while awake (minutes)',
    settingsFreshCheckAwakeHint: "0 disables it, otherwise at least 10 minutes. Opens a browser window for Edpuzzle and takes about a minute on its own, so this runs while someone might actually be at the computer — go easy on it",
    settingsFreshCheckAsleep: 'Fresh check while asleep (minutes)',
    settingsFreshCheckAsleepHint: "0 disables it, otherwise at least 10 minutes. Nobody's looking at the screen, but it's still a real browser launch every time — every 5 minutes for a few hours straight genuinely overloaded a real system. On a laptop running on battery, more frequent checks here also mean more battery drain while nobody's around to notice it happening",
    settingsFreshCheckCharging: 'Only while charging',
    settingsFreshCheckChargingHint: "Applies to both settings above. On a desktop with no battery this changes nothing — it's always \"on AC\"",
    checkStatusOk: 'OK',
    checkStatusFallback: 'Fallback',
    checkStatusProblem: 'Problem',
    checkStatusUnknown: 'Unknown',
    checkStatusNeverChecked: 'never checked yet',
    checkStatusTitle: 'Check status',
    updateAvailable: 'Update available',
    updateCurrentlyRunning: 'currently running',
    updateViewRelease: 'View release',
    updateDismiss: 'Dismiss',
    updateCheckFailed: 'Update check failed',
    setupIncomplete: 'Setup isn\'t finished',
    setupIncompleteHint: 'Add your school email (and Canvas address, if your school uses it) in Settings.',
    setupOpenSettings: 'Open Settings',
    signInNeeded: 'Looks like you need to sign in again — your session expired.',
    signInNow: 'Sign in',
    signInOpening: 'Opening sign-in window…',
    signInFailed: "couldn't open the sign-in window",
    settingsAdvanced: 'Advanced',
    settingsClassTimeout: 'Class timeout (ms)',
    settingsClassTimeoutHint: 'how long to wait for an ordinary class page to load',
    settingsEmptyTimeout: 'Empty class timeout (ms)',
    settingsEmptyTimeoutHint: 'shorter than the above — for classes that never had any assignments',
    settingsPassLimit: 'Pass time limit (ms)',
    settingsPassLimitHint: 'a collection pass longer than this is treated as hung and stopped',
    settingsBrowserPath: 'Browser path',
    settingsBrowserPathHint: "which browser gets used. Empty — ClassDash's own Brave if it's installed, otherwise Chrome. Leave it unless you know why you need this, see the README",
    settingsBrowserPathDefault: "default — ClassDash's own Brave, else Chrome",
    settingsBrowserPathChoose: 'Choose App…',
    settingsBrowserPathClear: 'Clear',
    settingsSetup: 'Setup',
    settingsSetupBrowser: 'Browser',
    settingsSetupBrowserButton: 'Choose Browser…',
    settingsSetupBrowserNow: 'currently',
    settingsSetupBrowserHint: "Install Brave, use Chrome, or pick another. Needed for Google Classroom, Edpuzzle and Canvas Google sign-in",
    settingsSetupSignIn: 'Sign in',
    settingsSetupSignInButton: 'Sign In…',
    settingsSetupSignInHint: "opens a browser window where you sign in to your school Google account. The sign-in lasts a few weeks; ClassDash tells you when it runs out",
    browserOwnBrave: "Brave (installed by ClassDash)",
    browserSystemChrome: 'Google Chrome (system)',

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
    signInRequiredHint: 'Google signed the browser out. Open ClassDash → Settings → Account → Setup → Sign In…',
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
