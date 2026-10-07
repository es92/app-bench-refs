// RSS Reader: every unread post from the feeds you follow, in one list.
//
// Plain JavaScript, no build step. State lives in `state`; each pane has a
// render function that redraws it from that state. The URL hash carries
// where you are (#feed=12&view=all&post=34, #screen=feeds) so Back works on
// a phone and a reload lands in the same place.
(function () {
  'use strict';

  // ── Small helpers ─────────────────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const asId = (v) => (/^\d{1,15}$/.test(String(v || '')) ? Number(v) : null);
  const now = () => (window.usernode && typeof window.usernode.now === 'function' ? window.usernode.now() : new Date());
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const desktop = window.matchMedia('(min-width: 1024px)');

  const query = new URLSearchParams(window.location.search);
  const TOKEN = query.get('token');
  const DEMO = query.get('demo') === '1';

  // Icons: inline strokes (Lucide shapes), drawn in currentColor.
  const PATHS = {
    rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    unfollow: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  };
  function icon(name, cls) {
    return `<svg class="${cls || 'h-5 w-5'} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function monogram(title) {
    const t = String(title || '').replace(/^(the|a|an)\s+/i, '');
    const m = t.match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : '#';
  }
  function avatar(feed, size) {
    const tint = ((Number(feed && feed.id) || 0) % 6) + 1;
    const cls = size === 'lg' ? 'h-10 w-10 text-body' : size === 'md' ? 'h-7 w-7 text-small' : 'h-5 w-5 text-small';
    return `<span class="avatar ${cls}" data-tint="${tint}" aria-hidden="true">${esc(monogram(feed && feed.title))}</span>`;
  }

  // "9 min", "3 h", "Yesterday", "Mon", "2 Oct": short, for the list.
  function shortTime(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const t = now();
    const mins = Math.round((t - d) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h`;
    const startOfToday = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const days = Math.ceil((startOfToday - d) / 86400000);
    if (days <= 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, d.getFullYear() === t.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function longTime(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  }
  function agoPhrase(isoString) {
    const s = shortTime(isoString);
    if (!s) return '';
    if (s === 'Just now') return 'just now';
    if (/ (min|h)$/.test(s)) return `${s} ago`;
    return s === 'Yesterday' ? 'yesterday' : `on ${s}`;
  }

  // ── Talking to the server ─────────────────────────────────────────────
  async function api(path, opts) {
    const options = opts || {};
    const url = new URL(path, window.location.origin);
    if (DEMO) url.searchParams.set('demo', '1');
    const headers = { accept: 'application/json' };
    if (TOKEN) headers['x-usernode-token'] = TOKEN;
    const u = window.usernode;
    if (u && u.previewNow && typeof u.now === 'function') headers['x-usernode-now'] = u.now().toISOString();
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.serverMessage = data && typeof data.error === 'string' && res.status < 500 ? data.error : null;
      throw err;
    }
    return data;
  }

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
    feedsStatus: 'loading', // loading | ready | error
    viewer: null,
    demo: false,
    feeds: [],
    postsStatus: 'loading', // loading | ready | error
    posts: [],
    nextCursor: null,
    loadingMore: false,
    moreError: false,
    asOf: null,
    feedId: null, // the feed the list is filtered to, or null for all
    view: 'unread', // unread | all
    screen: 'list', // phones: list | feeds | post
    openId: null, // the post the route names
    previewId: null, // the post the preview pane shows (desktop picks the first)
    previews: new Map(), // id -> { status, post }
    pendingNew: 0,
    refreshing: false,
    listScroll: 0,
  };
  let postsRequest = 0;

  const feedById = (id) => state.feeds.find((f) => f.id === id) || null;
  const postById = (id) => state.posts.find((p) => p.id === id) || null;
  const ownFeeds = () => state.feeds.filter((f) => !f.sample);

  // ── Routing ───────────────────────────────────────────────────────────
  function readRoute() {
    const p = new URLSearchParams(window.location.hash.slice(1));
    return {
      feed: asId(p.get('feed')),
      view: p.get('view') === 'all' ? 'all' : 'unread',
      post: asId(p.get('post')),
      screen: p.get('screen') === 'feeds' ? 'feeds' : null,
    };
  }
  function go(next, { replace = false } = {}) {
    const r = { ...readRoute(), ...next };
    const p = new URLSearchParams();
    if (r.feed) p.set('feed', r.feed);
    if (r.view === 'all') p.set('view', 'all');
    if (r.screen) p.set('screen', r.screen);
    if (r.post) p.set('post', r.post);
    const hash = p.toString();
    const url = window.location.pathname + window.location.search + (hash ? `#${hash}` : '');
    if (replace) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState({ rss: true }, '', url);
    applyRoute();
  }
  // Leave a phone screen the way it was entered: Back if we pushed it.
  function goBack(fallback) {
    if (window.history.state && window.history.state.rss) window.history.back();
    else go(fallback, { replace: true });
  }

  function applyRoute() {
    const r = readRoute();
    const listChanged = r.feed !== state.feedId || r.view !== state.view;
    const wasScreen = state.screen;
    state.feedId = r.feed;
    state.view = r.view;
    state.openId = r.post;
    state.screen = r.post ? 'post' : (r.screen || 'list');
    if (state.feedId && state.feedsStatus === 'ready' && !feedById(state.feedId)) {
      // A feed you no longer follow (or never did): show everything instead.
      go({ feed: null }, { replace: true });
      return;
    }
    if (listChanged) {
      state.previewId = null;
      loadPosts();
    }
    if (state.openId) state.previewId = state.openId;
    else if (!desktop.matches) state.previewId = null;
    pickPreview();
    renderAll();
    if (!desktop.matches && wasScreen !== state.screen) {
      if (state.screen === 'list') window.requestAnimationFrame(() => window.scrollTo(0, state.listScroll));
      else window.scrollTo(0, 0);
    }
  }

  // Wide screens always show a post: the one opened, else the newest.
  function pickPreview() {
    if (!desktop.matches || state.previewId || state.postsStatus !== 'ready') return;
    if (state.posts.length) state.previewId = state.posts[0].id;
  }

  // ── Loading ───────────────────────────────────────────────────────────
  async function loadFeeds({ quiet = false } = {}) {
    if (!quiet) { state.feedsStatus = 'loading'; renderAll(); }
    try {
      const data = await api('/api/feeds');
      state.viewer = data.viewer;
      state.demo = !!data.demo;
      state.feeds = data.feeds;
      state.feedsStatus = 'ready';
      if (state.feedId && !feedById(state.feedId)) { go({ feed: null }, { replace: true }); return; }
    } catch (err) {
      if (!quiet) state.feedsStatus = 'error';
    }
    renderAll();
  }

  async function loadPosts() {
    const req = ++postsRequest;
    state.postsStatus = 'loading';
    state.posts = [];
    state.nextCursor = null;
    state.loadingMore = false;
    state.moreError = false;
    state.pendingNew = 0;
    renderList();
    try {
      const data = await api(postsPath());
      if (req !== postsRequest) return;
      state.posts = data.posts;
      state.nextCursor = data.nextCursor;
      state.asOf = data.asOf;
      state.postsStatus = 'ready';
      // A post picked for the wide-screen preview (not one you opened) that
      // has left the list gives way to the list's first post.
      if (state.previewId && state.previewId !== state.openId && !postById(state.previewId)) state.previewId = null;
    } catch (err) {
      if (req !== postsRequest) return;
      state.postsStatus = 'error';
    }
    pickPreview();
    renderAll();
  }

  function postsPath(cursor) {
    const p = new URLSearchParams();
    if (state.feedId) p.set('feed', state.feedId);
    if (state.view === 'all') p.set('view', 'all');
    if (cursor) p.set('cursor', cursor);
    const qs = p.toString();
    return `/api/posts${qs ? `?${qs}` : ''}`;
  }

  async function loadMore() {
    if (!state.nextCursor || state.loadingMore || state.postsStatus !== 'ready') return;
    const req = postsRequest;
    state.loadingMore = true;
    state.moreError = false;
    renderListFooter();
    try {
      const data = await api(postsPath(state.nextCursor));
      if (req !== postsRequest) return; // the list was reloaded meanwhile
      const seen = new Set(state.posts.map((p) => p.id));
      state.posts = state.posts.concat(data.posts.filter((p) => !seen.has(p.id)));
      state.nextCursor = data.nextCursor;
    } catch (err) {
      if (req === postsRequest) state.moreError = true;
    }
    state.loadingMore = false;
    renderList();
  }

  async function loadPreview(id) {
    const cached = state.previews.get(id);
    if (cached && cached.status !== 'error') return;
    state.previews.set(id, { status: 'loading' });
    renderPreview();
    try {
      const data = await api(`/api/posts/${id}`);
      state.previews.set(id, { status: 'ready', post: data.post });
    } catch (err) {
      state.previews.set(id, { status: 'error', notFound: err.status === 404 });
    }
    if (state.previewId === id) renderPreview();
  }

  // Check your own feeds for new posts. On open it runs quietly and offers
  // the new posts with a button rather than moving the list under you.
  async function refresh({ force = false } = {}) {
    if (!state.viewer || !state.viewer.signedIn || state.refreshing) return;
    if (!force && !ownFeeds().length) return;
    state.refreshing = true;
    renderListHead();
    let result = null;
    try {
      result = await api('/api/refresh', { method: 'POST', body: { force } });
    } catch (err) {
      if (force) toast('Couldn\'t check for new posts. Try again in a moment.');
    }
    state.refreshing = false;
    if (!result) { renderListHead(); return; }
    await loadFeeds({ quiet: true });
    if (force) {
      await loadPosts();
      const failed = result.failed.length;
      if (result.newPosts) toast(`${plural(result.newPosts, 'new post', 'new posts')}.`);
      else if (failed) toast(`${plural(failed, 'feed', 'feeds')} couldn't be checked. The rest are up to date.`);
      else toast('You\'re up to date.');
    } else if (result.newPosts > 0 && state.postsStatus === 'ready') {
      state.pendingNew = result.newPosts;
      renderList();
    } else {
      renderListHead();
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────
  function adjustUnread(post, delta) {
    const feed = feedById(post.feedId);
    if (feed) feed.unread = Math.max(0, feed.unread + delta);
  }

  async function setRead(ids, read, { quiet = false } = {}) {
    const changed = [];
    for (const id of ids) {
      const post = postById(id);
      if (post && post.read !== read) { post.read = read; adjustUnread(post, read ? -1 : 1); changed.push(post); }
      const cached = state.previews.get(id);
      if (cached && cached.post) cached.post.read = read;
    }
    renderAll();
    try {
      await api('/api/posts/read', { method: 'POST', body: { ids, read } });
    } catch (err) {
      for (const post of changed) { post.read = !read; adjustUnread(post, read ? 1 : -1); }
      renderAll();
      if (!quiet || err.status) toast(read ? 'Couldn\'t mark that as read. Try again.' : 'Couldn\'t mark that as unread. Try again.');
    }
  }

  function openPost(id) {
    const post = postById(id);
    if (!desktop.matches) state.listScroll = window.scrollY;
    if (post && !post.read) setRead([id], true, { quiet: true });
    if (desktop.matches) go({ post: id, screen: null }, { replace: true });
    else go({ post: id, screen: null });
    const pane = $('#preview-pane');
    if (pane) pane.scrollTop = 0;
  }

  function step(delta) {
    if (!state.posts.length) return;
    const i = state.posts.findIndex((p) => p.id === state.previewId);
    const next = state.posts[Math.min(state.posts.length - 1, Math.max(0, (i < 0 ? -1 : i) + delta))];
    if (!next || next.id === state.previewId) return;
    openPost(next.id);
    const row = document.querySelector(`[data-post-id="${next.id}"]`);
    if (row && desktop.matches) row.scrollIntoView({ block: 'nearest' });
    if (state.posts.indexOf(next) >= state.posts.length - 3) loadMore();
  }

  function markCached(ids, read) {
    for (const id of ids) {
      const cached = state.previews.get(id);
      if (cached && cached.post) cached.post.read = read;
    }
  }

  async function markAllRead() {
    const feed = state.feedId ? feedById(state.feedId) : null;
    let data;
    try {
      data = await api('/api/posts/read-all', { method: 'POST', body: { feedId: state.feedId, asOf: state.asOf } });
    } catch (err) {
      toast('Couldn\'t mark those as read. Try again.');
      return;
    }
    const ids = data.ids;
    markCached(ids, true);
    await Promise.all([loadFeeds({ quiet: true }), loadPosts()]);
    if (!ids.length) { toast('Nothing left to mark.'); return; }
    toast(`Marked ${plural(ids.length, 'post', 'posts')} ${feed ? `from ${feed.title} ` : ''}as read.`, {
      label: 'Undo',
      run: async () => {
        try {
          await api('/api/posts/read', { method: 'POST', body: { ids, read: false } });
          markCached(ids, false);
          await Promise.all([loadFeeds({ quiet: true }), loadPosts()]);
        } catch (err) {
          toast('Couldn\'t undo that. Try again.');
        }
      },
    });
  }

  // ── Following and unfollowing ─────────────────────────────────────────
  async function follow(url) {
    const data = await api('/api/feeds', { method: 'POST', body: { url } });
    const feed = data.feed;
    await loadFeeds({ quiet: true });
    if (data.already) toast(`You already follow ${feed.title}.`);
    else toast(`Following ${feed.title}. ${feed.unread ? `${plural(feed.unread, 'unread post', 'unread posts')}.` : 'No new posts yet.'}`);
    go({ feed: feed.id, view: 'unread', post: null, screen: null }, { replace: !desktop.matches && state.screen === 'feeds' });
    return feed;
  }

  function askForAccount() {
    if (window.usernode && typeof window.usernode.askForAccount === 'function') {
      window.usernode.askForAccount({ action: 'follow feeds' });
    }
  }

  function openAddDialog() {
    if (state.viewer && !state.viewer.signedIn) { askForAccount(); return; }
    const dialog = $('#add-dialog');
    const form = $('#add-dialog-form');
    form.reset();
    setFormError(form, '');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    window.setTimeout(() => $('#add-dialog-url').focus(), 30);
  }

  function setFormError(form, message) {
    const el = form.querySelector('[data-role="error"]');
    const input = form.querySelector('input[name="url"]');
    if (el) { el.textContent = message; el.hidden = !message; }
    if (input) {
      if (message) { input.setAttribute('aria-invalid', 'true'); if (el) input.setAttribute('aria-describedby', el.id || ''); }
      else input.removeAttribute('aria-invalid');
    }
  }

  async function submitFollow(form) {
    const input = form.querySelector('input[name="url"]');
    const button = form.querySelector('[data-role="submit"]');
    const value = input.value.trim();
    if (!value) { setFormError(form, 'Enter the address of a feed or a website.'); input.focus(); return; }
    setFormError(form, '');
    const label = button.innerHTML;
    button.disabled = true;
    input.readOnly = true;
    button.innerHTML = `${icon('refresh', 'h-5 w-5 spin')}<span>Finding feed</span>`;
    try {
      await follow(value);
      const dialog = form.closest('dialog');
      if (dialog && dialog.open) dialog.close();
      form.reset();
    } catch (err) {
      setFormError(form, err.serverMessage || 'Something went wrong on our side. Try again in a moment.');
      input.focus();
    } finally {
      button.disabled = false;
      input.readOnly = false;
      button.innerHTML = label;
    }
  }

  function confirmAction({ title, body, confirm }) {
    return new Promise((resolve) => {
      const dialog = $('#confirm-dialog');
      $('#confirm-dialog-title').textContent = title;
      dialog.querySelector('[data-role="body"]').textContent = body;
      const ok = dialog.querySelector('[data-role="confirm"]');
      ok.textContent = confirm;
      const done = (value) => {
        ok.removeEventListener('click', onOk);
        dialog.removeEventListener('close', onClose);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onOk = () => done(true);
      const onClose = () => done(false);
      ok.addEventListener('click', onOk);
      dialog.addEventListener('close', onClose);
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    });
  }

  async function unfollow(feed) {
    const yes = await confirmAction({
      title: `Unfollow ${feed.title}?`,
      body: 'Its posts leave your list. You can follow it again any time.',
      confirm: 'Unfollow',
    });
    if (!yes) return;
    try {
      await api(`/api/feeds/${feed.id}`, { method: 'DELETE' });
    } catch (err) {
      toast('Couldn\'t unfollow that feed. Try again.');
      return;
    }
    go({ feed: null, post: null }, { replace: true });
    await Promise.all([loadFeeds({ quiet: true }), loadPosts()]);
    toast(`Unfollowed ${feed.title}.`, {
      label: 'Undo',
      run: async () => {
        try { await follow(feed.url); } catch (err) { toast('Couldn\'t follow it again. Try adding it from Follow a feed.'); }
      },
    });
  }

  // ── Toasts ────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(message, action) {
    const region = $('#toast-region');
    window.clearTimeout(toastTimer);
    region.innerHTML = `<div class="toast" role="status"><span class="py-2">${esc(message)}</span>${action ? `<button type="button" data-action="toast-action">${esc(action.label)}</button>` : '<span class="w-3"></span>'}</div>`;
    const btn = region.querySelector('[data-action="toast-action"]');
    if (btn) btn.addEventListener('click', () => { region.innerHTML = ''; action.run(); });
    toastTimer = window.setTimeout(() => { region.innerHTML = ''; }, action ? 7000 : 4000);
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  // Redrawing a pane replaces its buttons; put keyboard focus back on the
  // same control (same feed, post or action) so it is not lost.
  function keepFocus(pane, draw) {
    const el = document.activeElement;
    let selector = null;
    if (el && pane.contains(el)) {
      for (const attr of ['data-post-id', 'data-feed', 'data-view', 'data-action', 'data-suggest']) {
        if (el.hasAttribute(attr)) { selector = `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`; break; }
      }
    }
    draw();
    if (selector) {
      const again = pane.querySelector(selector);
      if (again && again !== document.activeElement) again.focus({ preventScroll: true });
    }
  }

  function renderAll() {
    const app = $('#app');
    app.dataset.screen = state.screen;
    const noFeeds = state.feedsStatus === 'ready' && state.feeds.length === 0;
    app.dataset.layout = noFeeds || state.feedsStatus === 'error' || (state.postsStatus === 'error') ? 'single' : 'three';
    renderFeeds();
    renderList();
    renderPreview();
  }

  // The feeds pane: the sidebar on wide screens, its own screen on phones.
  function renderFeeds() {
    const pane = $('#feeds-pane');
    keepFocus(pane, () => drawFeeds(pane));
  }
  function drawFeeds(pane) {
    const total = state.feeds.reduce((n, f) => n + f.unread, 0);
    let body;
    if (state.feedsStatus === 'loading') {
      body = `<div class="space-y-1 px-2" aria-hidden="true">${[70, 55, 80, 60, 45].map((w) => `
        <div class="flex min-h-11 items-center gap-3 px-3"><span class="skeleton h-7 w-7"></span><span class="skeleton h-3" style="width:${w}%"></span></div>`).join('')}</div>
        <span class="sr-only">Loading your feeds</span>`;
    } else if (state.feedsStatus === 'error') {
      body = `<p class="flex items-start gap-2 px-4 py-2 text-small text-muted">${icon('alert', 'mt-0.5 h-4 w-4')}<span>Your feeds couldn't be loaded.</span></p>`;
    } else if (!state.feeds.length) {
      body = `<p class="px-4 py-2 text-small text-muted">You don't follow any feeds yet. Feeds you follow appear here.</p>`;
    } else {
      body = `
        <button type="button" class="feed-row" data-feed="" aria-current="${!state.feedId}">
          <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-raised text-muted" aria-hidden="true">${icon('inbox', 'h-4 w-4')}</span>
          <span class="min-w-0 flex-1 truncate">All feeds</span>
          ${countBadge(total)}
        </button>
        <h2 class="section-label mt-5 px-3">Following</h2>
        <ul class="space-y-0.5" role="list">${state.feeds.map((f) => `
          <li><button type="button" class="feed-row" data-feed="${f.id}" aria-current="${state.feedId === f.id}">
            ${avatar(f, 'md')}
            <span class="min-w-0 flex-1 truncate">${esc(f.title)}</span>
            ${f.lastError ? `<span class="text-danger" title="Couldn't update">${icon('alert', 'h-4 w-4')}<span class="sr-only">Couldn't update this feed.</span></span>` : ''}
            ${countBadge(f.unread)}
          </button></li>`).join('')}
        </ul>`;
    }
    const note = state.demo && state.feeds.some((f) => f.sample)
      ? 'The sample feeds here come with this staging preview. Feeds you follow are private to you.'
      : 'Only you can see the feeds you follow.';
    pane.innerHTML = `
      <div class="flex min-h-full flex-col">
        <div class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-ground px-2 py-2 lg:hidden">
          <button type="button" class="btn-quiet" data-action="close-feeds">${icon('back')}<span>Posts</span></button>
          <h1 class="text-heading">Your feeds</h1>
        </div>
        <div class="hidden items-center gap-3 px-5 pb-4 pt-5 lg:flex">
          <span class="brand-tile h-9 w-9">${icon('rss', 'h-5 w-5')}</span>
          <span class="text-heading">RSS Reader</span>
        </div>
        <div class="px-4 pt-4 lg:px-3 lg:pt-0">
          <button type="button" class="btn-secondary w-full" data-action="add-feed">${icon('plus')}<span>Follow a feed</span></button>
        </div>
        <nav class="mt-4 flex-1 px-2 pb-4" aria-label="Feeds">${body}</nav>
        <p class="flex items-start gap-2 border-t border-line px-5 py-4 text-small text-muted">${icon('lock', 'mt-0.5 h-4 w-4')}<span>${esc(note)}</span></p>
      </div>`;
  }

  function countBadge(n) {
    return n > 0 ? `<span class="text-small tabular-nums text-muted">${n.toLocaleString()}<span class="sr-only"> unread</span></span>` : '';
  }

  function listTitle() {
    const feed = state.feedId ? feedById(state.feedId) : null;
    if (feed) return feed.title;
    return state.view === 'all' ? 'All posts' : 'All unread';
  }

  function listSubtitle() {
    const feed = state.feedId ? feedById(state.feedId) : null;
    if (state.feedsStatus !== 'ready') return '';
    if (feed) return state.view === 'all' ? 'Read and unread' : feed.unread ? `${feed.unread.toLocaleString()} unread` : 'Nothing unread';
    if (!state.feeds.length) return '';
    const total = state.feeds.reduce((n, f) => n + f.unread, 0);
    const from = plural(state.feeds.length, 'feed', 'feeds');
    if (state.view === 'all') return `Read and unread · ${from}`;
    return `${total ? `${total.toLocaleString()} unread` : 'Nothing unread'} · ${from}`;
  }

  function renderListHead() {
    const head = $('#list-head');
    if (!head) return;
    const feed = state.feedId ? feedById(state.feedId) : null;
    const hasFeeds = state.feedsStatus === 'ready' && state.feeds.length > 0;
    const loading = state.feedsStatus === 'loading';
    const lead = feed
      ? `<button type="button" class="btn-quiet btn-icon -ml-2" data-action="clear-feed" aria-label="Back to all feeds">${icon('back')}</button>`
      : `<span class="brand-tile h-9 w-9 lg:hidden">${icon('rss', 'h-5 w-5')}</span>`;
    const noFeeds = state.feedsStatus === 'ready' && !state.feeds.length;
    head.hidden = noFeeds && desktop.matches;
    const subtitle = listSubtitle();
    const title = loading
      ? '<span class="skeleton block h-5 w-32"></span><span class="skeleton mt-2 block h-3 w-44"></span>'
      : `<h1 class="truncate text-heading">${esc(noFeeds ? 'RSS Reader' : listTitle())}</h1>${subtitle ? `<p class="truncate text-small text-muted">${esc(subtitle)}</p>` : ''}`;
    head.innerHTML = `
      <div class="flex items-center gap-3 px-4 pt-3 lg:px-5 ${hasFeeds ? '' : 'pb-3'}">
        ${loading && !feed ? `<span class="brand-tile h-9 w-9 lg:hidden">${icon('rss', 'h-5 w-5')}</span>` : lead}
        <div class="min-w-0 flex-1">${title}</div>
        ${hasFeeds && state.viewer && state.viewer.signedIn ? `<button type="button" class="btn-quiet btn-icon" data-action="refresh" aria-label="Check for new posts" ${state.refreshing ? 'aria-busy="true"' : ''}>${icon('refresh', state.refreshing ? 'h-5 w-5 spin' : 'h-5 w-5')}</button>` : ''}
        <button type="button" class="btn-quiet -mr-2 lg:hidden" data-action="open-feeds">${icon('list')}<span>Feeds</span></button>
      </div>
      <div class="flex items-center gap-2 px-4 pb-3 pt-2 lg:px-5" ${hasFeeds ? '' : 'hidden'}>
        <div class="segmented" role="group" aria-label="Show">
          <button type="button" data-view="unread" aria-pressed="${state.view === 'unread'}">Unread</button>
          <button type="button" data-view="all" aria-pressed="${state.view === 'all'}">All</button>
        </div>
        <span class="flex-1"></span>
        <button type="button" class="btn-quiet -mr-2" data-action="mark-all" ${unreadInView() ? '' : 'disabled'}>${icon('checks')}<span>Mark all read</span></button>
      </div>
      ${state.pendingNew > 0 && state.postsStatus === 'ready' ? `<div class="pointer-events-none absolute inset-x-0 top-full flex justify-center pt-3">
        <button type="button" class="btn-primary pointer-events-auto rounded-full shadow-md" data-action="show-new">${icon('arrowUp')}<span>Show ${plural(state.pendingNew, 'new post', 'new posts')}</span></button>
      </div>` : ''}`;
  }

  function unreadInView() {
    const feed = state.feedId ? feedById(state.feedId) : null;
    return feed ? feed.unread : state.feeds.reduce((n, f) => n + f.unread, 0);
  }

  function skeletonRows(n) {
    return Array.from({ length: n }, (_, i) => `
      <li class="flex flex-col gap-2 px-4 py-4 lg:px-5" aria-hidden="true">
        <span class="flex items-center gap-2"><span class="skeleton h-5 w-5"></span><span class="skeleton h-3 w-28"></span></span>
        <span class="skeleton h-4" style="width:${[88, 72, 80, 64, 76, 70][i % 6]}%"></span>
        <span class="skeleton h-3 w-full"></span>
        <span class="skeleton h-3" style="width:${[60, 75, 52, 68, 58, 66][i % 6]}%"></span>
      </li>`).join('');
  }

  let listSignature = '';
  const feedSignature = (f) => (f ? [f.id, f.title, f.description, f.siteUrl, f.lastOkAt, f.lastError, f.sample].join('~') : '');
  function renderList() {
    const pane = $('#list-pane');
    if (!$('#list-head')) {
      pane.innerHTML = `
        <header id="list-head" class="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur"></header>
        <div id="list-body"></div>`;
    }
    keepFocus(pane, drawList);
  }
  function drawList() {
    renderListHead();
    const body = $('#list-body');
    // Same posts as last time: update read marks and the selection in place,
    // so the list does not jump or lose focus.
    const signature = [state.feedsStatus, state.postsStatus, state.feedId, state.view, state.pendingNew,
      state.feeds.length, state.posts.map((p) => p.id).join(','), state.nextCursor, state.loadingMore, state.moreError,
      feedSignature(state.feedId ? feedById(state.feedId) : null)].join('|');
    if (signature === listSignature && $('#post-list')) {
      for (const row of body.querySelectorAll('[data-post-id]')) {
        const post = postById(Number(row.dataset.postId));
        if (!post) continue;
        row.dataset.read = String(post.read);
        row.setAttribute('aria-current', String(state.previewId === post.id));
      }
      return;
    }
    listSignature = signature;
    const feed = state.feedId ? feedById(state.feedId) : null;

    if (state.feedsStatus === 'error' || state.postsStatus === 'error') {
      body.innerHTML = `
        <div class="state-error mx-auto max-w-sm py-16" role="alert">
          <span class="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-raised text-danger">${icon('alert', 'h-6 w-6')}</span>
          <h2 class="text-heading">Your posts didn't load</h2>
          <p class="text-body text-muted">We couldn't reach the reader just now. Your feeds and what you've read are saved, so nothing is lost.</p>
          <button type="button" class="btn-primary mt-3" data-action="retry">${icon('refresh')}<span>Try again</span></button>
        </div>`;
      return;
    }
    if (state.feedsStatus === 'loading' || state.postsStatus === 'loading') {
      body.innerHTML = `<ul role="list" class="divide-y divide-line">${skeletonRows(7)}</ul><span class="sr-only" role="status">Loading posts</span>`;
      return;
    }
    if (!state.feeds.length) {
      body.innerHTML = onboarding();
      return;
    }

    const masthead = feed ? feedMasthead(feed) : '';

    if (!state.posts.length) {
      const allView = state.view === 'all';
      body.innerHTML = `${masthead}
        <div class="state-empty mx-auto max-w-sm py-16">
          <span class="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-raised text-accent">${icon(allView ? 'inbox' : 'circleCheck', 'h-6 w-6')}</span>
          <h2 class="text-heading">${allView ? 'No posts yet' : 'You\'re all caught up'}</h2>
          <p class="text-body text-muted">${allView
            ? 'This feed hasn\'t published anything we could read yet. New posts will show up here.'
            : `New posts from ${feed ? esc(feed.title) : `your ${plural(state.feeds.length, 'feed', 'feeds')}`} will show up here.`}</p>
          ${allView ? '' : '<button type="button" class="btn-secondary mt-3" data-view="all">Show read posts</button>'}
        </div>`;
      return;
    }

    body.innerHTML = `${masthead}
      <ul id="post-list" role="list" class="divide-y divide-line border-b border-line">${state.posts.map(postRow).join('')}</ul>
      <div id="list-footer"></div>`;
    renderListFooter();
  }

  function postRow(p) {
    const feed = feedById(p.feedId) || { id: p.feedId, title: p.feedTitle };
    const source = state.feedId ? (p.author || feed.title) : feed.title;
    return `<li><button type="button" class="post-row" data-post-id="${p.id}" data-read="${p.read}" aria-current="${state.previewId === p.id}">
      <span class="flex min-w-0 items-center gap-2 text-small text-muted">
        ${state.feedId ? '' : avatar(feed, 'sm')}
        <span class="min-w-0 truncate font-medium">${esc(source)}</span>
        <span aria-hidden="true">·</span>
        <time class="shrink-0" datetime="${esc(p.publishedAt)}">${esc(shortTime(p.publishedAt))}</time>
        ${p.read ? '<span class="sr-only">, read</span>' : ''}
      </span>
      <span class="post-title line-clamp-2">${esc(p.title)}</span>
      ${p.summary ? `<span class="line-clamp-2 text-small text-muted">${esc(p.summary)}</span>` : ''}
    </button></li>`;
  }

  function renderListFooter() {
    const footer = $('#list-footer');
    if (!footer) return;
    if (state.loadingMore) {
      footer.innerHTML = `<ul role="list" class="divide-y divide-line">${skeletonRows(2)}</ul>`;
    } else if (state.moreError) {
      footer.innerHTML = `<div class="flex flex-col items-center gap-2 px-4 py-6 text-center"><p class="text-small text-muted">More posts didn't load.</p><button type="button" class="btn-secondary" data-action="load-more">Try again</button></div>`;
    } else if (state.nextCursor) {
      footer.innerHTML = '<div id="list-sentinel" class="flex justify-center px-4 py-6"><button type="button" class="btn-secondary" data-action="load-more">Load more posts</button></div>';
      observeSentinel();
    } else {
      footer.innerHTML = `<p class="flex items-center justify-center gap-2 px-4 py-8 text-small text-muted">${icon('circleCheck', 'h-4 w-4')}<span>${state.view === 'all' ? 'That\'s every post we have.' : 'That\'s everything unread from the last 30 days.'}</span></p>`;
    }
  }

  let observer = null;
  function observeSentinel() {
    if (!('IntersectionObserver' in window)) return;
    if (!observer) observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px 0px' });
    observer.disconnect();
    const s = $('#list-sentinel');
    if (s) observer.observe(s);
  }

  function feedStatusLine(feed) {
    if (feed.lastError) {
      return `<p class="mt-2 flex items-start gap-2 text-small text-danger">${icon('alert', 'mt-0.5 h-4 w-4')}<span>Couldn't update: ${esc(feed.lastError)}${feed.lastOkAt ? ` Last worked ${esc(agoPhrase(feed.lastOkAt))}.` : ''}</span></p>`;
    }
    const parts = [hostOf(feed.siteUrl || feed.url)];
    if (feed.lastOkAt) parts.push(`Updated ${agoPhrase(feed.lastOkAt)}`);
    return `<p class="mt-1 text-small text-muted">${esc(parts.filter(Boolean).join(' · '))}</p>`;
  }

  function feedMasthead(feed) {
    return `<section class="border-b border-line px-4 py-4 lg:px-5" aria-label="About this feed">
      <div class="flex items-start gap-3">
        ${avatar(feed, 'lg')}
        <div class="min-w-0 flex-1">
          <p class="text-body font-semibold lg:hidden">${esc(feed.title)}</p>
          ${feed.description ? `<p class="text-small text-fg">${esc(feed.description)}</p>` : ''}
          ${feedStatusLine(feed)}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        ${feed.siteUrl ? `<a class="btn-secondary" href="${esc(feed.siteUrl)}" target="_blank" rel="noopener noreferrer">${icon('globe')}<span>Visit site</span></a>` : ''}
        ${feed.sample
          ? '<p class="flex min-h-11 items-center text-small text-muted">Sample feed for this preview</p>'
          : `<button type="button" class="btn-secondary" data-action="unfollow" data-feed-id="${feed.id}">${icon('unfollow')}<span>Unfollow</span></button>`}
      </div>
    </section>`;
  }

  const SUGGESTIONS = [
    { title: 'NASA Image of the Day', url: 'https://www.nasa.gov/feeds/iotd-feed/', host: 'nasa.gov' },
    { title: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', host: 'smashingmagazine.com' },
    { title: 'The Mozilla Blog', url: 'https://blog.mozilla.org/en/feed/', host: 'blog.mozilla.org' },
  ];

  function onboarding() {
    const guest = state.viewer && !state.viewer.signedIn;
    return `
      <div class="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10 lg:py-16">
        <div class="flex flex-col items-start gap-3">
          <span class="brand-tile h-14 w-14 rounded-2xl">${icon('rss', 'h-8 w-8')}</span>
          <h2 class="font-serif text-title">Follow your first feed</h2>
          <p class="text-body text-muted">Paste the address of a blog, a news site or a podcast. New posts from every feed you follow arrive here, in one list, newest first.</p>
          <p class="flex items-center gap-2 text-small text-muted">${icon('lock', 'h-4 w-4')}<span>Only you can see the feeds you follow.</span></p>
        </div>
        ${guest ? `<button type="button" class="btn-primary self-start" data-action="ask-account">Make an account to follow feeds</button>` : `
        <form class="flex flex-col gap-2" data-role="follow-form" novalidate>
          <label for="onboard-url" class="text-small font-medium">Feed or website address</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input id="onboard-url" name="url" class="field" type="text" inputmode="url" autocomplete="url"
              autocapitalize="off" spellcheck="false" placeholder="e.g. example.com/feed">
            <button type="submit" class="btn-primary shrink-0" data-role="submit">Follow</button>
          </div>
          <p id="onboard-error" class="text-small text-danger" data-role="error" role="alert" hidden></p>
        </form>
        <div>
          <h3 class="section-label">Or start with one of these</h3>
          <ul class="list" role="list">${SUGGESTIONS.map((s, i) => `
            <li><button type="button" class="list-row w-full text-left hover:bg-raised" data-suggest="${esc(s.url)}">
              ${avatar({ id: i + 1, title: s.title }, 'md')}
              <span class="min-w-0 flex-1"><span class="block truncate text-body font-medium">${esc(s.title)}</span><span class="block truncate text-small text-muted">${esc(s.host)}</span></span>
              <span class="inline-flex items-center gap-1 text-small font-medium text-accent">${icon('plus', 'h-4 w-4')}Follow</span>
            </button></li>`).join('')}
          </ul>
        </div>`}
      </div>`;
  }

  function renderPreview() {
    const pane = $('#preview-pane');
    keepFocus(pane, () => drawPreview(pane));
  }
  function drawPreview(pane) {
    const id = state.previewId;
    const showingList = state.postsStatus === 'ready' && state.feedsStatus === 'ready';

    if (!id) {
      if (desktop.matches && (state.postsStatus === 'loading' || state.feedsStatus === 'loading')) {
        pane.innerHTML = previewSkeleton();
      } else if (showingList && !state.posts.length) {
        pane.innerHTML = `<div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <span class="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-muted">${icon('rss', 'h-7 w-7')}</span>
          <p class="max-w-xs text-body text-muted">When there's something new, pick a post and a preview of the article opens here.</p></div>`;
      } else {
        pane.innerHTML = '';
      }
      return;
    }
    const entry = state.previews.get(id);
    if (!entry) { loadPreview(id); return; }
    const listPost = postById(id);
    // The list is the source of truth for read marks made since it loaded.
    if (entry.post && listPost) entry.post.read = listPost.read;
    const bar = previewBar(entry.post || listPost);
    if (entry.status === 'loading') {
      pane.innerHTML = `${bar}${previewSkeleton(true)}`;
      return;
    }
    if (entry.status === 'error') {
      pane.innerHTML = `${bar}
        <div class="state-error mx-auto max-w-sm py-16" role="alert">
          <h2 class="text-heading">${entry.notFound ? 'This post is gone' : 'This post didn\'t open'}</h2>
          <p class="text-body text-muted">${entry.notFound ? 'It may belong to a feed you no longer follow.' : 'We couldn\'t load the preview just now. The rest of your list still works.'}</p>
          ${entry.notFound ? '' : `<button type="button" class="btn-primary mt-3" data-action="retry-preview">${icon('refresh')}<span>Try again</span></button>`}
        </div>`;
      return;
    }
    const post = entry.post;
    const feed = feedById(post.feedId) || { id: post.feedId, title: post.feedTitle };
    const host = hostOf(post.url || post.feedSiteUrl);
    const byline = [post.author, longTime(post.publishedAt)].filter(Boolean).join(' · ');
    pane.innerHTML = `${bar}
      <article class="mx-auto max-w-2xl px-5 pb-16 pt-6 lg:px-10 lg:pt-10">
        <p class="flex items-center gap-2 text-small font-medium text-fg">${avatar(feed, 'sm')}<span class="truncate">${esc(feed.title)}</span></p>
        <h1 class="mt-3 font-serif text-title">${esc(post.title)}</h1>
        ${byline ? `<p class="mt-3 text-small text-muted">${esc(byline)}</p>` : ''}
        ${post.url ? `<div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <a class="btn-primary" href="${esc(post.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>Open full article</span></a>
          <span class="text-small text-muted">on ${esc(host)}</span>
        </div>` : ''}
        <div class="mt-8 border-t border-line pt-8">
          ${post.contentHtml
            ? `<div class="article-body">${post.contentHtml}</div>`
            : `<p class="text-body text-muted">There's no text preview for this post. It may be a picture or a video${post.url ? ', so open the full article to see it.' : '.'}</p>`}
        </div>
        ${post.url && post.contentHtml ? `<div class="mt-10 flex flex-col items-start gap-3 rounded-xl bg-raised p-5">
          <p class="text-small text-muted">This is the preview ${esc(feed.title)} shares in its feed. The full article on ${esc(host)} may have more, including pictures.</p>
          <a class="btn-secondary" href="${esc(post.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>Open full article</span></a>
        </div>` : ''}
      </article>`;
  }

  function previewBar(post) {
    const i = state.posts.findIndex((p) => p.id === state.previewId);
    const read = post ? post.read : false;
    return `<div class="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur lg:px-4">
      <button type="button" class="btn-quiet lg:hidden" data-action="close-post">${icon('back')}<span>Back</span></button>
      <span class="flex-1"></span>
      ${post ? `<button type="button" class="btn-quiet" data-action="toggle-read">${icon(read ? 'mail' : 'check')}<span>${read ? 'Mark unread' : 'Mark read'}</span></button>` : ''}
      <button type="button" class="btn-quiet btn-icon" data-action="prev" aria-label="Previous post" ${i > 0 ? '' : 'disabled'}>${icon('up')}</button>
      <button type="button" class="btn-quiet btn-icon" data-action="next" aria-label="Next post" ${i >= 0 && i < state.posts.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
    </div>`;
  }

  function previewSkeleton(inner) {
    return `<div class="mx-auto max-w-2xl px-5 pb-16 pt-6 lg:px-10 lg:pt-10" aria-hidden="true">
      ${inner ? '' : '<div class="mb-6 h-6"></div>'}
      <span class="flex items-center gap-2"><span class="skeleton h-5 w-5"></span><span class="skeleton h-3 w-32"></span></span>
      <span class="skeleton mt-4 block h-7 w-11/12"></span>
      <span class="skeleton mt-3 block h-7 w-2/3"></span>
      <span class="skeleton mt-4 block h-3 w-48"></span>
      <span class="skeleton mt-6 block h-11 w-48"></span>
      <div class="mt-8 space-y-3 border-t border-line pt-8">${[100, 96, 92, 98, 70, 0, 100, 94, 88, 60].map((w) => (w ? `<span class="skeleton block h-3" style="width:${w}%"></span>` : '<span class="block h-3"></span>')).join('')}</div>
    </div><span class="sr-only" role="status">Loading the post</span>`;
  }

  // ── Events ────────────────────────────────────────────────────────────
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target.matches('[data-post-id]')) { openPost(Number(target.dataset.postId)); return; }
    if (target.hasAttribute('data-feed')) {
      const id = asId(target.dataset.feed);
      go({ feed: id, post: null, screen: null }, { replace: desktop.matches || state.screen === 'feeds' });
      if (!desktop.matches) window.scrollTo(0, 0);
      return;
    }
    if (target.hasAttribute('data-view')) { go({ view: target.dataset.view, post: null }, { replace: true }); return; }
    if (target.hasAttribute('data-suggest')) {
      const form = document.querySelector('[data-role="follow-form"]');
      if (form) { form.querySelector('input[name="url"]').value = target.dataset.suggest; submitFollow(form); }
      return;
    }
    const action = target.dataset.action;
    if (!action) return;
    switch (action) {
      case 'add-feed': openAddDialog(); break;
      case 'ask-account': askForAccount(); break;
      case 'close-dialog': { const d = target.closest('dialog'); if (d) d.close(); break; }
      case 'open-feeds': go({ screen: 'feeds', post: null }); break;
      case 'close-feeds': goBack({ screen: null }); break;
      case 'close-post': goBack({ post: null }); break;
      case 'clear-feed': go({ feed: null, post: null }, { replace: true }); break;
      case 'refresh': refresh({ force: true }); break;
      case 'mark-all': markAllRead(); break;
      case 'retry': Promise.all([loadFeeds(), loadPosts()]); break;
      case 'retry-preview': state.previews.delete(state.previewId); renderPreview(); break;
      case 'load-more': loadMore(); break;
      case 'show-new':
        state.pendingNew = 0;
        if (desktop.matches) $('#list-pane').scrollTop = 0; else window.scrollTo(0, 0);
        loadPosts();
        break;
      case 'prev': step(-1); break;
      case 'next': step(1); break;
      case 'toggle-read': {
        const post = postById(state.previewId) || (state.previews.get(state.previewId) || {}).post;
        if (post) setRead([state.previewId], !post.read);
        break;
      }
      case 'unfollow': { const f = feedById(asId(target.dataset.feedId)); if (f) unfollow(f); break; }
      default: break;
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'add-dialog-form' || form.matches('[data-role="follow-form"]')) {
      event.preventDefault();
      submitFollow(form);
    }
  });

  // j / k step through posts, as in most readers.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'j') { step(1); event.preventDefault(); }
    else if (event.key === 'k') { step(-1); event.preventDefault(); }
    else if (event.key === 'Escape' && state.screen === 'post' && !desktop.matches) goBack({ post: null });
  });

  // Close a dialog by tapping its backdrop.
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (event) => { if (event.target === d) d.close(); });
  }
  const closeIcon = document.querySelector('#add-dialog [data-action="close-dialog"][aria-label]');
  if (closeIcon) closeIcon.innerHTML = icon('x');

  // Back after a while away (the app stays loaded while hidden): check for
  // new posts the same quiet way as on open.
  let lastChecked = Date.now();
  function onShown() {
    if (Date.now() - lastChecked < 10 * 60000) return;
    lastChecked = Date.now();
    refresh();
  }
  window.addEventListener('usernode:visibility-changed', (e) => { if (e.detail && e.detail.hidden === false) onShown(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onShown(); });

  window.addEventListener('popstate', applyRoute);
  desktop.addEventListener('change', () => { if (!state.openId) state.previewId = null; pickPreview(); renderAll(); });

  // ── Start ─────────────────────────────────────────────────────────────
  (function boot() {
    const r = readRoute();
    state.feedId = r.feed;
    state.view = r.view;
    state.openId = r.post;
    state.previewId = r.post;
    state.screen = r.post ? 'post' : (r.screen || 'list');
    renderAll();
    Promise.all([loadFeeds(), loadPosts()]).then(() => refresh());
  })();
})();
