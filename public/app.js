// Tier List: rank things with friends, from S down to F.
//
// One page. The server keeps tier lists, the things on them and every
// person's vote; this script works out your tiers, the crowd's and each
// thing's breakdown from those, and lets you place things by dragging them
// into a tier or by tapping one and choosing.
(function () {
  'use strict';

  // ── Platform plumbing ──────────────────────────────────────────────────
  // The shell signs the viewer in with ?token=; every API call carries it.
  // A staging preview opened with ?demo=1 forwards that too, so the server
  // can add its read-only demo state.
  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || '';
  var demo = params.get('demo') === '1';

  function api(method, path, body) {
    var headers = { Accept: 'application/json' };
    if (token) headers['x-usernode-token'] = token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var url = path + (demo && method === 'GET' ? (path.indexOf('?') === -1 ? '?' : '&') + 'demo=1' : '');
    return fetch(url, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data && data.error ? data.error : 'Request failed');
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      });
  }

  // ── Tiers ──────────────────────────────────────────────────────────────
  // A tier is a score so it averages: 5 = S down to 0 = F. Class names are
  // whole literals so the stylesheet build can see them.
  // The heat ladder: hot takes at the top, cold ones at the bottom.
  var TIERS = [
    { score: 5, letter: 'S', bg: 'bg-heat-s', ink: 'text-on-heat-s' },
    { score: 4, letter: 'A', bg: 'bg-heat-a', ink: 'text-on-heat-a' },
    { score: 3, letter: 'B', bg: 'bg-heat-b', ink: 'text-on-heat-b' },
    { score: 2, letter: 'C', bg: 'bg-heat-c', ink: 'text-on-heat-c' },
    { score: 1, letter: 'D', bg: 'bg-heat-d', ink: 'text-on-heat-d' },
    { score: 0, letter: 'F', bg: 'bg-heat-f', ink: 'text-on-heat-f' },
  ];
  function tierOf(score) {
    for (var i = 0; i < TIERS.length; i += 1) if (TIERS[i].score === score) return TIERS[i];
    return null;
  }

  // ── State ──────────────────────────────────────────────────────────────
  var state = {
    lists: [],
    listId: null,
    list: null,
    items: [],
    votes: [],
    me: null,
    view: 'mine',
    openThing: null,
  };
  var LAST_LIST_KEY = 'tier-list:last-list';

  function el(id) { return document.getElementById(id); }
  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function shortName(username) {
    var parts = String(username || '').split(/[-_.]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(username || '');
  }
  function initial(username) { return shortName(username).charAt(0).toUpperCase() || '?'; }
  function isMe(userId) { return state.me && Number(userId) === Number(state.me.id); }

  // ── Derived views ──────────────────────────────────────────────────────
  function myTier(itemId) {
    for (var i = 0; i < state.votes.length; i += 1) {
      var v = state.votes[i];
      if (v.item_id === itemId && isMe(v.user_id)) return v.tier;
    }
    return null;
  }
  function votesFor(itemId) {
    return state.votes.filter(function (v) { return v.item_id === itemId; });
  }
  function crowdFor(itemId) {
    var vs = votesFor(itemId);
    if (!vs.length) return null;
    var sum = vs.reduce(function (s, v) { return s + v.tier; }, 0);
    var avg = sum / vs.length;
    return { avg: avg, tier: Math.round(avg), count: vs.length };
  }
  function voterCount() {
    var seen = {};
    state.votes.forEach(function (v) { seen[v.user_id] = true; });
    return Object.keys(seen).length;
  }

  // ── Screens ────────────────────────────────────────────────────────────
  var screens = ['state-loading', 'state-error', 'state-start', 'state-board'];
  function show(id) {
    screens.forEach(function (s) { el(s).hidden = s !== id; });
  }

  function toast(text) {
    var box = el('toast');
    el('toast-text').textContent = text;
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { box.hidden = true; }, 3200);
  }

  // A tile: a thing, as a button. Tap opens it; drag places it.
  function tile(item, extra) {
    var b = h('button', 'tile');
    b.type = 'button';
    b.dataset.itemId = String(item.id);
    var name = h('span', 'line-clamp-2 break-words', item.name);
    b.appendChild(name);
    if (extra) b.appendChild(extra);
    return b;
  }

  function tierRow(tier, tiles, droppable, first) {
    var row = h('div', 'flex min-h-16 items-stretch' + (first ? '' : ' border-t border-line'));
    row.dataset.tier = String(tier.score);
    if (droppable) row.dataset.dropTier = String(tier.score);
    var label = h('div', 'grade flex w-14 shrink-0 items-center justify-center ' + tier.bg + ' ' + tier.ink, tier.letter);
    label.setAttribute('aria-hidden', 'true');
    var zone = h('ul', 'flex min-w-0 flex-1 flex-wrap content-start items-start gap-2 p-2');
    zone.setAttribute('aria-label', tier.letter + ' tier');
    tiles.forEach(function (t) { var li = h('li', 'max-w-full'); li.appendChild(t); zone.appendChild(li); });
    row.appendChild(label);
    row.appendChild(zone);
    return row;
  }

  function renderMine() {
    var board = el('board-mine');
    board.replaceChildren();
    var unranked = [];
    var byTier = {};
    TIERS.forEach(function (t) { byTier[t.score] = []; });
    // Within a tier, the order you placed them in.
    var order = {};
    state.votes.forEach(function (v, i) { if (isMe(v.user_id)) order[v.item_id] = i; });
    state.items.forEach(function (item) {
      var t = myTier(item.id);
      if (t == null) unranked.push(item);
      else byTier[t].push(item);
    });
    TIERS.forEach(function (t, i) {
      var items = byTier[t.score].sort(function (a, b) { return order[a.id] - order[b.id]; });
      board.appendChild(tierRow(t, items.map(function (item) { return tile(item); }), true, i === 0));
    });

    var tray = el('tray-items');
    tray.replaceChildren();
    unranked.forEach(function (item) {
      var li = h('li', 'shrink-0');
      li.appendChild(tile(item));
      tray.appendChild(li);
    });
    var total = state.items.length;
    el('tray-heading').textContent = unranked.length ? 'To rank (' + unranked.length + ')' : 'To rank';
    el('tray-hint').hidden = !unranked.length;
    el('tray-items').hidden = !unranked.length;
    el('tray-done').hidden = !(total && !unranked.length);
    el('tray-done').textContent = "You've ranked everything on this list. Add something new below.";
    if (!total) {
      el('tray-done').hidden = false;
      el('tray-done').textContent = 'Nothing to rank yet. Add the first thing.';
    }
  }

  function renderEveryone() {
    var board = el('board-everyone');
    board.replaceChildren();
    var byTier = {};
    TIERS.forEach(function (t) { byTier[t.score] = []; });
    var unvoted = 0;
    state.items.forEach(function (item) {
      var c = crowdFor(item.id);
      if (!c) { unvoted += 1; return; }
      byTier[c.tier].push({ item: item, crowd: c });
    });
    TIERS.forEach(function (t, i) {
      var entries = byTier[t.score].sort(function (a, b) {
        return b.crowd.avg - a.crowd.avg || b.crowd.count - a.crowd.count || a.item.name.localeCompare(b.item.name);
      });
      var tiles = entries.map(function (e) {
        var count = h('span', 'ml-2 shrink-0 text-small font-normal tabular-nums text-muted', String(e.crowd.count));
        count.setAttribute('aria-label', plural(e.crowd.count, 'vote', 'votes'));
        return tile(e.item, count);
      });
      board.appendChild(tierRow(t, tiles, false, i === 0));
    });
    var voters = voterCount();
    var meta = voters ? 'The average of ' + plural(voters, 'person', 'people') + '.' : '';
    if (voters && unvoted) meta += ' ' + plural(unvoted, 'thing', 'things') + ' not ranked by anyone yet.';
    el('everyone-meta').textContent = meta;
    el('everyone-empty').hidden = voters > 0;
  }

  function renderHeader() {
    el('list-title').textContent = state.list ? state.list.title : '';
    var mine = state.items.filter(function (item) { return myTier(item.id) != null; }).length;
    var voters = voterCount();
    var parts = [];
    parts.push(state.items.length ? 'You\'ve ranked ' + mine + ' of ' + state.items.length : 'No things yet');
    if (voters) parts.push(plural(voters, 'person', 'people') + ' ranking');
    el('list-meta').textContent = parts.join('. ') + '.';
  }

  function renderView() {
    el('state-board').dataset.view = state.view;
    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    });
    el('mine-panel').classList.toggle('max-lg:hidden', state.view !== 'mine');
    el('everyone-panel').classList.toggle('max-lg:hidden', state.view !== 'everyone');
  }

  function renderBoard() {
    renderHeader();
    renderMine();
    renderEveryone();
    renderView();
    if (state.openThing != null) renderThing(state.openThing);
  }

  // ── One thing, in its sheet ───────────────────────────────────────────
  function renderThing(itemId) {
    var item = state.items.filter(function (i) { return i.id === itemId; })[0];
    if (!item) { closeSheet('thing-sheet'); return; }
    el('thing-name').textContent = item.name;
    el('thing-added').textContent = 'Added by ' + (isMe(item.added_by) ? 'you' : item.added_by_name);

    var mine = myTier(item.id);
    var pick = el('thing-pick');
    pick.replaceChildren();
    TIERS.forEach(function (t) {
      var on = mine === t.score;
      var b = h('button', on
        ? 'flex min-h-12 items-center justify-center rounded-lg font-grade text-heading font-bold ring-2 ring-fg ring-offset-2 ring-offset-surface ' + t.bg + ' ' + t.ink
        : 'flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface font-grade text-heading font-bold text-fg hover:bg-raised', t.letter);
      b.type = 'button';
      b.dataset.pick = String(t.score);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', t.letter + ' tier');
      pick.appendChild(b);
    });
    el('thing-clear').hidden = mine == null;

    var crowd = crowdFor(item.id);
    var badge = el('thing-crowd-tier');
    var tier = crowd ? tierOf(crowd.tier) : null;
    badge.className = tier
      ? 'grade flex h-14 w-14 shrink-0 items-center justify-center rounded-lg ' + tier.bg + ' ' + tier.ink
      : 'grade flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-raised text-muted';
    badge.textContent = tier ? tier.letter : '?';
    el('thing-crowd-line').textContent = tier ? 'Everyone puts it in ' + tier.letter : 'Not ranked by anyone yet';
    el('thing-crowd-sub').textContent = crowd ? 'Average of ' + plural(crowd.count, 'vote', 'votes') + ' (' + crowd.avg.toFixed(1) + ' out of 5)' : '';

    var vs = votesFor(item.id);
    var bars = el('thing-bars');
    bars.replaceChildren();
    var max = 0;
    var counts = {};
    TIERS.forEach(function (t) { counts[t.score] = 0; });
    vs.forEach(function (v) { counts[v.tier] += 1; max = Math.max(max, counts[v.tier]); });
    bars.hidden = !vs.length;
    TIERS.forEach(function (t) {
      var col = h('div', 'flex flex-col items-center gap-1');
      var track = h('div', 'flex h-16 w-full items-end rounded-md bg-raised');
      var fill = h('div', 'w-full rounded-md ' + t.bg);
      fill.style.height = max ? Math.max(counts[t.score] ? 12 : 0, Math.round(64 * counts[t.score] / max)) + 'px' : '0px';
      track.appendChild(fill);
      col.appendChild(track);
      col.appendChild(h('span', 'text-small font-medium tabular-nums text-muted', t.letter + ' ' + counts[t.score]));
      bars.appendChild(col);
    });

    var list = el('thing-votes');
    list.replaceChildren();
    TIERS.forEach(function (t) {
      var people = vs.filter(function (v) { return v.tier === t.score; });
      if (!people.length) return;
      var row = h('li', 'flex items-start gap-3 border-t border-line py-3 first:border-t-0');
      var letter = h('span', 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-grade text-body font-bold ' + t.bg + ' ' + t.ink, t.letter);
      letter.setAttribute('aria-label', t.letter + ' tier');
      var names = h('ul', 'flex min-w-0 flex-wrap gap-x-3 gap-y-2');
      people.forEach(function (v) {
        var who = h('li', 'flex items-center gap-2 text-body');
        var dot = h('span', 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-small font-semibold text-fg', initial(v.username));
        dot.setAttribute('aria-hidden', 'true');
        who.appendChild(dot);
        who.appendChild(h('span', isMe(v.user_id) ? 'font-semibold' : '', isMe(v.user_id) ? 'You' : v.username));
        names.appendChild(who);
      });
      row.appendChild(letter);
      row.appendChild(names);
      list.appendChild(row);
    });
    el('thing-novotes').hidden = vs.length > 0;
    el('thing-remove').hidden = !isMe(item.added_by);
  }

  function openThing(itemId) {
    state.openThing = itemId;
    renderThing(itemId);
    openSheet('thing-sheet');
  }

  function openSheet(id) {
    var d = el(id);
    if (!d.open) d.showModal();
  }
  function closeSheet(id) {
    var d = el(id);
    if (d.open) d.close();
  }

  // ── Changes ────────────────────────────────────────────────────────────
  // Optimistic: the board moves at once, and goes back if the save fails.
  function setTier(itemId, score) {
    var before = state.votes.slice();
    var me = state.me;
    state.votes = state.votes.filter(function (v) { return !(v.item_id === itemId && isMe(v.user_id)); });
    if (score != null) state.votes.push({ item_id: itemId, user_id: me.id, username: me.username, tier: score });
    renderBoard();
    return api('PUT', '/api/items/' + itemId + '/vote', { tier: score }).catch(function (err) {
      state.votes = before;
      renderBoard();
      toast(err.status === 404 ? err.message : 'Couldn\'t save that. Check your connection and try again.');
    });
  }

  function addThing(name) {
    return api('POST', '/api/lists/' + state.listId + '/items', { name: name }).then(function (data) {
      state.items.push(data.item);
      renderBoard();
      return data.item;
    });
  }

  function removeThing(itemId) {
    var item = state.items.filter(function (i) { return i.id === itemId; })[0];
    if (!item || !window.confirm('Remove ' + item.name + ' from this list? Everyone\'s votes on it go too.')) return;
    api('DELETE', '/api/items/' + itemId).then(function () {
      state.items = state.items.filter(function (i) { return i.id !== itemId; });
      state.votes = state.votes.filter(function (v) { return v.item_id !== itemId; });
      state.openThing = null;
      closeSheet('thing-sheet');
      renderBoard();
      toast('Removed ' + item.name + '.');
    }).catch(function (err) {
      toast(err.status === 403 ? err.message : 'Couldn\'t remove it. Try again.');
    });
  }

  // ── Loading ────────────────────────────────────────────────────────────
  function listIdFromHash() {
    var m = /^#\/list\/(\d+)/.exec(window.location.hash || '');
    return m ? Number(m[1]) : null;
  }
  function viewFromHash() {
    return /\/everyone$/.test(window.location.hash || '') ? 'everyone' : 'mine';
  }
  function setHash() {
    var next = '#/list/' + state.listId + (state.view === 'everyone' ? '/everyone' : '');
    if (window.location.hash !== next) history.replaceState(null, '', window.location.pathname + window.location.search + next);
  }

  function rememberList(id) {
    try { localStorage.setItem(LAST_LIST_KEY, String(id)); } catch (e) { /* storage may be off in the frame */ }
  }
  function lastList() {
    try { return Number(localStorage.getItem(LAST_LIST_KEY)) || null; } catch (e) { return null; }
  }

  function loadList(id) {
    return api('GET', '/api/lists/' + id).then(function (data) {
      state.listId = data.list.id;
      state.list = data.list;
      state.items = data.items;
      state.votes = data.votes;
      state.me = data.me;
      rememberList(state.listId);
      setHash();
      renderBoard();
      show('state-board');
    });
  }

  function load() {
    show('state-loading');
    return api('GET', '/api/lists').then(function (data) {
      state.lists = data.lists;
      if (!state.lists.length) {
        show('state-start');
        return null;
      }
      var wanted = listIdFromHash() || lastList();
      var exists = state.lists.some(function (l) { return l.id === wanted; });
      state.view = viewFromHash();
      return loadList(exists ? wanted : state.lists[0].id);
    }).catch(function () {
      show('state-error');
    });
  }

  function renderListsSheet() {
    var ul = el('lists-items');
    ul.replaceChildren();
    state.lists.forEach(function (l) {
      var li = h('li', '');
      var b = h('button', 'flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus');
      b.type = 'button';
      b.dataset.listId = String(l.id);
      var text = h('span', 'flex min-w-0 flex-col');
      text.appendChild(h('span', 'truncate text-body font-medium', l.title));
      text.appendChild(h('span', 'text-small text-muted', plural(l.item_count, 'thing', 'things') + ', ' + plural(l.voter_count, 'person', 'people') + ' ranking'));
      b.appendChild(text);
      if (l.id === state.listId) {
        var cur = h('span', 'shrink-0 text-small font-medium text-muted', 'Open');
        b.appendChild(cur);
        b.setAttribute('aria-current', 'true');
      }
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function createList(title, errorEl) {
    errorEl.hidden = true;
    if (!title.trim()) {
      errorEl.textContent = 'Give the tier list a name.';
      errorEl.hidden = false;
      return Promise.resolve(null);
    }
    return api('POST', '/api/lists', { title: title }).then(function (data) {
      state.lists.unshift(data.list);
      state.view = 'mine';
      return loadList(data.list.id).then(function () {
        el('add-name').focus();
        return data.list;
      });
    }).catch(function (err) {
      errorEl.textContent = err.status === 400 ? err.message : 'Couldn\'t create it. Try again.';
      errorEl.hidden = false;
      return null;
    });
  }

  // ── Drag and drop ──────────────────────────────────────────────────────
  // A mouse drags straight away; a finger holds a moment first, so a swipe
  // still scrolls the page. Dropping on a tier places the thing there, on
  // the tray takes it out of your tiers. A tap without a drag opens it.
  var drag = null;
  var HOLD_MS = 220;
  var SLOP = 6;
  // A tap opens a thing on its click, never on pointerup: opening the sheet
  // first would let that same click land on the sheet's backdrop and close
  // it. The click a drag leaves behind is dispatched in the same task as the
  // drop, so it is swallowed until that task ends.
  var swallowClick = false;

  function dropTargetAt(x, y) {
    var node = document.elementFromPoint(x, y);
    while (node && node !== document.body) {
      if (node.dataset && node.dataset.dropTier != null) return node;
      node = node.parentElement;
    }
    return null;
  }

  function lift() {
    var rect = drag.tile.getBoundingClientRect();
    var ghost = drag.tile.cloneNode(true);
    ghost.classList.add('tile-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.offsetX = drag.startX - rect.left;
    drag.offsetY = drag.startY - rect.top;
    drag.tile.classList.add('tile-lifted');
    drag.lifted = true;
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* not allowed in this frame */ } }
    moveGhost(drag.startX, drag.startY);
  }

  function moveGhost(x, y) {
    drag.ghost.style.transform = 'translate(' + (x - drag.offsetX) + 'px,' + (y - drag.offsetY) + 'px)';
    var target = dropTargetAt(x, y);
    if (target !== drag.over) {
      if (drag.over) drag.over.classList.remove('drop-active');
      drag.over = target;
      if (target) target.classList.add('drop-active');
    }
    // Scroll when held near the top or bottom edge.
    var edge = 56;
    if (y < edge) window.scrollBy(0, -12);
    else if (y > window.innerHeight - edge) window.scrollBy(0, 12);
  }

  function endDrag(commit) {
    if (!drag) return;
    var d = drag;
    drag = null;
    clearTimeout(d.hold);
    if (d.ghost) d.ghost.remove();
    d.tile.classList.remove('tile-lifted');
    if (d.over) d.over.classList.remove('drop-active');
    if (!commit || !d.lifted) return;
    // Held, then let go without moving: that was a long tap. Open it (a
    // long press is never followed by a click, so the sheet stays open).
    if (!d.moved) { openThing(d.itemId); return; }
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 0);
    if (!d.over) return;
    var raw = d.over.dataset.dropTier;
    var score = raw === 'none' ? null : Number(raw);
    if (score === myTier(d.itemId)) return;
    setTier(d.itemId, score);
  }

  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest ? e.target.closest('.tile') : null;
    if (!t || e.button > 0) return;
    var itemId = Number(t.dataset.itemId);
    var draggable = !!t.closest('#mine-panel');
    drag = { tile: t, itemId: itemId, startX: e.clientX, startY: e.clientY, lifted: false, over: null, touch: e.pointerType !== 'mouse', draggable: draggable };
    if (draggable && drag.touch) drag.hold = setTimeout(function () { if (drag && !drag.lifted) lift(); }, HOLD_MS);
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.lifted) {
      if (Math.abs(dx) + Math.abs(dy) < SLOP) return;
      if (drag.touch || !drag.draggable) { endDrag(false); return; }
      lift();
    }
    if (Math.abs(dx) + Math.abs(dy) >= SLOP) drag.moved = true;
    if (e.cancelable) e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', function (e) {
    if (!drag) return;
    if (drag.lifted) moveGhost(e.clientX, e.clientY);
    endDrag(true);
  });
  document.addEventListener('pointercancel', function () { endDrag(false); });
  // Once a tile is lifted by a finger, the page must not scroll under it.
  document.addEventListener('touchmove', function (e) { if (drag && drag.lifted && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', function (e) { if (drag && drag.touch) e.preventDefault(); });
  // A click on a tile opens it: a tap, a mouse click, or Enter or Space.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.tile') : null;
    if (swallowClick) { swallowClick = false; return; }
    if (t) openThing(Number(t.dataset.itemId));
  });

  // ── Wiring ─────────────────────────────────────────────────────────────
  el('error-retry').addEventListener('click', load);

  document.querySelectorAll('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = b.dataset.view;
      setHash();
      renderView();
    });
  });

  el('start-form').addEventListener('submit', function (e) {
    e.preventDefault();
    createList(el('start-title').value, el('start-error'));
  });

  el('list-switch').addEventListener('click', function () {
    renderListsSheet();
    openSheet('lists-sheet');
  });
  el('lists-items').addEventListener('click', function (e) {
    var b = e.target.closest('[data-list-id]');
    if (!b) return;
    closeSheet('lists-sheet');
    var id = Number(b.dataset.listId);
    if (id !== state.listId) loadList(id).catch(function () { toast('Couldn\'t open that list. Try again.'); });
  });
  el('new-list-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = el('new-list-title');
    createList(input.value, el('new-list-error')).then(function (list) {
      if (list) { input.value = ''; closeSheet('lists-sheet'); }
    });
  });

  el('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = el('add-name');
    var errorEl = el('add-error');
    var name = input.value.trim();
    errorEl.hidden = true;
    if (!name) {
      errorEl.textContent = 'Type the name of something to rank.';
      errorEl.hidden = false;
      return;
    }
    var same = state.items.filter(function (i) { return i.name.toLowerCase() === name.replace(/\s+/g, ' ').toLowerCase(); })[0];
    if (same) {
      errorEl.textContent = same.name + ' is already on this list.';
      errorEl.hidden = false;
      return;
    }
    addThing(name).then(function () {
      input.value = '';
      input.focus();
    }).catch(function (err) {
      errorEl.textContent = err.status === 409 || err.status === 400 ? err.message : 'Couldn\'t add it. Try again.';
      errorEl.hidden = false;
    });
  });

  el('thing-pick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (!b || state.openThing == null) return;
    var score = Number(b.dataset.pick);
    if (score === myTier(state.openThing)) return;
    setTier(state.openThing, score);
  });
  el('thing-clear').addEventListener('click', function () {
    if (state.openThing != null) setTier(state.openThing, null);
  });
  el('thing-remove').addEventListener('click', function () {
    if (state.openThing != null) removeThing(state.openThing);
  });

  ['thing-sheet', 'lists-sheet'].forEach(function (id) {
    var d = el(id);
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) closeSheet(id);
    });
    d.addEventListener('close', function () { if (id === 'thing-sheet') state.openThing = null; });
  });

  // Other people rank too: catch up when the app comes back into view.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.listId && !drag) {
      api('GET', '/api/lists/' + state.listId).then(function (data) {
        state.items = data.items;
        state.votes = data.votes;
        renderBoard();
      }).catch(function () { /* keep what is on screen */ });
    }
  });

  load();
})();
