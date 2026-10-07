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

let shuttingDown = false;
app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  res.json({ status: 'ok' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ── Saved recipes ─────────────────────────────────────────────────────────
// The calculator itself runs in the page (public/app.js): it needs nothing
// from the server and keeps working when the API does not. The server keeps
// one thing, each person's saved recipes, so a bake they liked is one tap
// away next time. A saved recipe is only the four inputs; the page works
// the grams and times out again, so a later fix to a formula reaches every
// saved recipe too.

// The five breads the page knows. Keep in step with BREADS in public/app.js.
const BREAD_KEYS = new Set(['sourdough', 'bagels', 'sourdough-bagels', 'rye', 'sandwich']);
const MAX_SAVED = 100;

// Schema, applied idempotently. Memoised so every request waits for the
// same attempt, and reset on failure so a database that was briefly down
// is retried by the next request instead of breaking the app until reboot.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saved_recipes (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          username TEXT,
          name TEXT NOT NULL,
          bread TEXT NOT NULL,
          hydration INTEGER NOT NULL,
          loaves INTEGER NOT NULL,
          loaf_grams INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS saved_recipes_user_idx
        ON saved_recipes (user_id, created_at DESC)`);
      // Each person's list is theirs alone in the app, so a staging copy
      // gets the table's shape and none of its rows.
      await pool.query(`COMMENT ON TABLE saved_recipes IS 'staging:private'`);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function toRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    bread: row.bread,
    hydration: row.hydration,
    loaves: row.loaves,
    loafGrams: row.loaf_grams,
    createdAt: row.created_at,
  };
}

// Staging demo recipes, added to the list only on a staging preview opened
// with ?demo=1. Read-only and never written to the database: they belong to
// nobody, cannot be removed, and say what they are in their names.
const DEMO_RECIPES = [
  { id: 'demo-1', name: 'Staging demo: Weekend boule', bread: 'sourdough', hydration: 78, loaves: 2, loafGrams: 900 },
  { id: 'demo-2', name: 'Staging demo: Everything bagels', bread: 'bagels', hydration: 57, loaves: 8, loafGrams: 115 },
  { id: 'demo-3', name: 'Staging demo: Deli rye', bread: 'rye', hydration: 70, loaves: 1, loafGrams: 1000 },
  { id: 'demo-4', name: 'Staging demo: School-week sandwich bread', bread: 'sandwich', hydration: 64, loaves: 2, loafGrams: 800 },
].map((r) => ({ ...r, demo: true, createdAt: null }));

function intIn(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

app.get('/api/recipes', async (req, res) => {
  const demo = IS_STAGING && req.query.demo === '1' ? DEMO_RECIPES : [];
  // A guest may look around but has nothing saved.
  if (!req.user) return res.json({ recipes: demo, guest: true });
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, name, bread, hydration, loaves, loaf_grams, created_at
         FROM saved_recipes WHERE user_id = $1
        ORDER BY created_at DESC, id DESC`,
      [String(req.user.id)]
    );
    res.json({ recipes: rows.map(toRecipe).concat(demo) });
  } catch (err) {
    console.error('[recipes] list failed', err.message);
    res.status(500).json({ error: 'Could not load saved recipes' });
  }
});

app.post('/api/recipes', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required', action: 'save a recipe' });
  const body = req.body || {};
  const bread = BREAD_KEYS.has(body.bread) ? body.bread : null;
  const hydration = intIn(body.hydration, 40, 100);
  const loaves = intIn(body.loaves, 1, 48);
  const loafGrams = intIn(body.loafGrams, 30, 3000);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!bread || hydration == null || loaves == null || loafGrams == null || !name) {
    return res.status(400).json({ error: 'That recipe is missing a bread, hydration, count or size.' });
  }
  try {
    await ensureSchema();
    const userId = String(req.user.id);
    // Saving the same bake twice keeps one copy.
    const same = await pool.query(
      `SELECT id, name, bread, hydration, loaves, loaf_grams, created_at FROM saved_recipes
        WHERE user_id = $1 AND bread = $2 AND hydration = $3 AND loaves = $4 AND loaf_grams = $5
        LIMIT 1`,
      [userId, bread, hydration, loaves, loafGrams]
    );
    if (same.rows.length) return res.json({ recipe: toRecipe(same.rows[0]), existing: true });
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM saved_recipes WHERE user_id = $1', [userId]);
    if (count.rows[0].n >= MAX_SAVED) {
      return res.status(409).json({ error: `You have ${MAX_SAVED} saved recipes. Remove one to save another.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO saved_recipes (user_id, username, name, bread, hydration, loaves, loaf_grams, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, bread, hydration, loaves, loaf_grams, created_at`,
      [userId, req.user.username || null, name, bread, hydration, loaves, loafGrams, req.now]
    );
    res.status(201).json({ recipe: toRecipe(rows[0]) });
  } catch (err) {
    console.error('[recipes] save failed', err.message);
    res.status(500).json({ error: 'Could not save the recipe' });
  }
});

app.delete('/api/recipes/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required', action: 'remove a recipe' });
  const id = intIn(req.params.id, 1, 2147483647);
  if (id == null) return res.status(404).json({ error: 'No such saved recipe' });
  try {
    await ensureSchema();
    const { rowCount } = await pool.query(
      'DELETE FROM saved_recipes WHERE id = $1 AND user_id = $2',
      [id, String(req.user.id)]
    );
    if (!rowCount) return res.status(404).json({ error: 'No such saved recipe' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[recipes] remove failed', err.message);
    res.status(500).json({ error: 'Could not remove the recipe' });
  }
});

// Anything else under /api is a JSON 404, not the HTML page.
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

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
      return res.redirect(302, PLATFORM_ORIGIN + '/app/bread-bot/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/bread-bot/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const DRAIN_MS = 3000;

async function start() {
  // Apply the schema on boot. The calculator never needs the database, so a
  // database that is not ready yet only delays saved recipes: the next
  // request retries the schema.
  ensureSchema().catch((err) => console.error('[schema] not applied yet:', err.message));

  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
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
