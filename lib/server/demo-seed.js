'use strict';
// Staging demo data: a demo reader's library of five invented feeds on
// reserved `.example` domains, so a staging preview has posts to show.
//
// It belongs to a fake identity (DEMO_READER), never to whoever opens the
// preview. A viewer sees it only with `?demo=1` on a staging container,
// layered over their own feeds; without it the app answers exactly as
// production does. Posts are dated relative to the first boot so "9 min
// ago" stays plausible. The feeds are never fetched: refreshing only ever
// covers the viewer's own subscriptions.

const DEMO_READER = 'staging-demo-reader';

const FEEDS = [
  {
    key: 'nightsky',
    url: 'https://nightsky-notes.example/feed.xml',
    title: 'Night Sky Notes',
    siteUrl: 'https://nightsky-notes.example/',
    description: 'What is up after dark this week, for people with binoculars and patience.',
  },
  {
    key: 'riverside',
    url: 'https://riverside-news.example/rss',
    title: 'Riverside Neighbourhood News',
    siteUrl: 'https://riverside-news.example/',
    description: 'Volunteer-written news from the Riverside area.',
  },
  {
    key: 'plaintext',
    url: 'https://plaintext-web.example/atom.xml',
    title: 'The Plain Text Web',
    siteUrl: 'https://plaintext-web.example/',
    description: 'Essays on small, fast and durable websites.',
  },
  {
    key: 'kitchen',
    url: 'https://smallbatch-kitchen.example/feed/',
    title: 'Small Batch Kitchen',
    siteUrl: 'https://smallbatch-kitchen.example/',
    description: 'Weeknight cooking for two, mostly vegetables.',
  },
  {
    key: 'allotment',
    url: 'https://allotment-diary.example/feed/',
    title: 'Allotment Diary',
    siteUrl: 'https://allotment-diary.example/',
    description: 'Notes from plot 14: what grew, what did not, and what the slugs got.',
  },
];

// minutesAgo is relative to the moment the seed first ran.
const POSTS = [
  {
    feed: 'nightsky', minutesAgo: 9, author: 'Mei Lin', slug: 'saturn-rings-tilting-back',
    title: 'Saturn\'s rings are tilting back into view: where to look tonight',
    html: `<p>For most of last year Saturn looked oddly bare. Its rings were edge-on to us, a thin line you could only just make out in a small telescope. This autumn they are opening up again, and even a modest pair of binoculars shows that the planet is not quite round.</p>
<h3>When and where</h3>
<ul><li>Look south-east about an hour after sunset. Saturn is the steady, creamy-yellow point that does not twinkle.</li><li>It is highest, and sharpest, a little before midnight.</li><li>The Moon stays out of the way until Thursday, so the next few evenings are the best of the month.</li></ul>
<blockquote><p>Rest your elbows on a wall or a car roof. Steady binoculars show more than a bigger pair held by shaking hands.</p></blockquote>
<p>With a small telescope at around 50x you should see the rings as a narrow ellipse, and on a calm night the brightest moon, Titan, sitting a few ring-widths away like a faint star. Sketch what you see; next month the rings will be noticeably wider.</p>`,
  },
  {
    feed: 'riverside', minutesAgo: 34, author: 'Priya Natarajan', slug: 'library-sunday-hours',
    title: 'Library adds Sunday opening hours from November',
    html: `<p>Riverside Library will open on Sundays from 11am to 4pm starting the first weekend of November, after a trial over the summer brought in more than 2,000 visits.</p>
<p>The reading room, the children's corner and the public computers will all be available. The study rooms upstairs stay closed on Sundays for now.</p>
<p>The library is also looking for two volunteers to help run the Sunday homework club. No teaching experience is needed, just patience and a free afternoon a fortnight.</p>`,
  },
  {
    feed: 'plaintext', minutesAgo: 80, author: 'Jonas Berg', slug: 'back-to-rss',
    title: 'Why I went back to reading with RSS',
    html: `<p>For years I read the web through other people's choices: whatever a timeline decided to show me that morning. Last spring I dug out my old list of feeds and started again.</p>
<p>The difference is not nostalgia. A feed reader shows me everything from the sites I chose, in the order it was written, and then it stops. There is a bottom to the list. When I reach it, I am done.</p>
<h3>What changed</h3>
<ul><li>I follow about forty sites, most of which post once a month or less.</li><li>I read in the morning, with coffee, and I do not check again until the next day.</li><li>When something is worth more than a skim, I open the full article and read it properly.</li></ul>
<p>The best part is how quiet it is. Nobody is ranking what I see, and nothing is trying to keep me there.</p>`,
  },
  {
    feed: 'kitchen', minutesAgo: 165, author: 'Tomás Reyes', slug: 'forgiving-weeknight-dal',
    title: 'A weeknight dal that forgives whatever lentils you have',
    html: `<p>Red lentils are the classic choice because they collapse into a soft, golden porridge in twenty minutes. But yellow split peas, green lentils and even a mix of the ends of three bags all work. They just take a little longer.</p>
<h3>The method</h3>
<ol><li>Rinse a mug of lentils and simmer them in three mugs of water with a teaspoon of turmeric.</li><li>While they cook, fry a sliced onion slowly in oil until deep brown.</li><li>Add garlic, ginger, cumin seeds and a pinch of chilli for the last minute.</li><li>Tip the onions into the lentils, season well and finish with lemon.</li></ol>
<p>It keeps for four days in the fridge and tastes better on the second.</p>`,
  },
  {
    feed: 'allotment', minutesAgo: 240, author: 'Ruth Okafor', slug: 'saving-tomato-seeds',
    title: 'Saving tomato seeds before the first frost',
    html: `<p>The forecast says frost by the weekend, so today was the day to pick the last of the tomatoes and save seed from the varieties worth growing again.</p>
<p>Pick the best fruit from the healthiest plant, not the biggest from the plant that struggled. Scoop the seeds and their jelly into a jar with a splash of water and leave it on the windowsill for three days. It will smell, and grow a little mould on top. That is the point: the fermenting breaks down the coating that stops the seeds sprouting.</p>
<p>Rinse, spread the seeds on a plate and let them dry for a week before they go into labelled envelopes.</p>`,
  },
  {
    feed: 'riverside', minutesAgo: 360, author: 'Dan Whitfield', slug: 'footbridge-reopens',
    title: 'Footbridge repairs finish two weeks early',
    html: `<p>The footbridge between Mill Lane and the park reopened on Monday, two weeks ahead of schedule. The new deck has a non-slip surface and the handrails have been raised to meet current guidance.</p>
<p>The council thanked residents for their patience during the detour, and said the dry weather in September helped the work along.</p>`,
  },
  {
    feed: 'plaintext', minutesAgo: 540, author: 'Jonas Berg', slug: 'under-a-second-on-a-train',
    title: 'A website that loads in under a second, on a train',
    html: `<p>I test every page I make on the slowest connection I use regularly: the 7:40 train, somewhere between two stations, with one bar of signal.</p>
<p>Three habits get a page under a second there. Send the words first, before any script. Keep the stylesheet small enough to inline. Make images optional, so the page still makes sense while they load or if they never do.</p>
<p>None of this is new. It is just easy to forget when you build on fast office wifi.</p>`,
  },
  {
    feed: 'nightsky', minutesAgo: 1200, author: 'Mei Lin', slug: 'star-trails-with-a-phone',
    title: 'Star trails with a phone: a beginner\'s setup',
    html: `<p>You do not need a camera with interchangeable lenses to photograph star trails. A phone on a cheap tripod, an app that takes a picture every thirty seconds, and a dark place to leave it for an hour are enough.</p>
<p>Point the phone at the pole star if you can find it, so the trails curve in neat circles around it. Turn off the flash and the screen, and start the sequence. Back home, a free stacking app layers the frames into one image.</p>`,
  },
  {
    feed: 'kitchen', minutesAgo: 1620, author: 'Tomás Reyes', slug: 'colder-longer-rise',
    title: 'Why your bread wants a longer, colder rise',
    html: `<p>If your loaves taste of not very much, the fix is usually time rather than a new recipe. Shape the dough in the evening, cover it and leave it in the fridge overnight.</p>
<p>The cold slows the yeast down while the flavour keeps developing, and a chilled loaf is also much easier to score neatly before it goes into the oven.</p>`,
  },
  {
    feed: 'allotment', minutesAgo: 1930, author: 'Ruth Okafor', slug: 'leeks-that-survived-august',
    title: 'The leeks that survived August',
    html: `<p>Half the leeks bolted in the heat. The other half, planted a fortnight later in the shadier bed by the shed, look better than any I have grown.</p>
<p>Lesson noted for next year: later, deeper, and out of the afternoon sun.</p>`,
  },
  {
    feed: 'riverside', minutesAgo: 2900, author: 'Grace Mensah', slug: 'orchard-harvest-day',
    title: 'Community orchard needs hands for harvest day',
    html: `<p>The community orchard on Station Road has its best apple crop in five years and needs volunteers for harvest day on Saturday 17th, from 10am.</p>
<p>Bring gloves if you have them. Ladders, crates and tea are provided, and everyone who helps takes home a bag of apples.</p>`,
  },
  {
    feed: 'kitchen', minutesAgo: 4400, author: 'Tomás Reyes', slug: 'five-pantry-sauces',
    title: 'Five pantry sauces worth making on Sunday',
    html: `<p>An hour on Sunday afternoon buys a week of quick dinners. These five keep in jars in the fridge and turn plain rice, noodles or roast vegetables into a meal.</p>
<ul><li>Green herb sauce with whatever soft herbs are wilting.</li><li>Peanut and lime.</li><li>Roast tomato and garlic.</li><li>Tahini with lemon and a little honey.</li><li>Chilli crisp, if you like heat.</li></ul>`,
  },
  {
    feed: 'allotment', minutesAgo: 4700, author: 'Ruth Okafor', slug: 'cold-frame-from-old-windows',
    title: 'A cold frame from two old windows',
    html: `<p>A neighbour was throwing out two sash windows, which became the lid of a cold frame by the end of the afternoon. The base is four scaffold boards screwed into a box, a little taller at the back so the rain runs off.</p>
<p>It already holds the winter lettuce and a tray of broad beans waiting for spring.</p>`,
  },
  {
    feed: 'nightsky', minutesAgo: 5800, author: 'Mei Lin', slug: 'autumn-sky-map',
    title: 'A beginner\'s map of the autumn sky',
    html: `<p>Autumn evenings are a good time to learn the sky, because the great square of Pegasus gives you a frame to hang everything else on.</p>
<p>Find the square high in the south, follow the line of stars off its top-left corner, and you arrive at the faint smudge of the Andromeda galaxy: the most distant thing most of us will ever see with our own eyes.</p>`,
  },
  {
    feed: 'riverside', minutesAgo: 7300, author: 'Dan Whitfield', slug: 'bins-move-to-thursdays',
    title: 'Bin collection moves to Thursdays from next month',
    html: `<p>Household and recycling collections in Riverside will move from Tuesdays to Thursdays from the first week of next month, as the council reorganises its rounds.</p>
<p>Garden waste collections are not affected. A reminder card will come through every door the week before the change.</p>`,
  },
];

/**
 * Insert the demo library if it is not there yet. Idempotent: every row has
 * a fixed natural key and is inserted with ON CONFLICT DO NOTHING.
 */
async function seedDemoLibrary(pool, { sanitizeArticleHtml, htmlToText, excerpt }) {
  const ids = {};
  for (const f of FEEDS) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await pool.query(
      `INSERT INTO feeds (url, title, site_url, description, last_fetched_at, last_ok_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '6 minutes', NOW() - interval '6 minutes')
       ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url
       RETURNING id`,
      [f.url, f.title, f.siteUrl, f.description],
    );
    ids[f.key] = rows[0].id;
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO subscriptions (user_id, feed_id, created_at)
       VALUES ($1, $2, NOW() - interval '30 days') ON CONFLICT DO NOTHING`,
      [DEMO_READER, ids[f.key]],
    );
  }
  for (const p of POSTS) {
    const feed = FEEDS.find((f) => f.key === p.feed);
    const url = `${feed.siteUrl}${p.slug}/`;
    const contentHtml = sanitizeArticleHtml(p.html, url);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO posts (feed_id, guid, title, url, author, summary, content_html, published_at, sort_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               NOW() - make_interval(mins => $8), NOW() - make_interval(mins => $8), NOW() - make_interval(mins => $8))
       ON CONFLICT (feed_id, guid) DO NOTHING`,
      [ids[p.feed], url, p.title, url, p.author, excerpt(htmlToText(p.html), 300), contentHtml, p.minutesAgo],
    );
  }
}

module.exports = { DEMO_READER, seedDemoLibrary };
