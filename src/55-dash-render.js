/**
 * Draws the dashboard's cards from plain data (dashboardView in 08-page.js).
 *
 * The one place these cards are drawn, used from both sides: the server calls
 * it to write summary.html, the copy the apps show when the server can't be
 * reached, and the page calls it for what /api/dashboard sends. This file's
 * own text goes into the page as it is (see writePage), so:
 *   - it uses nothing from Node, only what's passed in: t and locale;
 *   - everything it's given is JSON (dates are ISO text);
 *   - every word it asks for is written t('word') so writePage can find it and
 *     send it along, or listed in EXTRA_WORDS when the name is worked out.
 */
function makeDashRender({ t, locale }) {
  const DEFAULT_PLATFORM = 'Google Classroom';
  const escapeHtml = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /**
   * Difference in CALENDAR days, not in hour-counted 24-hour periods: an
   * assignment due tomorrow at 8am is "tomorrow", even at 9pm when it's less
   * than half a day away. Rounding is for daylight saving, when a day can have
   * 23 or 25 hours.
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

  const dueDate = x => (x.dueAt ? new Date(x.dueAt) : null);

  /** The teacher line for a card's meta row, or nothing when there's no name. */
  const teacherSpan = x => (x.teacher
    ? `<span class="teacher" title="${escapeHtml(t('teacherLabel'))}">${escapeHtml(x.teacher)}</span>`
    : '');

  // Assignment links (31-assignment-links.js). A linked card's meta gets a
  // "1 of 2 done" pill while some parts are still open.
  function partsBadge(x) {
    return x.partsTotal > 1 && x.partsDone > 0 && x.partsDone < x.partsTotal
      ? `<span class="plat parts-badge">${escapeHtml(t('partsDone', x.partsDone, x.partsTotal))}</span>`
      : '';
  }

  // Locked Canvas work (see lockState in 05-playwright-draft.js): why it
  // can't be opened yet, or that it closed.
  function lockBadge(x) {
    const lock = x.locked;
    if (!lock) return '';
    const text = lock.why === 'closed' ? t('closedBadge')
      : lock.why === 'opens' ? t('lockedOpens', new Date(lock.at).toLocaleString(locale(),
          { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
      : lock.why === 'module' ? t('lockedModule', lock.module)
      : t('lockedOther');
    return `<span class="lock-badge">${escapeHtml(text)}</span>`;
  }

  // A card's buttons only show while the card is hovered (or has keyboard
  // focus), so they take no room on every card; on a screen with no hover
  // (touch) they always show. They go in a wrapper beside the card, not
  // inside it: the card is usually a link itself, and a link can't hold links.
  function cardWithActions(card, actions) {
    return `<div class="card-wrap">${card}${actions.trim()
      ? `\n        <span class="card-actions"><span class="card-actions-inner">${actions}</span></span>` : ''}
      </div>`;
  }

  // A linked assignment's other parts (with a ✓ once turned in), Unlink, and
  // Link — for cardWithActions().
  function linkButtons(x) {
    if (x.removed) return '';
    const id = escapeHtml(x.id);
    const others = (x.parts || []).filter(p => p.id !== x.id && p.link && !p.removed)
      .map(p => `<a class="quiet also" href="${escapeHtml(p.link)}" target="_blank" rel="noopener"` +
        ` title="${escapeHtml(p.title || '')}">${escapeHtml(p.platform || DEFAULT_PLATFORM)}${p.done ? ' ✓' : ''}</a>`).join('');
    const unlink = x.parts
      ? `<a class="quiet" href="napominalka://unlinkAssignment/${id}" onclick="return unlinkItem(event, this)">${escapeHtml(t('unlink'))}</a>`
      : '';
    return `${others}${unlink}<a class="quiet link-start" href="#" onclick="return startLink(event, this)">${escapeHtml(t('linkStart'))}</a>`;
  }

  // "Link here" stays beside the card: it's only there while another card is
  // picking a partner, and has to be seen without hovering.
  function linkHereButton(x) {
    return x.removed ? ''
      : `\n      <button type="button" class="quiet link-here" onclick="linkHere(this)">${escapeHtml(t('linkHere'))}</button>`;
  }

  /**
   * The teacher's instructions under a card, folded (Canvas's description,
   * Classroom's from readInstructions in 05-playwright-draft.js). Outside the
   * card itself: the card is a link, and a click in here mustn't open it.
   * Web addresses in them can be clicked.
   */
  function instructionsBlock(x) {
    const text = typeof x.description === 'string' ? x.description.trim() : '';
    if (!text) return '';
    const linked = escapeHtml(text).replace(/https?:\/\/[^\s<>()"]+/g, url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    return `<details class="instructions"><summary>${escapeHtml(t('instructions'))}</summary><div class="instructions-text">${linked}</div></details>`;
  }

  function itemCard(x, now, section) {
    // Classroom's due date arrives as text, while Canvas and Edpuzzle have no
    // text field at all, only the machine one.
    const due = dueDate(x);
    const dueText = x.due
      ? x.due.replace(/^Due\s+/, '')
      : (due
          ? due.toLocaleString(locale(),
              { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '');
    const dueLine = x.noteText ? x.noteText : (due ? `${dueText} · ${when(due, now)}` : '');

    // target="_blank": a new tab, so going back doesn't lose your place in
    // the list. rel="noopener": the opened page gets no handle back to this.
    const href = x.link
      ? ` href="${escapeHtml(x.link)}" target="_blank" rel="noopener"`
      : '';
    const tag = x.link ? 'a' : 'div';

    // "Not urgent" is only for assignments the teacher never gave a due date,
    // which is why they count as due-soon. A muted one gets the way back.
    const button = x.muted
      ? `\n        <a class="quiet" href="napominalka://unquiet/${escapeHtml(x.id)}"
           onclick="restoreUrgency(event, this)">${escapeHtml(t('restore'))}</a>`
      : (x.note === 'noDueDateNote')
        ? `\n        <a class="quiet" href="napominalka://quiet/${escapeHtml(x.id)}"
           onclick="muteItem(event, this)">${escapeHtml(t('notUrgent'))}</a>`
        : '';

    // Invisible tags for the filters. data-days: days until due, negative is
    // overdue, "none" is no due date at all.
    const days = due ? daysUntil(now, due) : 'none';
    const tags = ` data-id="${escapeHtml(x.id)}"` +
                    ` data-cls="${escapeHtml(x.class)}"` +
                    ` data-type="${escapeHtml(x.type || '')}"` +
                    ` data-days="${days}"` +
                    ` data-removed="${x.removed ? 'yes' : 'no'}"` +
                    ` data-sect="${escapeHtml(section || '')}"` +
                    (x.removed ? '' : ' data-linkable="yes"');

    const card = `<${tag}${href} class="item${x.fresh ? ' new' : ''}">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(x.platform || DEFAULT_PLATFORM)}</span>
          <span class="cls">${escapeHtml(x.class)}</span>
          ${teacherSpan(x)}
          ${dueLine ? `<span class="due">${escapeHtml(dueLine)}</span>` : ''}
          ${x.fresh ? `<span class="badge">${escapeHtml(t('newLabel'))}</span>` : ''}
          ${x.removed ? `<span class="removed-badge">${escapeHtml(t('removedBadge'))}</span>` : ''}
          ${lockBadge(x)}
          ${x.nextClass && !x.removed ? `<span class="class-next-badge">${escapeHtml(x.nextClass)}</span>` : ''}
          ${partsBadge(x)}
        </div>
      </${tag}>`;
    const instructions = instructionsBlock(x);
    return `      <div class="row${x.removed ? ' gone' : ''}"${tags}>
      ${cardWithActions(instructions ? `<div class="item-stack">${card}${instructions}</div>` : card, linkButtons(x) + button)}${linkHereButton(x)}
      </div>`;
  }

  /**
   * An overdue card. Each one has a "hide" button: staring forever at something
   * that can't be fixed anymore serves no purpose. Hidden ones aren't deleted,
   * and the button at the bottom of the section shows them again.
   */
  function overdueCard(x, now) {
    const due = dueDate(x);
    const days = Math.round((now - due) / 864e5);
    const wasDue = x.due
      ? x.due.replace(/^Due\s+/, '')
      : due.toLocaleString(locale(), { day: 'numeric', month: 'short' });

    const tags = ` data-cls="${escapeHtml(x.class)}"` +
                    ` data-type="${escapeHtml(x.type || '')}"` +
                    ` data-days="${-days}"` +
                    ` data-sect="overdue"` +
                    ' data-linkable="yes"';

    const card = `<a href="${escapeHtml(x.link || '#')}" target="_blank" rel="noopener" class="item overdue-item">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(x.platform || DEFAULT_PLATFORM)}</span>
          <span class="cls">${escapeHtml(x.class)}</span>
          ${teacherSpan(x)}
          <span class="overdue-since">${escapeHtml(wasDue)} · ${escapeHtml(t('lateByDays', days))}</span>
          ${lockBadge(x)}
          ${partsBadge(x)}
        </div>
      </a>`;
    return `      <div class="row${x.hidden ? ' hidden-row' : ''}" data-id="${escapeHtml(x.id)}"${tags}>
      ${cardWithActions(card, linkButtons(x) + (x.hidden
        ? `<a class="quiet" href="napominalka://unhide/${escapeHtml(x.id)}"
             onclick="restoreOverdueItem(event, this)">${escapeHtml(t('restore'))}</a>`
        : `<a class="quiet quiet-faint" href="napominalka://hide/${escapeHtml(x.id)}"
             onclick="return hideOverdueItem(event, this)">${escapeHtml(t('hide'))}</a>`) +
        // Closed work can't ever be turned in, so it can also go for good.
        (x.locked && x.locked.why === 'closed'
          ? `<a class="quiet quiet-faint" href="napominalka://deleteAssignment/${escapeHtml(encodeURIComponent(x.id))}"
             onclick="return deleteClosedItem(event, this)">${escapeHtml(t('deleteForGood'))}</a>`
          : ''))}${linkHereButton(x)}
      </div>`;
  }

  /**
   * A reminder, kind being active, hidden or done (24-virtual-assignments.js).
   *
   * data-title/data-class/data-raw-due are read by startEditReminder() to fill
   * the add form. data-raw-due, not the due date: treatUndatedAsUrgent forces
   * that to "tomorrow" for a reminder that never had one, and editing needs the
   * stored value. data-cls/data-type/data-days are the same ones an assignment
   * has, so the main filters apply to a reminder too.
   */
  function reminderCard(x, kind, now) {
    const due = dueDate(x);
    const dueText = () => {
      if (!due) return t('reminderNoDue');
      if (x.noteText) return x.noteText;
      const date = due.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      // A done reminder isn't overdue, however long ago it was due.
      return kind === 'done' ? date : `${date} · ${when(due, now)}`;
    };
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
    const days = due ? daysUntil(now, due) : 'none';
    return `      <div class="row" data-id="${escapeHtml(x.id)}"
           data-title="${escapeHtml(x.title)}" data-class="${escapeHtml(x.class || '')}"
           data-raw-due="${escapeHtml(x.rawDue || '')}"
           data-cls="${escapeHtml(x.class || '')}" data-type="${escapeHtml(x.type || '')}"
           data-days="${days}">
      ${cardWithActions(`<div class="item">
        <div class="title">${escapeHtml(x.title)}</div>
        <div class="meta">
          <span class="plat">${escapeHtml(t('reminderPlatform'))}</span>
          ${x.class ? `<span class="cls">${escapeHtml(x.class)}</span>` : ''}
          <span class="due">${escapeHtml(dueText())}</span>
          ${x.fromLink === null || x.fromLink === undefined ? '' : x.fromLink
            ? `<a class="reminder-from" href="${escapeHtml(x.fromLink)}" target="_blank" rel="noopener">${escapeHtml(t('reminderFromAnnouncement'))}</a>`
            : `<span class="reminder-from">${escapeHtml(t('reminderFromAnnouncement'))}</span>`}
        </div>
      </div>`, actions)}
      </div>`;
  }

  /**
   * An announcement's attachments: photos saved by the collector as pictures
   * (a click shows them whole, see openPhoto), everything else as a chip that
   * opens it. dashboardView has already kept only what's safe to show.
   */
  function attachmentsBlock(p, photoBase) {
    const photos = p.photos || [];
    const chips = p.chips || [];
    if (!photos.length && !chips.length) return '';
    const known = ['image', 'pdf', 'doc', 'slides', 'sheet', 'form', 'video', 'link'];
    const kind = k => t(`attachment_${known.includes(k) ? k : 'file'}`);
    return `        <div class="post-attachments">
${photos.map(a => `          <button type="button" class="post-photo" onclick="openPhoto(this)" data-link="${a.link ? escapeHtml(a.link) : ''}" title="${escapeHtml(a.title || '')}"><img src="${escapeHtml(photoBase + a.photo)}" alt="${escapeHtml(a.title || kind('image'))}" loading="lazy"></button>`).join('\n')}
${chips.map(a => `          <a class="att-chip" href="${escapeHtml(a.link)}" target="_blank" rel="noopener"><span class="att-kind">${escapeHtml(kind(a.kind))}</span> ${escapeHtml(a.title || '')}</a>`).join('\n')}
        </div>`;
  }

  /**
   * What the last AI scan of an announcement did (38-announcement-scan.js's
   * record): a fold-out under its text, closed, with each item the AI found
   * and what became of it, what it answered, and its thinking when the model
   * sent any. A scan from before these were kept says so.
   */
  function aiResultBlock(p, record) {
    if (!record) return '';
    const date = iso => new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const summary = record.error ? t('aiPostSummaryFailed') : record.kept ? t('aiPostSummaryKept', record.kept) : t('aiPostSummaryNone');
    const outcome = st => st.outcome === 'kept' ? t('aiStepKept')
      : st.outcome === 'notInText' ? t('aiStepNotInText')
      : st.outcome === 'sameTitle' ? t('aiStepSameTitle', st.match || '?')
      : st.outcome === 'sameWork' ? t('aiStepSameWork', st.match || '?')
      : t('aiStepNotAdded');
    const steps = Array.isArray(record.steps) ? record.steps : [];
    const due = st => !st.due ? t('aiStepNoDue') : st.dueFrom === 'nextClass' ? t('aiStepDueNextClass', date(st.due)) : t('aiStepDue', date(st.due));
    const body = [
      record.error ? `<p>${escapeHtml(t('aiPostWhy', record.error))}</p>` : '',
      steps.length ? `<ul>${steps.map(st => `<li class="ai-step ai-step-${escapeHtml(st.outcome || '')}"><b>${escapeHtml(st.title)}</b> · ${escapeHtml(due(st))} — ${escapeHtml(outcome(st))}</li>`).join('')}</ul>`
        : !record.error && record.answer !== undefined ? `<p>${escapeHtml(t('aiPostNothing'))}</p>` : '',
      record.answer !== undefined ? `<div class="ai-result-label">${escapeHtml(t('aiPostAnswer'))}</div><pre>${escapeHtml(record.answer)}</pre>`
        : !record.error ? `<p class="hint">${escapeHtml(t('aiPostOld'))}</p>` : '',
      record.thinking ? `<div class="ai-result-label">${escapeHtml(t('aiPostThinking'))}</div><pre>${escapeHtml(record.thinking)}</pre>`
        : record.answer !== undefined ? `<p class="hint">${escapeHtml(t('aiPostNoThinking'))}</p>` : '',
    ].filter(Boolean).join('\n');
    return `        <details class="ai-result" data-scan-for="${escapeHtml(p.id)}"><summary>${escapeHtml(summary)}${record.at ? ` · ${escapeHtml(date(record.at))}` : ''}</summary>
${body}
        </details>`;
  }

  /**
   * An announcement. The card isn't one big link, it's a block with buttons:
   * otherwise clicking "expand" would go to Classroom instead. With AI on it
   * gets a scan button and, once scanned, a fold-out with what the AI did.
   */
  function announcementCard(p, aiOn, photoBase) {
    const scanButton = aiOn
      ? `<button type="button" class="quiet ai-scan-btn" data-id="${escapeHtml(p.id)}" onclick="scanPost(this)">${escapeHtml(t('aiPostScan'))}</button>` : '';
    const hasAttachments = (p.photos && p.photos.length) || (p.chips && p.chips.length) || p.hadAttachments;
    return `      <div class="post-row" data-id="${escapeHtml(p.id)}">
      ${cardWithActions(`<div class="post" data-cls="${escapeHtml(p.class)}" data-new="${p.fresh ? 'yes' : 'no'}">
        <div class="post-top">
          <span class="cls">${escapeHtml(p.class)}</span>
          <span>${escapeHtml(p.author || '')}</span>
          ${p.date ? `<span>${escapeHtml(p.date)}</span>` : ''}
          ${p.fresh ? `<span class="badge">${escapeHtml(t('newLabel'))}</span>` : ''}
        </div>
        <div class="text collapsed">${escapeHtml(p.text || (hasAttachments ? '' : p.title) || '')}</div>
${attachmentsBlock(p, photoBase)}
        <div class="actions">
          <button class="expand-btn" onclick="expandPost(this)" hidden>${escapeHtml(t('expand'))}</button>
          <a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${escapeHtml(t('openInClassroom'))}</a>
        </div>
${aiOn ? `        <div class="ai-post-status" hidden></div>
${aiResultBlock(p, p.scan)}` : ''}
      </div>`, scanButton)}
      </div>`;
  }

  /** The checkboxes above the announcements: by class, and "new only". */
  function announcementFilters(announcements) {
    const counts = new Map();
    for (const p of announcements) counts.set(p.class, (counts.get(p.class) || 0) + 1);
    const byClass = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    const freshCount = announcements.filter(p => p.fresh).length;
    const checkRow = (group, value, label, count, id) =>
      `        <label class="check-row"><input type="checkbox"` +
      // A lone id means this isn't part of a multi-select set: "new only" is
      // its own yes/no, so it gets the toggle look.
      (id ? ` id="${id}" class="toggle"` : ` data-group="${group}" value="${escapeHtml(value)}"`) +
      ` onchange="filterAnnouncements()">` +
      `<span class="label-text">${escapeHtml(label)}</span>` +
      `<span class="count-badge">${count}</span></label>`;
    const checkboxes = byClass.map(([c, n]) => checkRow('post-cls', c, c, n));
    if (freshCount) checkboxes.push(checkRow(null, null, t('filterNewOnly'), freshCount, 'f-post-new'));
    return byClass.length > 1 || freshCount
      ? `      <div class="announcement-filters">\n${checkboxes.join('\n')}\n      </div>`
      : '';
  }

  /**
   * The main filters' choices: class, type and due date. Boxes start checked,
   * apart from the ones the user unticked last time (`off`). An empty group
   * means everything matches, so "all checked" and "none checked" are the same.
   */
  function filterChoices(filters, off) {
    const isOff = (group, value) => ((off || {})[group] || []).includes(value);
    const checkRow = (group, value, label, count) =>
      `        <label class="check-row"><input type="checkbox" data-group="${group}"` +
      ` value="${escapeHtml(value)}" onchange="rememberFilters(); applyFilters()"` +
      `${isOff(group, value) ? '' : ' checked'}>` +
      `<span class="label-text">${escapeHtml(label)}</span>` +
      `<span class="count-badge">${count}</span></label>`;
    const group = (name, rows) =>
      `    <div class="filter-group">
      <div class="group-name">${escapeHtml(name)}</div>
${rows.join('\n')}
    </div>`;
    const dueLabels = { 1: t('filterTodayTomorrow'), 7: t('filterWeek'), 31: t('filterMonth'), past: t('filterOverdue'), none: t('filterNoDueDate') };
    return [
      group(t('filterClass'), filters.classes.map(([v, n]) => checkRow('cls', v, v, n))),
      group(t('filterType'), filters.types.map(([v, n]) => checkRow('type', v, v, n))),
      group(t('filterDue'), filters.dues.map(([v, n]) => checkRow('days', v, dueLabels[v], n))),
    ].join('\n');
  }

  // The lists of assignment sections, in the order they sit on the page: what
  // each is called and how it draws a row.
  const SECTIONS = [
    { list: 'overdue', heading: () => t('overdue'), caption: () => t('overdueCaption') },
    { list: 'dueSoon', heading: () => t('dueSoon'), caption: () => t('dueSoonCaption') },
    { list: 'ahead', heading: () => t('ahead') },
    { list: 'materials', heading: () => t('newMaterials'), caption: () => t('materialsCaption') },
    { list: 'muted', heading: () => t('mutedSection'), caption: () => t('mutedCaption') },
    { list: 'removed', heading: () => t('removed'), caption: () => t('removedCaption') },
  ];

  /** One row of any list on the dashboard, by the list's name. */
  function row(list, x, now, opts) {
    if (list === 'overdue') return overdueCard(x, now);
    if (list === 'remindersActive') return reminderCard(x, 'active', now);
    if (list === 'remindersHidden') return reminderCard(x, 'hidden', now);
    if (list === 'remindersDone') return reminderCard(x, 'done', now);
    if (list === 'announcements') return announcementCard(x, opts.aiOn, opts.photoBase || '');
    const section = SECTIONS.find(s => s.list === list);
    return itemCard(x, now, section.heading().toLowerCase());
  }

  /** "You can relax": nothing due, nothing new. */
  const emptyNote = () => `  <div class="empty">${escapeHtml(t('emptyState'))}</div>`;

  return { row, SECTIONS, filterChoices, emptyNote, announcementFilters, daysUntil, when, escapeHtml };
}

// Words whose names are worked out rather than written out.
makeDashRender.EXTRA_WORDS = ['locale', 'attachment_image', 'attachment_pdf', 'attachment_doc', 'attachment_slides', 'attachment_sheet', 'attachment_form', 'attachment_video', 'attachment_link', 'attachment_file'];

if (typeof module !== 'undefined') module.exports = makeDashRender;
