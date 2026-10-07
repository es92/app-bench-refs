// Bread Bot: the calculator runs here, in the page. It needs nothing from
// the server, so it keeps working when the network or the API does not.
// The server keeps each person's saved recipes (GET/POST/DELETE /api/recipes).
//
// Class names below are whole literals on purpose: Tailwind compiles only
// the class names it can read in this file.
(function () {
  'use strict';

  // ── Small helpers ──────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var tenth = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Grams as a baker weighs them: whole grams, and tenths for the small
  // things (yeast, salt) where a gram is a big share.
  function fmtGrams(g) { return (g < 10 ? tenth.format(g) : whole.format(g)) + ' g'; }

  // Round a recipe so its parts add up to the dough asked for: small amounts
  // to a tenth, the rest down to whole grams, then the gram or two that
  // rounding lost goes back to the rows that lost the most.
  function roundRows(ingredients, target) {
    var rows = ingredients.map(function (i) {
      return { name: i.name, note: i.note, raw: i.g, g: i.g < 10 ? Math.round(i.g * 10) / 10 : Math.floor(i.g) };
    });
    var big = rows.filter(function (r) { return r.raw >= 10; });
    var small = rows.reduce(function (sum, r) { return r.raw < 10 ? sum + r.g : sum; }, 0);
    var want = Math.round(target - small);
    var have = big.reduce(function (sum, r) { return sum + r.g; }, 0);
    big.sort(function (a, b) { return (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)); });
    for (var k = 0; have < want && k < big.length; k += 1) { big[k].g += 1; have += 1; }
    return rows;
  }

  function half(hours) {
    var h = Math.round(hours * 2) / 2;
    var floor = Math.floor(h);
    if (h === floor) return String(floor);
    return (floor ? String(floor) : '') + '½';
  }

  // One duration in minutes, as people say it.
  function fmtOne(min) {
    if (min < 60) return min + ' min';
    if (min % 30 === 0) return half(min / 60) + ' h';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  // A [low, high] range in minutes.
  function fmtRange(range) {
    var lo = range[0];
    var hi = range[1];
    if (lo === hi) return fmtOne(lo);
    if (hi < 60 || (lo < 60 && hi <= 90)) return lo + '–' + hi + ' min';
    if (lo >= 60 && lo % 30 === 0 && hi % 30 === 0) return half(lo / 60) + '–' + half(hi / 60) + ' h';
    return fmtOne(lo) + ' to ' + fmtOne(hi);
  }

  // Start to finish, which runs to many hours for the overnight breads.
  function fmtTotal(lo, hi) {
    if (hi < 180) return fmtRange([lo, hi]);
    var a = half(lo / 60);
    var b = half(hi / 60);
    return a === b ? 'about ' + a + ' h' : 'about ' + a + '–' + b + ' h';
  }

  // Bigger loaves need longer in the oven; heat has further to go. Scale a
  // reference bake by the weight ratio to the power 0.4 and round it.
  function scaleBake(range, refGrams, grams, roundTo) {
    var k = Math.pow(grams / refGrams, 0.4);
    var out = range.map(function (m) { return Math.max(roundTo, Math.round((m * k) / roundTo) * roundTo); });
    if (out[1] < out[0]) out[1] = out[0];
    return out;
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // ── Pictures ───────────────────────────────────────────────────────────
  // One line drawing per bread: the app's own mark, used on the picker, the
  // recipe and the saved recipes.

  var ART = {
    sourdough: '<path d="M5 33c0-11 8.5-19 19-19s19 8 19 19c0 2-1.5 3-3.5 3h-31C6.5 36 5 35 5 33z"/><path d="M15 24c5-4 13-4.5 19-1"/>',
    bagels: '<ellipse cx="24" cy="26" rx="19" ry="12"/><ellipse cx="24" cy="25" rx="6" ry="2.75"/><path d="M11 22c3-3 7.5-4.5 12-4.75"/>',
    'sourdough-bagels': '<ellipse cx="24" cy="26" rx="19" ry="12"/><ellipse cx="24" cy="25" rx="6" ry="2.75"/>' +
      '<g fill="currentColor" stroke="none"><circle cx="12" cy="23" r="1.4"/><circle cx="18" cy="18.5" r="1.4"/><circle cx="30" cy="18.5" r="1.4"/><circle cx="36.5" cy="23.5" r="1.4"/><circle cx="14" cy="31" r="1.4"/><circle cx="24" cy="33.5" r="1.4"/><circle cx="34" cy="31" r="1.4"/></g>',
    rye: '<path d="M4 31c0-8 9-15 20-15s20 7 20 15c0 3-2 5-5 5H9c-3 0-5-2-5-5z"/><path d="M14 21.5l3.5 6M22 19l3.5 7M30 20l3.5 6"/>',
    sandwich: '<path d="M10 41V25.5c-2-.8-3-2.6-3-4.5C7 15.5 14.5 11 24 11s17 4.5 17 10c0 1.9-1 3.7-3 4.5V41z"/><path d="M10 29h28"/>',
  };

  function art(key, cls) {
    return '<svg viewBox="0 0 48 48" class="' + cls + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ART[key] + '</svg>';
  }

  var ICON = {
    rise: '<path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>',
    oven: '<path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.2-5.8-4-8.2-.5 2-1.6 3.2-3 3.7.3-3.4-1-6.4-3.5-8.7-.4 4.2-4.5 7-4.5 12.9C4 19.3 8 22 12 22z"/>',
    bake: '<path d="M6 21V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13"/><path d="M4 21h16"/><path d="M9 10h6M9 14h6"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };

  function icon(name, cls) {
    return '<svg viewBox="0 0 24 24" class="' + cls + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  // ── The breads ─────────────────────────────────────────────────────────
  // Each bread is a baker's formula: every ingredient as a share of the
  // total flour, so any batch scales from one number. Total dough is
  // count × size, and flour = dough ÷ (sum of the shares). Starters are
  // fed 1:1, so 20% starter brings 10% of the flour and 10% of the water,
  // and the hydration you set counts both ("true" hydration).
  // Times assume a kitchen around 75°F (24°C). Keep the keys in step with
  // BREAD_KEYS in server.js.

  var KITCHEN_NOTE = 'Times assume a kitchen around 75°F (24°C). A cooler kitchen means slower rises, so go by how the dough looks.';

  var BOIL = 'Bring 3 L (3 qt) of water to a boil with 20 g malt syrup and 10 g baking soda. Boil a few at a time, 1 min per side. Heat the oven to 450°F (230°C) meanwhile.';

  function shapeBagels(n, w) {
    return n === 1
      ? 'Roll the dough into a rope and seal it into a ring around your hand.'
      : 'Divide into ' + n + ' pieces of ' + w + ' g. Roll each into a rope and seal it into a ring around your hand.';
  }

  function bagelBake(n, w) {
    var bake = scaleBake([16, 20], 115, w, 1);
    return {
      bake: bake,
      step: {
        name: 'Bake',
        time: bake,
        text: 'Top them while still wet if you like, then bake at 450°F (230°C) on a lined tray until deep golden.' +
          (n > 8 ? ' Use two trays and swap them halfway.' : ''),
        hot: true,
      },
    };
  }

  var BREADS = [
    {
      key: 'sourdough',
      name: 'Sourdough',
      one: 'sourdough loaf',
      many: 'sourdough loaves',
      countLabel: 'Loaves',
      sizeLabel: 'Each loaf (g)',
      blurb: 'A crusty country loaf raised with a starter and proofed overnight in the fridge.',
      hydration: { def: 75, min: 60, max: 90, lo: 70, hi: 80 },
      count: { def: 2, min: 1, max: 12 },
      size: { def: 900, min: 400, max: 2000, step: 50 },
      feel: [
        'Stiffer dough: easy to shape, with a tighter crumb.',
        'The classic range: an open crumb and a dough you can still shape.',
        'Very wet: big open holes, but slack and tricky to shape.',
      ],
      sizeNote: function (w) {
        if (w < 700) return 'A small boule. Fits a 3–4 qt (3–4 L) Dutch oven.';
        if (w <= 1100) return 'A medium boule or batard. Fits a 5 qt (5 L) Dutch oven.';
        return 'A large loaf. Needs a 6 qt (6 L) Dutch oven or bigger.';
      },
      build: function (h, n, w) {
        var F = (n * w) / (1 + h + 0.02);
        var bake = scaleBake([40, 45], 900, w, 5);
        var lidOff = bake.map(function (m) { return Math.max(10, m - 20); });
        return {
          ingredients: [
            { name: 'Bread flour', g: 0.9 * F },
            { name: 'Water', note: 'lukewarm, about 80°F (27°C)', g: (h - 0.1) * F },
            { name: 'Sourdough starter', note: 'active and bubbly, fed 4–12 h before', g: 0.2 * F },
            { name: 'Salt', note: 'fine sea salt', g: 0.02 * F },
          ],
          note: 'Hydration counts the flour and water inside the starter.',
          stats: {
            rise: ['4–5 h', 'then 12–16 h in the fridge'],
            oven: ['475°F', '245°C, then 450°F (230°C)'],
            bake: [fmtRange(bake), n > 1 ? 'per loaf, one at a time' : '20 min with the lid on'],
          },
          steps: [
            { name: 'Mix and rest', time: [45, 45], text: 'Mix the flour and water until no dry bits remain. Cover and rest.' },
            { name: 'Add starter and salt', time: [10, 10], text: 'Squeeze them through the dough until it comes back together.' },
            { name: 'Bulk rise', time: [240, 300], text: 'Stretch and fold every 30 min for the first 2 h. Ready when about 50% bigger, domed and bubbly.' },
            {
              name: 'Shape', time: [30, 30],
              text: n === 1
                ? 'Pre-shape into a round, rest 20 min, then shape it tight and set it seam-up in a floured basket.'
                : 'Divide into ' + n + ' pieces of ' + w + ' g. Pre-shape into rounds, rest 20 min, then shape tight and set seam-up in floured baskets.',
            },
            { name: 'Cold proof', time: [720, 960], text: 'Cover and refrigerate overnight. Bake straight from the fridge.' },
            {
              name: 'Bake', time: bake, each: n > 1, hot: true,
              text: 'Preheat a Dutch oven at 475°F (245°C) for 45 min. Bake 20 min with the lid on, then ' + fmtRange(lidOff) +
                ' with the lid off at 450°F (230°C), until deep brown.' +
                (n > 1 ? ' Bake one loaf at a time, keep the others in the fridge, and reheat the pot 10 min between loaves.' : ''),
            },
            { name: 'Cool', time: [60, 60], text: 'Cool on a rack for at least 1 h before slicing. The crumb is still setting.' },
          ],
          // Loaves go in one after another, with a reheat between them.
          extra: n > 1 ? [bake[0] * (n - 1) + 10 * (n - 1), bake[1] * (n - 1) + 10 * (n - 1)] : [0, 0],
        };
      },
    },
    {
      key: 'bagels',
      name: 'Bagels',
      one: 'bagel',
      many: 'bagels',
      countLabel: 'Bagels',
      sizeLabel: 'Each bagel (g)',
      blurb: 'New York style: a stiff yeasted dough, shaped the night before, boiled, then baked.',
      hydration: { def: 58, min: 50, max: 68, lo: 55, hi: 62 },
      count: { def: 8, min: 1, max: 24 },
      size: { def: 115, min: 60, max: 200, step: 5 },
      feel: [
        'Very stiff: a dense, extra-chewy bite. Knead it well.',
        'The classic bagel range: chewy, with a shiny crust.',
        'Softer and lighter. Wet bagels can flatten when boiled.',
      ],
      sizeNote: function (w) {
        if (w < 95) return 'Small bagels, about 3 in (8 cm) across.';
        if (w <= 130) return 'Classic deli bagels, about 4 in (10 cm) across.';
        return 'Big bakery bagels, about 5 in (12 cm) across.';
      },
      build: function (h, n, w) {
        var F = (n * w) / (1 + h + 0.02 + 0.008 + 0.04);
        var b = bagelBake(n, w);
        var boil = Math.ceil(n / 4) * 3;
        return {
          ingredients: [
            { name: 'Bread flour', note: 'high-gluten flour if you have it', g: F },
            { name: 'Water', note: 'cool from the tap', g: h * F },
            { name: 'Barley malt syrup', note: 'or honey', g: 0.04 * F },
            { name: 'Salt', g: 0.02 * F },
            { name: 'Instant yeast', g: 0.008 * F },
          ],
          note: 'For the boil you also need about 20 g malt syrup and 10 g baking soda.',
          stats: {
            rise: ['1 h', 'then overnight in the fridge'],
            oven: ['450°F', '230°C, after a quick boil'],
            bake: [fmtRange(b.bake), n > 8 ? 'on two trays' : 'on one tray'],
          },
          steps: [
            { name: 'Mix and knead', time: [10, 10], text: 'Mix everything into a stiff dough and knead until smooth. It should feel firm, not sticky.' },
            { name: 'First rise', time: [60, 60], text: 'Cover and rest until a little puffy. Bagel dough does not double.' },
            { name: 'Shape', time: [20, 20], text: shapeBagels(n, w) },
            { name: 'Cold proof', time: [720, 1080], text: 'Set them on a lined tray, cover and refrigerate overnight. Ready when one floats in water within 10 seconds.' },
            { name: 'Boil', time: [boil, boil], text: BOIL },
            b.step,
            { name: 'Cool', time: [15, 15], text: 'Cool on a rack for 15 min before slicing.' },
          ],
          extra: [0, 0],
        };
      },
    },
    {
      key: 'sourdough-bagels',
      name: 'Sourdough bagels',
      one: 'sourdough bagel',
      many: 'sourdough bagels',
      countLabel: 'Bagels',
      sizeLabel: 'Each bagel (g)',
      blurb: 'Bagels raised with a starter for a tangier, chewier bite. Shaped the night before.',
      hydration: { def: 60, min: 52, max: 68, lo: 56, hi: 63 },
      count: { def: 8, min: 1, max: 24 },
      size: { def: 115, min: 60, max: 200, step: 5 },
      feel: [
        'Very stiff: dense and extra chewy, and slow to rise.',
        'The classic range: chewy, with a blistered crust.',
        'Softer and lighter. Wet bagels can flatten when boiled.',
      ],
      sizeNote: function (w) {
        if (w < 95) return 'Small bagels, about 3 in (8 cm) across.';
        if (w <= 130) return 'Classic deli bagels, about 4 in (10 cm) across.';
        return 'Big bakery bagels, about 5 in (12 cm) across.';
      },
      build: function (h, n, w) {
        var F = (n * w) / (1 + h + 0.02 + 0.04);
        var b = bagelBake(n, w);
        var boil = Math.ceil(n / 4) * 3;
        return {
          ingredients: [
            { name: 'Bread flour', note: 'high-gluten flour if you have it', g: 0.9 * F },
            { name: 'Water', note: 'cool from the tap', g: (h - 0.1) * F },
            { name: 'Sourdough starter', note: 'active and bubbly, fed 4–12 h before', g: 0.2 * F },
            { name: 'Barley malt syrup', note: 'or honey', g: 0.04 * F },
            { name: 'Salt', g: 0.02 * F },
          ],
          note: 'Hydration counts the starter. For the boil you also need about 20 g malt syrup and 10 g baking soda.',
          stats: {
            rise: ['4–6 h', 'then overnight in the fridge'],
            oven: ['450°F', '230°C, after a quick boil'],
            bake: [fmtRange(b.bake), n > 8 ? 'on two trays' : 'on one tray'],
          },
          steps: [
            { name: 'Mix and knead', time: [10, 10], text: 'Mix everything into a stiff dough and knead until smooth. It should feel firm, not sticky.' },
            { name: 'Bulk rise', time: [240, 360], text: 'Cover and rest until about 50% bigger. A stiff sourdough is slow, so give it time.' },
            { name: 'Shape', time: [20, 20], text: shapeBagels(n, w) },
            { name: 'Cold proof', time: [720, 1080], text: 'Set them on a lined tray, cover and refrigerate overnight. Ready when one floats in water within 10 seconds.' },
            { name: 'Boil', time: [boil, boil], text: BOIL },
            b.step,
            { name: 'Cool', time: [15, 15], text: 'Cool on a rack for 15 min before slicing.' },
          ],
          extra: [0, 0],
        };
      },
    },
    {
      key: 'rye',
      name: 'Rye',
      one: 'rye loaf',
      many: 'rye loaves',
      countLabel: 'Loaves',
      sizeLabel: 'Each loaf (g)',
      blurb: 'Deli-style rye: 40% rye flour, caraway and a soft, tight crumb. Rises with yeast, ready the same day.',
      hydration: { def: 70, min: 60, max: 85, lo: 66, hi: 75 },
      count: { def: 1, min: 1, max: 12 },
      size: { def: 900, min: 400, max: 2000, step: 50 },
      feel: [
        'Stiffer dough: easier to shape, with a denser crumb.',
        'The deli range: moist and tender, and still easy to shape.',
        'Wet rye: soft and moist, but sticky. Shape it with wet hands.',
      ],
      sizeNote: function (w) {
        if (w < 700) return 'A small oval loaf.';
        if (w <= 1100) return 'A medium oval loaf, the classic deli size.';
        return 'A large oval loaf.';
      },
      build: function (h, n, w) {
        var F = (n * w) / (1 + h + 0.02 + 0.012 + 0.02);
        var bake = scaleBake([35, 40], 900, w, 5);
        var rest = bake.map(function (m) { return m - 10; });
        return {
          ingredients: [
            { name: 'Bread flour', g: 0.6 * F },
            { name: 'Rye flour', note: 'whole grain or medium rye', g: 0.4 * F },
            { name: 'Water', note: 'lukewarm', g: h * F },
            { name: 'Caraway seeds', note: 'optional, for the deli flavor', g: 0.02 * F },
            { name: 'Salt', g: 0.02 * F },
            { name: 'Instant yeast', g: 0.012 * F },
          ],
          note: 'Rye flour drinks more water than wheat, so this dough stays tacky.',
          stats: {
            rise: ['1–1½ h', 'then 45–60 min shaped'],
            oven: ['425°F', '220°C, then 375°F (190°C)'],
            bake: [fmtRange(bake), 'until it sounds hollow'],
          },
          steps: [
            { name: 'Mix and knead', time: [10, 10], text: 'Mix everything and knead until smooth. Rye stays tacky, so wet your hands instead of adding flour.' },
            { name: 'First rise', time: [60, 90], text: 'Cover and rise until nearly doubled.' },
            {
              name: 'Shape', time: [10, 10],
              text: n === 1
                ? 'Shape into a tight oval and set it on a lined tray.'
                : 'Divide into ' + n + ' pieces of ' + w + ' g, shape each into a tight oval and set them on lined trays.',
            },
            { name: 'Second rise', time: [45, 60], text: 'Cover loosely. Ready when puffy and a floured fingertip dent springs back slowly.' },
            {
              name: 'Bake', time: bake, hot: true,
              text: 'Score three diagonal slashes. Bake 10 min at 425°F (220°C) with a pan of steam, then ' + fmtRange(rest) +
                ' at 375°F (190°C), until it sounds hollow underneath, 200°F (93°C) inside.' +
                (n > 2 ? ' Use two trays and swap them halfway.' : ''),
            },
            { name: 'Cool', time: [120, 120], text: 'Rye needs time to set. Cool at least 2 h before slicing.' },
          ],
          extra: [0, 0],
        };
      },
    },
    {
      key: 'sandwich',
      name: 'Sandwich loaf',
      one: 'sandwich loaf',
      many: 'sandwich loaves',
      countLabel: 'Loaves',
      sizeLabel: 'Each loaf (g)',
      blurb: 'A soft white pan loaf with milk and butter, for sandwiches and toast. Ready the same day.',
      hydration: { def: 64, min: 55, max: 72, lo: 60, hi: 67 },
      count: { def: 1, min: 1, max: 12 },
      size: { def: 800, min: 400, max: 1600, step: 50 },
      feel: [
        'Firmer dough: a tight crumb that slices thin.',
        'The classic soft sandwich loaf.',
        'Softer and fluffier. The dough will be sticky.',
      ],
      sizeNote: function (w) {
        if (w <= 700) return 'Fits an 8½ × 4½ in (21 × 11 cm) loaf pan.';
        if (w <= 900) return 'Fits a 9 × 5 in (23 × 13 cm) loaf pan.';
        return 'Fits a 13 in (33 cm) Pullman pan.';
      },
      build: function (h, n, w) {
        var F = (n * w) / (1 + h + 0.08 + 0.06 + 0.02 + 0.012);
        var bake = scaleBake([30, 35], 800, w, 5);
        return {
          ingredients: [
            { name: 'Bread flour', g: F },
            { name: 'Milk', note: 'warm, whole or 2%', g: (h / 2) * F },
            { name: 'Water', note: 'warm', g: (h / 2) * F },
            { name: 'Butter', note: 'soft', g: 0.08 * F },
            { name: 'Sugar', g: 0.06 * F },
            { name: 'Salt', g: 0.02 * F },
            { name: 'Instant yeast', g: 0.012 * F },
          ],
          note: 'Hydration counts the milk and water together.',
          stats: {
            rise: ['1–1½ h', 'then 45–60 min in the pan'],
            oven: ['375°F', '190°C'],
            bake: [fmtRange(bake), 'until 190°F (88°C) inside'],
          },
          steps: [
            { name: 'Mix and knead', time: [10, 12], text: 'Mix everything but the butter. Knead it in once the dough comes together, until smooth and stretchy.' },
            { name: 'First rise', time: [60, 90], text: 'Cover and rise until doubled.' },
            {
              name: 'Shape', time: [10, 10],
              text: n === 1
                ? 'Roll into a tight log and set it seam-down in a greased loaf pan.'
                : 'Divide into ' + n + ' pieces of ' + w + ' g, roll each into a tight log and set them seam-down in greased pans.',
            },
            { name: 'Second rise', time: [45, 60], text: 'Cover and rise until the top is about 1 in (2–3 cm) above the rim.' },
            { name: 'Bake', time: bake, hot: true, text: 'Bake at 375°F (190°C) until golden and 190°F (88°C) inside. Brush the top with butter for a soft crust.' },
            { name: 'Cool', time: [60, 60], text: 'Turn it out of the pan and cool on a rack for 1 h.' },
          ],
          extra: [0, 0],
        };
      },
    },
  ];

  var BY_KEY = {};
  BREADS.forEach(function (b) { BY_KEY[b.key] = b; });

  // ── State ──────────────────────────────────────────────────────────────
  // Each bread keeps its own settings, so going from sourdough to bagels
  // and back does not leave a loaf at bagel size.

  var STORE_KEY = 'bread-bot:v1';
  var state = { bread: 'sourdough', settings: {} };
  BREADS.forEach(function (b) {
    state.settings[b.key] = { hydration: b.hydration.def, count: b.count.def, size: b.size.def };
  });

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function cleanSettings(b, s) {
    var out = state.settings[b.key];
    if (!s || typeof s !== 'object') return out;
    var h = Math.round(Number(s.hydration));
    var c = Math.round(Number(s.count));
    var w = Math.round(Number(s.size));
    return {
      hydration: isFinite(h) ? clamp(h, b.hydration.min, b.hydration.max) : out.hydration,
      count: isFinite(c) ? clamp(c, b.count.min, b.count.max) : out.count,
      size: isFinite(w) ? clamp(w, b.size.min, b.size.max) : out.size,
    };
  }

  // The last bake you set up, remembered in this browser only. Storage can
  // be missing (private windows, blocked site data), and that is fine.
  try {
    var kept = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (kept && typeof kept === 'object') {
      if (BY_KEY[kept.bread]) state.bread = kept.bread;
      BREADS.forEach(function (b) {
        if (kept.settings && kept.settings[b.key]) state.settings[b.key] = cleanSettings(b, kept.settings[b.key]);
      });
    }
  } catch (_) {}

  var params = new URLSearchParams(location.search);
  // A link can open a bread directly: /?bread=rye
  if (BY_KEY[params.get('bread')]) state.bread = params.get('bread');

  function remember() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function current() {
    var b = BY_KEY[state.bread];
    return { bread: b, s: state.settings[b.key] };
  }

  // ── Talking to the server ──────────────────────────────────────────────

  var token = params.get('token');
  var demo = params.get('demo') === '1';

  function api(path, options) {
    options = options || {};
    var headers = { Accept: 'application/json' };
    if (token) headers['x-usernode-token'] = token;
    if (options.body) headers['Content-Type'] = 'application/json';
    return fetch(path, { method: options.method || 'GET', headers: headers, body: options.body });
  }

  function readJson(res) { return res.json().catch(function () { return {}; }); }

  // saved.status: 'loading' | 'ready' | 'error'
  var saved = { status: 'loading', list: [] };
  var busy = false;
  var saveMessage = '';

  function matchSaved() {
    var c = current();
    var hit = null;
    saved.list.forEach(function (r) {
      if (hit && !hit.demo) return;
      if (r.bread === c.bread.key && r.hydration === c.s.hydration && r.loaves === c.s.count && r.loafGrams === c.s.size) {
        if (!hit || hit.demo) hit = r;
      }
    });
    return hit;
  }

  function loadSaved() {
    saved.status = 'loading';
    renderSaved();
    renderSaveArea();
    return api('/api/recipes' + (demo ? '?demo=1' : ''))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (body) {
        saved.list = Array.isArray(body.recipes) ? body.recipes : [];
        saved.status = 'ready';
      })
      .catch(function () {
        saved.status = 'error';
      })
      .then(function () {
        renderSaved();
        renderSaveArea();
      });
  }

  function saveRecipe() {
    if (busy) return;
    var c = current();
    busy = true;
    saveMessage = '';
    renderSaveArea();
    api('/api/recipes', {
      method: 'POST',
      body: JSON.stringify({
        name: c.bread.name,
        bread: c.bread.key,
        hydration: c.s.hydration,
        loaves: c.s.count,
        loafGrams: c.s.size,
      }),
    })
      .then(function (res) {
        return readJson(res).then(function (body) {
          if (res.ok && body.recipe) {
            if (saved.status === 'ready') {
              if (!saved.list.some(function (r) { return r.id === body.recipe.id; })) saved.list.unshift(body.recipe);
            } else {
              loadSaved();
            }
            return;
          }
          // A guest is asked to make an account by the platform itself.
          if (res.status === 401 && body.error === 'account_required') return;
          if (res.status === 401) saveMessage = 'Your sign-in has expired. Reopen Bread Bot from Homeroom to save.';
          else saveMessage = body.error && res.status < 500 ? body.error : 'Couldn’t save the recipe. Try again.';
        });
      })
      .catch(function () {
        saveMessage = 'Couldn’t save the recipe. Check your connection and try again.';
      })
      .then(function () {
        busy = false;
        renderSaved();
        renderSaveArea();
      });
  }

  function removeRecipe(recipe) {
    if (busy || !recipe || recipe.demo) return;
    busy = true;
    saveMessage = '';
    renderSaveArea();
    api('/api/recipes/' + encodeURIComponent(recipe.id), { method: 'DELETE' })
      .then(function (res) {
        if (res.ok || res.status === 404) {
          saved.list = saved.list.filter(function (r) { return r.id !== recipe.id; });
          return;
        }
        if (res.status === 401) return readJson(res).then(function (body) {
          if (body.error !== 'account_required') saveMessage = 'Your sign-in has expired. Reopen Bread Bot from Homeroom.';
        });
        saveMessage = 'Couldn’t remove the recipe. Try again.';
      })
      .catch(function () {
        saveMessage = 'Couldn’t remove the recipe. Check your connection and try again.';
      })
      .then(function () {
        busy = false;
        renderSaved();
        renderSaveArea();
      });
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function renderPicker() {
    // Three across on a phone, with the last two centred under them; all
    // five in a row on a wide screen.
    var place = ['col-span-2 lg:col-span-1', 'col-span-2 lg:col-span-1', 'col-span-2 lg:col-span-1',
      'col-span-2 col-start-2 lg:col-span-1 lg:col-start-auto', 'col-span-2 lg:col-span-1'];
    $('bread-picker').innerHTML = BREADS.map(function (b, i) {
      return '<label class="tile ' + place[i] + '">' +
        '<input type="radio" name="bread" class="tile-input" value="' + b.key + '"' + (b.key === state.bread ? ' checked' : '') + '>' +
        '<span class="tile-art">' + art(b.key, 'h-10 w-10') + '</span>' +
        '<span class="tile-name">' + esc(b.name) + '</span>' +
        '</label>';
    }).join('');
  }

  function renderControls() {
    var c = current();
    var b = c.bread;
    var s = c.s;
    var hyd = $('hydration');
    hyd.min = b.hydration.min;
    hyd.max = b.hydration.max;
    hyd.value = s.hydration;
    $('hydration-out').textContent = s.hydration + '%';
    $('hydration-min').textContent = b.hydration.min + '%';
    $('hydration-max').textContent = b.hydration.max + '%';
    $('hydration-typical').textContent = 'Typical ' + b.hydration.lo + '–' + b.hydration.hi + '%';
    var feel = s.hydration < b.hydration.lo ? b.feel[0] : s.hydration > b.hydration.hi ? b.feel[2] : b.feel[1];
    $('hydration-hint').textContent = s.hydration + ' g of water for every 100 g of flour. ' + feel;

    var count = $('count');
    count.min = b.count.min;
    count.max = b.count.max;
    if (document.activeElement !== count) count.value = s.count;
    $('count-label').textContent = b.countLabel;
    var unit = b.countLabel === 'Bagels' ? 'bagel' : 'loaf';
    $('count-minus').setAttribute('aria-label', 'One fewer ' + unit);
    $('count-plus').setAttribute('aria-label', 'One more ' + unit);
    $('count-minus').disabled = s.count <= b.count.min;
    $('count-plus').disabled = s.count >= b.count.max;

    var size = $('size');
    size.min = b.size.min;
    size.max = b.size.max;
    size.step = b.size.step;
    if (document.activeElement !== size) size.value = s.size;
    $('size-label').textContent = b.sizeLabel;
    $('size-minus').setAttribute('aria-label', 'Make each ' + unit + ' ' + b.size.step + ' g smaller');
    $('size-plus').setAttribute('aria-label', 'Make each ' + unit + ' ' + b.size.step + ' g bigger');
    $('size-minus').disabled = s.size <= b.size.min;
    $('size-plus').disabled = s.size >= b.size.max;
    $('size-note').textContent = b.sizeNote(s.size);

    $('bread-blurb').textContent = b.blurb;
  }

  function renderRecipe() {
    var c = current();
    var b = c.bread;
    var s = c.s;
    var r = b.build(s.hydration / 100, s.count, s.size);

    var total = s.count * s.size;
    var rows = roundRows(r.ingredients, total);

    $('recipe-art').innerHTML = art(b.key, 'h-10 w-10');
    $('recipe-title').textContent = s.count + ' ' + plural(s.count, b.one, b.many);
    $('recipe-summary').textContent = whole.format(s.size) + ' g each · ' + whole.format(s.hydration) + '% hydration';

    var stats = [
      { icon: 'rise', label: 'Rise', value: r.stats.rise[0], sub: r.stats.rise[1] },
      { icon: 'oven', label: 'Oven', value: r.stats.oven[0], sub: r.stats.oven[1] },
      { icon: 'bake', label: 'Bake', value: r.stats.bake[0], sub: r.stats.bake[1] },
    ];
    $('stats').innerHTML = stats.map(function (t) {
      return '<div class="stat">' +
        '<p class="flex items-center gap-1.5 text-small text-muted">' + icon(t.icon, 'h-4 w-4 shrink-0 text-accent') + esc(t.label) + '</p>' +
        '<p class="text-body font-semibold tabular-nums sm:text-heading">' + esc(t.value) + '</p>' +
        '<p class="text-small text-muted">' + esc(t.sub) + '</p>' +
        '</div>';
    }).join('');

    $('ingredients').innerHTML = rows.map(function (i) {
      return '<li class="list-row justify-between">' +
        '<div class="min-w-0">' +
        '<p class="text-body font-medium">' + esc(i.name) + '</p>' +
        (i.note ? '<p class="text-small text-muted">' + esc(i.note) + '</p>' : '') +
        '</div>' +
        '<p class="shrink-0 text-body font-semibold tabular-nums">' + fmtGrams(i.g) + '</p>' +
        '</li>';
    }).join('') +
      '<li class="list-row justify-between bg-raised">' +
      '<p class="text-body font-semibold">Total dough</p>' +
      '<p class="shrink-0 text-body font-semibold tabular-nums">' + fmtGrams(total) + '</p>' +
      '</li>';
    $('ingredients-note').textContent = r.note;

    var lo = r.extra[0];
    var hi = r.extra[1];
    $('steps').innerHTML = r.steps.map(function (step, n) {
      lo += step.time[0];
      hi += step.time[1];
      return '<li class="list-row items-start">' +
        '<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ' +
        (step.hot ? 'bg-accent text-on-accent' : 'bg-raised text-muted') + ' text-small font-semibold">' + (n + 1) + '</span>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="flex flex-wrap items-baseline justify-between gap-x-3">' +
        '<p class="text-body font-medium">' + esc(step.name) + '</p>' +
        '<p class="text-small font-semibold tabular-nums text-fg">' + esc(fmtRange(step.time)) + (step.each ? ' each' : '') + '</p>' +
        '</div>' +
        '<p class="text-small text-muted">' + esc(step.text) + '</p>' +
        '</div>' +
        '</li>';
    }).join('');
    $('steps-note').textContent = 'Start to finish: ' + fmtTotal(lo, hi) + '. ' + KITCHEN_NOTE;
  }

  function renderSaved() {
    $('saved-loading').hidden = saved.status !== 'loading';
    $('saved-loading-text').textContent = saved.status === 'loading' ? 'Loading your saved recipes' : '';
    $('saved-error').hidden = saved.status !== 'error';
    var ready = saved.status === 'ready';
    $('saved-empty').hidden = !(ready && saved.list.length === 0);
    var list = $('saved-list');
    list.hidden = !(ready && saved.list.length > 0);
    if (!ready) return;
    var active = matchSaved();
    list.innerHTML = saved.list.map(function (r) {
      var b = BY_KEY[r.bread];
      if (!b) return '';
      var on = active && active.id === r.id;
      return '<button type="button" class="chip" data-id="' + esc(r.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-accent">' + art(b.key, 'h-8 w-8') + '</span>' +
        '<span class="flex min-w-0 flex-col">' +
        '<span class="max-w-[15rem] truncate text-small font-semibold text-fg lg:max-w-none">' + esc(r.name) + '</span>' +
        '<span class="text-small text-muted">' + r.loaves + ' × ' + whole.format(r.loafGrams) + ' g · ' + r.hydration + '%</span>' +
        '</span>' +
        '</button>';
    }).join('');
  }

  function renderSaveArea() {
    var area = $('save-area');
    var hit = saved.status === 'ready' ? matchSaved() : null;
    if (hit) {
      area.innerHTML =
        '<p class="inline-flex items-center gap-2 text-small font-medium text-fg">' + icon('check', 'h-5 w-5 text-accent') +
        (hit.demo ? 'Staging demo recipe' : 'Saved') + '</p>' +
        (hit.demo ? '' : '<button type="button" id="remove-btn" class="btn-secondary"' + (busy ? ' disabled' : '') + '>' +
          (busy ? 'Removing…' : 'Remove') + '</button>');
    } else {
      area.innerHTML = '<button type="button" id="save-btn" class="btn-primary w-full sm:w-auto"' + (busy ? ' disabled' : '') + '>' +
        icon('save', 'h-5 w-5') + (busy ? 'Saving…' : 'Save recipe') + '</button>';
    }
    var msg = $('save-msg');
    msg.textContent = saveMessage;
    msg.hidden = !saveMessage;
  }

  function renderAll() {
    renderControls();
    renderRecipe();
    renderSaved();
    renderSaveArea();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────

  function update(patch) {
    var c = current();
    var b = c.bread;
    var s = state.settings[b.key];
    if ('hydration' in patch) s.hydration = clamp(patch.hydration, b.hydration.min, b.hydration.max);
    if ('count' in patch) s.count = clamp(patch.count, b.count.min, b.count.max);
    if ('size' in patch) s.size = clamp(patch.size, b.size.min, b.size.max);
    saveMessage = '';
    remember();
    renderControls();
    renderRecipe();
    renderSaved();
    renderSaveArea();
  }

  $('bread-picker').addEventListener('change', function (e) {
    if (!e.target || e.target.name !== 'bread' || !BY_KEY[e.target.value]) return;
    state.bread = e.target.value;
    update({});
  });

  $('hydration').addEventListener('input', function (e) {
    update({ hydration: Math.round(Number(e.target.value)) });
  });

  // Typed numbers apply as you type when they make sense, and snap into
  // range when you leave the field.
  function wireNumber(id, field) {
    var el = $(id);
    el.addEventListener('input', function () {
      var b = current().bread;
      var v = Math.round(Number(el.value));
      if (el.value !== '' && isFinite(v) && v >= b[field].min && v <= b[field].max) {
        var patch = {};
        patch[field === 'count' ? 'count' : 'size'] = v;
        update(patch);
      }
    });
    el.addEventListener('change', function () {
      var b = current().bread;
      var s = current().s;
      var v = Math.round(Number(el.value));
      var key = field === 'count' ? 'count' : 'size';
      var patch = {};
      patch[key] = el.value === '' || !isFinite(v) ? s[key] : clamp(v, b[field].min, b[field].max);
      el.value = patch[key];
      update(patch);
    });
  }
  wireNumber('count', 'count');
  wireNumber('size', 'size');

  function step(field, dir) {
    var c = current();
    var b = c.bread;
    if (field === 'count') return update({ count: c.s.count + dir });
    // Sizes move along the bread's own grid (50 g for loaves, 5 g for bagels).
    var st = b.size.step;
    var next = dir > 0 ? Math.floor(c.s.size / st) * st + st : Math.ceil(c.s.size / st) * st - st;
    update({ size: next });
  }
  $('count-minus').addEventListener('click', function () { step('count', -1); });
  $('count-plus').addEventListener('click', function () { step('count', 1); });
  $('size-minus').addEventListener('click', function () { step('size', -1); });
  $('size-plus').addEventListener('click', function () { step('size', 1); });

  $('saved-retry').addEventListener('click', function () { loadSaved(); });

  $('saved-list').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var id = chip.getAttribute('data-id');
    var r = saved.list.filter(function (x) { return String(x.id) === id; })[0];
    if (!r || !BY_KEY[r.bread]) return;
    var b = BY_KEY[r.bread];
    state.bread = b.key;
    state.settings[b.key] = cleanSettings(b, { hydration: r.hydration, count: r.loaves, size: r.loafGrams });
    var radio = document.querySelector('input[name="bread"][value="' + b.key + '"]');
    if (radio) radio.checked = true;
    update({});
  });

  $('save-area').addEventListener('click', function (e) {
    if (e.target.closest('#save-btn')) saveRecipe();
    else if (e.target.closest('#remove-btn')) removeRecipe(matchSaved());
  });

  renderPicker();
  renderAll();
  loadSaved();
})();
