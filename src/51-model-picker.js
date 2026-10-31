/**
 * The model picker: a button under the AI pane's question box and the
 * Grades center's, showing the AI and model the chat asks with, and one
 * in Settings → AI → Announcements for the announcement scan's. It
 * opens upward (downward in Settings), with the providers down the side (the ones not ready
 * yet say why when picked) and the chosen one's models beside them, a box
 * to search them or type a name the list doesn't have, and a check on the
 * one in use, and under it how hard the model in use thinks, where it can
 * be told (its levels from choices(); medium unless another is picked).
 * Like T3 Code's picker, without favorites.
 *
 * What's listed comes from the aiChoices action (37-ai.js choices()),
 * asked each time it opens; a pick is saved with aiPick: the chats' is
 * used by both chats (37-ai.js chatSettings), the scan's (which: 'scan',
 * with an Off at the top) is Settings → AI's aiProvider and aiModel.
 * Unlike T3 Code, the AI can change in the middle of a chat: ClassDash
 * sends the last few turns with every question, so there's no session to
 * keep with one provider.
 *
 * Both pages put CSS in their style and SCRIPT in their script, and call
 * modelPicker(host, { ask, words, onPick, which?, off?, down? }):
 * ask(action, arg) answers with a promise, words holds the mp* strings
 * (STRING_KEYS).
 */
const STRING_KEYS = ['mpTitle', 'mpDefault', 'mpMissing', 'mpSearch', 'mpUse', 'mpLooking', 'mpNoModels', 'mpOff', 'mpOffPick',
  'mpEffort', 'mpEffort_off', 'mpEffort_on', 'mpEffort_low', 'mpEffort_medium', 'mpEffort_high',
  'mpWhy_notFound', 'mpWhy_signedOut', 'mpWhy_key', 'mpWhy_agree', 'mpWhy_mac'];

const CSS = `
  .mp-host { position: relative; }
  .mp-trigger { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; padding: 2px 8px; }
  .mp-pop { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 5; display: flex; max-height: 300px; min-height: 160px;
    background: var(--card); color: var(--text); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); font-size: 13px; }
  .mp-side { flex: 0 0 38%; max-width: 170px; overflow-y: auto; border-right: 2px solid var(--line); display: flex; flex-direction: column; }
  .mp-side button { all: unset; box-sizing: border-box; padding: 6px 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mp-pop.down { bottom: auto; top: calc(100% + 4px); }
  .mp-side button.off { color: var(--dim); }
  .mp-side button.mp-none { border-bottom: 2px solid var(--line); }
  .mp-side button[aria-current="true"] { background: var(--accent); color: var(--card); }
  .mp-side button:focus-visible, .mp-list button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
  .mp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .mp-search { margin: 6px; font: inherit; font-size: 13px; color: var(--text); background: var(--bg); border: 2px solid var(--ink); padding: 3px 6px; }
  .mp-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .mp-list button { all: unset; box-sizing: border-box; padding: 5px 8px 5px 22px; cursor: pointer; position: relative; overflow-wrap: anywhere; }
  .mp-list button:hover, .mp-side button:hover:not([aria-current="true"]) { background: var(--bg); }
  .mp-list button[aria-selected="true"]::before { content: '✓'; position: absolute; left: 7px; }
  .mp-note { padding: 8px; color: var(--dim); }
  .mp-effort { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; padding: 6px; border-top: 2px solid var(--line); }
  .mp-effort span { color: var(--dim); margin-right: 4px; }
  .mp-effort button { all: unset; box-sizing: border-box; padding: 2px 8px; cursor: pointer; border: 2px solid var(--line); }
  .mp-effort button[aria-pressed="true"] { background: var(--accent); color: var(--card); border-color: var(--accent); }
  .mp-effort button:focus-visible { outline: 2px solid var(--ink); }
`;

// In the pages' own script, so written the way both of them can run.
const SCRIPT = String.raw`
function modelPicker(host, opts) {
  var W = opts.words;
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'mp-trigger small mini-btn';
  trigger.title = W.mpTitle;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = W.mpLooking;
  host.classList.add('mp-host');
  host.appendChild(trigger);
  var data = null, pop = null, tab = null, search = '';

  function find(id) { return data && data.providers.filter(function (p) { return p.id === id; })[0]; }
  function encode(text) {
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // The pick this picker shows: the chats', or the announcement scan's.
  function cur() { return opts.which === 'scan' ? data.scan : data.current; }
  function setCur(c) { if (opts.which === 'scan') data.scan = c; else data.current = c; }
  function whyOf(p) { return p.why === 'unavailable' ? p.detail || '' : W['mpWhy_' + p.why] || ''; }
  // How hard the model in use thinks: its levels and the one it uses, or null.
  function effortOf(p, model) { return p && p.efforts ? p.efforts[model] || null : null; }
  function effortNow(p) {
    var e = effortOf(p, cur().model);
    return e ? (e.levels.indexOf(cur().effort) !== -1 ? cur().effort : e.usual) : '';
  }
  function showCurrent() {
    var p = data && find(cur().provider);
    var e = effortNow(p);
    trigger.textContent = (p ? p.label + ' · ' + modelName(p, cur().model) + (e ? ' · ' + W['mpEffort_' + e] : '') : opts.off ? W.mpOffPick : W.mpOff) + ' ▾';
  }
  function load() {
    return Promise.resolve(opts.ask('aiChoices', '')).then(function (r) {
      if (r && r.ok && r.providers) { data = r; showCurrent(); if (pop) draw(); }
    });
  }
  // The models to pick from: its list, or only its default. The one in
  // use stays first even when it's gone (deleted from LM Studio, say), so
  // it's plain why the chat can't ask with it.
  // '' is its default; a cloud API's is its newest, named beside it.
  function modelName(p, m) { return m || W.mpDefault + (p.newest && p.model ? ' (' + p.model + ')' : ''); }
  function models(p) {
    if (p.newest) {
      var all = [''].concat(p.models);
      if (cur().model && p.id === cur().provider && all.indexOf(cur().model) === -1) all.splice(1, 0, cur().model);
      return all;
    }
    var list = p.models.length ? p.models.slice() : [p.model];
    if (p.model && list.indexOf(p.model) === -1) list.unshift(p.model);
    if (p.id === cur().provider && cur().model && list.indexOf(cur().model) === -1) list.unshift(cur().model);
    return list;
  }
  function gone(p, m) { return p.models.length > 0 && m && p.models.indexOf(m) === -1 && m !== p.model; }
  function draw() {
    pop.textContent = '';
    if (!data) { var wait = document.createElement('div'); wait.className = 'mp-note'; wait.textContent = W.mpLooking; pop.appendChild(wait); return; }
    if (!tab) tab = find(cur().provider) ? cur().provider : (data.providers.filter(function (p) { return p.ok; })[0] || data.providers[0]).id;
    var side = document.createElement('div');
    side.className = 'mp-side';
    if (opts.off) {
      var none = document.createElement('button');
      none.type = 'button';
      none.className = 'mp-none';
      none.textContent = (find(cur().provider) ? '' : '✓ ') + W.mpOffPick;
      none.onclick = function () { pick({ id: 'none' }, '', ''); };
      side.appendChild(none);
    }
    data.providers.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      if (!p.ok) { b.className = 'off'; b.title = whyOf(p); }
      b.setAttribute('aria-current', p.id === tab ? 'true' : 'false');
      b.onclick = function () { tab = p.id; search = ''; draw(); };
      side.appendChild(b);
    });
    var main = document.createElement('div');
    main.className = 'mp-main';
    var p = find(tab);
    if (!p.ok) {
      var why = document.createElement('div');
      why.className = 'mp-note';
      why.textContent = whyOf(p);
      main.appendChild(why);
    } else {
      var box = document.createElement('input');
      box.className = 'mp-search';
      box.placeholder = W.mpSearch;
      box.value = search;
      box.hidden = p.id === 'apple';
      var list = document.createElement('div');
      list.className = 'mp-list';
      list.setAttribute('role', 'listbox');
      var fill = function () {
        list.textContent = '';
        var q = search.trim().toLowerCase();
        var shown = models(p).filter(function (m) { return !q || modelName(p, m).toLowerCase().indexOf(q) !== -1; });
        // A name the list doesn't have, typed in: offered when nothing matches.
        var typed = search.trim();
        if (typed && !shown.length && /^[A-Za-z0-9._:\/-]+$/.test(typed)) shown.push({ typed: typed });
        if (!shown.length) { var none = document.createElement('div'); none.className = 'mp-note'; none.textContent = W.mpNoModels; list.appendChild(none); }
        shown.forEach(function (m) {
          var name = typeof m === 'string' ? m : m.typed;
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'option');
          b.textContent = typeof m === 'string' ? modelName(p, m) + (gone(p, m) ? ' ' + W.mpMissing : '') : W.mpUse.replace('{name}', m.typed);
          b.setAttribute('aria-selected', p.id === cur().provider && name === cur().model ? 'true' : 'false');
          // Another model keeps the level picked when it takes it too.
          b.onclick = function () {
            var keep = p.id === cur().provider && cur().effort && effortOf(p, name) && effortOf(p, name).levels.indexOf(cur().effort) !== -1;
            pick(p, name, keep ? cur().effort : '');
          };
          list.appendChild(b);
        });
      };
      box.oninput = function () { search = box.value; fill(); };
      box.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var first = list.querySelector('button'); if (first) first.click(); }
      };
      fill();
      main.appendChild(box);
      main.appendChild(list);
      var levels = p.id === cur().provider ? effortOf(p, cur().model) : null;
      if (levels) {
        var row = document.createElement('div');
        row.className = 'mp-effort';
        var head = document.createElement('span');
        head.textContent = W.mpEffort;
        row.appendChild(head);
        levels.levels.forEach(function (level) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = W['mpEffort_' + level];
          b.setAttribute('aria-pressed', effortNow(p) === level ? 'true' : 'false');
          // The usual one is saved as "none picked", so it follows the usual.
          b.onclick = function () { pick(p, cur().model, level === levels.usual ? '' : level, true); };
          row.appendChild(b);
        });
        main.appendChild(row);
      }
      setTimeout(function () { if (!box.hidden) box.focus(); }, 0);
    }
    pop.appendChild(side);
    pop.appendChild(main);
  }
  function pick(p, model, effort, stay) {
    var choice = { for: opts.which || 'chat', provider: p.id, model: model, url: p.url || '', effort: effort || '' };
    Promise.resolve(opts.ask('aiPick', encode(JSON.stringify(choice)))).then(function (r) {
      if (!r || !r.ok) return;
      setCur({ provider: p.id, model: model, effort: effort || '' });
      showCurrent();
      if (stay && pop) draw(); else close();
      if (opts.onPick) opts.onPick(choice);
    });
  }
  function close() {
    if (!pop) return;
    pop.remove();
    pop = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  }
  function outside(e) { if (!host.contains(e.target)) close(); }
  function escape(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.focus(); } }
  trigger.onclick = function () {
    if (pop) { close(); return; }
    pop = document.createElement('div');
    pop.className = 'mp-pop' + (opts.down ? ' down' : '');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', W.mpTitle);
    host.appendChild(pop);
    trigger.setAttribute('aria-expanded', 'true');
    tab = null; search = '';
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    draw();
    load();
  };
  load();
  return { reload: load, close: close };
}
`;

module.exports = { CSS, SCRIPT, STRING_KEYS };
