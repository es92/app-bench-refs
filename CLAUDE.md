# RSS Reader — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About RSS Reader

A personal feed reader in the spirit of Feedly: each person follows their own
RSS / Atom / JSON feeds and reads every unread post from all of them in one
scrolling list. Tapping a post opens a preview of the article with "Open full
article" to read it on the site. Each person's feeds and read state are
private to them; nothing in the app is shared between people.

## Design

This app's look. The first real version fills in the blanks; every later
change follows it, and updates it when a request changes the look on purpose.

- **Palette:** accent: burnt orange, the colour of the feed icon (`--accent`);
  neutrals: warm newsprint greys, a paper `ground` behind white `surface`
  pages. Six soft tints (`--tint-1..6`, light and dark) colour each feed's
  monogram so a mixed list can be scanned by source; they are for monograms
  only.
- **Signature element:** the newsprint reading pane: headlines and the article
  preview are set in a book serif (`font-serif`: Charter, Georgia and
  friends) like a printed page, under a kicker with the feed's monogram. The
  feed glyph on the orange tile is the app's mark.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`
  _(change their sizes in `tailwind.config.js` if you must, not their number)_
- **Layout:** phones show one screen at a time (`data-screen` on `#app`:
  list, feeds, post); from 1024 px the feeds sidebar, the post list and the
  preview sit side by side, each scrolling on its own.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and components (`btn-primary`,
`btn-secondary`, `btn-quiet`, `field`, `list` and `list-row`, `section-label`,
`skeleton`, `state-empty`, `state-error`, plus this app's `avatar`,
`brand-tile`, `feed-row`, `post-row`, `segmented`, `article-body`, `toast`
and `dialog`). Re-theme by changing the token values there, keeping every
text pair at 4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. example.com/feed").
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Icons are inline SVG strokes (the `PATHS` table in `public/app.js`).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- **Privacy.** All four tables (`feeds`, `subscriptions`, `posts`,
  `post_reads`) are `staging:private`: they record what each person follows
  and reads, and a private feed's address can carry a token. Every API query
  is scoped to the viewer's own subscriptions; a post outside them is a 404.
- **Feeds are shared, following is not.** One `feeds` row per address,
  fetched once however many people follow it; who follows what is
  `subscriptions` (`user_id` is the platform user id as text). A feed nobody
  follows any more is deleted with its posts.
- **Fetching is fenced** (`lib/server/fetch-url.js`): http/https only, no
  private, loopback or link-local addresses (checked on the resolved IP),
  10 s and 5 MB limits, redirects re-checked. Keep it that way for any new
  outbound request built from user input.
- **Feed HTML is never rendered raw.** `lib/server/sanitize.js` rebuilds it
  from an allowlist (paragraphs, headings, lists, quotes, code, emphasis,
  http(s) links) when it is stored; the client inserts only that output.
  Images and embeds are dropped on purpose; "Open full article" is the way to
  the full page.
- **Unread** means: not in your `post_reads`, and dated within the last 30
  days (`UNREAD_WINDOW_DAYS`, measured from `req.now`). "Mark all read" only
  marks posts fetched before the list was loaded (`asOf`).
- **Refreshing** happens on demand (on open, on the refresh button, on
  returning to the app after 10 minutes), at most every 10 minutes per feed,
  never on a timer, so the staging demo feeds are never fetched.
- **Staging demo data** (`lib/server/demo-seed.js`) belongs to the fake
  `staging-demo-reader`, never to the viewer. With `?demo=1` on a staging
  container its subscriptions are layered over the viewer's own, read-only;
  read marks the viewer makes are still the viewer's own. Without the flag,
  staging answers as production does (the empty "Follow your first feed"
  screen for a new person).
