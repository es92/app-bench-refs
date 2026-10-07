'use strict';
// Adding, refreshing and storing feeds.
//
// A feed (one row per address) is shared by everyone who follows it, so
// it is fetched once however many people read it; who follows what lives in
// `subscriptions`, and what each person has read in `post_reads`. Feeds are
// refreshed on demand (when a reader opens the app or asks), never on a
// timer, and a failure is recorded on the feed (`last_error`) for the UI to
// show rather than thrown at the reader.

const { fetchText, userError } = require('./fetch-url');
const { parseFeed, discoverFeedLinks } = require('./feed-parser');

const MAX_FEEDS_PER_PERSON = 300;
const STALE_MINUTES = 10;
const REFRESH_CONCURRENCY = 4;
const REFRESH_BUDGET_MS = 20000;

/** The address someone typed, made into a full http(s) URL. */
function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) throw userError('Enter the address of a feed or a website.', 'EEMPTY');
  if (s.length > 2048) throw userError('That address is too long.', 'EBADURL');
  s = s.replace(/^feed:\/\//i, 'https://').replace(/^feed:/i, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let url;
  try { url = new URL(s); } catch { throw userError('That doesn\'t look like a web address.', 'EBADURL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw userError('Only http and https addresses can be followed.', 'EBADURL');
  if (!url.hostname.includes('.') && !url.hostname.startsWith('[')) throw userError('That doesn\'t look like a web address.', 'EBADURL');
  url.hash = '';
  return url.toString();
}

/** Fetch `input`; when it is a web page, follow the feed it advertises. */
async function discover(input) {
  const first = await fetchText(input);
  const parsed = parseFeed(first.text, first.url);
  if (parsed) return { feedUrl: first.url, parsed, etag: first.etag, lastModified: first.lastModified };
  for (const candidate of discoverFeedLinks(first.text, first.url)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchText(candidate);
      const found = parseFeed(res.text, res.url);
      if (found) return { feedUrl: res.url, parsed: found, etag: res.etag, lastModified: res.lastModified };
    } catch { /* try the next one */ }
  }
  throw userError('We couldn\'t find a feed at that address. Look for an RSS link on the site; it often ends in /feed or .xml.', 'ENOFEED');
}

/** Insert new posts and update changed ones. Resolves to how many were new. */
async function upsertPosts(pool, feedId, items) {
  const byGuid = new Map();
  for (const it of items) if (it.guid && !byGuid.has(it.guid)) byGuid.set(it.guid, it);
  const list = [...byGuid.values()];
  if (!list.length) return 0;
  const { rows } = await pool.query(
    `INSERT INTO posts (feed_id, guid, title, url, author, summary, content_html, published_at, sort_at, fetched_at)
     SELECT $1, g, t, u, a, s, c, p, LEAST(COALESCE(p, now()), now()), now()
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[])
         AS x(g, t, u, a, s, c, p)
     ON CONFLICT (feed_id, guid) DO UPDATE
        SET title = EXCLUDED.title, url = EXCLUDED.url, author = EXCLUDED.author,
            summary = EXCLUDED.summary, content_html = EXCLUDED.content_html,
            published_at = COALESCE(EXCLUDED.published_at, posts.published_at)
      WHERE (posts.title, posts.url, posts.author, posts.summary, posts.content_html)
            IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.url, EXCLUDED.author, EXCLUDED.summary, EXCLUDED.content_html)
     RETURNING (xmax = 0) AS inserted`,
    [
      feedId,
      list.map((i) => i.guid),
      list.map((i) => i.title),
      list.map((i) => i.url || null),
      list.map((i) => i.author || null),
      list.map((i) => i.summary || ''),
      list.map((i) => i.contentHtml || ''),
      list.map((i) => (i.publishedAt ? i.publishedAt.toISOString() : null)),
    ],
  );
  return rows.filter((r) => r.inserted).length;
}

async function saveFeed(pool, found) {
  const { rows } = await pool.query(
    `INSERT INTO feeds (url, title, site_url, description, etag, last_modified, last_fetched_at, last_ok_at, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now(), NULL)
     ON CONFLICT (url) DO UPDATE
        SET title = EXCLUDED.title, site_url = EXCLUDED.site_url, description = EXCLUDED.description,
            etag = EXCLUDED.etag, last_modified = EXCLUDED.last_modified,
            last_fetched_at = now(), last_ok_at = now(), last_error = NULL
     RETURNING *`,
    [found.feedUrl, found.parsed.title, found.parsed.siteUrl, found.parsed.description || null, found.etag, found.lastModified],
  );
  const feed = rows[0];
  await upsertPosts(pool, feed.id, found.parsed.items);
  return feed;
}

const inflight = new Map();

async function doRefresh(pool, feed) {
  try {
    const res = await fetchText(feed.url, { etag: feed.etag, lastModified: feed.last_modified });
    if (res.status === 304) {
      await pool.query('UPDATE feeds SET last_fetched_at = now(), last_ok_at = now(), last_error = NULL WHERE id = $1', [feed.id]);
      return { id: feed.id, newPosts: 0 };
    }
    const parsed = parseFeed(res.text, res.url);
    if (!parsed) throw userError('This address no longer returns a feed.', 'ENOFEED');
    const newPosts = await upsertPosts(pool, feed.id, parsed.items);
    await pool.query(
      `UPDATE feeds SET title = COALESCE(NULLIF($2, ''), title), site_url = COALESCE($3, site_url),
              description = COALESCE(NULLIF($4, ''), description), etag = $5, last_modified = $6,
              last_fetched_at = now(), last_ok_at = now(), last_error = NULL
        WHERE id = $1`,
      [feed.id, parsed.title, parsed.siteUrl, parsed.description, res.etag, res.lastModified],
    );
    return { id: feed.id, newPosts };
  } catch (err) {
    const message = (err && err.userMessage) || 'Something went wrong reading this feed.';
    if (!err || !err.userMessage) console.warn(`[refresh] feed ${feed.id}: ${err && err.message}`);
    await pool.query('UPDATE feeds SET last_fetched_at = now(), last_error = $2 WHERE id = $1', [feed.id, message]).catch(() => {});
    return { id: feed.id, newPosts: 0, error: message };
  }
}

/** Refresh one feed; concurrent calls for the same feed share one fetch. */
function refreshFeed(pool, feed) {
  const key = String(feed.id);
  if (inflight.has(key)) return inflight.get(key);
  const p = doRefresh(pool, feed).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Refresh the feeds `userId` follows that have not been checked lately.
 * Resolves within the budget with what finished; slower feeds keep going in
 * the background and show up on the next load.
 */
async function refreshFeedsFor(pool, userId, { force = false } = {}) {
  const { rows } = await pool.query(
    `SELECT f.* FROM feeds f JOIN subscriptions s ON s.feed_id = f.id
      WHERE s.user_id = $1
        AND (f.last_fetched_at IS NULL OR f.last_fetched_at < now() - make_interval(mins => $2))
      ORDER BY f.last_fetched_at NULLS FIRST`,
    [userId, force ? 1 : STALE_MINUTES],
  );
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const feed = rows[next];
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results.push(await refreshFeed(pool, feed));
    }
  };
  const all = Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, rows.length) }, worker));
  let timer;
  await Promise.race([all, new Promise((resolve) => { timer = setTimeout(resolve, REFRESH_BUDGET_MS); })]);
  clearTimeout(timer);
  return {
    checked: results.length,
    pending: rows.length - results.length,
    newPosts: results.reduce((n, r) => n + r.newPosts, 0),
    failed: results.filter((r) => r.error).map((r) => r.id),
  };
}

/** Follow the feed at `raw` for `userId`, fetching it if it is new to the app. */
async function followFeed(pool, userId, raw) {
  const input = normalizeInput(raw);
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1', [userId]);
  if (countRows[0].n >= MAX_FEEDS_PER_PERSON) {
    throw userError(`You follow ${MAX_FEEDS_PER_PERSON} feeds, which is the most one person can. Unfollow one to add another.`, 'ELIMIT');
  }
  let feed = (await pool.query('SELECT * FROM feeds WHERE url = $1', [input])).rows[0];
  if (feed && feed.last_ok_at) {
    const ageMs = Date.now() - new Date(feed.last_fetched_at || 0).getTime();
    if (ageMs > STALE_MINUTES * 60000) await refreshFeed(pool, feed);
  } else {
    feed = await saveFeed(pool, await discover(input));
  }
  const sub = await pool.query(
    'INSERT INTO subscriptions (user_id, feed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING feed_id',
    [userId, feed.id],
  );
  return { feed, already: sub.rowCount === 0 };
}

/** Stop following; a feed nobody follows any more is deleted with its posts. */
async function unfollowFeed(pool, userId, feedId) {
  const { rowCount } = await pool.query('DELETE FROM subscriptions WHERE user_id = $1 AND feed_id = $2', [userId, feedId]);
  if (!rowCount) return false;
  await pool.query(
    'DELETE FROM feeds f WHERE f.id = $1 AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = f.id)',
    [feedId],
  );
  return true;
}

module.exports = { followFeed, unfollowFeed, refreshFeedsFor, normalizeInput };
