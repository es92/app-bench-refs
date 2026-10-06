# Tier List — notes for Claude Code

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

The screen this app currently ships — the hero, the "What's already
working" card, and the Press! example (the demo markup in
`public/index.html`, the `/api/press` and `/api/leaderboard` routes, and
the `presses` table bootstrap in `server.js`) — is placeholder content
from the Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- remove or repurpose the "Try the example" card, its demo endpoints and
  the `presses` table as appropriate,
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

## About Tier List

Rank things with friends. A tier list is a topic ("Bay Area restaurants");
anyone can add things to it, and each person drags each thing into a tier
from S down to F. Everyone sees three things: their own tiers, the crowd's
(the average of everyone's votes), and, for any one thing, how each person
voted on it.

## Design

This app's look. The first real version fills in the blanks; every later
change follows it, and updates it when a request changes the look on purpose.

The plan behind it (from the `frontend-design` skill). The subject is friends
settling arguments about taste ("that taqueria is S tier"); the audience is a
group on their phones, a few minutes at a time; the job is to put a thing in a
tier in one gesture and see where you stand against the crowd. The default
look for a tier list is a rainbow ladder (red S down to purple F); that was
rejected for one hue whose strength says the rank.

- **Palette:** one hue, ultramarine (`accent`), on cool paper (`ground`) with
  ink text (`fg`), slate secondary text (`muted`) and mist lines (`line`).
  A tier is how much ultramarine its row carries: `band-s` is solid, then
  each tier lighter, down to `band-f`, which is the page itself. Each band
  has its own letter colour (`grade-s` to `grade-f`), checked at 4.5:1 or
  more in both looks. The dark look inverts the ramp's lightness, not its
  order: S is still the strongest.
- **Signature element:** the grades. Each row starts with its tier letter as
  a heavy italic (`grade`: `text-title`, black weight, italic), like a rank
  on a results screen, and the solid S band is the one loud thing on the
  page. Everything else (things, fields, sheets) stays flat and quiet.
- **Type scale:** `text-title` is larger and tighter than the kit's
  (2.25rem, weight 800, slight negative tracking) so the list's name and the
  grades carry the personality; `text-heading`, `text-body`, `text-small`
  as the kit's. System sans throughout; no other typeface.
- **Components:** `tile` (a thing: a small flat white ticket, tap to open,
  drag to place), `grade`, `seg` and `seg-btn` (My tiers / Everyone as two
  words with a rule under the current one), `sheet` (a `<dialog>`: a bottom
  sheet on a phone, a centred panel from `sm`).
- **Layout:** on a phone one board at a time; from `lg` your tiers and
  everyone's side by side. Things never get shadows; one radius per kind
  (tickets `rounded-md`, boards `rounded-2xl`, sheets larger).

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- A tier is stored as a score so it averages: 5 = S, 4 = A, 3 = B, 2 = C,
  1 = D, 0 = F (`tier_votes.tier`). The letters and colours live in the
  client (`TIERS` in `public/app.js`).
- Every vote is public inside the app on purpose: "how everyone voted on a
  thing" is a feature. All three tables are public.
- The crowd's tier for a thing is the rounded average of everyone's votes.
- Only the person who added a thing can remove it (its votes go with it).
- Staging seeds two "Staging demo:" lists ranked by five fake
  `staging-demo-*` people. `?demo=1` adds, read-only, the viewer's own
  placements on the restaurant list so the populated board can be seen; it
  never writes them.
