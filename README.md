# RSS Reader

A feed reader in the spirit of Feedly. Follow the RSS, Atom or JSON feeds of
the sites you like, and every unread post from all of them lands in one
scrolling list, newest first. Tap a post to read a preview of the article,
with a button to open the full thing in your browser. The feeds you follow
are yours alone: nobody else can see them, or what you have read.

## What it does

- **Follow a feed** by pasting its address, or a website's address: the app
  finds the feed the site advertises. RSS 2.0, RSS 1.0, Atom and JSON Feed
  all work.
- **One unread list** across every feed, or one feed at a time. Switch
  between Unread and All, mark a single post read or unread, or mark the
  whole view read (with Undo).
- **Preview, then open.** A post opens as a clean preview of the text the
  feed shares (no scripts, trackers or remote images), with "Open full
  article" to read it on the site.
- **New posts arrive quietly.** Opening the app checks your feeds in the
  background and offers "Show N new posts" instead of moving the list
  under you. The refresh button checks right away.
- Phone: one screen at a time (posts, your feeds, a post). From 1024 px
  wide: feeds, posts and the preview side by side, with `j` / `k` to step
  through posts.

## How it works

- `server.js`: the Express app, sign-in (the platform's identity token),
  the schema, and the JSON API under `/api`.
- `lib/server/fetch-url.js`: fetches a feed safely (http/https only, never
  a private address, time and size limits, redirects checked).
- `lib/server/feed-parser.js`: reads RSS, Atom and JSON Feed into one shape
  and discovers a site's feed from its home page.
- `lib/server/sanitize.js`: turns a feed's HTML into an allowlist of safe
  structure for the preview.
- `lib/server/feed-store.js`: following, unfollowing and refreshing.
- `lib/server/demo-seed.js`: the staging demo library.
- `public/index.html` and `public/app.js`: the whole front end, plain
  JavaScript with the Tailwind design kit in `styles/tailwind-input.css`.

Feeds are refreshed on demand (when someone opens the app or presses
refresh), at most every 10 minutes per feed, and a feed is fetched once no
matter how many people follow it. A feed that fails to update keeps its
posts and shows why it failed.

## Staging previews

A staging preview seeds a demo reader with five invented feeds on
`.example` addresses. Open the preview with `?demo=1` to see that library
layered over your own (still empty) one. Without `?demo=1` the preview
behaves exactly as production does. The demo feeds are never fetched.
