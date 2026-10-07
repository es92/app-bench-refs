const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { followFeed, unfollowFeed, refreshFeedsFor } = require('./lib/server/feed-store');
const { sanitizeArticleHtml, htmlToText, excerpt } = require('./lib/server/sanitize');
const { DEMO_READER, seedDemoLibrary } = require('./lib/server/demo-seed');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

let shuttingDown = false;
app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting down' });
  return res.json({ status: 'ok' });
});

// The app ships no favicon file (inside Homeroom the app's own tile is its
// icon). Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── The reader's API ─────────────────────────────────────────────────────
//
// Everything is scoped to the person asking: their subscriptions decide
// which feeds and posts they can see, and their own rows in post_reads
// decide what is unread. Nobody can list, open or mark another person's
// feeds; a post id outside your subscriptions answers 404.
//
// Staging demo: with `?demo=1` on a staging container, the demo reader's
// subscriptions (lib/server/demo-seed.js) are layered over the viewer's own,
// read-only, so a preview has posts to show. Read marks are still the
// viewer's own. Without the flag, staging answers exactly as production.

// Posts older than this are never "unread": following a feed with years
// of archive should not bury the reader.
const UNREAD_WINDOW_DAYS = 30;
const PAGE_SIZE = 30;

function scopeOf(req) {
  const viewer = req.user ? String(req.user.id) : '';
  const demo = IS_STAGING && req.query.demo === '1';
  const owners = [viewer, demo ? DEMO_READER : ''].filter(Boolean);
  return { viewer, owners, demo };
}

function unreadCutoff(req) {
  return new Date(req.now.getTime() - UNREAD_WINDOW_DAYS * 86400000);
}

const asId = (v) => (/^\d{1,15}$/.test(String(v || '')) ? Number(v) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

// Express 4 does not catch a rejected async handler; this does.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function feedJson(r) {
  return {
    id: Number(r.id),
    title: r.title,
    url: r.url,
    siteUrl: r.site_url,
    description: r.description,
    unread: Number(r.unread) || 0,
    lastOkAt: iso(r.last_ok_at),
    lastError: r.last_error || null,
    sample: !!r.sample,
  };
}

function postJson(r) {
  return {
    id: Number(r.id),
    feedId: Number(r.feed_id),
    feedTitle: r.feed_title,
    title: r.title,
    url: r.url,
    author: r.author,
    summary: r.summary,
    publishedAt: iso(r.published_at || r.sort_at),
    read: !!r.read,
  };
}

app.get('/api/feeds', wrap(async (req, res) => {
  const { viewer, owners, demo } = scopeOf(req);
  const { rows } = await pool.query(
    `SELECT f.id, f.title, f.url, f.site_url, f.description, f.last_ok_at, f.last_error,
            bool_and(s.user_id <> $1) AS sample,
            (SELECT count(*) FROM posts p
              WHERE p.feed_id = f.id AND p.sort_at >= $3
                AND NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.user_id = $1 AND r.post_id = p.id)) AS unread
       FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
      WHERE s.user_id = ANY($2)
      GROUP BY f.id
      ORDER BY lower(f.title), f.id`,
    [viewer, owners, unreadCutoff(req)],
  );
  const feeds = rows.map(feedJson);
  res.json({
    viewer: req.user ? { signedIn: true, username: req.user.username || null } : { signedIn: false },
    demo,
    feeds,
    totalUnread: feeds.reduce((n, f) => n + f.unread, 0),
  });
}));

app.get('/api/posts', wrap(async (req, res) => {
  const { viewer, owners } = scopeOf(req);
  const feedId = req.query.feed ? asId(req.query.feed) : null;
  if (req.query.feed && feedId == null) return res.status(400).json({ error: 'Unknown feed.' });
  const unreadOnly = req.query.view !== 'all';
  let cursorAt = null;
  let cursorId = null;
  if (req.query.cursor) {
    const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)~(\d{1,15})$/.exec(String(req.query.cursor));
    if (!m) return res.status(400).json({ error: 'Bad cursor.' });
    [, cursorAt, cursorId] = m;
  }
  const asOf = new Date();
  const { rows } = await pool.query(
    `SELECT p.id, p.feed_id, p.title, p.url, p.author, p.summary, p.published_at, p.sort_at,
            f.title AS feed_title,
            EXISTS (SELECT 1 FROM post_reads r WHERE r.user_id = $1 AND r.post_id = p.id) AS read
       FROM posts p JOIN feeds f ON f.id = p.feed_id
      WHERE p.feed_id IN (SELECT feed_id FROM subscriptions WHERE user_id = ANY($2))
        AND ($3::bigint IS NULL OR p.feed_id = $3)
        AND (NOT $4 OR (p.sort_at >= $5
             AND NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.user_id = $1 AND r.post_id = p.id)))
        AND ($6::timestamptz IS NULL OR (p.sort_at, p.id) < ($6::timestamptz, $7::bigint))
      ORDER BY p.sort_at DESC, p.id DESC
      LIMIT $8`,
    [viewer, owners, feedId, unreadOnly, unreadCutoff(req), cursorAt, cursorId, PAGE_SIZE + 1],
  );
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  res.json({
    posts: page.map(postJson),
    nextCursor: rows.length > PAGE_SIZE && last ? `${iso(last.sort_at)}~${last.id}` : null,
    asOf: asOf.toISOString(),
  });
}));

app.get('/api/posts/:id', wrap(async (req, res) => {
  const { viewer, owners } = scopeOf(req);
  const id = asId(req.params.id);
  if (id == null) return res.status(404).json({ error: 'Post not found.' });
  const { rows } = await pool.query(
    `SELECT p.*, f.title AS feed_title, f.site_url AS feed_site_url,
            EXISTS (SELECT 1 FROM post_reads r WHERE r.user_id = $1 AND r.post_id = p.id) AS read
       FROM posts p JOIN feeds f ON f.id = p.feed_id
      WHERE p.id = $3 AND p.feed_id IN (SELECT feed_id FROM subscriptions WHERE user_id = ANY($2))`,
    [viewer, owners, id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Post not found.' });
  const r = rows[0];
  res.json({ post: { ...postJson(r), contentHtml: r.content_html, feedSiteUrl: r.feed_site_url } });
}));

// Mark posts read or unread: { ids: [..], read: true|false }.
app.post('/api/posts/read', wrap(async (req, res) => {
  const { viewer, owners } = scopeOf(req);
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(asId).filter((v) => v != null).slice(0, 1000) : [];
  if (!ids.length) return res.status(400).json({ error: 'No posts given.' });
  const read = req.body.read !== false;
  const { rows } = read
    ? await pool.query(
      `INSERT INTO post_reads (user_id, post_id)
       SELECT $1, p.id FROM posts p
        WHERE p.id = ANY($2::bigint[]) AND p.feed_id IN (SELECT feed_id FROM subscriptions WHERE user_id = ANY($3))
       ON CONFLICT DO NOTHING RETURNING post_id`,
      [viewer, ids, owners],
    )
    : await pool.query('DELETE FROM post_reads WHERE user_id = $1 AND post_id = ANY($2::bigint[]) RETURNING post_id', [viewer, ids]);
  res.json({ ids: rows.map((r) => Number(r.post_id)), read });
}));

// Mark everything unread in a view as read, up to the moment the reader
// loaded it (`asOf`), so posts that arrived since are not swept up unseen.
app.post('/api/posts/read-all', wrap(async (req, res) => {
  const { viewer, owners } = scopeOf(req);
  const body = req.body || {};
  const feedId = body.feedId != null ? asId(body.feedId) : null;
  const asOf = body.asOf && !Number.isNaN(Date.parse(body.asOf)) ? new Date(body.asOf) : new Date();
  const { rows } = await pool.query(
    `INSERT INTO post_reads (user_id, post_id)
     SELECT $1, p.id FROM posts p
      WHERE p.feed_id IN (SELECT feed_id FROM subscriptions WHERE user_id = ANY($2))
        AND ($3::bigint IS NULL OR p.feed_id = $3)
        AND p.fetched_at <= $4 AND p.sort_at >= $5
     ON CONFLICT DO NOTHING RETURNING post_id`,
    [viewer, owners, feedId, asOf, unreadCutoff(req)],
  );
  res.json({ ids: rows.map((r) => Number(r.post_id)) });
}));

app.post('/api/feeds', wrap(async (req, res) => {
  const { viewer } = scopeOf(req);
  try {
    const { feed, already } = await followFeed(pool, viewer, req.body && req.body.url);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM posts p
        WHERE p.feed_id = $1 AND p.sort_at >= $2
          AND NOT EXISTS (SELECT 1 FROM post_reads r WHERE r.user_id = $3 AND r.post_id = p.id)`,
      [feed.id, unreadCutoff(req), viewer],
    );
    res.status(already ? 200 : 201).json({ feed: feedJson({ ...feed, unread: rows[0].n }), already });
  } catch (err) {
    if (err && err.userMessage) return res.status(422).json({ error: err.userMessage });
    throw err;
  }
}));

app.delete('/api/feeds/:id', wrap(async (req, res) => {
  const { viewer } = scopeOf(req);
  const id = asId(req.params.id);
  if (id == null || !(await unfollowFeed(pool, viewer, id))) return res.status(404).json({ error: 'You don\'t follow that feed.' });
  res.json({ ok: true });
}));

// Check the reader's own feeds for new posts. Demo feeds are never fetched.
app.post('/api/refresh', wrap(async (req, res) => {
  const { viewer } = scopeOf(req);
  res.json(await refreshFeedsFor(pool, viewer, { force: !!(req.body && req.body.force) }));
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use('/api', (err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/rss-reader/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/rss-reader/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Every table holds what one person follows or has read (or, for feeds and
// posts, what can be traced back to it: a private feed's address can carry
// a token), so all four are staging:private. Staging copies their schema,
// not their rows, and seeds a demo library of its own below.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  site_url TEXT,
  description TEXT,
  etag TEXT,
  last_modified TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE feeds IS 'staging:private';

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT NOT NULL,
  feed_id BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feed_id)
);
CREATE INDEX IF NOT EXISTS subscriptions_feed_idx ON subscriptions (feed_id);
COMMENT ON TABLE subscriptions IS 'staging:private';

CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  author TEXT,
  summary TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (feed_id, guid)
);
CREATE INDEX IF NOT EXISTS posts_feed_sort_idx ON posts (feed_id, sort_at DESC, id DESC);
COMMENT ON TABLE posts IS 'staging:private';

CREATE TABLE IF NOT EXISTS post_reads (
  user_id TEXT NOT NULL,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS post_reads_post_idx ON post_reads (post_id);
COMMENT ON TABLE post_reads IS 'staging:private';
`;

async function migrate() {
  await pool.query(SCHEMA);
  if (IS_STAGING) {
    await seedDemoLibrary(pool, { sanitizeArticleHtml, htmlToText, excerpt });
  }
}

const DRAIN_MS = 3000;

async function start() {
  await migrate();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    if (server.closeIdleConnections) server.closeIdleConnections();
    const t = setTimeout(() => { if (server.closeAllConnections) server.closeAllConnections(); }, DRAIN_MS);
    if (t.unref) t.unref();
    try {
      await pool.end();
    } catch (e) {
      console.error('[shutdown] pool.end failed', e.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
