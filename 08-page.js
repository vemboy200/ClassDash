/**
 * Builds the summary page.
 *
 * The page is written WHOLE AND AT THE END of a pass, never appended to
 * one assignment at a time. If it were appended along the way, crashing
 * halfway through would leave half a page that looks like a real summary.
 * This way the file is either old-and-correct or new-and-correct, never
 * a half-finished draft.
 *
 * There's no model here. This is an ordinary program that prints HTML.
 * Opened by clicking the notification popup.
 */

const fs = require('fs');
const { t, locale } = require('./18-language.js');
const { read: readSettings, appliedFetchSettings, pendingFetchKeys } = require('./19-settings.js');
const path = require('path');
// The API's token/fingerprint aren't settings — nothing here writes
// them, 23-api-security.js is the only writer — just values this page
// reads at redraw time to show in the panel. See that file's own
// comment on why it exists separately from 17-api.js.
const { currentToken, certFingerprint, isServerRunning } = require('./23-api-security.js');
const virtualAssignments = require('./24-virtual-assignments.js');
const { isClassStale } = require('./22-class-activity.js');
const { checkStatus } = require('./25-check-status.js');
const { publishPageVersion } = require('./28-live-state.js');
const { readUpdateStatus } = require('./26-update-check.js');

// THE HEADER ICONS ARE PIXEL ART, NOT TEXT CHARACTERS.
//
// Refresh, Fresh check and Settings used to be a Unicode arrow, an SF
// Symbol render and a Unicode gear — three different styles, none of them
// pixel art. They're now three 32x32 PNGs drawn to match the app icon,
// committed next to AppIcon.icns. (The gear was drawn twice: the first,
// with 1px gaps between its teeth, turned into a sunburst at 16px, where
// those gaps merge — it had to be drawn for the size it's shown at. It was
// 31x31, padded here to 32 so it scales by a whole 2:1 like the others.)
// Each is used only as a stencil (see
// .pixel-icon): the page ignores its colour and paints the shape with the
// button's own text colour, so one file serves dark and light mode and
// every hover and spinning state. Drawn at 32px and shown at exactly 16 —
// a whole 2:1 — so every art pixel lands on a whole device pixel on a
// Retina display and stays crisp. Read once at module load, not per page
// render: they're static assets.
const readIcon = name => fs.readFileSync(path.join(__dirname, name)).toString('base64');
const ICON_REFRESH_B64 = readIcon('refresh-icon.png');
const ICON_FRESHCHECK_B64 = readIcon('freshcheck-icon.png');
const ICON_SETTINGS_B64 = readIcon('settings-icon.png');
// Two 32x32 frames side by side (64x32): the app icon, then the same with its
// speed-dashes swapped long-for-short. Flipped between while a check runs —
// see .check-progress-icon. Full colour, so a background image, not a stencil.
// The dashes are drawn white, which is invisible on the light theme's near-
// white page, so there are two copies: loading-icon.png as drawn (dark theme)
// and loading-icon-light.png, identical except that the dashes — and only the
// dashes — are the light theme's ink colour.
const ICON_LOADING_B64 = readIcon('loading-icon.png');
const ICON_LOADING_LIGHT_B64 = readIcon('loading-icon-light.png');

// Substituted when an assignment has no platform of its own — that's how
// Classroom assignments arrive. Canvas and Edpuzzle have their own field.
const DEFAULT_PLATFORM = 'Google Classroom';

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Difference in CALENDAR days, not in hour-counted 24-hour periods.
 *
 * This used to be `Math.round((due - now) / 864e5)` everywhere — divide
 * by a day's worth of milliseconds and round. That asks the wrong
 * question: "how many hours are left" instead of "which day is this".
 *
 * What that produced (caught on August 24th at 21:25): an assignment due
 * TOMORROW at 8am was labeled "today" — ten hours away, less than half a
 * day, and rounding gave zero. The same way, one due the day after
 * tomorrow at 8:30 was called "tomorrow". In the evening, exactly when you
 * sit down to do homework, every morning-due card was wrong.
 *
 * Fixed by shifting both dates to midnight: then the difference is between
 * DAYS, not between instants. Rounding is kept for daylight saving time —
 * some days there have 23 or 25 hours.
 */
function daysUntil(from, to) {
  const d0 = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const d1 = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((d1 - d0) / 864e5);
}

/** "in 3 days", "today", "tomorrow", "2 days overdue" */
function when(due, now) {
  const days = daysUntil(now, due);
  if (days < 0) return t('overdueByDays', -days);
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  return t('inDays', days);
}

function itemCard(x, now, isFresh, section) {
  // Same trap as in 05-...js: Classroom's due date arrives as text, while
  // Canvas and Edpuzzle have no text field at all — only the machine one.
  // Touching x.due without checking crashed the whole script.
  const dueText = x.due
    ? x.due.replace(/^Due\s+/, '')
    : (x.due_at
        ? x.due_at.toLocaleString(locale(),
            { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '');

  const due = x.note
    ? t(x.note)
    : (x.due_at ? `${dueText} · ${when(x.due_at, now)}` : '');

  // target="_blank" — open in a new tab, not over the summary page:
  // otherwise going back loses your place in the list.
  // rel="noopener" — a technical detail, so the opened page can't get
  // a handle back to this one.
  const href = x.link
    ? ` href="${escapeHtml(x.link)}" target="_blank" rel="noopener"`
    : '';
  const tag = x.link ? 'a' : 'div';

  // The "not urgent" button — only for assignments the teacher never gave
  // a due date, which is why they count as due-soon. Clicking it goes to
  // the notifier via a napominalka:// link, which writes the id to disk.
  // The page itself can't write anything — the browser won't allow it.
  // Compared against the KEY, not the phrase: see the comment in
  // 18-language.js.
  //
  // A muted item gets the opposite button — "restore". This button used
  // to not exist at all, and muting was only undoable by hand in a
  // `not-urgent.txt` file: hidden overdue items could be restored, muted
  // ones couldn't. Asymmetric and inconvenient.
  const button = x.muted
    ? `\n        <a class="quiet" href="napominalka://unquiet/${escapeHtml(x.id)}"
           onclick="restoreUrgency(event, this)">${escapeHtml(t('restore'))}</a>`
    : (x.note === 'noDueDateNote')
      ? `\n        <a class="quiet" href="napominalka://quiet/${escapeHtml(x.id)}"
           onclick="muteItem(event, this)">${escapeHtml(t('notUrgent'))}</a>`
      : '';

  // Invisible tags for the filters. Names are Latin on purpose: code
  // inside the page will address them, and it doesn't behave consistently
  // everywhere with Cyrillic names.
  //
  // data-days — how many days until due: negative means overdue, "none"
  // means there's no due date at all. Computed here, not in the browser,
  // because "now" at the moment the page is built is known here.
  const days = x.due_at ? daysUntil(now, x.due_at) : 'none';
  const tags = ` data-cls="${escapeHtml(x.class)}"` +
                  ` data-type="${escapeHtml(x.type || '')}"` +
                  ` data-days="${days}"` +
                  ` data-removed="${x.removed ? 'yes' : 'no'}"` +
                  ` data-sect="${escapeHtml(section || '')}"`;

  return `      <div class="row${x.removed ? ' gone' : ''}"${tags}>
      <${tag}${href} class="item${isFresh ? ' new' : ''}">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(x.platform || DEFAULT_PLATFORM)}</span>
          <span class="cls">${escapeHtml(x.class)}</span>
          ${due ? `<span class="due">${escapeHtml(due)}</span>` : ''}
          ${isFresh ? `<span class="badge">${escapeHtml(t('newLabel'))}</span>` : ''}
          ${x.removed ? `<span class="removed-badge">${escapeHtml(t('removedBadge'))}</span>` : ''}
        </div>
      </${tag}>${button}
      </div>`;
}

/**
 * Right column: announcements from Classroom streams.
 *
 * ALL of them are shown, not just new ones — unlike materials. Reason: an
 * announcement stays relevant for weeks ("field trip on the 20th, bring
 * the permission slip"), and hiding it after the first view would be wrong.
 * New ones are just marked.
 */
function announcementsSection(announcements, freshIds) {
  if (!announcements.length) {
    return `    <section>
      <h2>${escapeHtml(t('announcements'))}</h2>
      <p class="hint">${escapeHtml(t('noAnnouncements'))}</p>
    </section>`;
  }

  // The card isn't one big link, it's a block with buttons. Otherwise
  // clicking "expand" would navigate to Classroom instead of expanding
  // the text.
  const cards = announcements.map(p => {
    const isFresh = freshIds.has(p.id);
    return `      <div class="post" data-cls="${escapeHtml(p.class)}" data-new="${isFresh ? 'yes' : 'no'}">
        <div class="post-top">
          <span class="cls">${escapeHtml(p.class)}</span>
          <span>${escapeHtml(p.author || '')}</span>
          ${p.date ? `<span>${escapeHtml(p.date)}</span>` : ''}
          ${isFresh ? `<span class="badge">${escapeHtml(t('newLabel'))}</span>` : ''}
        </div>
        <div class="text collapsed">${escapeHtml(p.text || p.title || '')}</div>
        <div class="actions">
          <button class="expand-btn" onclick="expandPost(this)" hidden>${escapeHtml(t('expand'))}</button>
          <a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${escapeHtml(t('openInClassroom'))}</a>
        </div>
      </div>`;
  }).join('\n');

  // Its own scroll area: without it, nineteen announcements stretch the
  // page so far that the assignments on the left get lost somewhere up top.
  // Checkboxes by class plus "new only". Separate from the main panel:
  // announcements have no due date or type, and the general filters don't
  // apply to them.
  const counts = new Map();
  for (const p of announcements) counts.set(p.class, (counts.get(p.class) || 0) + 1);
  const byClass = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  const freshCount = announcements.filter(p => freshIds.has(p.id)).length;

  const checkRow = (group, value, label, count, id) =>
    `        <label class="check-row"><input type="checkbox"` +
    // A lone id (no group/value) means this one isn't part of a
    // multi-select set — "new only" is its own single yes/no, same as
    // the two "show hidden/removed" filters, so it gets the toggle look
    // instead of the checkbox one.
    (id ? ` id="${id}" class="toggle"` : ` data-group="${group}" value="${escapeHtml(value)}"`) +
    ` onchange="filterAnnouncements()">` +
    `<span class="label-text">${escapeHtml(label)}</span>` +
    `<span class="count-badge">${count}</span></label>`;

  const checkboxes = byClass.map(([c, n]) => checkRow('post-cls', c, c, n));
  if (freshCount) checkboxes.push(checkRow(null, null, t('filterNewOnly'), freshCount, 'f-post-new'));

  const bar = byClass.length > 1 || freshCount
    ? `      <div class="announcement-filters">\n${checkboxes.join('\n')}\n      </div>`
    : '';

  return `    <section>
      <h2>${escapeHtml(t('announcements'))} <span class="count announcements-count">${announcements.length}</span></h2>
      <p class="hint">${escapeHtml(t('announcementsCaption'))}</p>
${bar}
      <div class="feed">
${cards}
      </div>
    </section>`;
}

/**
 * Reminders — virtual assignments the user typed in themselves. See
 * 24-virtual-assignments.js's own header comment for what these are.
 *
 * Its own section, not folded into Due Soon/Ahead/Overdue: those three
 * are built around Classroom/Canvas/Edpuzzle assumptions (freshness
 * badges keyed to a diff against last collection, "hide" only existing
 * for overdue items) that don't fit something the user fully owns the
 * lifecycle of. One flat list instead — overdue-and-soonest-first,
 * undated ones last — with all three actions (done, hide, delete)
 * available on every card, since none of the due-date-bucket-specific
 * rules apply here.
 */
/** The reminders shown in the Reminders section right now: not done, not
 *  hidden — the same set remindersSection() renders as active cards.
 *  Separate so filtersPanel() can count them too. */
function activeReminderItems(now) {
  const { burning, later, overdue, undated } =
    virtualAssignments.bucketed(now, readSettings().treatUndatedAsUrgent);
  return [...overdue, ...burning, ...later, ...undated].filter(x => !x.hidden);
}

function remindersSection(now) {
  const settings = readSettings();
  const { burning, later, overdue, undated, done } =
    virtualAssignments.bucketed(now, settings.treatUndatedAsUrgent);
  const all = [...overdue, ...burning, ...later, ...undated];
  const active = all.filter(x => !x.hidden)
    .sort((a, b) => {
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at - b.due_at;
    });
  const hiddenItems = all.filter(x => x.hidden);

  const dueText = (x, kind) => {
    if (!x.due_at) return t('reminderNoDue');
    if (x.note) return t(x.note);
    const date = x.due_at.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    // A DONE reminder isn't overdue, however long ago it was due — "4
    // days overdue" next to something already completed read as if the
    // check-off hadn't taken. Just the date it was due.
    return kind === 'done' ? date : `${date} · ${when(x.due_at, now)}`;
  };

  const card = (x, kind) => {
    // Edit isn't offered for done ones — the add-form only has fields
    // for title/class/due, nothing to un-do "done" through, and that's
    // what the undo link right below is already for.
    const editLink = kind !== 'done'
      ? `<a class="quiet" href="#" onclick="return startEditReminder(event, this)">${escapeHtml(t('reminderEdit'))}</a>`
      : '';
    const actions = kind === 'done'
      ? `<a class="quiet" href="#" onclick="return virtualAction(event, 'virtualUndone', '${escapeHtml(x.id)}')">${escapeHtml(t('reminderUndo'))}</a>`
      : kind === 'hidden'
        ? editLink + `<a class="quiet" href="#" onclick="return virtualAction(event, 'virtualUnhide', '${escapeHtml(x.id)}')">${escapeHtml(t('restore'))}</a>`
        : editLink +
          `<a class="quiet" href="#" onclick="return virtualAction(event, 'virtualDone', '${escapeHtml(x.id)}')">${escapeHtml(t('reminderDone'))}</a>` +
          `<a class="quiet quiet-faint" href="#" onclick="return virtualAction(event, 'virtualHide', '${escapeHtml(x.id)}')">${escapeHtml(t('hide'))}</a>` +
          `<a class="quiet quiet-faint" href="#" onclick="return virtualDeleteConfirm(event, '${escapeHtml(x.id)}')">${escapeHtml(t('reminderDelete'))}</a>`;
    // data-title/data-class/data-raw-due — read by startEditReminder()
    // to pre-fill the add form. data-raw-due specifically, not
    // x.due_at: due_at gets forced to "tomorrow" by treatUndatedAsUrgent
    // for a reminder that never had a real due date, and editing needs
    // the actual stored value, not that display-only stand-in.
    //
    // data-cls/data-type/data-days — the SAME attributes itemCard()
    // puts on a real assignment's row, so a reminder assigned to a
    // class actually participates in the main filter panel: hiding that
    // class hides this too, and its own class-count badge includes it.
    // Without these, applyFilters() had nothing to match against and
    // exempted every reminder from class filtering entirely — a
    // reminder for a hidden class stayed on screen regardless.
    const days = x.due_at ? daysUntil(now, x.due_at) : 'none';
    return `      <div class="row" data-id="${escapeHtml(x.id)}"
           data-title="${escapeHtml(x.title)}" data-class="${escapeHtml(x.class || '')}"
           data-raw-due="${escapeHtml(x.rawDue || '')}"
           data-cls="${escapeHtml(x.class || '')}" data-type="${escapeHtml(x.type || '')}"
           data-days="${days}">
      <div class="item">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(t('reminderPlatform'))}</span>
          ${x.class ? `<span class="cls">${escapeHtml(x.class)}</span>` : ''}
          <span class="due">${escapeHtml(dueText(x, kind))}</span>
        </div>
      </div>
      ${actions}
      </div>`;
  };

  // NOT .show-hidden-btn — that class is swept up globally by
  // applyFilters() (querySelectorAll('.show-hidden-btn') across the
  // WHOLE page, not scoped to one section), which calls refreshSection()
  // on whatever section it's in. refreshSection() counts .row.hidden-row
  // elements specifically, which these cards never use, so it would
  // force-hide this button on every filter change regardless of whether
  // there's actually anything hidden. Own class, own styling instead.
  const hiddenButton =
    `      <button class="reminder-toggle-btn"${hiddenItems.length ? '' : ' hidden'}
              id="reminders-hidden-btn" onclick="toggleReminderGroup('reminders-hidden')">${escapeHtml(t('showHidden'))} (${hiddenItems.length})</button>`;
  const doneButton =
    `      <button class="reminder-toggle-btn"${done.length ? '' : ' hidden'}
              id="reminders-done-btn" onclick="toggleReminderGroup('reminders-done')">${escapeHtml(t('reminderShowDone'))} (${done.length})</button>`;

  // <datalist> — suggests, doesn't apply. Typing "che" offers "Chemistry"
  // in a dropdown, same as any browser's own address-bar autocomplete,
  // but nothing is auto-corrected or forced: the field stays a plain
  // text input, and submitting whatever was actually typed — a class
  // not in this list, a typo, a made-up label for something that isn't
  // a real class at all — works exactly the same as picking a suggestion.
  // allKnownClasses() deliberately still includes excluded classes too
  // (see exclusionsField()'s own comment — that's what lets a settings
  // checkbox turn one back on). A reminder isn't that: excluding a
  // class means "stop reading and showing this one", so suggesting it
  // here would offer something that isn't actually shown anywhere else
  // on the page right now.
  // appliedFetchSettings, not the file: a class excluded a moment ago is
  // still in the data until the next collection purges it, and this list
  // should change at that moment along with everything else.
  const excludedClasses = new Set(appliedFetchSettings(settings).exclusions);
  const classOptions = allKnownClasses()
    .filter(name => !excludedClasses.has(name))
    .map(name => `<option value="${escapeHtml(name)}">`).join('');

  const addForm = `      <div class="reminder-add">
        <input type="hidden" id="reminder-editing-id" value="">
        <input type="text" id="reminder-title" placeholder="${escapeHtml(t('reminderTitlePlaceholder'))}">
        <input type="text" id="reminder-class" list="reminder-class-list" placeholder="${escapeHtml(t('reminderClassPlaceholder'))}">
        <datalist id="reminder-class-list">${classOptions}</datalist>
        <span class="reminder-due-field">
          <input type="datetime-local" id="reminder-due" title="${escapeHtml(t('reminderDueHint'))}"
                 oninput="document.getElementById('reminder-due-clear').hidden = !this.value">
          <button type="button" class="mini-btn" id="reminder-due-clear" hidden
                  onclick="clearReminderDue()" title="${escapeHtml(t('reminderDueClear'))}">✕</button>
        </span>
        <button type="button" id="reminder-save-btn" onclick="saveReminder()">${escapeHtml(t('reminderAdd'))}</button>
        <button type="button" class="mini-btn" id="reminder-cancel-edit-btn" hidden
                onclick="cancelEditReminder()">${escapeHtml(t('reminderCancelEdit'))}</button>
        <span class="result" id="reminders-result"></span>
      </div>
      <p class="hint">${escapeHtml(t('reminderCaption'))}</p>`;

  // NOT data-has-items="yes" — that opts a section into recount()'s
  // live auto-hide-when-empty behavior, which only knows about the
  // .hidden-row/shown convention (real assignments' hide mechanism),
  // not this section's own [hidden]-wrapper-div one. Every state change
  // here reloads the page anyway (see virtualAction() etc.), so this
  // section never needs recount()'s LIVE recalculation in the first
  // place — and skipping it is what keeps the add-reminder form always
  // visible even with zero reminders, rather than the whole section
  // vanishing the moment there's nothing active in it.
  return `    <section>
      <h2>${escapeHtml(t('reminders'))} <span class="count">${active.length}</span></h2>
${addForm}
${active.map(x => card(x, 'active')).join('\n')}
      <div id="reminders-hidden" hidden>
${hiddenItems.map(x => card(x, 'hidden')).join('\n')}
      </div>
${hiddenButton}
      <div id="reminders-done" hidden>
${done.map(x => card(x, 'done')).join('\n')}
      </div>
${doneButton}
    </section>`;
}

/**
 * Overdue. A separate section because it needs to behave differently.
 *
 * Overdue assignments used to silently drop out — only a number in the
 * stats. Tolerable for Classroom (turned-in work stays in its past), but
 * Canvas and Edpuzzle only ever return what's NOT turned in: overdue there
 * means "didn't turn it in and missed it". The user asked for it to be
 * shown, but UNDER "Due soon", not above — what's due soon matters more
 * than what's already a lost cause.
 *
 * Each one has a "hide" button: staring forever at something that can't
 * be fixed anymore serves no purpose. The button is deliberately
 * unobtrusive and asks for confirmation, so it isn't hit by accident.
 * Hidden items aren't deleted — they can be shown again with the button
 * at the bottom of the section.
 */
function overdueSection(items, now) {
  if (!items.length) return '';

  const visible = items.filter(x => !x.hidden);
  const hiddenItems = items.filter(x => x.hidden);

  const overdueCard = (x) => {
    const days = Math.round((now - x.due_at) / 864e5);
    const wasDue = x.due
      ? x.due.replace(/^Due\s+/, '')
      : x.due_at.toLocaleString(locale(), { day: 'numeric', month: 'short' });

    // data-id is needed by the page so that clicking "hide" can move the
    // card into "hidden" itself, without waiting for the next collection.
    const tags = ` data-cls="${escapeHtml(x.class)}"` +
                    ` data-type="${escapeHtml(x.type || '')}"` +
                    ` data-days="${-days}"` +
                    ` data-sect="overdue"`;

    return `      <div class="row${x.hidden ? ' hidden-row' : ''}" data-id="${escapeHtml(x.id)}"${tags}>
      <a href="${escapeHtml(x.link || '#')}" target="_blank" rel="noopener" class="item overdue-item">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(x.platform || DEFAULT_PLATFORM)}</span>
          <span class="cls">${escapeHtml(x.class)}</span>
          <span class="overdue-since">${escapeHtml(wasDue)} · ${escapeHtml(t('lateByDays', days))}</span>
        </div>
      </a>
      ${x.hidden
        ? `<a class="quiet" href="napominalka://unhide/${escapeHtml(x.id)}"
             onclick="restoreOverdueItem(event, this)">${escapeHtml(t('restore'))}</a>`
        : `<a class="quiet quiet-faint" href="napominalka://hide/${escapeHtml(x.id)}"
             onclick="return hideOverdueItem(event, this)">${escapeHtml(t('hide'))}</a>`}
      </div>`;
  };

  // The button is always rendered, just hidden when empty. That way the
  // page doesn't need to create it on the fly when the user hides the
  // first assignment.
  const hiddenButton =
    `      <button class="show-hidden-btn"${hiddenItems.length ? '' : ' hidden'}
              onclick="toggleHiddenRows(this)">${escapeHtml(t('showHidden'))} (${hiddenItems.length})</button>`;

  return `    <section data-has-items="yes">
      <h2>${escapeHtml(t('overdue'))} <span class="count">${visible.length}</span></h2>
      <p class="hint">${escapeHtml(t('overdueCaption'))}</p>
${visible.map(overdueCard).join('\n')}
${hiddenItems.map(overdueCard).join('\n')}
${hiddenButton}
    </section>`;
}

function section(heading, items, now, freshIds, caption) {
  if (!items.length) return '';
  const sectionKey = heading.toLowerCase();
  // data-has-items — a "cards live in this section" marker. Needed by the
  // recount: the section the LAST card was removed from used to stay
  // hanging around empty — heading and caption, but no content.
  return `    <section data-has-items="yes">
      <h2>${escapeHtml(heading)} <span class="count">${items.length}</span></h2>
      ${caption ? `<p class="hint">${escapeHtml(caption)}</p>` : ''}
${items.map(x => itemCard(x, now, freshIds.has(x.id), sectionKey)).join('\n')}
    </section>`;
}

/**
 * The settings panel under the gear icon.
 *
 * Hidden until clicked. Values shown are the current ones — from
 * settings.json, not made up: otherwise someone who opens it sees empty
 * fields and assumes there are no settings at all.
 *
 * Saving doesn't happen from here — the page can't write to disk. The
 * button collects everything into one chunk and hands it to
 * dispatchAction('config', ...), the same as every other action on this
 * page — see saveSettings() for the actual save button's logic.
 */
/**
 * Every class known across all three platforms, deduplicated.
 *
 * Each platform's collector persists its own last-successfully-read list
 * (classes.json for Classroom, canvas-classes.json, edpuzzle-classes.json)
 * for exactly this: the settings page has no other way to know what
 * classes exist without re-reading a source itself.
 *
 * edpuzzle-classes.json is skipped outright when edpuzzleEnabled is
 * off. Turning Edpuzzle off stops it from being fetched, but the file
 * itself doesn't go anywhere — it just sits there frozen, and without
 * this check its classes would keep showing up in the class filter, the
 * exclusions picker, and the reminder autocomplete forever, for a
 * platform that's no longer actually being read. Not the same case as a
 * merely-stale Classroom/Canvas class (still worth surfacing, still
 * being checked) — Edpuzzle here isn't stale, it's turned off on
 * purpose, same distinction EXCLUSIONS already makes in
 * diffWithPrevious for an excluded class.
 *
 * last-collection.json's own class names are folded in too, on top of
 * the three class-listing files above — not a fourth "known" source,
 * a fallback for a class that's fallen out of ALL of them. A real
 * class transfer (moved to a different section, dropped a class) makes
 * Classroom stop listing the old one entirely: it's gone from
 * classes.json, but its old assignments are still sitting in
 * last-collection.json marked removed:true (three misses in a row —
 * see diffWithPrevious), still showing real "gone" cards on the page.
 * Without this, that class couldn't be picked from the exclusions
 * checkbox list at all — it fell out of every list the picker reads
 * from, even though it still has real content on the page someone
 * might want to hide. Caught live: exactly this case, a class the user
 * had genuinely left.
 */
function allKnownClasses() {
  return [...knownClassStatus().keys()];
}

/**
 * Same merge as allKnownClasses(), but keeping WHERE each name came
 * from — a platform's own current listing ("known"), or only from
 * last-collection.json's leftover items ("orphaned"). allKnownClasses()
 * itself only ever needed the names (the class filter, the exclusions
 * picker, the reminder autocomplete don't care which); classRoster() in
 * 17-api.js needs the distinction, so a consumer like a Home Assistant
 * integration can tell "this is a real, currently-listed class" apart
 * from "this fell off the platform's own listing, ClassDash just still
 * remembers it had data" — instead of both looking identical in the
 * roster and a client having no way to filter one out. Caught live: an
 * orphaned class (hidden on Classroom's own side, per that platform's
 * "hide this class from me" feature — a real class transfer with no way
 * to actually leave) flooded an HA integration with an entity it had no
 * way to distinguish from a real one.
 */
function knownClassStatus() {
  const readNames = (file) => {
    try {
      if (!fs.existsSync(file)) return [];
      return JSON.parse(fs.readFileSync(file, 'utf8')).map(c => c.name).filter(Boolean);
    } catch { return []; }
  };
  const settings = readSettings();
  const readItemClasses = (file) => {
    try {
      if (!fs.existsSync(file)) return [];
      // Same edpuzzleEnabled carve-out as edpuzzle-classes.json below —
      // an old Edpuzzle item can sit here frozen forever once disabled
      // (diffWithPrevious treats a disabled platform as permanently
      // "unread", never dropping it), and without this check it would
      // sneak Edpuzzle classes back into the list through a side door
      // this same function otherwise deliberately blocks.
      return JSON.parse(fs.readFileSync(file, 'utf8'))
        .filter(x => settings.edpuzzleEnabled || x.platform !== 'Edpuzzle')
        .map(x => x.class).filter(Boolean);
    } catch { return []; }
  };

  const known = new Set([
    ...readNames(path.join(__dirname, 'classes.json')),
    ...readNames(path.join(__dirname, 'canvas-classes.json')),
    ...(settings.edpuzzleEnabled ? readNames(path.join(__dirname, 'edpuzzle-classes.json')) : []),
  ]);
  const fromItems = readItemClasses(path.join(__dirname, 'last-collection.json'));

  const status = new Map();
  for (const name of known) status.set(name, 'known');
  for (const name of fromItems) if (!status.has(name)) status.set(name, 'orphaned');
  return status;
}

/**
 * Excluded classes — as CHECKBOXES, not a text field.
 *
 * The user's request, and a fair one: names like "AP World Hist 1 Per 2 -
 * 6255D-1 (S1)" can't be typed by hand without a typo, and a typo means
 * the exclusion just silently doesn't work. The list comes from every
 * platform's own last-read class list — that is, from what the system
 * actually sees, not just Classroom's.
 *
 * Names no longer in that list (the class closed, but the exclusion
 * stayed) are still shown checked: otherwise saving would silently lose
 * them.
 *
 * If classes have never been read yet, a plain text field is used instead,
 * to type in by hand. An empty checkbox list would be a dead end.
 */
function exclusionsField(selected) {
  let classes = allKnownClasses();

  // Checked but no longer known — goes to the bottom of the list, so it
  // doesn't disappear.
  for (const name of selected) if (!classes.includes(name)) classes.push(name);

  if (!classes.length) {
    return `      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsExclusions'))}</span>
        <input type="text" data-key="exclusions" value="${escapeHtml(selected.join(', '))}">
        <span class="field-hint">${escapeHtml(t('settingsExclusionsHint'))}</span>
      </label>`;
  }

  const rows = classes.map(name =>
    `          <label class="check-row"><input type="checkbox" data-key="exclusions"` +
    ` onchange="updateSelectionCount()"` +
    ` value="${escapeHtml(name)}"${selected.includes(name) ? ' checked' : ''}>` +
    `<span class="label-text">${escapeHtml(name)}</span></label>`).join('\n');

  // <details> — the BROWSER'S OWN COLLAPSIBLE MENU.
  //
  // The user's request: a checkbox list that's always expanded took up
  // half the panel. Writing a custom JavaScript menu is pointless —
  // <details> already does this, works with zero lines of code, and
  // doesn't break if the script crashes.
  //
  // The summary shows how many are checked, so you don't have to expand
  // it just to check.
  const checkedCount = classes.filter(c => selected.includes(c)).length;
  return `      <div class="setting-row wide">
        <span class="field-name">${escapeHtml(t('settingsExclusions'))}</span>
        <details class="class-picker">
          <summary><span class="picker-summary">${checkedCount}</span> ${escapeHtml(t('settingsOf'))} ${classes.length}</summary>
          <div class="class-list">
${rows}
          </div>
        </details>
        <span class="field-hint">${escapeHtml(t('settingsExclusionsCheckboxHint'))}</span>
      </div>`;
}

/**
 * Read-only version info row for the Advanced section — CFBundleShort-
 * VersionString (see build.sh), plus whatever the last update check
 * found. Never a data-key: saveSettings() walks [data-key]/
 * [data-bool-key], and there's nothing here to save, just to read.
 */
function versionRow() {
  const status = readUpdateStatus();
  const current = status ? status.currentVersion : null;
  const versionText = current ? `v${current}` : t('checkStatusNeverChecked');
  const updateNote = status && status.updateAvailable
    ? ` — ${t('updateAvailable')} <b>v${escapeHtml(status.latestVersion)}</b>` +
      ` (<a href="${escapeHtml(status.url)}" target="_blank" rel="noopener">${escapeHtml(t('updateViewRelease'))}</a>)`
    : '';
  // A failed check/download used to be completely invisible on the
  // page — recordCheckError() in 16-summary.swift and downloadUpdate()
  // in 26-update-check.js both now actually record why, so this is the
  // one place a person looking at Settings (not just an API client
  // watching `status`) finds out too.
  const errorNote = status && status.error
    ? ` <span class="update-error-note">— ${escapeHtml(t('updateCheckFailed'))}: ${escapeHtml(status.error)}</span>`
    : '';
  // Empty middle span deliberately kept — .setting-row is a fixed
  // 3-column grid (name / value / hint), and every other row has
  // something in that middle slot (an input, a checkbox). Without it,
  // grid auto-placement puts the hint in column 2 instead of 3,
  // sitting right next to the name instead of where every other row's
  // hint actually lands.
  return `      <label class="setting-row">
        <span class="field-name">ClassDash</span>
        <span></span>
        <span class="field-hint">${escapeHtml(versionText)}${updateNote}${errorNote}</span>
      </label>`;
}

function settingsPanel() {
  const s = readSettings();
  const apiToken = currentToken();
  const apiFingerprint = certFingerprint();
  const field = (key, label, value, hint, sensitive) => {
    const input = sensitive
      ? `<span class="field-with-toggle">
          <input type="password" data-key="${key}" value="${escapeHtml(value)}">
          <button type="button" class="reveal-btn" onclick="toggleReveal(this)" title="${escapeHtml(t('settingsReveal'))}">👁</button>
        </span>`
      : `<input type="text" data-key="${key}" value="${escapeHtml(value)}">`;
    return `      <label class="setting-row">
        <span class="field-name">${escapeHtml(label)}</span>
        ${input}
        <span class="field-hint">${escapeHtml(hint || '')}</span>
      </label>`;
  };

  // Four sections behind a sidebar instead of one long scroll — fine at
  // 8 settings, unwieldy at 17. The sidebar only shows/hides
  // <div data-section> blocks with plain JS (showSettingsSection, in the
  // page's own <script>); it changes nothing about how saveSettings()
  // collects values — that still walks every [data-key]/[data-bool-key]
  // under #settings-panel, hidden section or not.
  const sections = [
    { id: 'account', label: t('settingsSectionAccount'), body: `
${field('email', t('settingsEmail'), s.email, t('settingsEmailHint'), true)}
${field('canvas', t('settingsCanvas'), s.canvas, t('settingsCanvasHint'), true)}
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsEdpuzzleEnabled'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="edpuzzleEnabled"${s.edpuzzleEnabled ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsEdpuzzleEnabledHint'))}</span>
      </label>
${field('account', t('settingsAccount'), String(s.account), t('settingsAccountHint'))}
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsLanguage'))}</span>
        <select data-key="language">
          <option value="ru"${s.language === 'ru' ? ' selected' : ''}>Русский</option>
          <option value="en"${s.language === 'en' ? ' selected' : ''}>English</option>
        </select>
        <span class="field-hint"></span>
      </label>` },
    { id: 'display', label: t('settingsSectionDisplay'), body: `
${field('summaryHours', t('settingsHours'), s.summaryHours.join(', '), t('settingsHoursHint'))}
${exclusionsField(s.exclusions)}
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsTreatUndated'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="treatUndatedAsUrgent"${s.treatUndatedAsUrgent ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsTreatUndatedHint'))}</span>
      </label>
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsShowEmpty'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="showEmptyClasses"${s.showEmptyClasses ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsShowEmptyHint'))}</span>
      </label>
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsHideInactive'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="hideInactiveClasses"${s.hideInactiveClasses ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsHideInactiveHint'))}</span>
      </label>
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsSkipStale'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="skipStaleClasses"${s.skipStaleClasses ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsSkipStaleHint'))}</span>
      </label>
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsStaleMonths'))}</span>
        <span class="field-with-value">
          <input type="range" data-key="staleMonths" min="1" max="12" step="1"
                 value="${s.staleMonths}" oninput="updateStaleMonthsLabel(this)">
          <span class="slider-value">${s.staleMonths} ${escapeHtml(s.staleMonths == 1 ? t('monthWord') : t('monthsWord'))}</span>
        </span>
        <span class="field-hint">${escapeHtml(t('settingsStaleMonthsHint'))}</span>
      </label>` },
    { id: 'api', label: t('settingsSectionApi'), body: `
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsApiEnabled'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="apiEnabled"${s.apiEnabled ? ' checked' : ''}
               onchange="toggleApiKeySection(this)">
        <span class="field-hint">${escapeHtml(t('settingsApiEnabledHint'))}
          ${isServerRunning()
            ? `<span class="api-status api-status-on">${escapeHtml(t('settingsApiRunning'))}</span>`
            : `<span class="api-status">${escapeHtml(t('settingsApiNotRunning'))}</span>`}
        </span>
      </label>
      <div class="api-key-row"${s.apiEnabled ? '' : ' hidden'}>
        <label class="setting-row">
          <span class="field-name">${escapeHtml(t('settingsApiNetwork'))}</span>
          <input type="checkbox" class="toggle" data-bool-key="apiNetwork"${s.apiNetwork ? ' checked' : ''}>
          <span class="field-hint">${escapeHtml(t('settingsApiNetworkHint'))}</span>
        </label>
        <label class="setting-row">
          <span class="field-name">${escapeHtml(t('settingsApiToken'))}</span>
          <span class="field-with-value">
            <span class="field-with-toggle" style="flex:1 1 auto;min-width:0;">
              <input type="password" readonly id="api-token-field"
                     value="${escapeHtml(apiToken || t('settingsApiNotGenerated'))}">
              <button type="button" class="reveal-btn" onclick="toggleReveal(this)"
                      title="${escapeHtml(t('settingsReveal'))}">👁</button>
            </span>
            <button type="button" class="mini-btn" onclick="copyFieldValue(this, 'api-token-field')">${escapeHtml(t('settingsCopy'))}</button>
            <button type="button" class="mini-btn" onclick="rollApiToken()">${escapeHtml(t('settingsRoll'))}</button>
          </span>
          <span class="field-hint">${escapeHtml(t('settingsApiTokenHint'))}</span>
        </label>
        <label class="setting-row">
          <span class="field-name">${escapeHtml(t('settingsApiFingerprint'))}</span>
          <span class="field-with-value">
            <input type="text" readonly id="api-fingerprint-field" style="flex:1 1 auto;min-width:0;"
                   value="${escapeHtml(apiFingerprint || t('settingsApiNotGenerated'))}">
            <button type="button" class="mini-btn" onclick="copyFieldValue(this, 'api-fingerprint-field')">${escapeHtml(t('settingsCopy'))}</button>
          </span>
          <span class="field-hint">${escapeHtml(t('settingsApiFingerprintHint'))}</span>
        </label>
      </div>` },
    { id: 'fetching', label: t('settingsSectionFetching'), body: `
${field('freshCheckAwakeMinutes', t('settingsFreshCheckAwake'), String(s.freshCheckAwakeMinutes), t('settingsFreshCheckAwakeHint'))}
${field('freshCheckAsleepMinutes', t('settingsFreshCheckAsleep'), String(s.freshCheckAsleepMinutes), t('settingsFreshCheckAsleepHint'))}
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsFreshCheckCharging'))}</span>
        <input type="checkbox" class="toggle" data-bool-key="freshCheckOnlyWhenCharging"${s.freshCheckOnlyWhenCharging ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsFreshCheckChargingHint'))}</span>
      </label>` },
    { id: 'advanced', label: t('settingsAdvanced'), body: `
${versionRow()}
${field('classTimeoutMs', t('settingsClassTimeout'), String(s.classTimeoutMs), t('settingsClassTimeoutHint'))}
${field('emptyTimeoutMs', t('settingsEmptyTimeout'), String(s.emptyTimeoutMs), t('settingsEmptyTimeoutHint'))}
${field('passLimitMs', t('settingsPassLimit'), String(s.passLimitMs), t('settingsPassLimitHint'))}
${field('browserPath', t('settingsBrowserPath'), s.browserPath, t('settingsBrowserPathHint'))}` },
  ];

  const sidebarButtons = sections.map((sec, i) =>
    `        <button type="button" class="settings-nav-btn${i === 0 ? ' active' : ''}"` +
    ` onclick="showSettingsSection('${sec.id}', this)">${escapeHtml(sec.label)}</button>`).join('\n');

  const sectionBlocks = sections.map((sec, i) =>
    `      <div class="settings-section" data-section="${sec.id}"${i === 0 ? '' : ' hidden'}>${sec.body}
      </div>`).join('\n');

  return `  <div class="settings-panel" id="settings-panel" hidden>
      <div class="name">${escapeHtml(t('settingsTitle'))}</div>
      <div class="settings-body">
      <div class="settings-sidebar">
${sidebarButtons}
      </div>
      <div class="settings-content">
${sectionBlocks}
      </div>
      </div>
      <div class="settings-actions">
        <button onclick="toggleSettingsPanel()">${escapeHtml(t('settingsDone'))}</button>
        <span class="result" id="settings-result"></span>
      </div>
  </div>`;
}

/**
 * The filters panel.
 *
 * The lists of classes and types are built from what's actually on the
 * page, not from a list known ahead of time: classes now come from the
 * site itself, and a hardcoded list would go stale by September.
 */
function filtersPanel(allItems, announcements, now, rawItems) {
  // ACTIVE REMINDERS ARE PART OF WHAT THIS PANEL OFFERS, NOT JUST REAL
  // ASSIGNMENTS. Every card on the page — reminders included — is
  // filtered against the checked boxes below, but the boxes used to be
  // built from allItems alone. A reminder whose class, type or due range
  // no real assignment shared matched nothing on offer, so it was
  // filtered out and simply never appeared: caught live when a
  // completed reminder was un-done. Four days past due, with no real
  // overdue assignment on the page to make "overdue" an option, it
  // vanished — the section header still said "1", the card was
  // display:none. Only reminders on screen count (not done, not hidden:
  // those sit behind their own button and skip these filters entirely).
  const pool = [...allItems, ...activeReminderItems(now)];

  // Counts how many cards each checkbox would match. The number next to
  // it immediately shows whether there's anything there — like the Steam
  // library the user referenced.
  const count = (key) => {
    const counts = new Map();
    for (const x of pool) {
      const k = key(x);
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  };

  const daysFor = x => (x.due_at ? daysUntil(now, x.due_at) : null);
  const countByDue = (test) => pool.filter(x => test(daysFor(x))).length;

  const dueRanges = [
    ['1', t('filterTodayTomorrow'), countByDue(d => d !== null && d >= 0 && d <= 1)],
    ['7', t('filterWeek'), countByDue(d => d !== null && d >= 0 && d <= 7)],
    ['31', t('filterMonth'), countByDue(d => d !== null && d >= 0 && d <= 31)],
    ['past', t('filterOverdue'), countByDue(d => d !== null && d < 0)],
    ['none', t('filterNoDueDate'), countByDue(d => d === null)],
  ];

  // CHECKBOXES START CHECKED. The user's request, and a fair point: they
  // used to all start unchecked while everything was still shown — visually
  // that looks contradictory. And removing one class meant checking every
  // other one.
  //
  // The mechanism stays the same: an empty group means "everything
  // matches". So "all checked" and "none checked" give the same result —
  // the first one just looks more honest.
  //
  // REMEMBERED ACROSS REFRESHES: the boxes the user unchecked last time
  // start unchecked (settings.filterUnchecked); everything else — including
  // an option that's new since — starts checked, as before.
  const savedOff = readSettings().filterUnchecked || {};
  const isOff = (group, value) => (savedOff[group] || []).includes(value);
  const checkRow = (group, value, label, count) =>
    `        <label class="check-row"><input type="checkbox" data-group="${group}"` +
    ` value="${escapeHtml(value)}" onchange="rememberFilters(); applyFilters()"` +
    `${isOff(group, value) ? '' : ' checked'}>` +
    `<span class="label-text">${escapeHtml(label)}</span>` +
    `<span class="count-badge">${count}</span></label>`;

  const group = (name, content) =>
    `    <div class="filter-group">
      <div class="group-name">${escapeHtml(name)}</div>
${content.join('\n')}
    </div>`;

  const parts = [];

  let classCounts = count(x => x.class);
  // Off by default: without this, a class with nothing due/overdue/removed
  // just never appears here at all, which reads as "this class doesn't
  // exist" rather than "this class has nothing going on". Adds a 0 entry
  // for every known class (from all three platforms) not already present.
  //
  // EXCLUDED CLASSES ARE THE ONE CASE THIS WASN'T MEANT FOR. This
  // setting means "still being read, currently has nothing due" — an
  // excluded class isn't being read at all, so a permanent 0 next to it
  // here doesn't mean that, it just looks like the setting isn't
  // working. allKnownClasses() deliberately still contains excluded
  // classes (see resolveClasses()'s own comment — that's what lets
  // exclusionsField() below still list them as checkboxes, so they can
  // be turned back on), so this needs its own check rather than relying
  // on that list being pre-filtered.
  const filterSettings = readSettings();
  if (filterSettings.showEmptyClasses) {
    const present = new Set(classCounts.map(([name]) => name));
    const excluded = new Set(appliedFetchSettings(filterSettings).exclusions);

    // HIDEINACTIVECLASSES IS A NARROWER CUT OF THE SAME LIST.
    //
    // showEmptyClasses can't tell "quiet right now" apart from "this
    // project has never once recorded anything for this class" — both
    // look like a bare 0. everHadClasswork/everHadAnnouncement answer
    // that from data already on hand: announcements is the full
    // historical merge, not just this pass's new ones, so that half is
    // fine as-is.
    //
    // The classwork half is deliberately NOT allItems, even though
    // allItems sounds like "everything" — it's actually the page's own
    // display list, and materials only stay in it while they're still
    // "new" (see newMaterials above and its own comment). A class whose
    // only history is a material read weeks ago would look exactly like
    // a class with no history at all once that material aged out of
    // allItems, and hideInactiveClasses would hide it — caught live: a
    // class with only Google Classroom materials, no assignments or
    // announcements, disappeared under this toggle. rawItems is the
    // actual full collection (everything last-collection.json has ever
    // recorded, materials included regardless of read status), passed
    // in from writePage() separately from the display-filtered allItems
    // for exactly this reason.
    const hideInactive = filterSettings.hideInactiveClasses;
    const everHadClasswork = hideInactive ? new Set((rawItems || allItems).map(x => x.class)) : null;
    const everHadAnnouncement = hideInactive ? new Set(announcements.map(p => p.class)) : null;

    // SKIPSTALECLASSES HIDES HERE TOO, NOT JUST FROM FETCHING.
    //
    // The user's own expectation, and a fair one: "skip inactive
    // classes" reads as "skip it", full stop — not "keep fetching it a
    // little less and still list it forever with a permanent 0". This
    // is deliberately a SEPARATE check from hideInactiveClasses right
    // above, not folded into it: hideInactiveClasses means "literally
    // never had any history, ever", which a stale class usually
    // doesn't qualify for (Video Game Club had real assignments once —
    // it just isn't stale in the "no history" sense, it's stale in the
    // "gone quiet for staleMonths" sense). Two different questions,
    // same isClassStale() the actual fetch-skip decision already uses,
    // so a class that's currently being fetched and one that's hidden
    // here can never disagree about which classes count as stale.
    const skipStale = filterSettings.skipStaleClasses;

    for (const name of allKnownClasses()) {
      if (present.has(name) || excluded.has(name)) continue;
      if (hideInactive && !everHadClasswork.has(name) && !everHadAnnouncement.has(name)) continue;
      if (skipStale && isClassStale(name)) continue;
      classCounts.push([name, 0]);
    }
    classCounts = classCounts.sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }
  parts.push(group(t('filterClass'), classCounts
    .map(([v, n]) => checkRow('cls', v, v, n))));

  parts.push(group(t('filterType'), count(x => (x.type || '').trim())
    .map(([v, n]) => checkRow('type', v, v, n))));

  parts.push(group(t('filterDue'), dueRanges
    .filter(([, , n]) => n > 0)
    .map(([v, label, n]) => checkRow('days', v, label, n))));

  // A separate checkbox: not a value filter, but "show what's been removed".
  parts.push(`    <div class="filter-group">
      <div class="group-name">${escapeHtml(t('filterHidden'))}</div>
        <label class="check-row"><input type="checkbox" class="toggle" id="f-hidden"${filterSettings.filterShowHidden ? ' checked' : ''} onchange="rememberFilters(); applyFilters()">
          <span class="label-text">${escapeHtml(t('filterShowHiddenMuted'))}</span></label>
        <label class="check-row"><input type="checkbox" class="toggle" id="f-removed"${filterSettings.filterShowRemoved ? ' checked' : ''} onchange="rememberFilters(); applyFilters()">
          <span class="label-text">${escapeHtml(t('filterShowRemoved'))}</span></label>
      <button onclick="resetFilters()">${escapeHtml(t('filterResetAll'))}</button>
      <div class="result" id="f-result"></div>
    </div>`);

  return `  <div class="filters">
${parts.join('\n')}
  </div>`;
}

/**
 * "Did the last check actually work?" — one small dot per platform, in
 * the header, click to expand into a full per-platform breakdown. See
 * 25-check-status.js for what ok/problem/unknown mean; this just
 * renders whatever checkStatus() already decided.
 *
 * The dots keep their own hover tooltips too (the quick answer for one
 * platform, no click needed) — the expanded panel is for the full
 * picture, timestamps and error detail included, which a tooltip can't
 * show for three platforms at once and doesn't work at all on touch.
 *
 * Platform display names are hardcoded English, not run through t() —
 * same call already made for the .platform line right below the header
 * and for every card's own platform label: these are product names,
 * not sentence text, and stay the same word regardless of language.
 */
const CHECK_STATUS_ENTRIES = [
  ['classroom', 'Google Classroom'],
  ['canvas', 'Canvas'],
  ['edpuzzle', 'Edpuzzle'],
];

function checkStatusWord(s) {
  return s === 'ok' ? t('checkStatusOk')
    : s === 'problem' ? t('checkStatusProblem') : t('checkStatusUnknown');
}

function checkStatusWhen(s) {
  return s.at ? new Date(s.at).toLocaleString(locale(), {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }) : t('checkStatusNeverChecked');
}

/** The clickable row of dots itself — sits inline in the header's button row. */
function checkStatusIndicator() {
  const status = checkStatus();
  const dot = (key, label) => {
    const s = status[key];
    const tooltip = `${label}: ${checkStatusWord(s.status)} — ${checkStatusWhen(s)}` +
      (s.detail ? `\n${s.detail}` : '');
    return `<span class="status-dot status-${s.status}" title="${escapeHtml(tooltip)}"></span>`;
  };
  return `<button type="button" class="check-status" onclick="toggleCheckStatusDetail()"
       title="${escapeHtml(t('checkStatusTitle'))}">${CHECK_STATUS_ENTRIES.map(([k, l]) => dot(k, l)).join('')}</button>`;
}

/**
 * The expanded breakdown, hidden until the dots above are clicked.
 * ITS OWN FUNCTION, NOT PART OF checkStatusIndicator() — the button
 * lives inline inside .when (the header's button row); this is a real
 * block-level panel, and nesting it inside .when's own inline flow
 * would make it wrap into that row instead of dropping down below the
 * whole header the way it's meant to. Placed as its own sibling in the
 * header markup instead.
 */
function checkStatusPanel() {
  const status = checkStatus();
  const row = (key, label) => {
    const s = status[key];
    return `      <div class="check-status-row">
        <span class="status-dot status-${s.status}"></span>
        <span class="check-status-name">${escapeHtml(label)}</span>
        <span class="check-status-word">${escapeHtml(checkStatusWord(s.status))}</span>
        <span class="check-status-time">${escapeHtml(checkStatusWhen(s))}</span>
        ${s.detail ? `<span class="check-status-detail-text">${escapeHtml(s.detail)}</span>` : ''}
      </div>`;
  };
  return `  <div class="check-status-panel" id="check-status-panel" hidden>
    <div class="check-status-panel-title">${escapeHtml(t('checkStatusTitle'))}</div>
${CHECK_STATUS_ENTRIES.map(([k, l]) => row(k, l)).join('\n')}
  </div>`;
}

// ── Pixel-stepped corners ──
//
// The app icon's tile has corners cut in a little staircase — rounded,
// but still 8-bit. border-radius can only draw smooth curves, and
// clip-path would clip away the border and the hard shadow with it, so
// each frame is a tiny pixel-art sprite used as a border-image: the
// corners are drawn pixel by pixel, the edges stretch, the middle fills.
// A hard drop-shadow (filter, which follows the sprite's own transparent
// corners instead of the rectangle) goes on top.
//
// Single source of truth for the colours the sprites bake in — the
// :root tokens in the stylesheet are built from these too, because an
// SVG in a border-image can't read CSS variables, so the two have to be
// generated from the same place or they'd drift apart.
const PIXEL_THEME = {
  light: { bg: '#f6f7f9', card: '#ffffff', line: '#e5e7eb', dim: '#6b7280', warnbg: '#fffaeb', ink: '#101018', new: '#0004ff', hot: '#d40000' },
  dark:  { bg: '#16181c', card: '#1f2226', line: '#2f3338', dim: '#9aa0a6', warnbg: '#2a2314', ink: '#66718a', new: '#00ffff', hot: '#ff6b6b' },
};

// A corner is described the way pixel artists draw a round one: for each
// row from the top, how many cells are missing before the shape starts.
// A cell is 2 CSS pixels. Each list is a pixel-circle's staircase, and
// each is symmetric top-to-side (read as columns it gives the same list)
// so a corner never looks lopsided.
//   large  — cards and panels: a 12px-radius arc
//   medium — buttons and fields: 10px
//   pill   — count badges and labels: 6px
//   mini   — checkboxes and toggles: 4px, a single notch
const PIXEL_CORNERS = {
  large:  [4, 2, 1, 1, 0],
  medium: [3, 1, 1, 0],
  pill:   [2, 1, 0],
  mini:   [1, 0],
};
const PIXEL_CELL = 2;

/**
 * One frame sprite as a data: URL, drawn 1:1 with CSS pixels so every
 * sprite pixel is exactly one on the page and stays sharp. The shape is
 * the corner staircase mirrored into all four corners; a cell is outline
 * if any side-neighbour falls outside the shape, fill otherwise, so the
 * outline is always one cell (2px) thick and follows the steps.
 */
function pixelSprite(size, edge, fill) {
  const insets = PIXEL_CORNERS[size];
  const R = insets.length;
  const N = 2 * R + 1; // corner + one stretchable middle cell + corner
  return rasterSprite(N, (x, y) => {
    const fx = Math.min(x, N - 1 - x), fy = Math.min(y, N - 1 - y);
    return fx >= (fy < R ? insets[fy] : 0);
  }, edge, fill);
}

// A rounded square, 6 cells (12px) across: only the four corner cells
// are missing, so the sides stay straight. (An earlier version cut 2
// cells off the top row and 1 off the next — a proper pixel circle —
// but at this size it read as a diamond.)
const PIXEL_DOT = [1, 0, 0];
const PIXEL_DOT_CELLS = PIXEL_DOT.length * 2;

/** A status light: the same outlined-cell drawing as the frames, but a
 *  fixed 12x12 rounded square instead of a stretchable box. */
function pixelDot(edge, fill) {
  const N = PIXEL_DOT_CELLS;
  return rasterSprite(N, (x, y) => {
    const fx = Math.min(x, N - 1 - x), fy = Math.min(y, N - 1 - y);
    return fx >= PIXEL_DOT[fy];
  }, edge, fill);
}

/** Draws an N x N grid of 2px cells into an SVG data: URL. inShape says
 *  which cells are part of the shape; those with a side-neighbour outside
 *  it are outline, the rest fill. */
function rasterSprite(N, shapeAt, edge, fill) {
  const inShape = (x, y) => x >= 0 && y >= 0 && x < N && y < N && shapeAt(x, y);
  let body = '';
  for (let y = 0; y < N; y++) {
    // Merge each row into runs of one colour: a handful of rects, not N*N.
    let x = 0;
    while (x < N) {
      if (!inShape(x, y)) { x++; continue; }
      const isEdge = (cx) => !inShape(cx - 1, y) || !inShape(cx + 1, y) ||
                             !inShape(cx, y - 1) || !inShape(cx, y + 1);
      const colour = isEdge(x) ? edge : fill;
      let end = x + 1;
      while (end < N && inShape(end, y) && (isEdge(end) ? edge : fill) === colour) end++;
      body += `<rect x='${x * PIXEL_CELL}' y='${y * PIXEL_CELL}' width='${(end - x) * PIXEL_CELL}' height='${PIXEL_CELL}' fill='${colour}'/>`;
      x = end;
    }
  }
  const W = N * PIXEL_CELL;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${W}' shape-rendering='crispEdges'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The stepped-corner rules — shared geometry once, then the sprite each
 *  kind of element uses, generated for both themes. */
function pixelCornerCss() {
  const TILES = '.post, .item, .live, .filters, .settings-panel, .check-status-panel, .warn';
  const BUTTONS = '.reload, .check-status, .quiet, .filters button, .mini-btn, ' +
    '.settings-actions button, .show-hidden-btn, .reminder-toggle-btn, .reminder-add button';
  const each = (list, suffix) => list.split(', ').map(s => s + suffix).join(', ');
  const FIELDS = '.setting-row input[type="text"], .setting-row input[type="password"], ' +
    '.setting-row select, .reminder-add input[type="text"], ' +
    '.reminder-add input[type="datetime-local"], .class-picker';
  const PILLS = '.count, .plat, .removed-badge, .check-row .count-badge';
  const CHECK = 'input[type="checkbox"]:not(.toggle)';
  const SLIDER = '.field-with-value input[type="range"]';
  const TRACK = SLIDER + '::-webkit-slider-runnable-track';
  const THUMB = SLIDER + '::-webkit-slider-thumb';
  const TOGGLE = 'input[type="checkbox"].toggle';
  const PROGRESS = '.check-progress-track';

  // Slice and width are both the corner's size in CSS pixels, so the
  // corners are drawn 1:1 and only the middle stretches.
  const geometry = (size) => {
    const n = PIXEL_CORNERS[size].length * PIXEL_CELL;
    return `border-style: solid; border-radius: 0; background: transparent;
    border-image-slice: ${n} fill; border-image-width: ${n}px; border-image-repeat: stretch;`;
  };

  const themed = (t) => {
    const src = (size, edge, fill) => `border-image-source: ${pixelSprite(size, t[edge], t[fill])};`;
    return `
  ${TILES} { ${src('large', 'ink', 'card')} }
  .warn { ${src('large', 'ink', 'warnbg')} }
  .item.overdue-item { ${src('large', 'hot', 'card')} }
  a.item:hover, .post:hover { ${src('large', 'new', 'card')} }
  ${BUTTONS} { ${src('medium', 'ink', 'card')} }
  ${each(BUTTONS, ':hover')}, .reload.spinning, .reload.expanded { ${src('medium', 'new', 'card')} }
  ${FIELDS} { ${src('medium', 'ink', 'bg')} }
  ${PILLS} { ${src('pill', 'ink', 'line')} }
  .badge { ${src('pill', 'ink', 'new')} }
  ${CHECK}, ${TOGGLE} { ${src('mini', 'ink', 'card')} }
  ${CHECK}:checked, ${TOGGLE}:checked { ${src('mini', 'ink', 'new')} }
  ${TRACK}, ${THUMB}, ${PROGRESS} { ${src('mini', 'ink', 'card')} }
  ${SLIDER}:hover::-webkit-slider-thumb, ${SLIDER}:active::-webkit-slider-thumb { ${src('mini', 'ink', 'new')} }
  .status-dot.status-ok, .dot { background-image: ${pixelDot(t.ink, t.new)}; }
  .status-dot.status-problem { background-image: ${pixelDot(t.ink, t.hot)}; }
  .status-dot.status-unknown { background-image: ${pixelDot(t.ink, t.dim)}; }`;
  };

  // The frame IS the background now (the sprite paints the fill), so the
  // element's own background has to go transparent — otherwise its
  // square corners would show through the staircase notches. A
  // border-image is only drawn when the element has a border style, and
  // .warn never had a border at all — so every tile states one here.
  return `/* Frames: sprites drawn corner by corner instead of border-radius. */
  ${TILES} {
    border-width: 2px; ${geometry('large')}
    filter: drop-shadow(3px 3px 0 var(--shadow));
  }
  a.item:hover, .post:hover {
    transform: translateY(-1px); filter: drop-shadow(3px 4px 0 var(--shadow));
  }
  /* Raised at rest, lifts a pixel straight up on hover, presses straight
     down on click — the shadow keeps its sideways offset and only its
     depth changes. Transitions off — real sprites don't ease. */
  ${BUTTONS} {
    ${geometry('medium')} color: var(--text); transition: none;
    filter: drop-shadow(2px 2px 0 var(--shadow));
  }
  ${each(BUTTONS, ':hover')} {
    transform: translateY(-1px); filter: drop-shadow(2px 3px 0 var(--shadow));
  }
  ${each(BUTTONS, ':active')} { transform: translateY(2px); filter: drop-shadow(2px 0 0 var(--shadow)); }
  ${FIELDS} { ${geometry('medium')} }
  ${PILLS}, .badge { ${geometry('pill')} }
  ${CHECK}, ${TOGGLE} { ${geometry('mini')} }
  /* No "fill" on the track's slice: only its frame comes from the sprite,
     so the progress gradient behind it stays visible. The 4px notch sits
     inside the 2px border, which is why padding-box clipping is enough. */
  ${TRACK} {
    border-radius: 0; border-image-slice: 4; border-image-width: 4px; border-image-repeat: stretch;
  }
  /* The progress bar's frame is the slider track's sprite again, with the
     border as wide as the sprite's corner so the fill sits inside it. */
  ${PROGRESS} {
    border-style: solid; border-width: 4px; border-radius: 0;
    border-image-slice: 4; border-image-width: 4px; border-image-repeat: stretch;
    background: var(--card); background-clip: padding-box;
  }
  ${THUMB} {
    border-radius: 0; background: transparent;
    border-image-slice: 4 fill; border-image-width: 4px; border-image-repeat: stretch;
  }
  /* Status lights: a fixed 12px rounded square. Every status variant is
     listed because each one's original background shorthand has the
     same specificity as this rule and would otherwise paint a square
     of solid colour behind the sprite. */
  .status-dot.status-ok, .status-dot.status-problem, .status-dot.status-unknown, .dot {
    width: 12px; height: 12px; border: 0; border-radius: 0;
    background-color: transparent; background-repeat: no-repeat; background-size: 12px 12px;
  }
  ${themed(PIXEL_THEME.light)}
  @media (prefers-color-scheme: dark) {${themed(PIXEL_THEME.dark)}
  }`;
}

/**
 * @param {object} data — {burning, later, undated, fresh, broken, now}
 * @param {string} outputPath — where to write the html
 */
function writePage(data, outputPath) {
  const { burning, later, undated, freshIds, broken, now } = data;
  const reading = data.reading || [];

  // Stamped into the page and published beside it once it's on disk, so an
  // open copy can tell a newer one exists (see "Live updates" in the page
  // script and 28-live-state.js).
  const pageVersion = Date.now();

  // Set only by a collection's in-progress writes: how many sources are
  // done out of how many. Baked in so a page reloaded mid-run already shows
  // the bar in the right place instead of flashing empty until the first
  // poll; the page's own script keeps it moving from there.
  const progress = data.progress || null;
  const progressPct = progress && progress.total
    ? Math.round(progress.done / progress.total * 100) : 0;
  const progressLabel = progress
    ? (progress.total && progress.done >= progress.total
        ? t('progressFinishing')
        : `${t('progressChecking')} ${progress.done} ${t('settingsOf')} ${progress.total}`)
    : '';
  const progressBar = `  <div class="check-progress" id="check-progress" role="progressbar"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}"${progress ? '' : ' hidden'}>
    <span class="check-progress-icon" aria-hidden="true"></span>
    <div class="check-progress-body">
      <div class="check-progress-head"><span id="check-progress-label">${escapeHtml(progressLabel)}</span><span id="check-progress-pct">${progressPct}%</span></div>
      <div class="check-progress-track"><div class="check-progress-fill" id="check-progress-fill" style="width: ${progressPct}%"></div></div>
    </div>
  </div>`;
  const deferred = data.deferred || [];
  // Full, unbucketed collection — everything last-collection.json has
  // ever recorded, materials included regardless of whether they're
  // still "new". Only used for hideInactiveClasses's history check (see
  // filtersPanel's own comment on why that can't just reuse allItems);
  // falls back to allItems itself if a caller doesn't have it, so a
  // missing rawItems degrades to the old (buggy but harmless) behavior
  // instead of crashing.
  const rawItems = data.items || null;

  // Announcements from streams. Freshest on top.
  const overdue = data.overdue || [];
  const gone = data.gone || [];
  const announcements = [...(data.announcements || [])];
  const freshAnnouncementIds = data.freshAnnouncements || new Set();

  // Which platforms are involved at all — shown in the header.
  // Only two for now, Edpuzzle and DeltaMath will join later.
  // Materials only show new ones (old ones are already read, no reason
  // for them to hang around in the list — same logic as the popup).
  //
  // Computed here, not further down, because the checkboxes in the
  // filters need to match what's actually drawn. Otherwise "no due date"
  // would show 32 next to it while the page had no such card at all.
  const newMaterials = undated.filter(x => freshIds.has(x.id));

  // Everything that will actually land on the page — for the filter lists.
  const allItems = [...burning, ...later, ...newMaterials, ...deferred, ...overdue, ...gone];

  const platforms = [...new Set(
    [...burning, ...later, ...undated, ...deferred]
      .map(x => x.platform || DEFAULT_PLATFORM)
  )].sort();
  if (!platforms.length) platforms.push(DEFAULT_PLATFORM);

  const time = now.toLocaleString(locale(), {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  // newMaterials was already computed above, together with the filter lists.

  // The page is rewritten after every class read, so it can be checked
  // without waiting for the pass to finish. Which means it MUST be honest
  // about its own state — otherwise a half-read list looks like a
  // complete one, and that's worse than waiting.
  const inProgress = reading.length
    ? `  <div class="live"><span class="dot"></span>${escapeHtml(t('stillReading'))} ${escapeHtml(reading.join(', '))}.
       ${escapeHtml(t('fromMemoryNotice'))}</div>`
    : '';

  const warning = broken.length
    ? `  <div class="warn">${escapeHtml(t('couldNotRead'))} ${escapeHtml(broken.join(', '))}.
       ${escapeHtml(t('fromMemoryNotice'))}</div>`
    : '';

  const emptyBanner = !burning.length && !later.length && !newMaterials.length
    ? `  <div class="empty">${escapeHtml(t('emptyState'))}</div>`
    : '';

  // Dismissable per-VERSION, not per-session: dismissedVersion (see
  // 26-update-check.js) only matches the exact version it was recorded
  // against, so dismissing v1.3.0's banner today doesn't silently
  // swallow v1.4.0's whenever that ships later — the comparison here is
  // deliberately == the latest version, not "was dismissed at all".
  const updateStatus = readUpdateStatus();
  const updateBanner = (updateStatus && updateStatus.updateAvailable &&
                         updateStatus.latestVersion !== updateStatus.dismissedVersion)
    ? `  <div class="warn update-banner" id="update-banner">
       <span>${escapeHtml(t('updateAvailable'))} <b>v${escapeHtml(updateStatus.latestVersion)}</b>
       (${escapeHtml(t('updateCurrentlyRunning'))} v${escapeHtml(updateStatus.currentVersion)}).
       <a href="${escapeHtml(updateStatus.url)}" target="_blank" rel="noopener">${escapeHtml(t('updateViewRelease'))}</a></span>
       <button type="button" class="update-dismiss" data-version="${escapeHtml(updateStatus.latestVersion)}"
               onclick="dismissUpdateBanner(this)"
               title="${escapeHtml(t('updateDismiss'))}">&times;</button>
     </div>`
    : '';

  // Not dismissable, unlike updateBanner above — an unset email isn't an
  // FYI, it's the reason 05-playwright-draft.js can't correctly build
  // Classroom links yet (see AUTHUSER there), so this keeps showing every
  // reload until it's actually fixed, the same "repeat until fixed, not
  // once and done" rule COOKIES_EXPIRED's own notification already
  // follows. Only checks the placeholder EMAIL, not canvas — canvas is
  // legitimately optional (plenty of schools don't use it, and an empty
  // string there already means "don't read it" correctly on its own),
  // so a still-placeholder canvas alone isn't something to nag about.
  const setupSettings = readSettings();
  const setupBanner = setupSettings.email === 'your.school@email.example'
    ? `  <div class="warn setup-banner">
       <span>${escapeHtml(t('setupIncomplete'))} — ${escapeHtml(t('setupIncompleteHint'))}</span>
       <a href="#" onclick="toggleSettingsPanel(); return false;">${escapeHtml(t('setupOpenSettings'))}</a>
     </div>`
    : '';

  // Not dismissable, same reasoning as setupBanner above: this only
  // shows for a currently-true problem, not a one-time event, so it
  // keeps nagging every reload until it's actually fixed. The two
  // conditions checked here are the ones 05-playwright-draft.js/
  // 10-canvas.js already tag with a specific, recognizable message when
  // the failure really is "the browser session needs a person to sign
  // back in" — not just any Classroom/Canvas problem (a timeout, a
  // broken page) gets this banner, only ones confirmed to be that.
  // A click opens the real, visible sign-in browser window directly —
  // no more figuring out there's a terminal command, or that a headless
  // scheduled check has no window a person could even sign into.
  const liveStatus = checkStatus();
  const signInNeeded =
    (liveStatus.classroom.status === 'problem' && /cookies expired/.test(liveStatus.classroom.detail || '')) ||
    (liveStatus.canvas.status === 'problem' && /stuck on sign-in/.test(liveStatus.canvas.detail || ''));
  const signInBanner = signInNeeded
    ? `  <div class="warn sign-in-banner">
       <span>${escapeHtml(t('signInNeeded'))}</span>
       <a href="#" id="sign-in-banner-link" onclick="triggerSignIn(this); return false;">${escapeHtml(t('signInNow'))}</a>
     </div>`
    : '';

  // Saved settings that only a collection can apply (which classes are
  // read, the Canvas address) sit in settings.json until the next check
  // runs — see pendingFetchKeys in 19-settings.js. Nothing on the page
  // has changed yet, so this says so, and offers to start the check now
  // instead of leaving it to the next automatic or manual one. Not
  // dismissable, same as the banners above: it's true until a collection
  // has actually read the new values, and puts the setting back the way
  // it was and it goes away by itself.
  const pendingBanner = pendingFetchKeys(setupSettings).length
    ? `  <div class="warn pending-banner" id="pending-banner">
       <span>${escapeHtml(t('pendingFetchText'))}</span>
       <a href="#" id="pending-banner-link" onclick="startPendingCheck(this); return false;">${escapeHtml(t('pendingFetchNow'))}</a>
     </div>`
    : '';

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t('title'))}</title>
<style>
  /* 8-BIT SKIN — the surfaces (backgrounds, cards, text, dividers) are
     the app's original colours; only the accents come from the icon
     (icon-source.png is a 16-colour VGA-style sprite: blue #0004ff,
     cyan #00ffff). Dark mode uses the cyan as its accent.
       --bg2       a step off --bg, for the scrollbar track
       --ink       chunky borders and hard shadows (near-black / pale cyan)
       --line      still the SOFT tone — dividers, badge fills. Borders
                   around cards and buttons use --ink instead, so a
                   divider inside a card doesn't turn into a thick bar.
     Type is untouched on purpose: pixel fonts are hard to read at body
     size and mostly lack Cyrillic, which this app's default language
     (ru) needs. */
  :root {
    --bg: ${PIXEL_THEME.light.bg}; --bg2: #eceef2; --card: ${PIXEL_THEME.light.card}; --text: #1a1c1e; --dim: ${PIXEL_THEME.light.dim};
    --line: ${PIXEL_THEME.light.line}; --hot: ${PIXEL_THEME.light.hot}; --new: ${PIXEL_THEME.light.new}; --warn: #6b3a00;
    --warnbg: ${PIXEL_THEME.light.warnbg}; --ink: ${PIXEL_THEME.light.ink}; --shadow: #101018;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: ${PIXEL_THEME.dark.bg}; --bg2: #1c1f24; --card: ${PIXEL_THEME.dark.card}; --text: #e8eaed; --dim: ${PIXEL_THEME.dark.dim};
      --line: ${PIXEL_THEME.dark.line}; --hot: ${PIXEL_THEME.dark.hot}; --new: ${PIXEL_THEME.dark.new}; --warn: #ffff55;
      --warnbg: ${PIXEL_THEME.dark.warnbg}; --ink: ${PIXEL_THEME.dark.ink}; --shadow: #000;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 60px;
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  main { max-width: 1800px; margin: 0 auto; }
  /* Assignments on the left, announcements on the right. Stacked on narrow screens. */
  .columns { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 28px; }
  @media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
  .post {
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 8px; display: block;
    text-decoration: none; color: inherit;
  }
  .post:hover { border-color: var(--new); }
  .post .post-top {
    display: flex; gap: 8px; font-size: 12px; color: var(--dim);
    margin-bottom: 6px; flex-wrap: wrap;
  }
  .post .text { font-size: 14px; white-space: pre-wrap; }
  /* Long announcements get clamped; the "expand" button lifts the clamp */
  .post .text.collapsed {
    display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .actions {
    display: flex; gap: 12px; align-items: center; margin-top: 8px;
    font-size: 13px;
  }
  .actions a { color: var(--dim); text-decoration: none; }
  .actions a:hover { color: var(--new); }
  .expand-btn {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--new); font: inherit;
  }
  /* Its own scrollbar for the feed: otherwise nineteen announcements
     stretch the page and the assignments on the left drift up and away */
  .feed {
    max-height: calc(100vh - 220px); overflow-y: auto;
    padding-right: 6px;
  }
  header { margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .when { color: var(--dim); font-size: 13px; }
  /* Per-platform check status — three small dots, one per platform,
     colors matching the meaning: --new (blue) for the same positive
     sense the API's "running" indicator already uses, --hot (red) for
     "something's actually wrong, go look", --dim (gray) for "not being
     checked at all" (off, or no check has completed yet). Each dot's
     own title attribute is the quick, one-platform answer on hover;
     clicking the whole row (a real <button>, not a span, so it's
     reachable by keyboard and works on touch where hover doesn't)
     opens the panel below with the full breakdown, timestamps and
     error detail included. */
  /* Same visible-at-rest chrome as .reload right next to it (border +
     card background) — an invisible-until-hover button doesn't read as
     clickable at all, and this one needs to, unlike the dots-only look
     tried first. */
  .check-status {
    margin-left: 10px; display: inline-flex; align-items: center; gap: 5px;
    vertical-align: middle; height: 26px; box-sizing: border-box;
    background: var(--card); border: 2px solid var(--ink); border-radius: 7px;
    padding: 0 8px; cursor: pointer; transition: border-color .15s;
  }
  .check-status:hover { border-color: var(--new); }
  .status-dot {
    width: 9px; height: 9px; border-radius: 50%; display: inline-block;
    cursor: default;
  }
  .status-dot.status-ok { background: var(--new); }
  .status-dot.status-problem { background: var(--hot); }
  .status-dot.status-unknown { background: var(--dim); opacity: .5; }
  .check-status-panel {
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    padding: 12px 14px; margin: 8px 0 0; max-width: 420px;
  }
  .check-status-panel-title { font-weight: 600; margin-bottom: 8px; }
  .check-status-row {
    display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px;
    font-size: 13px; padding: 5px 0; border-top: 1px solid var(--line);
  }
  .check-status-row:first-of-type { border-top: none; }
  .check-status-row .status-dot { align-self: center; }
  .check-status-name { font-weight: 500; }
  .check-status-word { color: var(--dim); }
  .check-status-time { color: var(--dim); font-size: 12px; margin-left: auto; }
  .check-status-detail-text {
    flex-basis: 100%; color: var(--dim); font-size: 12px; white-space: pre-wrap;
    word-break: break-word;
  }
  /* Reload/fresh-check/settings buttons — like a browser's, but on the
     page itself: the digest window has no browser chrome at all.
     Refresh just rereads the file; Fresh check triggers a real
     collection pass (see the two separate click handlers below) —
     used to be one button (click vs. hold), split into two so each one
     can say what it actually does instead of relying on a tooltip. */
  .reload {
    width: 26px; height: 26px; padding: 0; margin-left: 8px;
    vertical-align: middle; cursor: pointer;
    border: 2px solid var(--ink); border-radius: 7px;
    background: var(--card); color: var(--dim);
    font-size: 15px; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
    transition: color .15s, border-color .15s;
  }
  /* .named — Refresh and Fresh check specifically: icon plus a visible
     label, not just an icon with a tooltip. Auto width instead of the
     plain icon button's fixed 26px square. */
  .reload.named {
    width: auto; height: auto; padding: 4px 10px; gap: 6px;
    display: inline-flex; align-items: center;
    font-size: 12px; font-family: inherit;
  }
  .reload-icon { display: inline-block; }
  /* The three header icons are stencils: a real (tiny) pixel-art image used
     as a CSS mask over a block of currentColor, so each inherits its
     colour exactly like a text glyph would — dim by default, cyan/blue on
     hover, while spinning, in dark or light mode — with no separate asset
     per colour, theme or state. A plain img element couldn't do that.
     Drawn 32px, shown 16px, and pixelated so a display that can't map the
     art 1:1 still picks whole pixels instead of smearing them. */
  :root {
    --icon-refresh: url("data:image/png;base64,${ICON_REFRESH_B64}");
    --icon-freshcheck: url("data:image/png;base64,${ICON_FRESHCHECK_B64}");
    --icon-settings: url("data:image/png;base64,${ICON_SETTINGS_B64}");
    --icon-loading: url("data:image/png;base64,${ICON_LOADING_LIGHT_B64}");
  }
  @media (prefers-color-scheme: dark) {
    :root { --icon-loading: url("data:image/png;base64,${ICON_LOADING_B64}"); }
  }
  .pixel-icon {
    display: inline-block; flex: 0 0 auto; width: 16px; height: 16px;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    -webkit-mask-position: center; mask-position: center;
    -webkit-mask-size: 16px 16px; mask-size: 16px 16px;
    image-rendering: pixelated;
  }
  .icon-refresh { -webkit-mask-image: var(--icon-refresh); mask-image: var(--icon-refresh); }
  .icon-freshcheck { -webkit-mask-image: var(--icon-freshcheck); mask-image: var(--icon-freshcheck); }
  .icon-settings { -webkit-mask-image: var(--icon-settings); mask-image: var(--icon-settings); }
  .reload:hover { color: var(--new); border-color: var(--new); }
  /* Spins while a check is running. Only the ICON spins, not the whole
     button — with a text label sitting next to it now, spinning the
     whole button would spin the label too. No :active rotation of its
     own on purpose — it would fight this one. */
  .reload.spinning .reload-icon, .reload.spinning {
    color: var(--new); border-color: var(--new);
  }
  .reload.spinning .reload-icon {
    /* steps(8), not linear: eight 45-degree jumps a turn reads as a
       sprite animation instead of a smooth modern spinner. */
    animation: spin 0.9s steps(8) infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* Announcement filters — their own strip, in their own column. Separate
     from the main panel: announcements have no due date or type, the
     general checkboxes don't apply to them. */
  .announcement-filters {
    display: flex; flex-wrap: wrap; gap: 2px 14px; margin: -2px 0 10px;
    font-size: 13px;
  }
  .announcement-filters .check-row { flex: 0 1 auto; gap: 6px; }
  .announcement-filters .check-row .label-text { max-width: 210px; }
  /* The hidden attribute alone won't hide .post: it has its own display set */
  .post[hidden] { display: none; }
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
    display: block; background: var(--card); border: 2px solid var(--ink);
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
  .update-banner, .setup-banner, .sign-in-banner, .pending-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .update-banner a, .setup-banner a, .sign-in-banner a, .pending-banner a { color: inherit; text-decoration: underline; }
  /* A REAL, PRE-EXISTING BUG, CAUGHT DURING WINDOWS TESTING — every
     other hideable element here (.post, section, .settings-panel,
     .settings-section) already has its own [hidden] { display: none; }
     counter-rule; this one never did. Without it, dismissUpdateBanner()
     setting .hidden = true had zero visual effect: an ordinary author
     rule like the plain "display: flex" above always beats the
     browser's own [hidden] default, regardless of specificity — same
     cascade tier, source order decides, and this rule came first. Not
     Electron-specific; would misbehave identically on the Mac app too,
     just apparently never actually clicked on there. */
  .update-banner[hidden] { display: none; }
  /* A collection is running. Filled in whole 8px blocks with a 2px gap
     between them, snapped by the page script — a smooth bar would be the
     one thing on this page that isn't drawn in pixels. */
  .check-progress { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .check-progress-body { flex: 1 1 auto; min-width: 0; }
  /* The app icon, running: its speed-dashes swap between long and short, two
     frames of a sprite stepped between with no easing (steps(1) holds each
     frame, then jumps). At its own 32px, one art pixel per CSS pixel, so it's
     crisp on every display — the header icons taught that shrinking pixel art
     by half only works where the screen can spare the pixels. */
  .check-progress-icon {
    flex: 0 0 auto; width: 32px; height: 32px;
    background-image: var(--icon-loading); background-repeat: no-repeat;
    background-size: 64px 32px; background-position: 0 0;
    image-rendering: pixelated;
    animation: dashCycle .6s steps(1) infinite;
  }
  @keyframes dashCycle {
    0% { background-position: 0 0; }
    50% { background-position: -32px 0; }
    100% { background-position: 0 0; }
  }
  .check-progress[hidden] { display: none; }
  .check-progress-head {
    display: flex; justify-content: space-between; margin-bottom: 6px;
    font-size: 12px; color: var(--dim);
  }
  .check-progress-track { height: 16px; }
  .check-progress-fill {
    height: 100%; background-color: var(--new);
    background-image: repeating-linear-gradient(to right, transparent 0 6px, var(--card) 6px 8px);
    transition: width .25s steps(4);
  }
  /* Before the class list is known there's no fraction to show, so a block
     sweeps back and forth instead. */
  .check-progress.indeterminate .check-progress-fill {
    width: 22px !important; transition: none;
    animation: checkScan 1.2s steps(12) infinite alternate;
  }
  @keyframes checkScan { from { margin-left: 0; } to { margin-left: calc(100% - 22px); } }
  @media (prefers-reduced-motion: reduce) {
    .check-progress-icon { animation: none; }
    .check-progress-fill { transition: none; }
    .check-progress.indeterminate .check-progress-fill { animation: none; }
  }
  /* The gear grows to say "Saving…" and then "Saved." — closing the panel
     is what saves, and this is where the eye already is. The glyph keeps
     its size; only the width changes, like Refresh and Fresh check. */
  .reload.expanded {
    width: auto; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px;
    color: var(--new); border-color: var(--new);
  }
  .settings-status { font-size: 12px; font-family: inherit; }
  .settings-status:empty { display: none; }
  .update-dismiss {
    background: none; border: none; color: inherit; opacity: .6;
    font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px;
    flex-shrink: 0;
  }
  .update-dismiss:hover { opacity: 1; }
  .update-error-note { color: var(--warn); }
  .live {
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 20px; font-size: 14px; color: var(--dim);
    display: flex; gap: 9px; align-items: baseline;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: var(--new);
    flex: 0 0 auto; animation: pulse 1s steps(2, jump-none) infinite;
  }
  @keyframes pulse { 50% { opacity: .25; } }
  .empty { color: var(--dim); padding: 20px 0; }
  .row { display: flex; gap: 8px; align-items: stretch; margin-bottom: 8px; }
  .row .item { flex: 1; margin-bottom: 0; }
  .quiet {
    flex: 0 0 auto; display: flex; align-items: center; padding: 0 12px;
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    color: var(--dim); font-size: 13px; text-decoration: none; white-space: nowrap;
  }
  .quiet:hover { color: var(--text); border-color: var(--dim); }
  .row.done { opacity: .45; }
  .row.done .quiet { pointer-events: none; }
  /* A card dismissed with "not urgent": fades first, then slides away and
     gets removed entirely. It used to just fade and sit there until the
     next collection — the user rightly pointed out nothing works that way. */
  .row { transition: opacity .25s ease, transform .25s ease; }
  .row.dismissed { opacity: 0; transform: translateX(12px); }
  /* Doesn't match a filter. !important — because .row.hidden-row.shown
     also sets display, and without this they'd fight each other. */
  .row.filtered-out { display: none !important; }
  section[hidden] { display: none; }
  /* Filters as checkbox lists, not dropdowns: the user asked for it to
     look like the Steam library — every option visible at once along
     with how many cards it matches, instead of one at a time behind a
     toggle. */
  .filters {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 18px 24px;
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 20px; font-size: 13px;
  }
  .filter-group .group-name {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--dim); margin-bottom: 7px;
  }
  .check-row {
    display: flex; gap: 7px; align-items: center; padding: 3px 0;
    cursor: pointer; color: var(--text);
  }
  .check-row:hover { color: var(--new); }
  .check-row input { flex: 0 0 auto; margin: 0; }
  /* Long class names get clamped: otherwise the column sprawls across half the screen */
  .check-row .label-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .check-row .count-badge {
    margin-left: auto; color: var(--dim); font-size: 12px;
    background: var(--line); border-radius: 9px; padding: 0 6px;
  }
  .filters button {
    background: none; border: 2px solid var(--ink); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 5px 10px;
    cursor: pointer; margin-top: 10px;
  }
  .filters button:hover { color: var(--text); border-color: var(--dim); }
  .filters .result { color: var(--dim); font-size: 12px; margin-top: 8px; }
  /* Settings panel. Hidden until the gear icon is clicked. */
  .settings-panel {
    background: var(--card); border: 2px solid var(--ink); border-radius: 10px;
    padding: 14px 16px; margin-bottom: 20px; font-size: 13px;
  }
  .settings-panel[hidden] { display: none; }
  /* Sidebar + content, replacing what used to be one long scrolling
     list of every setting in a row. saveSettings() doesn't care —
     it walks [data-key]/[data-bool-key] under #settings-panel
     regardless of which .settings-section is currently hidden. */
  .settings-body { display: flex; gap: 18px; align-items: flex-start; margin-top: 10px; }
  .settings-sidebar {
    display: flex; flex-direction: column; gap: 2px; flex: 0 0 150px;
    border-right: 1px solid var(--line); padding-right: 12px;
  }
  .settings-nav-btn {
    background: none; border: none; text-align: left; color: var(--dim);
    font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 7px;
    cursor: pointer;
  }
  .settings-nav-btn:hover { color: var(--text); background: var(--bg); }
  .settings-nav-btn.active { color: var(--text); background: var(--bg); font-weight: 600; }
  .settings-content { flex: 1 1 auto; min-width: 0; }
  .settings-section[hidden] { display: none; }
  @media (max-width: 700px) {
    .settings-body { flex-direction: column; }
    .settings-sidebar {
      flex-direction: row; flex-wrap: wrap; border-right: none;
      border-bottom: 1px solid var(--line); padding-right: 0;
      padding-bottom: 8px; width: 100%;
    }
  }
  .setting-row {
    display: grid; grid-template-columns: 190px minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 10px; align-items: center; margin-bottom: 8px;
  }
  @media (max-width: 700px) { .setting-row { grid-template-columns: 1fr; gap: 4px; } }
  .field-name { color: var(--text); }
  .field-hint { color: var(--dim); font-size: 12px; }
  /* ONLY text fields and dropdowns. This used to say ".setting-row input",
     and the rule caught the CHECKBOXES in the class list too: each one
     stretched to the full row width, leaving no room for its label. First
     it collapsed to zero width (names vanished entirely), then to one
     word per line. The cause wasn't the label — it was its neighbor. */
  .setting-row input[type="text"], .setting-row input[type="password"], .setting-row select {
    font: inherit; font-size: 13px; padding: 5px 8px; border-radius: 7px;
    border: 2px solid var(--ink); background: var(--bg); color: var(--text);
    width: 100%;
  }
  .setting-row input[type="checkbox"] { flex: 0 0 auto; width: auto; margin: 2px 0 0; }
  /* A TOGGLE SWITCH, NOT A CHECKBOX, FOR A STANDALONE ON/OFF SETTING.
     Checkboxes read as "pick zero or more from this set" — right for
     the class list, the type list, the due-date ranges, where several
     can be checked at once. treatUndatedAsUrgent, showEmptyClasses, and
     the two "show hidden/removed" filters are each their own single
     yes/no, with nothing else in the group to pick alongside them, so
     they look like the setting they actually are instead of borrowing
     the multi-select one's shape. Still a real <input type="checkbox">
     underneath — :checked, onchange, data-bool-key, id all keep working
     exactly as before; only the appearance changes. */
  /* input[type="checkbox"].toggle, NOT plain input.toggle — has to tie
     .setting-row input[type="checkbox"]'s specificity above (a class +
     an attribute selector) to actually win the width. Losing that fight
     was exactly what made these stretch to fill the whole row: an
     auto-width grid item defaults to STRETCHING to fill its column,
     and width: auto (from the older, more specific rule) never
     overrode the explicit width set here, so the pill filled the
     entire middle column instead of staying a fixed 34px wide. */
  input[type="checkbox"].toggle {
    appearance: none; -webkit-appearance: none;
    width: 34px; height: 20px; border-radius: 10px;
    background: var(--line); position: relative; cursor: pointer;
    transition: background 0.15s; flex: 0 0 auto; justify-self: start;
    margin: 0; padding: 0;
  }
  input[type="checkbox"].toggle::before {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,.3);
  }
  input[type="checkbox"].toggle:checked::before { transform: translateX(14px); }
  /* Email and Canvas address start masked like a password field — a
     screen share or a screenshot for a bug report shouldn't leak either
     one. The little eye button reveals it, same idea as a password
     field's own show/hide toggle. */
  .field-with-toggle { position: relative; }
  .field-with-toggle input { padding-right: 30px; }
  .field-with-value { display: flex; align-items: center; gap: 10px; }
  .field-with-value input[type="range"] { flex: 1 1 auto; min-width: 0; accent-color: var(--new); }
  .field-with-value .slider-value {
    flex: 0 0 auto; color: var(--dim); font-size: 12px; min-width: 52px;
  }
  .reveal-btn {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; font-size: 14px;
    line-height: 1; padding: 2px; color: var(--dim);
  }
  .reveal-btn:hover { color: var(--text); }
  .mini-btn {
    background: none; border: 2px solid var(--ink); border-radius: 6px;
    color: var(--dim); font: inherit; font-size: 12px; padding: 3px 8px;
    cursor: pointer; flex: 0 0 auto; white-space: nowrap;
  }
  .mini-btn:hover { color: var(--text); border-color: var(--dim); }
  .api-status { margin-left: 6px; }
  .api-status-on { color: var(--new); }
  .settings-actions {
    display: flex; gap: 10px; align-items: center; margin-top: 12px;
    flex-wrap: wrap;
  }
  .settings-actions button {
    background: none; border: 2px solid var(--ink); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer;
  }
  .settings-actions button:hover { color: var(--text); border-color: var(--dim); }
  #settings-result { color: var(--dim); font-size: 12px; }
  /* Collapsible class list. */
  .class-picker {
    border: 2px solid var(--ink); border-radius: 7px; background: var(--bg);
  }
  .class-picker summary {
    cursor: pointer; padding: 5px 8px; color: var(--dim); font-size: 13px;
    user-select: none;
  }
  .class-picker summary:hover { color: var(--text); }
  .class-picker[open] summary { border-bottom: 1px solid var(--line); }
  .picker-summary { color: var(--text); }
  .class-list { max-height: 190px; overflow-y: auto; padding: 6px 8px; }
  .class-list .check-row { padding: 3px 0; align-items: flex-start; }
  /* LABELS ARE NOT CLAMPED HERE. In the general filters a class name is
     clamped to one line, and that's correct there — the column is narrow.
     Here it's the opposite: names like "AP World Hist 1 Per 2 - 6255D-1
     (S1)" need to be seen in full, or you can't tell what you're checking.
     Without this rule the flexbox squeezed the label down to ZERO width:
     an element with overflow:hidden gets a minimum width of zero, and the
     text disappeared entirely — confirmed in the browser. */
  .class-list .check-row .label-text {
    overflow: visible; white-space: normal; text-overflow: clip;
    max-width: none; line-height: 1.35;
    /* flex: 1 — so the label takes up all available width. Without it the
       flexbox shrinks it down to the longest WORD, and the class name
       wraps one word per line. */
    flex: 1;
  }
  /* The class-list row is wider than the others: names are long, and in a
     narrow column they fall apart. The hint moves under the list. */
  .setting-row.wide { grid-template-columns: 190px minmax(0, 1fr); }
  .setting-row.wide .field-hint { grid-column: 2; margin-top: 4px; }
  .item.overdue-item { border-left: 3px solid var(--hot); }
  .overdue-since { color: var(--hot); }
  /* The "hide" button is deliberately unobtrusive: so it isn't hit by
     accident. Appears when hovering over the card. */
  .quiet.quiet-faint { opacity: .25; }
  .row:hover .quiet.quiet-faint { opacity: 1; }
  /* Removed by the teacher: visible that the entry exists, but it's no
     longer about actual work. */
  .row.gone .item { opacity: .55; border-style: dashed; }
  .removed-badge {
    background: var(--line); color: var(--dim); border-radius: 6px;
    padding: 0 6px; font-size: 12px;
  }
  .row.hidden-row { display: none; }
  .row.hidden-row.shown { display: flex; opacity: .5; }
  .show-hidden-btn {
    background: none; border: 2px solid var(--ink); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer; margin-top: 4px;
  }
  .show-hidden-btn:hover { color: var(--text); border-color: var(--dim); }
  .reminder-toggle-btn {
    background: none; border: 2px solid var(--ink); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer; margin-top: 4px; margin-right: 8px;
  }
  .reminder-toggle-btn:hover { color: var(--text); border-color: var(--dim); }
  .reminder-add {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin-bottom: 4px;
  }
  .reminder-add input[type="text"] {
    font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 7px;
    border: 2px solid var(--ink); background: var(--bg); color: var(--text);
  }
  .reminder-add input#reminder-title { flex: 1 1 180px; min-width: 120px; }
  .reminder-add input#reminder-class { flex: 1 1 120px; min-width: 90px; }
  .reminder-due-field { display: inline-flex; align-items: center; gap: 4px; }
  .reminder-add input[type="datetime-local"] {
    font: inherit; font-size: 13px; padding: 5px 6px; border-radius: 7px;
    border: 2px solid var(--ink); background: var(--bg); color: var(--text);
  }
  .reminder-add button {
    background: none; border: 2px solid var(--ink); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer;
  }
  .reminder-add button:hover { color: var(--text); border-color: var(--dim); }
  #reminders-result { color: var(--dim); font-size: 12px; flex-basis: 100%; }
  footer { color: var(--dim); font-size: 12px; margin-top: 32px; }

  /* ── 8-bit skin: what can't be done by editing an existing rule ──
     The 2px ink borders were applied in place above; this block adds the
     pieces that have no rule of their own yet. Kept together (and last)
     so the whole look can be tuned or backed out in one place.
     Selectors deliberately match the originals they sit on top of —
     same specificity, later in the file — rather than reaching for
     !important. */

  /* Small labels get the outline too. .badge's text was a hard-coded
     white — right on the light theme's blue, unreadable on the dark
     theme's cyan — so it takes the card colour instead. */
  .count, .plat, .badge, .removed-badge, .check-row .count-badge {
    border: 2px solid var(--ink);
  }
  .badge { color: var(--card); }

  /* Checkboxes: drawn boxes (their stepped frame and filled-when-on look
     come from the generated sprite rules at the end of this block) — not
     a native tick mark. The toggle has its own rule below. */
  input[type="checkbox"]:not(.toggle) {
    appearance: none; -webkit-appearance: none;
    width: 14px; height: 14px; border: 2px solid var(--ink);
    cursor: pointer; flex: 0 0 auto;
  }

  /* Toggle switch: stepped track, square knob. The knob hops across in
     five 4px steps in 0.05s — 20px of travel, a multiple of the 2px cell, so it
     lands on the pixel grid every frame — instead of gliding. The
     track's colour can't animate (it's a sprite swap), so it changes
     the instant the knob starts moving. */
  input[type="checkbox"].toggle {
    width: 40px; height: 22px; border: 2px solid var(--ink); transition: none;
  }
  input[type="checkbox"].toggle::before {
    top: 3px; left: 2px; width: 12px; height: 12px; border-radius: 0;
    background: var(--ink); box-shadow: none;
    transition: transform 0.05s steps(5);
    /* A little rounded, still pixels — and in proportion with the track.
       The track loses a 2px cell from each corner of a 40x22 frame; the
       same 2px off this 12x12 knob was three times as round and read as a
       disc next to it, so the cut is 1px here: about the same fraction. */
    clip-path: polygon(1px 0, 11px 0, 11px 1px, 12px 1px, 12px 11px, 11px 11px,
      11px 12px, 1px 12px, 1px 11px, 0 11px, 0 1px, 1px 1px);
  }
  input[type="checkbox"].toggle:checked::before {
    transform: translateX(20px); background: var(--card);
  }
  @media (prefers-reduced-motion: reduce) {
    input[type="checkbox"].toggle::before { transition: none; }
  }

  /* The class picker's disclosure arrow: the browser's own triangle is a
     smooth vector, so it's swapped for a stepped one — a right-pointing
     staircase of 2px cells that turns into a down-pointing one when the
     list is open. Drawn with clip-path (no border or shadow on it to
     lose) in the text colour, so it dims and brightens with the label. */
  .class-picker summary { list-style: none; display: flex; align-items: center; gap: 8px; }
  .class-picker summary::-webkit-details-marker { display: none; }
  .class-picker summary::before {
    content: ''; flex: none; width: 6px; height: 10px; background: currentColor;
    clip-path: polygon(0 0, 2px 0, 2px 2px, 4px 2px, 4px 4px, 6px 4px, 6px 6px,
      4px 6px, 4px 8px, 2px 8px, 2px 10px, 0 10px);
  }
  .class-picker[open] summary::before {
    width: 10px; height: 6px;
    clip-path: polygon(0 0, 10px 0, 10px 2px, 8px 2px, 8px 4px, 6px 4px, 6px 6px,
      4px 6px, 4px 4px, 2px 4px, 2px 2px, 0 2px);
  }

  /* The slider: a square track that fills with the accent colour up to
     the thumb, and a framed block for a thumb. WebKit can't colour the
     travelled part of a native slider, so the fill is a gradient driven
     by --pct (0 to 1), which syncSliderFill() in the page script keeps
     current. Thumb travel is 14px narrower than the track, hence the
     7px-and-14px arithmetic: it puts the edge of the fill under the
     thumb's centre. box-sizing is set by hand because the page-wide
     border-box rule doesn't reach these pseudo-elements. The frames
     (border-image) are in the generated block at the end. */
  .field-with-value input[type="range"] {
    -webkit-appearance: none; appearance: none; background: transparent;
    height: 22px; margin: 0; cursor: pointer;
  }
  .field-with-value input[type="range"]::-webkit-slider-runnable-track {
    box-sizing: border-box; height: 12px; border: 2px solid var(--ink);
    background-clip: padding-box;
    background-image: linear-gradient(to right,
      var(--new) calc(7px + (100% - 14px) * var(--pct, 0)), var(--card) 0);
  }
  .field-with-value input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; box-sizing: border-box;
    width: 14px; height: 22px; margin-top: -7px; border: 2px solid var(--ink);
  }

  /* Selected settings section reads like a highlighted DOS menu row. */
  .settings-nav-btn:hover { background: var(--line); }
  .settings-nav-btn.active { background: var(--new); color: var(--card); }

  /* Chunky scrollbars to match. */
  ::-webkit-scrollbar { width: 14px; height: 14px; }
  ::-webkit-scrollbar-track { background: var(--bg2); border-left: 2px solid var(--ink); }
  ::-webkit-scrollbar-thumb { background: var(--card); border: 2px solid var(--ink); }
  ::-webkit-scrollbar-thumb:hover { background: var(--new); }

  ${pixelCornerCss()}
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(t('title'))}</h1>
    <div class="when">${escapeHtml(t('updated'))} ${escapeHtml(time)}<button class="reload named"
         id="refresh-button"
         title="${escapeHtml(t('refreshHint'))}"><span class="reload-icon pixel-icon icon-refresh"></span><span class="reload-label">${escapeHtml(t('refreshLabel'))}</span></button><button class="reload named"
         id="freshcheck-button"
         title="${escapeHtml(t('freshCheckHint'))}"><span class="reload-icon pixel-icon icon-freshcheck"></span><span class="reload-label">${escapeHtml(t('freshCheckLabel'))}</span></button><button class="reload"
         id="settings-button" onclick="toggleSettingsPanel()"
         title="${escapeHtml(t('settingsTitle'))}"><span class="pixel-icon icon-settings"></span><span class="settings-status" id="settings-status"></span></button>${checkStatusIndicator()}</div>
    <div class="platform">${escapeHtml(platforms.join(' · '))}</div>
${checkStatusPanel()}
  </header>
${progressBar}
${inProgress}
${setupBanner}
${signInBanner}
${pendingBanner}
${updateBanner}
${warning}
  <div class="columns">
  <div>
${settingsPanel()}
${filtersPanel(allItems, announcements, now, rawItems)}
${emptyBanner}
${remindersSection(now)}
${overdueSection(overdue, now)}
${section(t('dueSoon'), burning, now, freshIds, t('dueSoonCaption'))}
${section(t('ahead'), later, now, freshIds)}
${section(t('newMaterials'), newMaterials, now, freshIds, t('materialsCaption'))}
${section(t('mutedSection'), deferred, now, freshIds, t('mutedCaption'))}
${section(t('removed'), gone, now, freshIds, t('removedCaption'))}
  </div>
  <div>
${announcementsSection(announcements, freshAnnouncementIds)}
    <section>
      <h2>${escapeHtml(t('transcripts'))}</h2>
      <p class="hint">${escapeHtml(t('transcriptsCaption'))}</p>
    </section>
  </div>
  </div>
  <footer>${escapeHtml(t('footerNote'))}</footer>
</main>
<script>
// A BROKEN SCRIPT HAS TO SAY SO OUT LOUD.
//
// This page's buttons all depend on the script below. In a browser, a
// script that dies leaves an explanation in the console. In the native
// window there is no console, so the failure is completely silent: the
// buttons just quietly stop working, which is indistinguishable from
// them working and having nothing to do. That has now happened twice —
// once from a single escaped character, once from a page-reload race —
// and both times the search started at the wrong end because there was
// no error to see.
//
// So errors get pinned to the top of the page instead. Ugly on purpose:
// this should be impossible to miss and embarrassing to leave in place.
// Registered before everything else, so it also catches a syntax error
// in the script that follows it.
window.onerror = function (message, source, line, column) {
  try {
    var box = document.getElementById('script-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'script-error';
      box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;' +
        'background:#7f1d1d;color:#fff;padding:10px 14px;font:13px monospace;' +
        'white-space:pre-wrap;';
      document.body.insertBefore(box, document.body.firstChild);
    }
    box.textContent += 'Script error: ' + message + '\\n  line ' + line +
      ':' + column + '\\n';
  } catch (e) { /* nothing left to report with */ }
  return false;
};

// WORDS — translations for the code that already runs inside the page.
//
// Pasting the translation directly into the code text isn't safe: an
// apostrophe in an English phrase ("don't") would break the string and
// kill the entire page script — exactly like it already happened once
// with a line break inside confirm(). JSON.stringify escapes everything
// itself, so it's safe regardless of language.
const WORDS = ${JSON.stringify({
  expand: t('expand'),
  collapse: t('collapse'),
  hide: t('hide'),
  restore: t('restore'),
  muted: t('mutedBadge'),
  confirmRemove: t('confirmRemove'),
  confirmRemoveHint: t('confirmRemoveHint'),
  showHidden: t('showHidden'),
  hideAgain: t('hideAgain'),
  showing: t('filterShowingCount'),
  checking: t('checking'),
  checkFailed: t('checkFailed'),
  pendingChecking: t('pendingFetchStarting'),
  progressChecking: t('progressChecking'),
  progressOf: t('settingsOf'),
  progressStarting: t('progressStarting'),
  progressFinishing: t('progressFinishing'),
  signInNow: t('signInNow'),
  signInOpening: t('signInOpening'),
  signInFailed: t('signInFailed'),
  saving: t('settingsSaving'),
  saveFailed: t('settingsSaveFailed'),
  saved: t('settingsSaved'),
  restored: t('restoredBadge'),
  monthWord: t('monthWord'),
  monthsWord: t('monthsWord'),
  confirmRollToken: t('confirmRollToken'),
  confirmRollTokenHint: t('confirmRollTokenHint'),
  copied: t('settingsCopied'),
  confirmDeleteReminder: t('confirmDeleteReminder'),
  reminderTitleRequired: t('reminderTitleRequired'),
  reminderAdding: t('reminderAdding'),
  reminderAdd: t('reminderAdd'),
  reminderSave: t('reminderSave'),
  reminderSaving: t('reminderSaving'),
})};

// ── Reaching outside the page ──
//
// A page has no filesystem access at all — that's a browser security
// guarantee, not something this project can work around — so every
// action that needs to persist anything (a hidden item, a saved
// setting, a fresh collection) has to ask something else to do it.
//
// THIS USED TO MEAN ONE PATH FOR EVERYTHING: set the address bar to a
// napominalka:// URL, and let macOS Launch Services find the app that
// claimed that scheme. That path crosses FOUR boundaries to write one
// file — page, Launch Services, a separate AppleScript app, a shell
// command — and one of them (the shell command's own stripped
// environment not containing Homebrew's node) silently broke every
// single button here for an entire evening, because nothing along the
// way had any means of reporting a failure back to this page.
//
// Running inside the native window, there's a second, better path now:
// window.webkit.messageHandlers.classdash, a direct bridge straight into
// the Swift app hosting this page (see 16-summary.swift). One hop, and
// a REAL result comes back — not just "the click happened somewhere",
// but what it actually did. dispatchAction() below prefers this path
// whenever it exists.
//
// The old napominalka:// path still exists and is still used when this
// bridge doesn't — chiefly, the page opened as a plain browser tab,
// with no native app around it to ask directly. Nothing about what an
// action DOES differs between the two paths; they run the exact same
// 21-notifier-actions.js on the other end either way.
var bridgeCallbacks = {};
var bridgeRequestCounter = 0;

function hasNativeBridge() {
  return !!(window.webkit && window.webkit.messageHandlers &&
            window.webkit.messageHandlers.classdash);
}

// Called BY THE NATIVE APP, by this exact name, once a bridge action it
// ran has actually finished — see 16-summary.swift's deliver(). Not
// wired up through any DOM event, so the fixed global name matters.
window.classdashBridgeResult = function (id, result) {
  var callback = bridgeCallbacks[id];
  delete bridgeCallbacks[id];
  if (callback) callback(result);
};

// Sends one action to the notifier, one of two ways.
//
// With a native bridge: posts {id, action, arg} straight across it, and
// -- IF the caller wants to know what happened -- onResult fires later
// with the real result object once the native side reports it.
//
// Without one (a plain browser tab): the only way left to reach outside
// the page is the old napominalka:// link, which has no way to answer
// back at all. onResult, if given, is simply never called on this path
// -- exactly the "fire it and hope" behavior this page has always had
// there, unchanged.
function dispatchAction(action, arg, onResult) {
  if (hasNativeBridge()) {
    var id = 'r' + (++bridgeRequestCounter);
    if (onResult) bridgeCallbacks[id] = onResult;
    window.webkit.messageHandlers.classdash.postMessage({ id: id, action: action, arg: arg || '' });
  } else {
    location.href = 'napominalka://' + action + (arg ? '/' + arg : '');
  }
}

// Reads the (action, arg) pair back out of a napominalka:// href that
// was already built for the old path — rather than re-deriving them
// from scratch, which would mean keeping two copies of the same id in
// sync. Whatever encoding that href already used (there's a real
// inconsistency between how different buttons build one — not
// something this rewrite set out to fix) is preserved exactly, since
// this only ever forwards a string that already worked.
function napominalkaActionFromHref(href) {
  var prefix = 'napominalka://';
  var rest = href.indexOf(prefix) === 0 ? href.slice(prefix.length) : href;
  var slash = rest.indexOf('/');
  return slash === -1
    ? { action: rest, arg: '' }
    : { action: rest.slice(0, slash), arg: rest.slice(slash + 1) };
}

// Used by every button below that's still a real <a href="napominalka://...">
// link (hide, unhide, "not urgent", restore). With a bridge available,
// this sends the action directly and cancels the link's own navigation
// -- otherwise it would go out BOTH ways at once. Without one, it does
// nothing and returns true, which is exactly what these callers already
// checked for: let the href navigate on its own, same as always.
function sendLinkViaBridge(e, link) {
  if (!hasNativeBridge()) return true;
  var parsed = napominalkaActionFromHref(link.getAttribute('href'));
  dispatchAction(parsed.action, parsed.arg);
  if (e) e.preventDefault();
  return false;
}

// The link (of either kind) gets written to disk there, but the page
// won't find out until the next collection. So the card is dimmed right
// away — otherwise it's unclear whether the click registered.
// The "expand" button is only shown for announcements that actually
// didn't fit. That can only be known after rendering: compare the full
// text height against the visible one.
for (const post of document.querySelectorAll('.post')) {
  const text = post.querySelector('.text');
  const button = post.querySelector('.expand-btn');
  if (text && button && text.scrollHeight > text.clientHeight + 2) {
    button.hidden = false;
  }
}

function expandPost(button) {
  const text = button.closest('.post').querySelector('.text');
  const collapsed = text.classList.toggle('collapsed');
  button.textContent = collapsed ? WORDS.expand : WORDS.collapse;
}

// Hide an overdue item — with a confirmation, so it isn't hit by accident.
// If the person backs out, the link doesn't fire at all.
function hideOverdueItem(e, link) {
  var row = link.closest('.row');
  var title = row.querySelector('.title').textContent.trim();
  // THE BACKSLASHES HERE ARE DOUBLED, AND THAT'S REQUIRED.
  //
  // This code rides inside the template string that assembles the page.
  // A single \\n would turn into a real line break at build time, and in
  // the finished HTML the quote would end up broken in the middle. The
  // browser trips on that and silently refuses to run the ENTIRE page
  // script. That's exactly what happened: the buttons and filters stopped
  // working from the day the "Overdue" section was added, and it was only
  // noticed by checking the finished page.
  if (!confirm(WORDS.confirmRemove + '\\n\\n' + title +
               '\\n\\n' + WORDS.confirmRemoveHint)) {
    e.preventDefault();
    return false;
  }

  // Hide it RIGHT AWAY, without waiting for the next collection.
  //
  // The card used to just fade and stay for ten minutes. The user rightly
  // pointed out that nothing works that way: click "hide" and it should
  // be hidden. The app will still update the file on disk regardless —
  // the page just no longer waits for that to behave correctly.
  //
  // sendLinkViaBridge reads the "hide" href off this link, so it has to
  // run BEFORE the line below rewrites that same href to "unhide" for
  // next time — reading it after would send the wrong action.
  var sentDirectly = sendLinkViaBridge(e, link);

  row.classList.add('hidden-row');
  row.classList.remove('shown');
  link.className = 'quiet';
  link.textContent = WORDS.restore;
  link.href = 'napominalka://unhide/' + encodeURIComponent(row.dataset.id);
  link.onclick = function (ev) { return restoreOverdueItem(ev, link); };

  refreshSection(row.closest('section'));
  return sentDirectly;
}

function restoreOverdueItem(e, link) {
  var row = link.closest('.row');
  // Same ordering requirement as hideOverdueItem: read the current
  // ("unhide") href before it gets rewritten to "hide" below.
  var sentDirectly = sendLinkViaBridge(e, link);

  row.classList.remove('hidden-row', 'shown');
  link.className = 'quiet quiet-faint';
  link.textContent = WORDS.hide;
  link.href = 'napominalka://hide/' + encodeURIComponent(row.dataset.id);
  link.onclick = function (ev) { return hideOverdueItem(ev, link); };

  refreshSection(row.closest('section'));
  return sentDirectly;
}

// Refreshes the "show hidden" button. Header counters are handled by
// recount(): filters change them now too, and keeping two independent
// counters is a reliable way to end up with a mismatch.
function refreshSection(section) {
  recount();
  if (!section) return;
  var hiddenCount = section.querySelectorAll('.row.hidden-row').length;

  var button = section.querySelector('.show-hidden-btn');
  if (!button) return;
  button.hidden = (hiddenCount === 0);
  var expanded = section.querySelector('.row.hidden-row.shown') !== null;
  button.textContent = expanded
    ? WORDS.hideAgain
    : WORDS.showHidden + ' (' + hiddenCount + ')';
}

// WARNING: this code rides inside the template string that assembles the
// whole page. That means NO backticks and no "dollar-curly-brace"
// interpolations here — they would break the outer string, and Node would
// try to run a chunk of text as code.
//
// Hit this twice in a row: once in the code itself, then again in this
// very warning, where such an interpolation was written out literally.
function toggleHiddenRows(button) {
  var section = button.closest('section');
  var rows = [].slice.call(section.querySelectorAll('.row.hidden-row'));
  var shown = rows.length && rows[0].classList.contains('shown');
  for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('shown', !shown);
  refreshSection(section);
}

// ── Reminders — virtual assignments ──
//
// Every action (done/undone/hide/unhide/delete) just calls
// dispatchAction and reloads the page on success, rather than
// surgically updating the DOM the way hideOverdueItem/muteItem above
// do — reminders are a much smaller feature, and a reload here costs
// nothing noticeable.
function virtualAction(e, action, id) {
  if (e) e.preventDefault();
  dispatchAction(action, id, function (res) {
    if (res && res.ok) { location.reload(); return; }
    var result = document.getElementById('reminders-result');
    if (result) result.textContent = (res && res.why) || WORDS.checkFailed;
  });
  return false;
}

function virtualDeleteConfirm(e, id) {
  if (e) e.preventDefault();
  if (!confirm(WORDS.confirmDeleteReminder)) return false;
  return virtualAction(null, 'virtualDelete', id);
}

function toggleReminderGroup(id) {
  var el = document.getElementById(id);
  if (el) el.hidden = !el.hidden;
}

// An explicit way out of the date field, not just "leave it alone" --
// datetime-local inputs aren't reliably empty-by-default across every
// WebKit build this could run in, so this guarantees the field can
// always be forced back to blank with one click, however it ended up
// non-empty.
function clearReminderDue() {
  var field = document.getElementById('reminder-due');
  field.value = '';
  document.getElementById('reminder-due-clear').hidden = true;
}

// ISO (UTC) -> the local-time "YYYY-MM-DDTHH:mm" a datetime-local input
// actually wants in its .value. Used only to pre-fill the field when
// editing — new Date(iso) already reads it back correctly either way,
// since getFullYear()/getHours()/etc. below are local-time accessors.
function isoToLocalDatetimeValue(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Pre-fills the add form from a card's own data-* attributes (see
// card() in remindersSection(), 08-page.js) and switches it into edit
// mode — saveReminder() below checks reminder-editing-id to decide
// whether to create or edit.
function startEditReminder(e, link) {
  if (e) e.preventDefault();
  var row = link.closest('.row');
  document.getElementById('reminder-editing-id').value = row.getAttribute('data-id');
  document.getElementById('reminder-title').value = row.getAttribute('data-title') || '';
  document.getElementById('reminder-class').value = row.getAttribute('data-class') || '';
  var dueField = document.getElementById('reminder-due');
  dueField.value = isoToLocalDatetimeValue(row.getAttribute('data-raw-due'));
  document.getElementById('reminder-due-clear').hidden = !dueField.value;
  document.getElementById('reminder-save-btn').textContent = WORDS.reminderSave;
  document.getElementById('reminder-cancel-edit-btn').hidden = false;
  var result = document.getElementById('reminders-result');
  if (result) result.textContent = '';
  document.getElementById('reminder-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('reminder-title').focus();
  return false;
}

function cancelEditReminder() {
  document.getElementById('reminder-editing-id').value = '';
  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-class').value = '';
  clearReminderDue();
  document.getElementById('reminder-save-btn').textContent = WORDS.reminderAdd;
  document.getElementById('reminder-cancel-edit-btn').hidden = true;
  var result = document.getElementById('reminders-result');
  if (result) result.textContent = '';
}

function saveReminder() {
  var titleField = document.getElementById('reminder-title');
  var result = document.getElementById('reminders-result');
  var title = titleField.value.trim();
  if (!title) {
    if (result) result.textContent = WORDS.reminderTitleRequired;
    return;
  }
  var cls = document.getElementById('reminder-class').value.trim();
  var dueField = document.getElementById('reminder-due').value;
  var editingId = document.getElementById('reminder-editing-id').value;
  var payload = {
    title: title,
    class: cls || null,
    due: dueField ? new Date(dueField).toISOString() : null,
  };
  var action = 'virtualCreate';
  if (editingId) {
    payload.id = editingId;
    action = 'virtualEdit';
  }
  var chunk = toBase64Url(JSON.stringify(payload));
  if (result) result.textContent = editingId ? WORDS.reminderSaving : WORDS.reminderAdding;
  dispatchAction(action, chunk, function (res) {
    if (res && res.ok) { location.reload(); return; }
    if (result) result.textContent = (res && res.why) || WORDS.checkFailed;
  });
}

// "Not urgent": fades, shows "muted", and slides away a second later.
// sendLinkViaBridge sends the id to the app directly when it can, or
// leaves the link's own href to do it the old way when it can't — either
// way there's no reason to wait for the next collection for the card to
// disappear.
function muteItem(e, button) {
  sendLinkViaBridge(e, button);

  var row = button.closest('.row');
  row.classList.add('done');
  button.textContent = WORDS.muted;

  setTimeout(function () {
    row.classList.add('dismissed');
    setTimeout(function () {
      var section = row.closest('section');
      row.remove();
      refreshSection(section);
    }, 300);
  }, 800);
}

// ── Filters ──
//
// Card tags are Latin (data-cls, data-type, data-days, data-sect), see the
// comment in itemCard. data-days — days until due: negative means
// overdue, "none" means there's no due date at all.

function isRowVisible(row) {
  if (row.classList.contains('filtered-out')) return false;
  if (row.classList.contains('hidden-row') && !row.classList.contains('shown')) return false;
  // Reminders' hidden/done groups use a plain [hidden] wrapper div
  // instead of the hidden-row/shown class dance above — a second kind
  // of "not currently on screen" this function needs to know about too,
  // or recount()'s header counter would include cards nobody can see.
  //
  // BUT NOT THE SECTION ITSELF. This used to be a bare
  // row.closest('[hidden]'), which also matched the <section> — and
  // recount() below hides a section whose visible count is zero. So a
  // section hidden at page load (say "No longer in Classroom", whose
  // cards all start filtered out) could never come back: ticking "show
  // removed" un-filtered its cards, but each card still counted as
  // invisible because its section was hidden, so the count stayed zero
  // and the section stayed hidden. Only the filter badges (computed
  // separately, from the cards alone) changed — the "only the numbers
  // change" symptom. Whether a section shows is recount()'s decision,
  // made from its rows; it can't also be an input to that decision.
  var hiddenAncestor = row.closest('[hidden]');
  if (hiddenAncestor && hiddenAncestor.tagName !== 'SECTION') return false;
  return true;
}

// Header counters, empty sections, and "showing: N" on the right of the panel.
function recount() {
  var total = 0;
  var sections = document.querySelectorAll('section');
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    // Announcements and transcripts are left alone: they have their own
    // life and their own counters.
    // Checked by TAG, not by card count: a section that just lost its
    // last card also has zero rows — and used to simply be skipped,
    // staying empty on screen.
    if (section.getAttribute('data-has-items') !== 'yes') continue;
    var rows = section.querySelectorAll('.row');

    var visibleCount = 0;
    for (var j = 0; j < rows.length; j++) if (isRowVisible(rows[j])) visibleCount++;

    var counter = section.querySelector('h2 .count');
    if (counter) counter.textContent = visibleCount;

    // A SECTION WITH HIDDEN CARDS IS NOT HIDDEN, EVEN IF VISIBLE COUNT IS ZERO.
    //
    // The "show hidden (N)" button lives INSIDE the section. While the
    // condition was just "visible count is zero", hiding the last overdue
    // item took the whole section away — along with the only button that
    // could bring it back. And the confirmation dialog had promised:
    // "you can restore it with the button at the bottom of this section."
    // The button existed, it just wasn't on screen.
    var hasHidden = section.querySelector('.row.hidden-row') !== null;
    section.hidden = (visibleCount === 0 && !hasHidden);
    total += visibleCount;
  }
  var result = document.getElementById('f-result');
  if (result) result.textContent = WORDS.showing + ' ' + total;
}

// What's checked within one checkbox group.
// Empty means "nothing selected" — that is, everything matches.
// Multiple checks within a group combine with "or" — pick two classes,
// you'll see both. Different groups combine with "and" — class AND due date.
function getSelectedValues(group) {
  var found = [];
  var fields = document.querySelectorAll('input[data-group="' + group + '"]');
  for (var i = 0; i < fields.length; i++) {
    if (fields[i].checked) found.push(fields[i].value);
  }
  return found;
}

// Whether a card matches the checked due-date ranges.
function matchesDueFilter(values, days) {
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v === 'none') {
      if (days === 'none') return true;
    } else if (v === 'past') {
      if (days !== 'none' && Number(days) < 0) return true;
    } else if (days !== 'none' && Number(days) >= 0 && Number(days) <= Number(v)) {
      return true;
    }
  }
  return false;
}

// COUNTS NEXT TO CHECKBOXES ARE LIVE, NOT COMPUTED AT BUILD TIME.
//
// They used to be computed once, when the page was printed, and knew
// nothing about "show removed" or "show hidden". That produced a lie:
// a class would show "3" next to it, but clicking it revealed ZERO — all
// three assignments were sitting in "No longer in Classroom", hidden by
// default. The same way a "Completed Assignment" type would show up even
// though it's nowhere on the page.
//
// Computed WITHOUT regard to other groups: the number answers "how many
// would become visible if only this were checked", not "how many remain
// given every other checkbox". The second is more honest, but you can't
// pick anything by it — the numbers would jump with every click.
function updateCounts(showHidden, showRemoved) {
  var fields = document.querySelectorAll('.filters input[data-group]');
  var rows = document.querySelectorAll('.row');

  for (var i = 0; i < fields.length; i++) {
    var label = fields[i].parentElement.querySelector('.count-badge');
    if (!label) continue;
    var group = fields[i].getAttribute('data-group');
    var value = fields[i].value;
    var count = 0;

    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!showRemoved && r.getAttribute('data-removed') === 'yes') continue;
      if (!showHidden && r.classList.contains('hidden-row')) continue;
      // Done/hidden reminders aren't on screen until their own button is
      // clicked, and no checkbox here can bring them out — counting them
      // made a class read "1" while ticking it showed nothing.
      if (r.closest('#reminders-done, #reminders-hidden') !== null) continue;
      if (group === 'cls' && r.getAttribute('data-cls') !== value) continue;
      if (group === 'type' && r.getAttribute('data-type') !== value) continue;
      if (group === 'days' && !matchesDueFilter([value], r.getAttribute('data-days'))) continue;
      count++;
    }
    label.textContent = count;
  }
}

function applyFilters() {
  var cls = getSelectedValues('cls');
  var types = getSelectedValues('type');
  var dueRanges = getSelectedValues('days');
  var showHidden = document.getElementById('f-hidden').checked;
  var removedField = document.getElementById('f-removed');
  var showRemoved = removedField !== null && removedField.checked;

  var rows = document.querySelectorAll('.row');
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ok = true;

    // Removed items are hidden by default: they're about history, not work.
    // A section made entirely of them hides itself — it'll have zero
    // visible cards.
    if (!showRemoved && r.getAttribute('data-removed') === 'yes') ok = false;

    // REMINDERS BEHIND A "SHOW DONE" / "SHOW HIDDEN" BUTTON SKIP THE
    // CHECKBOXES BELOW. Clicking that button IS the request to see them —
    // the class/type/due panel doesn't get a second say. Caught live: a
    // done reminder due four days ago matched no checked due range (with
    // nothing else on the page, "no due date" was the only one offered),
    // so it was tagged filtered-out at page load, while its wrapper was
    // still hidden. "Show done (1)" then un-hid an empty box — the click
    // worked, the card stayed display:none !important.
    var inReminderGroup = r.closest('#reminders-done, #reminders-hidden') !== null;

    // A reminder with no class ("Class (optional)" in the add form) has
    // data-cls="" — no checkbox exists for it, so with any class boxes on
    // the page it matched none of them and could never be shown. Real
    // assignments always have a class, so empty only ever means that.
    var noClass = r.getAttribute('data-cls') === '';
    if (ok && !inReminderGroup && !noClass && cls.length && cls.indexOf(r.getAttribute('data-cls')) === -1) ok = false;
    if (ok && !inReminderGroup && types.length && types.indexOf(r.getAttribute('data-type')) === -1) ok = false;
    if (ok && !inReminderGroup && dueRanges.length) ok = matchesDueFilter(dueRanges, r.getAttribute('data-days'));

    r.classList.toggle('filtered-out', !ok);
  }

  // The "show hidden" checkbox controls all hidden rows at once,
  // including the "show hidden" button inside the "Overdue" section.
  var hiddenRows = document.querySelectorAll('.row.hidden-row');
  for (var k = 0; k < hiddenRows.length; k++) {
    hiddenRows[k].classList.toggle('shown', showHidden);
  }

  var buttons = document.querySelectorAll('.show-hidden-btn');
  for (var m = 0; m < buttons.length; m++) {
    refreshSection(buttons[m].closest('section'));
  }

  updateCounts(showHidden, showRemoved);
  recount();
}

// Restore urgency: the assignment moves back out of "Muted".
// Like "not urgent", the card is removed right away, without waiting for
// a collection — click it, and it's restored.
function restoreUrgency(e, link) {
  sendLinkViaBridge(e, link);

  var row = link.closest('.row');
  row.classList.add('done');
  link.textContent = WORDS.restored;

  setTimeout(function () {
    row.classList.add('dismissed');
    setTimeout(function () {
      var section = row.closest('section');
      row.remove();
      refreshSection(section);
    }, 300);
  }, 800);
  // With a bridge, sendLinkViaBridge above already cancelled the link
  // and sent this directly. Without one, it's left alone here — it
  // still needs to navigate to reach the notifier the old way.
}

// ── Settings ──
//
// WARNING: this code rides inside the template string. No backticks and
// no "dollar-curly-brace" interpolations — they would break the outer
// string.

// Closing the panel IS saving it: there's no Save button. Only when
// something actually changed since the page loaded, so opening it to look
// and closing again does nothing at all — no request, no reload. The
// settings that matter most to get right by accident (which classes are
// read, the Canvas address) don't act on being saved either, they wait
// for a fresh check; see pendingBanner and startPendingCheck below.
function toggleSettingsPanel() {
  var panel = document.getElementById('settings-panel');
  if (!panel) return;
  if (panel.hidden) {
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  panel.hidden = true;
  if (settingsDirty()) saveSettings();
}

// The "some settings need a fresh check" notice's button. Starts the same
// quick pass the home API's reload does (Classroom and Canvas, no
// Edpuzzle window). The pass runs detached and takes about 17 seconds, so
// nothing can report back when it's done; the page reloads after a
// margin, and the notice is gone from that reload if the pass finished
// and read the new values. Reverts on failure so it's obvious the click
// didn't go anywhere, same as triggerSignIn.
function startPendingCheck(link) {
  var original = link.textContent;
  link.textContent = WORDS.pendingChecking;
  var reloadSoon = function () { setTimeout(function () { location.reload(); }, 30000); };
  if (!hasNativeBridge()) {
    dispatchAction('reload', '');
    reloadSoon();
    return;
  }
  dispatchAction('reload', '', function (res) {
    if (res && res.ok) { reloadSoon(); return; }
    link.textContent = (res && res.why) || WORDS.checkFailed;
    setTimeout(function () { link.textContent = original; }, 4000);
  });
}

function toggleCheckStatusDetail() {
  var panel = document.getElementById('check-status-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
}

// Hides right away, doesn't wait on the round trip — same optimistic-
// update pattern as hiding an overdue card. Worst case (the write
// somehow fails) the banner just comes back on the next real redraw,
// no worse than not dismissing it at all.
function dismissUpdateBanner(btn) {
  var version = btn.getAttribute('data-version');
  dispatchAction('dismissUpdate', version);
  var banner = document.getElementById('update-banner');
  if (banner) banner.hidden = true;
}

// The banner itself isn't dismissable (see its own comment above, in
// signInBanner) — it comes back on the next reload regardless, once a
// real check confirms the problem is still there. This only gives
// feedback on the click itself: a real sign-in browser window takes a
// beat to open (a fresh Brave/Chrome launch isn't instant), and without
// this the link would just sit there looking unresponsive in the
// meantime. Reverts on failure so it's obvious the click didn't work,
// rather than silently doing nothing.
function triggerSignIn(link) {
  var original = link.textContent;
  link.textContent = WORDS.signInOpening;
  dispatchAction('signIn', '', function (res) {
    if (res && res.ok) return;
    link.textContent = (res && res.why) || WORDS.signInFailed;
    setTimeout(function () { link.textContent = original; }, 4000);
  });
}

// Switches which settings section is visible. Sections that aren't
// showing stay in the DOM, just hidden — saveSettings() walks every
// [data-key]/[data-bool-key] under #settings-panel regardless, so a
// value changed in a section you've since clicked away from still
// gets saved.
function showSettingsSection(name, btn) {
  var sections = document.querySelectorAll('.settings-section');
  for (var i = 0; i < sections.length; i++) {
    sections[i].hidden = sections[i].getAttribute('data-section') !== name;
  }
  var buttons = document.querySelectorAll('.settings-nav-btn');
  for (var j = 0; j < buttons.length; j++) buttons[j].classList.remove('active');
  if (btn) btn.classList.add('active');
}

// Reveals a masked field (email, Canvas address) the same way a password
// field's own show/hide button does. The button sits right after the
// input in the markup, so previousElementSibling always reaches it.
function toggleReveal(button) {
  var input = button.previousElementSibling;
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// Live label for the "how long counts as inactive" slider, as it's
// dragged. WORDS.monthWord/monthsWord are set to the same "мес." for
// both singular and plural in Russian on purpose (see the comment on
// them in 18-language.js) — this stays a plain singular/plural check
// either way, it just happens to pick the identical string in Russian.
// Where the slider's filled part ends, as 0..1 — read by the track's
// gradient (see the slider CSS). No regexes: this rides in a template
// string, where an escape would be mangled at build time.
function syncSliderFill(slider) {
  var span = Number(slider.max) - Number(slider.min);
  slider.style.setProperty('--pct', span > 0 ? (Number(slider.value) - Number(slider.min)) / span : 0);
}

(function () {
  var sliders = document.querySelectorAll('input[type="range"]');
  for (var i = 0; i < sliders.length; i++) syncSliderFill(sliders[i]);
})();

function updateStaleMonthsLabel(slider) {
  syncSliderFill(slider);
  var label = slider.nextElementSibling;
  if (!label) return;
  var n = slider.value;
  label.textContent = n + ' ' + (n == 1 ? WORDS.monthWord : WORDS.monthsWord);
}

// Shows/hides the token+fingerprint block the instant the "enable home
// API" checkbox is clicked — same "don't make the person wait for a
// save round-trip just to see the UI react" idea as the filter panel's
// own instant checkboxes. The actual server only starts or stops once
// the settings panel is closed and the setting really changed; this is
// purely about not showing a key section for an API that (as far as the
// page can tell right now) isn't turned on.
function toggleApiKeySection(checkbox) {
  var row = document.querySelector('.api-key-row');
  if (row) row.hidden = !checkbox.checked;
}

// Copies a readonly field's value — the token or the certificate
// fingerprint. navigator.clipboard needs a secure context, which this
// page doesn't always have (see dispatchAction's own comment: this can
// be opened as a plain, non-HTTPS browser tab), so a manual select +
// execCommand fallback covers that case instead of the button silently
// doing nothing.
function copyFieldValue(button, fieldId) {
  var input = document.getElementById(fieldId);
  if (!input) return;
  var text = input.value;
  var flash = function () {
    var original = button.textContent;
    button.textContent = WORDS.copied;
    setTimeout(function () { button.textContent = original; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, flash);
    return;
  }
  var wasReadonly = input.hasAttribute('readonly');
  var wasPassword = input.type === 'password';
  input.type = 'text';
  input.removeAttribute('readonly');
  input.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing left to try */ }
  if (wasReadonly) input.setAttribute('readonly', 'readonly');
  if (wasPassword) input.type = 'password';
  flash();
}

// Rolling the token cuts the OLD one off immediately (see rollToken()'s
// own comment in 23-api-security.js) — anything already configured with
// it, like a Home Assistant integration, breaks until updated with the
// new one. Confirmed the same way "hide" on an overdue item is, so it
// isn't hit by accident.
function rollApiToken() {
  if (!confirm(WORDS.confirmRollToken + '\\n\\n' + WORDS.confirmRollTokenHint)) return;
  dispatchAction('rollApiToken', '', function (res) {
    if (res && res.ok) setTimeout(function () { location.reload(); }, 1500);
  });
}

// Text -> base64url. Not encryption: just a way to carry an email address
// and Russian class names through a URL intact. btoa only handles
// "narrow" bytes, so the string is turned into bytes via TextEncoder
// first, and "+" and "/" are swapped for "-" and "_" — otherwise the
// chunk would fall apart when the URL is split on slashes.
function toBase64Url(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // NO REGEXES HERE ON PURPOSE. This code rides inside the template
  // string, and "\+" in it turns into "+" at build time: the regex /\+/g
  // arrives on the page as /+/g and crashes the ENTIRE script. Caught by
  // checking the finished page right after writing it. split/join needs
  // no escape sequences at all, so there's nothing here to break.
  return btoa(binary).split('+').join('-').split('/').join('_');
}

// The counter in the picker's summary. Recomputed immediately on click,
// otherwise the heading lies until the next collection.
function updateSelectionCount() {
  var box = document.querySelector('.class-picker');
  if (!box) return;
  var all = box.querySelectorAll('input[type="checkbox"]');
  var count = 0;
  for (var i = 0; i < all.length; i++) if (all[i].checked) count++;
  var label = box.querySelector('.picker-summary');
  if (label) label.textContent = count;
}

// Everything on the settings panel, in the shape saveSettings() sends.
// Its own function so "did anything change since the page loaded?" asks
// exactly what a save would send, and can't drift from it.
function collectSettings() {
  var panel = document.getElementById('settings-panel');
  var payload = {};
  if (!panel) return payload;
  var fields = panel.querySelectorAll('[data-key]');
  var lists = {};
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i].getAttribute('data-key');
    if (fields[i].type === 'checkbox') {
      // Checkboxes sharing a key collect into a list. None checked should
      // still send an EMPTY list, not a missing key: otherwise clearing
      // the last exclusion would be impossible.
      if (!lists[key]) lists[key] = [];
      if (fields[i].checked) lists[key].push(fields[i].value);
    } else {
      payload[key] = fields[i].value;
    }
  }
  for (var k in lists) payload[k] = lists[k];

  // Single true/false toggles use their own attribute, data-bool-key, not
  // data-key: a lone checkbox has no other values to collect alongside
  // it, so it maps straight to true/false instead of building a list.
  var boolFields = panel.querySelectorAll('[data-bool-key]');
  for (var b = 0; b < boolFields.length; b++) {
    payload[boolFields[b].getAttribute('data-bool-key')] = boolFields[b].checked;
  }
  return payload;
}

// What the panel held when the page loaded, or when it was last saved.
var settingsBaseline = JSON.stringify(collectSettings());

function settingsDirty() {
  return JSON.stringify(collectSettings()) !== settingsBaseline;
}

// Where save progress shows. The panel's own line while it's open; once
// it's closed (closing is what saves) that line can't be seen, so the gear
// button grows to say it instead. If the page is scrolled so the gear is
// out of view, it's scrolled back in: a message nobody can see might as
// well not exist, and the panel that was just closed sat right below it.
var settingsStatusTimer = null;
function announceSettings(text) {
  var result = document.getElementById('settings-result');
  if (result) result.textContent = text;
  var panel = document.getElementById('settings-panel');
  var button = document.getElementById('settings-button');
  var status = document.getElementById('settings-status');
  if (!button || !status) return;
  clearTimeout(settingsStatusTimer);
  if (panel && !panel.hidden) {
    status.textContent = '';
    button.classList.remove('expanded');
    return;
  }
  status.textContent = text;
  button.classList.add('expanded');
  var box = button.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) {
    button.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  settingsStatusTimer = setTimeout(function () {
    status.textContent = '';
    button.classList.remove('expanded');
  }, 2500);
}

// Puts the panel back in front of the person, with the reason. Used when
// a save that started as the panel closed didn't take: without this the
// error would land in a panel that's no longer on screen and the person
// would believe it worked.
function reopenSettingsWith(message) {
  var panel = document.getElementById('settings-panel');
  if (panel) {
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  announceSettings(message);
}

function saveSettings() {
  var sent = JSON.stringify(collectSettings());
  var encoded = toBase64Url(sent);

  // NOTHING ON THE PAGE CHANGES HERE, INCLUDING FOR EXCLUDED CLASSES. An
  // exclusion used to hide the class from the page at once and start a
  // collection to make it permanent. Now it's saved and waits: the
  // "some settings need a fresh check" notice appears after the redraw
  // below, and the class goes away when a check has actually run.
  //
  // WITH A BRIDGE, "Saved" only appears once dispatchAction's onResult
  // actually reports success — not on a blind assumption. That matters
  // on its own: this used to assume success unconditionally, and a
  // rejected setting, or the notifier never being reached at all (which
  // is exactly what happened for one whole evening — see
  // 21-notifier-actions.js's own PATH comment), looked identical to a
  // working save.
  if (hasNativeBridge()) {
    announceSettings(WORDS.saving);
    dispatchAction('config', encoded, function (res) {
      if (!res || !res.ok) {
        var why = res && (res.why ||
          (res.rejected && res.rejected.length && res.rejected.join('; ')));
        reopenSettingsWith(WORDS.saveFailed + (why ? ': ' + why : ''));
        return;
      }
      // Accepted, but some fields refused (a fresh-check interval under
      // its minimum, say). The rest were written; the panel comes back so
      // the refused ones can be fixed, and doesn't reload — that would
      // throw away what was typed. The baseline stays put, so closing
      // again tries once more.
      if (res.rejected && res.rejected.length) {
        reopenSettingsWith(WORDS.saveFailed + ': ' + res.rejected.join('; '));
        return;
      }
      settingsBaseline = sent;
      announceSettings(WORDS.saved);
      // The config action only ever redraws now (a browser is never
      // launched by a save), which finishes in well under a second.
      setTimeout(function () { location.reload(); }, 1500);
    });
    return;
  }

  // No bridge (a plain browser tab): there's no way to ask whether this
  // worked, so this keeps behaving exactly as it always has — assume it
  // did, and quietly sync up after a moment.
  settingsBaseline = sent;
  announceSettings(WORDS.saved);
  dispatchAction('config', encoded);
  setTimeout(function () { location.reload(); }, 3000);
}

// Remembers the filter panel across refreshes — the two view toggles and
// which class/type/due boxes are unchecked — through the same config
// bridge the settings panel uses, so it lands in settings.json and the
// next page (the app reloads it whenever it comes back to the front)
// starts with them where they were left. Fire-and-forget: the filter has
// already taken effect on screen, and a save that fails just means it
// resets on the next refresh, as it always did.
//
// The unchecked lists as this page was built, so a save can keep choices
// about options this page doesn't happen to list right now.
var savedFilterState = ${JSON.stringify(readSettings().filterUnchecked || {}).split('<').join('\\u003c')};
var rememberTimer = null;

// What's unchecked now, per group. Options that aren't on this page at the
// moment (a class with nothing due this week isn't listed) keep whatever
// was saved for them: unchecking a class, then having it drop off the
// panel for a week, shouldn't quietly turn it back on.
function collectUnchecked() {
  var groups = ['cls', 'type', 'days'];
  var out = {};
  for (var g = 0; g < groups.length; g++) {
    var fields = document.querySelectorAll('.filters input[data-group="' + groups[g] + '"]');
    var offered = {};
    var off = [];
    for (var i = 0; i < fields.length; i++) {
      offered[fields[i].value] = true;
      if (!fields[i].checked) off.push(fields[i].value);
    }
    var kept = savedFilterState[groups[g]] || [];
    for (var k = 0; k < kept.length; k++) {
      if (!offered[kept[k]] && off.indexOf(kept[k]) === -1) off.push(kept[k]);
    }
    out[groups[g]] = off;
  }
  return out;
}

// clearAll: "reset all" forgets everything, including choices about
// options this page isn't listing.
//
// Debounced: ticking several boxes in a row is one save, not one per
// click — every save regenerates the page file.
function rememberFilters(clearAll) {
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(function () {
    var hidden = document.getElementById('f-hidden');
    var removed = document.getElementById('f-removed');
    var unchecked = clearAll === true ? { cls: [], type: [], days: [] } : collectUnchecked();
    savedFilterState = unchecked;
    dispatchAction('config', toBase64Url(JSON.stringify({
      filterShowHidden: !!(hidden && hidden.checked),
      filterShowRemoved: !!(removed && removed.checked),
      filterUnchecked: unchecked,
    })));
  }, 500);
}

function resetFilters() {
  // Back to how the page looks when opened: every assignment checkbox
  // checked, "show hidden/removed" unchecked. Unchecking everything would
  // be wrong — that's a state the page itself never starts in.
  var fields = document.querySelectorAll('.filters input[data-group]');
  for (var i = 0; i < fields.length; i++) fields[i].checked = true;

  var hiddenField = document.getElementById('f-hidden');
  if (hiddenField) hiddenField.checked = false;
  var removedField = document.getElementById('f-removed');
  if (removedField) removedField.checked = false;

  rememberFilters(true);
  applyFilters();
}

// ── Announcements: their own checkboxes ──
//
// Separate from the main panel: an announcement has no due date or type,
// the general filters don't apply to it. Filtered by class and by freshness.
function filterAnnouncements() {
  var classes = getSelectedValues('post-cls');
  var field = document.getElementById('f-post-new');
  var newOnly = (field !== null && field.checked);

  var posts = document.querySelectorAll('.post');
  var visible = 0;
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    var ok = true;
    if (ok && classes.length && classes.indexOf(p.getAttribute('data-cls')) === -1) ok = false;
    if (ok && newOnly && p.getAttribute('data-new') !== 'yes') ok = false;
    p.hidden = !ok;
    if (ok) visible++;
  }

  var counter = document.querySelector('.announcements-count');
  if (counter) counter.textContent = visible;
}

// ── Refresh and Fresh check — two buttons, not one with a gesture ──
//
// Used to be a single button: a short press reread the file, holding it
// for a second triggered a real check. Split into two so each one says
// what it does instead of relying on a tooltip nobody reads before
// clicking — Refresh just rereads the page, Fresh check actually
// fetches. No hold-timer/long-press-swallows-the-click dance needed
// anymore now that they're separate elements.
//
// dispatchAction sends the fresh-check request through the native
// bridge when there is one, or the old napominalka:// link when there
// isn't — the same as every other action on this page.
(function () {
  var refreshButton = document.getElementById('refresh-button');
  if (refreshButton) {
    refreshButton.addEventListener('click', function () { location.reload(); });
  }

  var freshCheckButton = document.getElementById('freshcheck-button');
  if (!freshCheckButton) return;
  freshCheckButton.addEventListener('click', function () {
    freshCheckButton.classList.add('spinning');
    freshSpinUntil = Date.now() + 15000;
    freshCheckButton.title = WORDS.checking;

    // onResult here only ever confirms the request was DISPATCHED — a
    // full check runs detached, in the background, and takes about a
    // minute, so nothing can report back when it's actually DONE. What
    // it catches instead is the request never having gone anywhere at
    // all, which used to look identical to a check quietly running.
    dispatchAction('check', '', function (res) {
      if (res && res.ok) return;
      freshCheckButton.classList.remove('spinning');
      freshCheckButton.title = (res && res.why) ? res.why : WORDS.checkFailed;
    });

    // A full check takes about a minute. The page redraws after every
    // source it reads, so reloading it is safe: you'll see at least
    // part of it, not nothing.
    setTimeout(function () { location.reload(); }, 45000);
  });
})();

// ── Live updates ──
//
// Two things an open page can't see on its own: that a collection is
// running, and that a newer copy of this page has been written (a
// collection rewrites it after every source it reads). Both are written to
// live/ (see 28-live-state.js) and reach the page one of two ways:
//
//   PUSHED: the app hosting this page watches live/ and calls
//   window.classdashLiveChanged(...) below whenever it changes, and once
//   as each page finishes loading. Nothing polls.
//
//   POLLED: a page in a plain browser tab, or under an app that doesn't
//   push yet, loads the two one-line scripts in live/ itself every few
//   seconds. The first push switches polling off for good.
//
// A newer page is picked up by reloading — there's no way to fetch and
// patch it in place from a file:// page — so the reload waits for a quiet
// moment: not while settings are open, a field is being typed in, or
// anything was clicked, typed or scrolled in the last few seconds. It
// keeps trying, so it happens the moment things go quiet.
var PAGE_VERSION = ${pageVersion};
var LIVE_POLL_IDLE = 5000;
var LIVE_POLL_RUNNING = 2000;
var LIVE_STALE_MS = 30000;
var LIVE_UNKNOWN_MS = 15000;
var QUIET_BEFORE_RELOAD_MS = 4000;
var pageLoadedAt = Date.now();
var lastInteraction = Date.now();
var reloadingForLive = false;
var freshSpinUntil = 0;
var liveTimer = null;
var livePushed = false;
var lastRun = null;
var newestVersion = 0;
var lastLiveReport = 0;

['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (name) {
  document.addEventListener(name, function () { lastInteraction = Date.now(); },
    { passive: true, capture: true });
});

// Loads one of the live/ scripts and says whether it loaded. The query
// string is what stops the web view from serving the previous copy.
function loadLiveFile(name, done) {
  var el = document.createElement('script');
  var finished = false;
  var finish = function (ok) {
    if (finished) return;
    finished = true;
    if (el.parentNode) el.parentNode.removeChild(el);
    done(ok);
  };
  el.onload = function () { finish(true); };
  el.onerror = function () { finish(false); };
  el.src = 'live/' + name + '?t=' + Date.now();
  document.head.appendChild(el);
}

// The page hid its own progress bar while it still believed the check was
// going. There's no console in the app window, so this leaves a line in the
// notifier log saying what the page saw — enough to tell a dead heartbeat
// from a missing file from a run that really ended. At most every 10s.
function reportLiveDecision(run) {
  if (!hasNativeBridge()) return;
  var now = Date.now();
  if (now - lastLiveReport < 10000) return;
  lastLiveReport = now;
  dispatchAction('liveDebug', JSON.stringify({
    run: run || null, ageMs: run ? now - run.at : null,
    pushed: livePushed, sinceLoadMs: now - pageLoadedAt,
  }));
}

// Shows, moves or hides the progress bar for the run last heard about, and
// keeps the Fresh check icon spinning to match. Returns whether a run is
// live. A run whose heartbeat stopped counts as over even if it never said
// so — it died. Hearing NOTHING isn't the same as hearing "over": a bar
// baked into this page is left alone until a real answer turns up, or
// LIVE_UNKNOWN_MS passes with none.
function applyRunState(run) {
  var live = !!(run && run.running && (Date.now() - run.at) < LIVE_STALE_MS);
  var unknown = !run && (Date.now() - pageLoadedAt) < LIVE_UNKNOWN_MS;
  var box = document.getElementById('check-progress');
  if (box && !unknown) {
    if (!live) {
      if (!box.hidden && document.querySelector('.live')) reportLiveDecision(run);
      box.hidden = true;
    } else {
      box.hidden = false;
      var total = run.total || 0;
      var done = Math.min(run.done || 0, total);
      var pct = total ? Math.round(done / total * 100) : 0;
      box.classList.toggle('indeterminate', total === 0);
      box.setAttribute('aria-valuenow', pct);
      document.getElementById('check-progress-pct').textContent = total ? pct + '%' : '';
      document.getElementById('check-progress-label').textContent =
        total === 0 ? WORDS.progressStarting
        : done >= total ? WORDS.progressFinishing
        : WORDS.progressChecking + ' ' + done + ' ' + WORDS.progressOf + ' ' + total;
      // Whole 8px blocks, the last one ending on a filled block rather than
      // a gap. Measured now, after un-hiding: a hidden bar has no width.
      var track = box.querySelector('.check-progress-track');
      var blocks = Math.floor(track.clientWidth / 8);
      var filled = Math.round(pct / 100 * blocks);
      document.getElementById('check-progress-fill').style.width =
        filled > 0 ? (filled * 8 - 2) + 'px' : '0px';
    }
  }
  var fresh = document.getElementById('freshcheck-button');
  if (fresh) {
    if (live || Date.now() < freshSpinUntil) fresh.classList.add('spinning');
    else fresh.classList.remove('spinning');
  }
  return live;
}

function reloadWhenQuiet() {
  if (reloadingForLive) return;
  var now = Date.now();
  if (now - pageLoadedAt < 3000) return;
  if (now - lastInteraction < QUIET_BEFORE_RELOAD_MS) return;
  var panel = document.getElementById('settings-panel');
  if (panel && !panel.hidden) return;
  var a = document.activeElement;
  var typingTypes = ['text', 'password', 'search', 'number', 'url', 'email', 'datetime-local'];
  if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' ||
            (a.tagName === 'INPUT' && typingTypes.indexOf(a.type) !== -1))) return;
  // A reminder half-typed, or one being edited, survives the field losing
  // focus — a click elsewhere shouldn't be what lets the reload eat it.
  var title = document.getElementById('reminder-title');
  if (title && title.value) return;
  var editing = document.getElementById('reminder-editing-id');
  if (editing && editing.value) return;
  reloadingForLive = true;
  location.reload();
}

// Everything that arrives, pushed or polled, comes through here. run and
// version are each optional: null/0 means "nothing new heard", NOT "there's
// no run" — a file that failed to load once must never look like a run that
// ended. Only a state that really says so, or a heartbeat that stopped,
// takes the bar down.
function onLiveState(run, version) {
  if (run) lastRun = run;
  if (version && version > newestVersion) newestVersion = version;
  var running = applyRunState(lastRun);
  // Strictly newer, never just different: if the version ever lags or goes
  // missing this can leave a page un-refreshed, but can't make one reload
  // forever.
  if (newestVersion > PAGE_VERSION) reloadWhenQuiet();
  return running;
}

// Called by the hosting app, by this exact name — see LiveStatePusher in
// 16-summary.swift and pushLiveState in electron/main.js. The first call
// ends polling.
window.classdashLiveChanged = function (state) {
  livePushed = true;
  clearTimeout(liveTimer);
  if (state) onLiveState(state.run, state.version);
};

// A run that dies sends nothing at all, and a reload that was held back by
// typing has nothing to wake it either, so both are re-checked on a timer.
setInterval(function () { onLiveState(null, 0); }, 2000);

function scheduleLivePoll(ms) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(pollLive, ms);
}

function pollLive() {
  if (livePushed) return;
  // A window nobody can see doesn't need polling; coming back to it does
  // (see the visibilitychange listener), and the app reloads on return anyway.
  if (document.hidden) { scheduleLivePoll(LIVE_POLL_IDLE); return; }
  loadLiveFile('check-run.js', function (haveRun) {
    var run = haveRun ? window.classdashCheckRun : null;
    loadLiveFile('page-version.js', function (haveVersion) {
      if (livePushed) return;
      var running = onLiveState(run, haveVersion ? window.classdashPageVersion : 0);
      scheduleLivePoll(running ? LIVE_POLL_RUNNING : LIVE_POLL_IDLE);
    });
  });
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && !livePushed) scheduleLivePoll(0);
});
scheduleLivePoll(0);

// Filters are applied right away on load, not just counted: otherwise
// removed items would show up until the first checkbox click.
applyFilters();
</script>
</body>
</html>
`;

  fs.writeFileSync(outputPath, html);
  publishPageVersion(path.dirname(outputPath), pageVersion);
  return outputPath;
}

// allKnownClasses/knownClassStatus are exported for 17-api.js's own
// /api/classes roster — same reasoning as sortIntoBuckets being shared
// between this page and the API instead of reimplemented: the merged-
// across-all-three-platforms class list should mean exactly one thing
// everywhere it's used, not two that could quietly drift apart.
module.exports = { writePage, daysUntil, allKnownClasses, knownClassStatus };
