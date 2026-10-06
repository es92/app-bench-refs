---
name: playful-tactile
description: This app's house look for any UI you build or reshape - playful and tactile, with saturated colour, generous rounded shapes, chunky pressable controls and small physical feedback. Read it before designing or building any screen.
---

# Playful, tactile

This app's look is decided: playful and tactile, like a well-made toy or board game. Things look pressable and answer when pressed. Colour is saturated and confident, shapes are round and generous, and there is always one clear thing to do. The app's subject still shows through: in its content, its palette pick and its one signature element. Everything here is made with the app's design kit (`styles/tailwind-input.css`, `tailwind.config.js`), so it is the app's own look, written down once.

## 1. Pick a palette

Choose the one whose mood fits the subject, and copy its values into the existing `:root` (light look) and `.dark` (dark look) blocks in the kit's `@layer base` in `styles/tailwind-input.css`, replacing the defaults. Every text pair in each palette already passes 4.5:1 in both looks; if you change a value, check it again.

- **Blueberry**: calm, dependable; organising, planning, tools.
- **Grape**: creative, nocturnal; music, games, making things.
- **Leaf**: fresh, growing; food, health, outdoors, habits.
- **Tangerine**: energetic, sociable; groups, events, sport, cooking.

```css
/* Blueberry: blue accent, sunflower pop, cool neutrals */
:root {
  --ground: 243 246 255; --surface: 255 255 255; --raised: 232 238 252; --fg: 15 23 42;
  --muted: 71 85 105; --line: 212 221 241; --accent: 37 99 235; --on-accent: 255 255 255;
  --pop: 250 204 21; --on-pop: 66 32 6; --danger: 200 30 30; --on-danger: 255 255 255;
  --focus: 37 99 235; --shade: 15 23 42;
}
.dark {
  --ground: 11 17 32; --surface: 22 30 50; --raised: 34 45 70; --fg: 241 245 249;
  --muted: 163 177 197; --line: 51 65 94; --accent: 96 165 250; --on-accent: 8 27 61;
  --pop: 250 204 21; --on-pop: 66 32 6; --danger: 248 113 113; --on-danger: 69 10 10;
  --focus: 147 197 253; --shade: 0 0 0;
}

/* Grape: violet accent, mint pop, lilac-grey neutrals */
:root {
  --ground: 248 245 255; --surface: 255 255 255; --raised: 240 234 253; --fg: 30 20 50;
  --muted: 88 76 112; --line: 226 218 245; --accent: 124 58 237; --on-accent: 255 255 255;
  --pop: 110 231 183; --on-pop: 6 78 59; --danger: 200 30 30; --on-danger: 255 255 255;
  --focus: 124 58 237; --shade: 30 20 50;
}
.dark {
  --ground: 18 12 32; --surface: 31 23 52; --raised: 45 35 74; --fg: 245 242 255;
  --muted: 180 170 205; --line: 64 52 98; --accent: 178 152 255; --on-accent: 40 14 92;
  --pop: 110 231 183; --on-pop: 6 60 45; --danger: 248 113 113; --on-danger: 69 10 10;
  --focus: 196 181 253; --shade: 0 0 0;
}

/* Leaf: green accent, lilac pop, sage neutrals */
:root {
  --ground: 244 250 245; --surface: 255 255 255; --raised: 231 244 234; --fg: 18 38 26;
  --muted: 70 94 78; --line: 208 229 213; --accent: 21 128 61; --on-accent: 255 255 255;
  --pop: 196 181 253; --on-pop: 46 16 101; --danger: 200 30 30; --on-danger: 255 255 255;
  --focus: 21 128 61; --shade: 18 38 26;
}
.dark {
  --ground: 10 22 15; --surface: 20 36 27; --raised: 31 52 40; --fg: 236 247 239;
  --muted: 160 190 170; --line: 48 74 58; --accent: 74 222 128; --on-accent: 5 46 22;
  --pop: 196 181 253; --on-pop: 46 16 101; --danger: 248 113 113; --on-danger: 69 10 10;
  --focus: 134 239 172; --shade: 0 0 0;
}

/* Tangerine: orange accent, sky pop, warm neutrals; danger is crimson so it never reads as the accent */
:root {
  --ground: 255 248 241; --surface: 255 255 255; --raised: 254 237 222; --fg: 43 22 10;
  --muted: 104 72 52; --line: 246 222 202; --accent: 194 65 12; --on-accent: 255 255 255;
  --pop: 125 211 252; --on-pop: 12 74 110; --danger: 175 20 60; --on-danger: 255 255 255;
  --focus: 194 65 12; --shade: 43 22 10;
}
.dark {
  --ground: 26 14 8; --surface: 41 24 15; --raised: 58 36 23; --fg: 255 244 235;
  --muted: 214 184 160; --line: 84 56 38; --accent: 251 146 60; --on-accent: 67 20 7;
  --pop: 125 211 252; --on-pop: 12 60 90; --danger: 251 113 133; --on-danger: 76 5 25;
  --focus: 253 186 116; --shade: 0 0 0;
}
```

`pop`, `on-pop` and `shade` are new tokens: name them in `tailwind.config.js` beside the others (`pop: token('pop')`, `'on-pop': token('on-pop')`, `shade: token('shade')`).

**How the colours are used.** The accent is the primary action and the selected state, filled (`bg-accent text-on-accent`), never a thin outline. Pop is a second colour for ONE recurring kind of thing in the whole app (a count, a "new" marker, the signature element's highlight), always as a fill with `text-on-pop`, never as text on the page. Everything else is neutral. No gradients, ever.

## 2. Type

In `tailwind.config.js`, add `fontFamily: { display: ['ui-rounded', 'system-ui', 'sans-serif'] }` and use `font-display` on titles and headings; body text stays the system face. Keep the kit's four sizes, set as:

- `title`: 2rem, line height 2.5rem, weight 800, with `tracking-tight` where it is used
- `heading`: 1.25rem, line height 1.75rem, weight 700
- `body`: 1rem, line height 1.5rem
- `small`: 0.875rem, line height 1.25rem, weight 500

Numbers that change or line up get `tabular-nums`. Sentence case everywhere; no all-caps labels.

## 3. Shape

Roundness has levels, so the hierarchy shows; never one radius on everything:

- buttons, chips, toggles, badges, avatars: `rounded-full`
- list groups and anything you tap as a whole: `rounded-2xl`
- sheets and dialogs: `rounded-3xl` (top corners only on a phone)
- images and thumbnails: `rounded-xl`

Surfaces get a 2px border in `border-line` (`border-2`), so shapes read clearly in both looks. Spacing is generous: `px-4` page gutters on a phone, `gap-4` to `gap-6` between groups.

## 4. Pressable things

The one depth device in this look is the **pressable lip**: a solid shelf under anything you press, which the thing sinks into when pressed. It lives in the kit's components, so markup never repeats it. Use no other shadows. Put these rules after the kit's own button rules in `styles/tailwind-input.css` (they override the shape and size, and keep the colours and focus ring).

```css
@layer components {
  .btn-primary,
  .btn-secondary {
    @apply min-h-12 rounded-full px-6 font-semibold motion-safe:transition-transform motion-safe:duration-75;
    box-shadow: 0 4px 0 rgb(var(--shade) / 0.3);
  }
  .btn-primary:active,
  .btn-secondary:active {
    transform: translateY(4px);
    box-shadow: none;
  }
  .btn-secondary {
    @apply border-2 border-line;
  }
  /* Something you tap as a whole: a smaller lip. */
  .tap-card {
    @apply rounded-2xl border-2 border-line bg-surface p-4 motion-safe:transition-transform motion-safe:duration-75;
    box-shadow: 0 3px 0 rgb(var(--shade) / 0.12);
  }
  .tap-card:active {
    transform: translateY(3px);
    box-shadow: none;
  }
  /* A pill choice: unselected on raised, selected filled with the accent. */
  .chip {
    @apply inline-flex min-h-11 items-center gap-2 rounded-full bg-raised px-4 text-body font-medium text-fg;
  }
  .chip[aria-pressed="true"],
  .chip[aria-selected="true"] {
    @apply bg-accent text-on-accent;
  }
}
```

Leave at least 8px below anything with a lip, so the shelf never touches what follows. Lists that are not tapped as a whole (`list`, `list-row`) get the 2px border and `rounded-2xl`, no lip; their rows are at least 48px tall.

## 5. States with character

Every screen that loads data shows exactly one of: loading, empty, error, populated.

- **Empty**: a small illustration (96 to 128px) made of two to four simple shapes in inline SVG (circles, rounded rectangles, one curve), coloured only with token classes (`fill-current` with `text-accent`, `text-pop`, `text-raised`), drawn from the app's subject. Then a one-line title, one sentence, and the primary action. Never an emoji.
- **Loading**: skeletons in the same shapes and radii as the content they stand in for, with one gentle pulse (`motion-safe:animate-pulse`).
- **Error**: the same illustration language in `text-muted` and `text-raised`, what failed in one plain sentence, what still works, and a Retry button (`btn-secondary`).

## 6. Motion that answers

Motion only ever answers what a person did, inside `motion-safe:`:

- press: the lip (above)
- choose: the chosen thing settles from `scale-95` to `scale-100` over 150ms, ease-out
- add: the new item fades and slides in 8px over 200ms
- remove: it fades out over 150ms

Nothing moves on page load, and nothing loops except a loading pulse.

## 7. Voice

Friendly and brief. Sentence case, plain verbs, buttons that name the outcome ("Add item", "Save changes"). At most one exclamation mark on a screen. Warmth comes from the look, not from jokes in the copy.

## 8. Signature element

One thing on screen drawn from this app's subject, in this style: built from the same simple shapes, and the main place the pop colour appears. It is the memorable thing; keep everything around it quiet.

## 9. Write it down, then check it

Fill in the `## Design` section of `CLAUDE.md`: "Look: playful, tactile (see `.claude/skills/playful-tactile`)", the palette you picked and why, the signature element, and the type. Then look at each screen at 390px and desktop width, in the light and the dark look (`?un-theme=light`, `?un-theme=dark`), in each of its states, and confirm:

- one filled primary action per view, with its lip
- the radii follow the levels above
- pop is used for one kind of thing only
- every tap target is 44px or more
- every text pair is readable in both looks
- no gradients, no emoji as icons, no uppercase labels, no cards inside cards
