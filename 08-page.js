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
           onclick="restoreUrgency(this)">${escapeHtml(t('restore'))}</a>`
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
    (id ? ` id="${id}"` : ` data-group="${group}" value="${escapeHtml(value)}"`) +
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
             onclick="restoreOverdueItem(this)">${escapeHtml(t('restore'))}</a>`
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
 * button collects everything into one chunk and calls the notifier via a
 * napominalka://config link, the same way "not urgent" and "hide" do.
 */
/**
 * Excluded classes — as CHECKBOXES, not a text field.
 *
 * The user's request, and a fair one: names like "AP World Hist 1 Per 2 -
 * 6255D-1 (S1)" can't be typed by hand without a typo, and a typo means
 * the exclusion just silently doesn't work. The list comes from
 * `classes.json` — that is, from what the system actually sees.
 *
 * Names no longer in that list (the class closed, but the exclusion
 * stayed) are still shown checked: otherwise saving would silently lose
 * them.
 *
 * If classes have never been read yet, a plain text field is used instead,
 * to type in by hand. An empty checkbox list would be a dead end.
 */
function exclusionsField(selected) {
  let classes = [];
  try {
    const file = path.join(__dirname, 'classes.json');
    if (fs.existsSync(file)) {
      classes = JSON.parse(fs.readFileSync(file, 'utf8')).map(c => c.name).filter(Boolean);
    }
  } catch { /* couldn't read it — fall back to the manual text field */ }

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

function settingsPanel() {
  const s = readSettings();
  const field = (key, label, value, hint) =>
    `      <label class="setting-row">
        <span class="field-name">${escapeHtml(label)}</span>
        <input type="text" data-key="${key}" value="${escapeHtml(value)}">
        <span class="field-hint">${escapeHtml(hint || '')}</span>
      </label>`;

  return `  <div class="settings-panel" id="settings-panel" hidden>
      <div class="name">${escapeHtml(t('settingsTitle'))}</div>
${field('email', t('settingsEmail'), s.email, t('settingsEmailHint'))}
${field('canvas', t('settingsCanvas'), s.canvas, t('settingsCanvasHint'))}
${field('summaryHours', t('settingsHours'), s.summaryHours.join(', '), t('settingsHoursHint'))}
${exclusionsField(s.exclusions)}
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsLanguage'))}</span>
        <select data-key="language">
          <option value="ru"${s.language === 'ru' ? ' selected' : ''}>Русский</option>
          <option value="en"${s.language === 'en' ? ' selected' : ''}>English</option>
        </select>
        <span class="field-hint"></span>
      </label>
      <label class="setting-row">
        <span class="field-name">${escapeHtml(t('settingsTreatUndated'))}</span>
        <input type="checkbox" data-bool-key="treatUndatedAsUrgent"${s.treatUndatedAsUrgent ? ' checked' : ''}>
        <span class="field-hint">${escapeHtml(t('settingsTreatUndatedHint'))}</span>
      </label>
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
function filtersPanel(allItems, now) {
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

  parts.push(group(t('filterClass'), count(x => x.class)
    .map(([v, n]) => checkRow('cls', v, v, n))));

  parts.push(group(t('filterType'), count(x => (x.type || '').trim())
    .map(([v, n]) => checkRow('type', v, v, n))));

  parts.push(group(t('filterDue'), dueRanges
    .filter(([, , n]) => n > 0)
    .map(([v, label, n]) => checkRow('days', v, label, n))));

  // A separate checkbox: not a value filter, but "show what's been removed".
  parts.push(`    <div class="filter-group">
      <div class="group-name">${escapeHtml(t('filterHidden'))}</div>
        <label class="check-row"><input type="checkbox" id="f-hidden" onchange="applyFilters()">
          <span class="label-text">${escapeHtml(t('filterShowHiddenMuted'))}</span></label>
        <label class="check-row"><input type="checkbox" id="f-removed" onchange="applyFilters()">
          <span class="label-text">${escapeHtml(t('filterShowRemoved'))}</span></label>
      <button onclick="resetFilters()">${escapeHtml(t('filterResetAll'))}</button>
      <div class="result" id="f-result"></div>
    </div>`);

  return `  <div class="filters">
${parts.join('\n')}
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
  main { max-width: 1180px; margin: 0 auto; }
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
  /* Reload button — like a browser's, but on the page itself: the digest
     window has no browser chrome at all. Just rereads the file, doesn't
     trigger a check (that's what "Check now" is for). */
  .reload {
    width: 26px; height: 26px; padding: 0; margin-left: 8px;
    vertical-align: middle; cursor: pointer;
    border: 1px solid var(--line); border-radius: 7px;
    background: var(--card); color: var(--dim);
    font-size: 15px; line-height: 1;
    transition: transform .3s ease, color .15s, border-color .15s;
  }
  .reload:hover { color: var(--new); border-color: var(--new); }
  /* Spins while a long-press-triggered check is running. No :active
     rotation of its own on purpose — it would fight this one. */
  .reload.spinning {
    animation: spin 1.1s linear infinite;
    color: var(--new); border-color: var(--new);
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
  .setting-row input[type="text"], .setting-row select {
    font: inherit; font-size: 13px; padding: 5px 8px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
    width: 100%;
  }
  .setting-row input[type="checkbox"] { flex: 0 0 auto; width: auto; margin: 2px 0 0; }
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
  footer { color: var(--dim); font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(t('title'))}</h1>
    <div class="when">${escapeHtml(t('updated'))} ${escapeHtml(time)}<button class="reload"
         id="reload-button"
         title="${escapeHtml(t('reloadHint'))}">&#8635;</button><button class="reload"
         id="settings-button" onclick="toggleSettingsPanel()"
         title="${escapeHtml(t('settingsTitle'))}">&#9881;</button></div>
    <div class="platform">${escapeHtml(platforms.join(' · '))}</div>
  </header>
${inProgress}
${warning}
  <div class="columns">
  <div>
${settingsPanel()}
${filtersPanel(allItems, now)}
${emptyBanner}
${section(t('dueSoon'), burning, now, freshIds, t('dueSoonCaption'))}
${overdueSection(overdue, now)}
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
  saved: t('settingsSaved'),
  restored: t('restoredBadge'),
})};

// The napominalka:// link goes to the notifier and gets written to disk
// there, but the page won't find out until the next collection. So the
// card is dimmed right away — otherwise it's unclear whether the click
// registered.
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
  row.classList.add('hidden-row');
  row.classList.remove('shown');
  link.className = 'quiet';
  link.textContent = WORDS.restore;
  link.href = 'napominalka://unhide/' + encodeURIComponent(row.dataset.id);
  link.onclick = function () { restoreOverdueItem(link); };

  refreshSection(row.closest('section'));
  return true;
}

function restoreOverdueItem(link) {
  var row = link.closest('.row');
  row.classList.remove('hidden-row', 'shown');
  link.className = 'quiet quiet-faint';
  link.textContent = WORDS.hide;
  link.href = 'napominalka://hide/' + encodeURIComponent(row.dataset.id);
  link.onclick = function (e) { return hideOverdueItem(e, link); };

  refreshSection(row.closest('section'));
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

// "Not urgent": fades, shows "muted", and slides away a second later.
// The link isn't cancelled — it still needs to reach the app so it can
// write the id to disk. But there's no reason to wait for the next
// collection for the card to disappear.
function muteItem(e, button) {
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
function restoreUrgency(link) {
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
  // The link isn't cancelled: it needs to reach the notifier.
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

  var result = document.getElementById('settings-result');
  if (result) result.textContent = WORDS.saved;

  // The page can't write to disk — call the notifier, it will.
  location.href = 'napominalka://config/' + toBase64Url(JSON.stringify(payload));

  // And reload itself. The notifier redraws the page right after writing
  // (takes about a second), so wait a beat and a half and refresh:
  // otherwise a language change would only show up after the next
  // collection, and language is an interface setting — waiting ten
  // minutes for it would be silly.
  setTimeout(function () { location.reload(); }, 1500);
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
    if (classes.length && classes.indexOf(p.getAttribute('data-cls')) === -1) ok = false;
    if (ok && newOnly && p.getAttribute('data-new') !== 'yes') ok = false;
    p.hidden = !ok;
    if (ok) visible++;
  }

  var counter = document.querySelector('.announcements-count');
  if (counter) counter.textContent = visible;
}

// ── The "reload" button ──
//
// A short press rereads the file. A long one (a second) triggers a real
// check — a full one, like "Check now".
//
// The page can't launch the program itself, the browser won't allow it.
// But it can call it via a napominalka:// link, which the notifier
// intercepts — the same way "not urgent" and "hide" work.
(function () {
  var button = document.getElementById('reload-button');
  if (!button) return;

  var timer = null;
  var wasLongPress = false;

  function onPress() {
    wasLongPress = false;
    timer = setTimeout(function () {
      wasLongPress = true;
      button.classList.add('spinning');
      button.title = WORDS.checking;
      location.href = 'napominalka://check';
      // A full check takes about a minute. The page redraws after every
      // source it reads, so reloading it is safe: you'll see at least
      // part of it, not nothing.
      setTimeout(function () { location.reload(); }, 45000);
    }, 700);
  }
  function onRelease() { clearTimeout(timer); }

  button.addEventListener('mousedown', onPress);
  button.addEventListener('mouseup', onRelease);
  button.addEventListener('mouseleave', onRelease);
  button.addEventListener('click', function () {
    // After a long press, a normal click follows right behind — swallow
    // it, otherwise the page reloads immediately and clobbers "spinning".
    if (wasLongPress) { wasLongPress = false; return; }
    location.reload();
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

module.exports = { writePage, daysUntil };
