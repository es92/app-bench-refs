const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

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


// Readiness: answers 503 once a shutdown has begun, so anything polling it
// sees the container leaving rotation rather than a connection reset.
let shuttingDown = false;
app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  return res.json({ status: 'ok' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Tier lists ─────────────────────────────────────────────────────────────
//
// A tier list is a title and the things people rank on it. Anyone can add a
// thing; each person puts each thing in one tier, and the crowd's tier for a
// thing is the average of everyone's. Every vote is visible to everyone on
// purpose: "how everyone voted on a thing" is part of the app.
//
// A tier is stored as a score so it averages: 5 = S, 4 = A, 3 = B, 2 = C,
// 1 = D, 0 = F. The client owns the letters.

const TIER_MIN = 0;
const TIER_MAX = 5;
const MAX_TITLE_CHARS = 80;
const MAX_NAME_CHARS = 80;
const MAX_ITEMS_PER_LIST = 200;
const MAX_LISTS = 100;

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function idParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function serverError(res, err) {
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on our side.' });
}

// Staging only, and only with ?demo=1: the viewer's own placements on the
// seeded restaurant list, added when the response is built and never
// written, so the populated preview shows a board someone has already
// started. The plain route (no ?demo=1) answers exactly what production
// would. See "Staging mock data" in the platform conventions.
const DEMO_LIST_ID = 970001;
const DEMO_VIEWER_TIERS = new Map([
  [970101, 5], [970109, 5], [970102, 4], [970103, 4], [970105, 3], [970106, 2], [970107, 1],
]);

function isDemo(req) {
  return IS_STAGING && req.query.demo === '1';
}

function withDemoVotes(req, listId, votes) {
  if (!isDemo(req) || listId !== DEMO_LIST_ID || !req.user) return votes;
  const me = Number(req.user.id);
  const mine = new Set(votes.filter((v) => v.user_id === me).map((v) => v.item_id));
  const added = [];
  for (const [itemId, tier] of DEMO_VIEWER_TIERS) {
    if (!mine.has(itemId)) added.push({ item_id: itemId, user_id: me, username: req.user.username, tier });
  }
  return votes.concat(added);
}

async function touchList(listId, now) {
  await pool.query('UPDATE tier_lists SET updated_at = $2 WHERE id = $1', [listId, now]);
}

// Every list, most recently active first, with how far along each is.
app.get('/api/lists', async (req, res) => {
  try {
    const me = req.user ? Number(req.user.id) : null;
    const { rows } = await pool.query(`
      SELECT l.id, l.title, l.created_by_name, l.updated_at,
             (SELECT COUNT(*) FROM tier_items i WHERE i.list_id = l.id)::int AS item_count,
             (SELECT COUNT(DISTINCT v.user_id) FROM tier_votes v
                JOIN tier_items i ON i.id = v.item_id WHERE i.list_id = l.id)::int AS voter_count,
             (SELECT COUNT(*) FROM tier_votes v
                JOIN tier_items i ON i.id = v.item_id WHERE i.list_id = l.id AND v.user_id = $1)::int AS ranked_by_me
        FROM tier_lists l
       ORDER BY l.updated_at DESC, l.id DESC
       LIMIT ${MAX_LISTS}`, [me]);
    if (isDemo(req) && me != null) {
      const demo = rows.find((r) => r.id === DEMO_LIST_ID);
      if (demo && demo.ranked_by_me === 0) {
        demo.ranked_by_me = DEMO_VIEWER_TIERS.size;
        demo.voter_count += 1;
      }
    }
    res.json({ lists: rows });
  } catch (err) {
    serverError(res, err);
  }
});

app.post('/api/lists', async (req, res) => {
  const title = cleanText(req.body && req.body.title, MAX_TITLE_CHARS);
  if (!title) return res.status(400).json({ error: 'Give the tier list a name.' });
  try {
    const { rows: [list] } = await pool.query(`
      INSERT INTO tier_lists (title, created_by, created_by_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
      RETURNING id, title, created_by_name, updated_at`,
      [title, req.user.id, req.user.username, req.now]);
    res.status(201).json({ list: { ...list, item_count: 0, voter_count: 0, ranked_by_me: 0 } });
  } catch (err) {
    serverError(res, err);
  }
});

// One list: its things and every vote on them. The client works out the
// viewer's tiers, the crowd's and each thing's breakdown from these.
app.get('/api/lists/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: 'No such tier list.' });
  try {
    const { rows: [list] } = await pool.query(
      'SELECT id, title, created_by, created_by_name, created_at, updated_at FROM tier_lists WHERE id = $1', [id]);
    if (!list) return res.status(404).json({ error: 'No such tier list.' });
    const [{ rows: items }, { rows: votes }] = await Promise.all([
      pool.query(`
        SELECT id, name, added_by, added_by_name, created_at
          FROM tier_items WHERE list_id = $1 ORDER BY created_at, id`, [id]),
      pool.query(`
        SELECT v.item_id, v.user_id, v.username, v.tier
          FROM tier_votes v JOIN tier_items i ON i.id = v.item_id
         WHERE i.list_id = $1
         ORDER BY v.updated_at, v.item_id`, [id]),
    ]);
    res.json({
      list,
      items,
      votes: withDemoVotes(req, id, votes),
      me: req.user ? { id: Number(req.user.id), username: req.user.username } : null,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Add a thing to rank. The same name twice on one list (ignoring case)
// answers 409 with the thing that is already there.
app.post('/api/lists/:id/items', async (req, res) => {
  const id = idParam(req.params.id);
  const name = cleanText(req.body && req.body.name, MAX_NAME_CHARS);
  if (!id) return res.status(404).json({ error: 'No such tier list.' });
  if (!name) return res.status(400).json({ error: 'Name the thing to rank.' });
  try {
    const { rows: [list] } = await pool.query(`
      SELECT l.id, (SELECT COUNT(*) FROM tier_items i WHERE i.list_id = l.id)::int AS item_count
        FROM tier_lists l WHERE l.id = $1`, [id]);
    if (!list) return res.status(404).json({ error: 'No such tier list.' });
    if (list.item_count >= MAX_ITEMS_PER_LIST) {
      return res.status(400).json({ error: `A tier list holds up to ${MAX_ITEMS_PER_LIST} things.` });
    }
    const { rows: [item] } = await pool.query(`
      INSERT INTO tier_items (list_id, name, added_by, added_by_name, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (list_id, lower(name)) DO NOTHING
      RETURNING id, name, added_by, added_by_name, created_at`,
      [id, name, req.user.id, req.user.username, req.now]);
    if (!item) {
      const { rows: [existing] } = await pool.query(
        'SELECT id, name FROM tier_items WHERE list_id = $1 AND lower(name) = lower($2)', [id, name]);
      return res.status(409).json({ error: `${existing ? existing.name : name} is already on this list.`, item: existing || null });
    }
    await touchList(id, req.now);
    res.status(201).json({ item });
  } catch (err) {
    serverError(res, err);
  }
});

// Put a thing in a tier (0 to 5), or take it out of yours (tier: null).
app.put('/api/items/:id/vote', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: 'No such thing.' });
  const raw = req.body ? req.body.tier : undefined;
  const clearing = raw === null;
  const tier = Number(raw);
  if (!clearing && !(Number.isInteger(tier) && tier >= TIER_MIN && tier <= TIER_MAX)) {
    return res.status(400).json({ error: 'Pick a tier.' });
  }
  try {
    const { rows: [item] } = await pool.query('SELECT id, list_id FROM tier_items WHERE id = $1', [id]);
    if (!item) return res.status(404).json({ error: 'That thing is no longer on the list.' });
    if (clearing) {
      await pool.query('DELETE FROM tier_votes WHERE item_id = $1 AND user_id = $2', [id, req.user.id]);
    } else {
      await pool.query(`
        INSERT INTO tier_votes (item_id, user_id, username, tier, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (item_id, user_id)
        DO UPDATE SET tier = EXCLUDED.tier, username = EXCLUDED.username, updated_at = EXCLUDED.updated_at`,
        [id, req.user.id, req.user.username, tier, req.now]);
    }
    await touchList(item.list_id, req.now);
    res.json({ ok: true, vote: clearing ? null : { item_id: id, user_id: Number(req.user.id), username: req.user.username, tier } });
  } catch (err) {
    serverError(res, err);
  }
});

// Whoever added a thing can take it off the list, with everyone's votes on it.
app.delete('/api/items/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(404).json({ error: 'No such thing.' });
  try {
    const { rows: [item] } = await pool.query('SELECT id, list_id, added_by FROM tier_items WHERE id = $1', [id]);
    if (!item) return res.status(404).json({ error: 'That thing is no longer on the list.' });
    if (Number(item.added_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the person who added it can remove it.' });
    }
    await pool.query('DELETE FROM tier_items WHERE id = $1', [id]);
    await touchList(item.list_id, req.now);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// Anything else under /api/ is a missing route, answered as JSON rather than
// falling through to the HTML shell.
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found.' }));

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
      return res.redirect(302, PLATFORM_ORIGIN + '/app/tier-list/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/tier-list/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Schema, applied idempotently on every boot. All three tables are public:
// a tier list's things, and who put each one where, are what everyone in
// the app is meant to see.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tier_lists (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tier_items (
      id SERIAL PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES tier_lists(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      added_by INTEGER NOT NULL,
      added_by_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS tier_items_list_name ON tier_items (list_id, lower(name))');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tier_votes (
      item_id INTEGER NOT NULL REFERENCES tier_items(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      tier SMALLINT NOT NULL CHECK (tier BETWEEN 0 AND 5),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, user_id)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS tier_votes_user ON tier_votes (user_id)');
}

// Staging only: two obviously fake tier lists ranked by five fake people,
// so the preview shows a crowd. Idempotent (fixed ids, ON CONFLICT DO
// NOTHING), never anything owned by whoever opens the preview.
const SEED_PEOPLE = [
  [980001, 'staging-demo-ana'],
  [980002, 'staging-demo-ben'],
  [980003, 'staging-demo-chloe'],
  [980004, 'staging-demo-dev'],
  [980005, 'staging-demo-eli'],
];
const SEED_LISTS = [
  {
    id: 970001, title: 'Staging demo: Bay Area restaurants', by: 0, ageDays: 0,
    // [id, name, added by (index), tiers by person (null = not ranked)]
    items: [
      [970101, 'Golden Hour Dumplings', 0, [5, 5, 4, 5, 4]],
      [970102, 'Mission Street Taqueria', 1, [5, 4, 5, 3, 5]],
      [970103, 'Fog City Noodle Bar', 2, [3, 4, 3, 2, 3]],
      [970104, 'Lake Merritt Smokehouse', 3, [4, 2, 5, 4, null]],
      [970105, 'Sunset Pho House', 0, [4, 4, 3, 4, 4]],
      [970106, 'Telegraph Pizza Co.', 4, [2, 3, 1, 2, 2]],
      [970107, 'Pier 7 Oyster Counter', 1, [1, 5, 2, 0, 3]],
      [970108, 'North Beach Focaccia', 2, [3, 3, 4, null, 3]],
      [970109, 'Japantown Ramen Stand', 3, [5, 4, 4, 5, 5]],
      [970110, 'Valencia Street Bakery', 4, [0, 1, 1, 2, null]],
    ],
  },
  {
    id: 970002, title: 'Staging demo: Game night board games', by: 1, ageDays: 2,
    items: [
      [970201, 'Codenames', 1, [5, 4, null, 5, null]],
      [970202, 'Wingspan', 0, [4, 5, null, 3, null]],
      [970203, 'Ticket to Ride', 3, [3, 3, null, 4, null]],
      [970204, 'Azul', 1, [4, null, null, 2, null]],
    ],
  },
];

async function seedStaging() {
  if (!IS_STAGING) return;
  for (const list of SEED_LISTS) {
    const [byId, byName] = SEED_PEOPLE[list.by];
    await pool.query(`
      INSERT INTO tier_lists (id, title, created_by, created_by_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW() - make_interval(days => $5 + 3), NOW() - make_interval(days => $5))
      ON CONFLICT (id) DO NOTHING`, [list.id, list.title, byId, byName, list.ageDays]);
    for (const [itemId, name, adder, tiers] of list.items) {
      const [addedBy, addedByName] = SEED_PEOPLE[adder];
      await pool.query(`
        INSERT INTO tier_items (id, list_id, name, added_by, added_by_name, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW() - make_interval(days => $6 + 2))
        ON CONFLICT DO NOTHING`, [itemId, list.id, name, addedBy, addedByName, list.ageDays]);
      for (let p = 0; p < tiers.length; p += 1) {
        if (tiers[p] == null) continue;
        const [userId, username] = SEED_PEOPLE[p];
        await pool.query(`
          INSERT INTO tier_votes (item_id, user_id, username, tier, updated_at)
          VALUES ($1, $2, $3, $4, NOW() - make_interval(days => $5 + 1))
          ON CONFLICT (item_id, user_id) DO NOTHING`, [itemId, userId, username, tiers[p], list.ageDays]);
      }
    }
  }
}

const DRAIN_MS = 3000;

async function start() {
  await migrate();
  await seedStaging();
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
