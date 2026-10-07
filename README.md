# Bread Bot

A bread calculator for home bakers. Pick the kind of bread, set the
hydration, how many loaves and how big, and Bread Bot works out the recipe:
grams of every ingredient, how long each rise takes, and the oven
temperature and bake time.

## What it does

- **Five breads:** sourdough, bagels, sourdough bagels, rye (deli style)
  and a sandwich loaf. Each is a baker's formula, so any batch scales from
  the numbers you set.
- **Your dough:** hydration on a slider limited to a sensible range for that
  bread, with its typical range and what the dough will feel like; the
  number of loaves (or bagels); and the dough weight of each, with a note on
  what that fits (a 5 qt Dutch oven, a 9 × 5 in pan, a deli-size bagel).
- **The recipe:** ingredients in grams that add up to exactly the dough you
  asked for, the rise, oven and bake times at a glance, and a step-by-step
  schedule with how long each step takes and a start-to-finish estimate.
  Bigger loaves get longer bakes.
- **Saved recipes:** save a bake and it waits at the top of the page, one
  tap away next time. Each person sees only their own.

The calculator runs entirely in the page, so it keeps working when the
server or the network does not. The server stores saved recipes only.

## How it is built

- `public/index.html` and `public/app.js`: the page and the calculator.
  The bread formulas live in `BREADS` in `app.js`.
- `server.js`: Express, the platform's sign-in check, and
  `GET/POST /api/recipes` and `DELETE /api/recipes/:id`.
- `styles/tailwind-input.css` and `tailwind.config.js`: the design kit,
  compiled to `public/tailwind.css` by `npm run build`.

On a staging preview opened with `?demo=1`, the saved recipes list also
shows four read-only "Staging demo" recipes.
