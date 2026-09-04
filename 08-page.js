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
const { read: readSettings } = require('./19-settings.js');
const path = require('path');
// The API's token/fingerprint aren't settings — nothing here writes
// them, 23-api-security.js is the only writer — just values this page
// reads at redraw time to show in the panel. See that file's own
// comment on why it exists separately from 17-api.js.
const { currentToken, certFingerprint, isServerRunning } = require('./23-api-security.js');
const virtualAssignments = require('./24-virtual-assignments.js');
const { isClassStale } = require('./22-class-activity.js');
const { checkStatus } = require('./25-check-status.js');
const { readUpdateStatus } = require('./26-update-check.js');

// Fresh check's icon. Refresh (↻) and Settings (⚙) are plain Unicode
// characters — nothing in Unicode reads as "thorough sync" the way this
// needs to, so this one's a real small image instead: a render of the
// SF Symbol arrow.trianglehead.2.clockwise.rotate.90, exported once via
// a throwaway AppKit script (NSImage(systemSymbolName:) + a template
// render), committed as freshcheck-icon.png next to AppIcon.icns. Read
// once at module load, not per page render — it's a static asset, not
// something that changes between redraws.
const FRESHCHECK_ICON_B64 =
  fs.readFileSync(path.join(__dirname, 'freshcheck-icon.png')).toString('base64');

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

  const dueText = (x) => {
    if (!x.due_at) return t('reminderNoDue');
    if (x.note) return t(x.note);
    return `${x.due_at.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${when(x.due_at, now)}`;
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
          <span class="due">${escapeHtml(dueText(x))}</span>
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
  const excludedClasses = new Set(settings.exclusions);
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
        <button onclick="saveSettings()">${escapeHtml(t('settingsSave'))}</button>
        <button onclick="toggleSettingsPanel()">${escapeHtml(t('settingsClose'))}</button>
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
  // Counts how many cards each checkbox would match. The number next to
  // it immediately shows whether there's anything there — like the Steam
  // library the user referenced.
  const count = (key) => {
    const counts = new Map();
    for (const x of allItems) {
      const k = key(x);
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  };

  const daysFor = x => (x.due_at ? daysUntil(now, x.due_at) : null);
  const countByDue = (test) => allItems.filter(x => test(daysFor(x))).length;

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
  const checkRow = (group, value, label, count) =>
    `        <label class="check-row"><input type="checkbox" data-group="${group}"` +
    ` value="${escapeHtml(value)}" onchange="applyFilters()" checked>` +
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
    const excluded = new Set(filterSettings.exclusions);

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
        <label class="check-row"><input type="checkbox" class="toggle" id="f-hidden" onchange="applyFilters()">
          <span class="label-text">${escapeHtml(t('filterShowHiddenMuted'))}</span></label>
        <label class="check-row"><input type="checkbox" class="toggle" id="f-removed" onchange="applyFilters()">
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

/**
 * @param {object} data — {burning, later, undated, fresh, broken, now}
 * @param {string} outputPath — where to write the html
 */
function writePage(data, outputPath) {
  const { burning, later, undated, freshIds, broken, now } = data;
  const reading = data.reading || [];
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

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t('title'))}</title>
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
  main { max-width: 1800px; margin: 0 auto; }
  /* Assignments on the left, announcements on the right. Stacked on narrow screens. */
  .columns { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 28px; }
  @media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
  .post {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
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
    background: var(--card); border: 1px solid var(--line); border-radius: 7px;
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
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
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
    border: 1px solid var(--line); border-radius: 7px;
    background: var(--card); color: var(--dim);
    font-size: 15px; line-height: 1;
    transition: color .15s, border-color .15s;
  }
  /* .named — Refresh and Fresh check specifically: icon plus a visible
     label, not just an icon with a tooltip. Auto width instead of the
     plain icon button's fixed 26px square. */
  .reload.named {
    width: auto; height: auto; padding: 5px 10px; gap: 6px;
    display: inline-flex; align-items: center;
    font-size: 12px; font-family: inherit;
  }
  .reload-icon { font-size: 14px; display: inline-block; }
  /* Fresh check's icon isn't a text character — it's a CSS mask driven
     by a real (tiny) image, so it can still inherit color exactly like
     the text glyphs do: dim by default, blue on hover, blue while
     spinning, dark or light mode, all for free from currentColor. A
     plain img element couldn't do that without a separate asset per
     color/theme/state. */
  .freshcheck-icon {
    width: 14px; height: 14px; vertical-align: -2px;
    background-color: currentColor;
    -webkit-mask-image: url("data:image/png;base64,${FRESHCHECK_ICON_B64}");
    -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-image: url("data:image/png;base64,${FRESHCHECK_ICON_B64}");
    mask-size: contain; mask-repeat: no-repeat; mask-position: center;
  }
  .reload:hover { color: var(--new); border-color: var(--new); }
  /* Spins while a check is running. Only the ICON spins, not the whole
     button — with a text label sitting next to it now, spinning the
     whole button would spin the label too. No :active rotation of its
     own on purpose — it would fight this one. */
  .reload.spinning .reload-icon, .reload.spinning {
    color: var(--new); border-color: var(--new);
  }
  .reload.spinning .reload-icon {
    animation: spin 1.1s linear infinite;
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
  .update-banner { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .update-banner a { color: inherit; text-decoration: underline; }
  .update-dismiss {
    background: none; border: none; color: inherit; opacity: .6;
    font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px;
    flex-shrink: 0;
  }
  .update-dismiss:hover { opacity: 1; }
  .update-error-note { color: var(--warn); }
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
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
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
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 5px 10px;
    cursor: pointer; margin-top: 10px;
  }
  .filters button:hover { color: var(--text); border-color: var(--dim); }
  .filters .result { color: var(--dim); font-size: 12px; margin-top: 8px; }
  /* Settings panel. Hidden until the gear icon is clicked. */
  .settings-panel {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
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
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
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
  input[type="checkbox"].toggle:checked { background: var(--new); }
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
    background: none; border: 1px dashed var(--line); border-radius: 6px;
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
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer;
  }
  .settings-actions button:hover { color: var(--text); border-color: var(--dim); }
  #settings-result { color: var(--dim); font-size: 12px; }
  /* Collapsible class list. */
  .class-picker {
    border: 1px solid var(--line); border-radius: 7px; background: var(--bg);
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
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer; margin-top: 4px;
  }
  .show-hidden-btn:hover { color: var(--text); border-color: var(--dim); }
  .reminder-toggle-btn {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
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
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
  }
  .reminder-add input#reminder-title { flex: 1 1 180px; min-width: 120px; }
  .reminder-add input#reminder-class { flex: 1 1 120px; min-width: 90px; }
  .reminder-due-field { display: inline-flex; align-items: center; gap: 4px; }
  .reminder-add input[type="datetime-local"] {
    font: inherit; font-size: 13px; padding: 5px 6px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
  }
  .reminder-add button {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font: inherit; font-size: 13px; padding: 6px 12px;
    cursor: pointer;
  }
  .reminder-add button:hover { color: var(--text); border-color: var(--dim); }
  #reminders-result { color: var(--dim); font-size: 12px; flex-basis: 100%; }
  footer { color: var(--dim); font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(t('title'))}</h1>
    <div class="when">${escapeHtml(t('updated'))} ${escapeHtml(time)}<button class="reload named"
         id="refresh-button"
         title="${escapeHtml(t('refreshHint'))}"><span class="reload-icon">&#8635;</span><span class="reload-label">${escapeHtml(t('refreshLabel'))}</span></button><button class="reload named"
         id="freshcheck-button"
         title="${escapeHtml(t('freshCheckHint'))}"><span class="reload-icon freshcheck-icon"></span><span class="reload-label">${escapeHtml(t('freshCheckLabel'))}</span></button><button class="reload"
         id="settings-button" onclick="toggleSettingsPanel()"
         title="${escapeHtml(t('settingsTitle'))}">&#9881;</button>${checkStatusIndicator()}</div>
    <div class="platform">${escapeHtml(platforms.join(' · '))}</div>
${checkStatusPanel()}
  </header>
${inProgress}
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
  if (row.closest('[hidden]')) return false;
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
      if (optimisticExclusions.indexOf(r.getAttribute('data-cls')) !== -1) continue;
      if (group === 'cls' && r.getAttribute('data-cls') !== value) continue;
      if (group === 'type' && r.getAttribute('data-type') !== value) continue;
      if (group === 'days' && !matchesDueFilter([value], r.getAttribute('data-days'))) continue;
      count++;
    }
    label.textContent = count;
  }
}

// Classes just excluded via Save, before a real collection has actually
// caught up. saveSettings() sets this and re-runs the two filter
// functions below, which is what makes excluding a class feel instant
// instead of a 20-second wait: the data is already on the page, so
// there's no real reason to wait for a fresh fetch just to stop
// showing it.
//
// A SEPARATE VARIABLE, NOT JUST A ONE-OFF DOM HIDE, because a filter
// checkbox click re-runs applyFilters()/filterAnnouncements() and would
// otherwise un-hide anything this doesn't know to keep excluding. Both
// functions AND this in with their own checks, so it survives being
// re-run for any other reason. It only ever needs to live until the
// next real reload, at which point the excluded class isn't in the
// fetched data at all anymore and this array is moot (the reload wipes
// all page state, this included).
var optimisticExclusions = [];

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
    if (ok && optimisticExclusions.indexOf(r.getAttribute('data-cls')) !== -1) ok = false;

    if (ok && cls.length && cls.indexOf(r.getAttribute('data-cls')) === -1) ok = false;
    if (ok && types.length && types.indexOf(r.getAttribute('data-type')) === -1) ok = false;
    if (ok && dueRanges.length) ok = matchesDueFilter(dueRanges, r.getAttribute('data-days'));

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

function toggleSettingsPanel() {
  var panel = document.getElementById('settings-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
function updateStaleMonthsLabel(slider) {
  var label = slider.nextElementSibling;
  if (!label) return;
  var n = slider.value;
  label.textContent = n + ' ' + (n == 1 ? WORDS.monthWord : WORDS.monthsWord);
}

// Shows/hides the token+fingerprint block the instant the "enable home
// API" checkbox is clicked — same "don't make the person wait for a
// save round-trip just to see the UI react" idea as optimisticExclusions
// elsewhere on this page. The actual server only starts or stops once
// Save is clicked and the setting really changes; this is purely about
// not showing a key section for an API that (as far as the page can
// tell right now) isn't turned on.
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

function saveSettings() {
  var panel = document.getElementById('settings-panel');
  var fields = panel.querySelectorAll('[data-key]');
  var payload = {};
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

  // INSTANT, using data already on the page — no reason to make an
  // exclusion feel like it takes 20 seconds just because the real fetch
  // that makes it permanent does. Same idea hide/quiet already use:
  // update what's on screen right now, let the actual persistence catch
  // up in the background afterward.
  //
  // This only ever COVERS what's visibly on the page already, not
  // bucket placement (treatUndatedAsUrgent) or the class list's own
  // 0-counts (showEmptyClasses) — those come from server-side logic in
  // 05-playwright-draft.js that isn't duplicated here, and still only
  // change once the background collection below actually runs.
  if (payload.exclusions) {
    optimisticExclusions = payload.exclusions;
    applyFilters();
    filterAnnouncements();
  }

  var result = document.getElementById('settings-result');
  var encoded = toBase64Url(JSON.stringify(payload));

  // A saved exclusion still needs to reach settings.json and, to be
  // PERMANENT (surviving a reload, actually stopping the class from
  // being fetched at all), still needs the notifier's own quick
  // collection to run — the optimistic update above only ever touched
  // this one page's DOM. What changed is that nothing here asks the
  // user to wait around for that anymore; the reload below is just a
  // quiet background sync; the page already looks right before it fires.
  //
  // WITH A BRIDGE, "Saved" only appears once dispatchAction's onResult
  // actually reports success — not on a blind assumption. That matters
  // on its own, apart from the instant update above: this used to
  // assume success unconditionally, and a rejected setting, or the
  // notifier never being reached at all (which is exactly what happened
  // for one whole evening — see 21-notifier-actions.js's own PATH
  // comment), looked identical to a working save.
  if (hasNativeBridge()) {
    if (result) result.textContent = WORDS.saving;
    dispatchAction('config', encoded, function (res) {
      if (!res || !res.ok) {
        var why = res && (res.why ||
          (res.rejected && res.rejected.length && res.rejected.join('; ')));
        if (result) result.textContent = WORDS.saveFailed + (why ? ': ' + why : '');
        return;
      }
      if (result) result.textContent = WORDS.saved;
      // 21-notifier-actions.js only runs the slow, browser-launching
      // quick collection when a setting that actually changes what gets
      // FETCHED was touched (exclusions, canvas) — see its own comment
      // on NEEDS_REAL_FETCH. Everything else (treatUndatedAsUrgent,
      // showEmptyClasses, language, ...) only needed a redraw, which
      // finishes in well under a second, and previously still made the
      // page wait out the full 30-second quick-collection margin for
      // no reason — the exact same "looks like it's doing nothing"
      // shape as the original bug, just for a different set of settings.
      var wait = res.mode === 'redraw' ? 1500 : 30000;
      setTimeout(function () { location.reload(); }, wait);
    });
    return;
  }

  // No bridge (a plain browser tab): there's no way to ask whether this
  // worked, so this keeps behaving exactly as it always has — assume it
  // did, and quietly sync up on the same timer. The instant update above
  // still applies here too; it's plain DOM/JS, nothing bridge-specific.
  if (result) result.textContent = WORDS.saved;
  dispatchAction('config', encoded);
  setTimeout(function () { location.reload(); }, 30000);
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
    if (optimisticExclusions.indexOf(p.getAttribute('data-cls')) !== -1) ok = false;
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

// Filters are applied right away on load, not just counted: otherwise
// removed items would show up until the first checkbox click.
applyFilters();
</script>
</body>
</html>
`;

  fs.writeFileSync(outputPath, html);
  return outputPath;
}

// allKnownClasses/knownClassStatus are exported for 17-api.js's own
// /api/classes roster — same reasoning as sortIntoBuckets being shared
// between this page and the API instead of reimplemented: the merged-
// across-all-three-platforms class list should mean exactly one thing
// everywhere it's used, not two that could quietly drift apart.
module.exports = { writePage, daysUntil, allKnownClasses, knownClassStatus };
