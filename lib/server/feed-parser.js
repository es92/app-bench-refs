'use strict';
// Reading RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed into one shape, and
// finding a site's feed from its home page.
//
//   { title, siteUrl, description, items: [{ guid, title, url, author,
//     contentHtml, summary, publishedAt }] }
//
// contentHtml is already sanitized (lib/server/sanitize.js) and summary is
// plain text, so nothing downstream handles a feed's raw markup.

const { parseDocument, DomUtils } = require('htmlparser2');
const { sanitizeArticleHtml, htmlToText, excerpt, safeUrl } = require('./sanitize');

const MAX_ITEMS = 100;

const lower = (s) => String(s || '').toLowerCase();
const elements = (nodes) => (nodes || []).filter((n) => n.type === 'tag');

function child(el, ...names) {
  if (!el) return null;
  const wanted = names.map(lower);
  return elements(el.children).find((c) => wanted.includes(lower(c.name))) || null;
}
function childrenNamed(el, name) {
  return el ? elements(el.children).filter((c) => lower(c.name) === name) : [];
}
function text(el) {
  return el ? DomUtils.textContent(el).trim() : '';
}
function date(value) {
  if (!value) return null;
  const d = new Date(String(value).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
function cleanTitle(value) {
  return htmlToText(value).slice(0, 500);
}

// Atom text constructs: type="xhtml" holds markup, the others escaped text.
function atomContent(el) {
  if (!el) return '';
  if (lower(el.attribs && el.attribs.type) === 'xhtml') {
    const div = child(el, 'div', 'xhtml:div');
    return DomUtils.getInnerHTML(div || el, { xmlMode: false, decodeEntities: false });
  }
  return text(el);
}

function atomLink(el, base) {
  const links = childrenNamed(el, 'link').concat(childrenNamed(el, 'atom:link'));
  const pick = links.find((l) => !l.attribs.rel || l.attribs.rel === 'alternate') || null;
  return pick ? safeUrl(pick.attribs.href, base) : null;
}

// RSS <author> is "email (Name)"; keep the name, never a bare address.
function cleanAuthor(value) {
  let name = htmlToText(value || '').trim();
  const paren = /\(([^)]+)\)\s*$/.exec(name);
  if (paren) name = paren[1].trim();
  if (!name || /^\S+@\S+$/.test(name)) return null;
  return name.slice(0, 200);
}

function finishItem({ guid, title, url, author, html, plain, publishedAt }, base) {
  const contentHtml = sanitizeArticleHtml(html || plain || '', url || base);
  const words = htmlToText(html || plain || '');
  const cleanTitleText = cleanTitle(title);
  return {
    guid: String(guid || url || `${cleanTitleText}|${publishedAt ? publishedAt.toISOString() : ''}`).slice(0, 1000),
    title: cleanTitleText || excerpt(words, 90) || 'Untitled post',
    url,
    author: cleanAuthor(author),
    contentHtml,
    summary: excerpt(words, 300),
    publishedAt,
  };
}

function parseRss(root, base) {
  const channel = child(root, 'channel') || root;
  const siteUrl = safeUrl(text(child(channel, 'link')), base) || atomLink(channel, base);
  const itemEls = childrenNamed(channel, 'item').concat(channel === root ? [] : childrenNamed(root, 'item'));
  const items = itemEls.slice(0, MAX_ITEMS).map((item) => {
    const guidEl = child(item, 'guid');
    const guid = text(guidEl);
    let url = safeUrl(text(child(item, 'link')), base) || atomLink(item, base);
    if (!url && guid && lower(guidEl.attribs && guidEl.attribs.ispermalink) !== 'false') url = safeUrl(guid, base);
    const encoded = text(child(item, 'content:encoded'));
    const description = text(child(item, 'description'));
    return finishItem({
      guid: guid || url,
      title: text(child(item, 'title')),
      url,
      author: text(child(item, 'dc:creator')) || text(child(item, 'author')),
      html: encoded || description,
      publishedAt: date(text(child(item, 'pubdate')) || text(child(item, 'dc:date')) || text(child(item, 'published'))),
    }, url || siteUrl || base);
  });
  return {
    title: cleanTitle(text(child(channel, 'title'))),
    siteUrl,
    description: excerpt(htmlToText(text(child(channel, 'description'))), 300),
    items,
  };
}

function parseAtom(root, base) {
  const siteUrl = atomLink(root, base);
  const items = childrenNamed(root, 'entry').slice(0, MAX_ITEMS).map((entry) => {
    const url = atomLink(entry, base);
    const authorEl = child(entry, 'author') || child(root, 'author');
    return finishItem({
      guid: text(child(entry, 'id')) || url,
      title: atomContent(child(entry, 'title')),
      url,
      author: text(child(authorEl, 'name')),
      html: atomContent(child(entry, 'content')) || atomContent(child(entry, 'summary')),
      publishedAt: date(text(child(entry, 'published')) || text(child(entry, 'updated'))),
    }, url || siteUrl || base);
  });
  return {
    title: cleanTitle(atomContent(child(root, 'title'))),
    siteUrl,
    description: excerpt(htmlToText(atomContent(child(root, 'subtitle'))), 300),
    items,
  };
}

function parseJsonFeed(raw, base) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object' || !/jsonfeed\.org/.test(String(data.version || '')) || !Array.isArray(data.items)) return null;
  const siteUrl = safeUrl(data.home_page_url, base);
  const items = data.items.slice(0, MAX_ITEMS).map((it) => {
    const url = safeUrl(it.url || it.external_url, base);
    const author = (Array.isArray(it.authors) && it.authors[0] && it.authors[0].name) || (it.author && it.author.name) || '';
    return finishItem({
      guid: it.id != null ? String(it.id) : url,
      title: String(it.title || ''),
      url,
      author,
      html: typeof it.content_html === 'string' ? it.content_html : '',
      plain: typeof it.content_text === 'string' ? it.content_text : (typeof it.summary === 'string' ? it.summary : ''),
      publishedAt: date(it.date_published || it.date_modified),
    }, url || siteUrl || base);
  });
  return {
    title: cleanTitle(String(data.title || '')),
    siteUrl,
    description: excerpt(String(data.description || ''), 300),
    items,
  };
}

/** The feed in `raw`, or null when it isn't one. */
function parseFeed(raw, base) {
  const body = String(raw || '').trim();
  if (!body) return null;
  if (body.startsWith('{')) return parseJsonFeed(body, base);
  const doc = parseDocument(body, { xmlMode: true, decodeEntities: true });
  const root = DomUtils.findOne((el) => ['rss', 'feed', 'rdf:rdf', 'rdf'].includes(lower(el.name)), doc.children, true);
  if (!root) return null;
  const parsed = lower(root.name) === 'feed' ? parseAtom(root, base) : parseRss(root, base);
  if (!parsed.title) {
    try { parsed.title = new URL(parsed.siteUrl || base).hostname.replace(/^www\./, ''); } catch { parsed.title = 'Untitled feed'; }
  }
  return parsed;
}

/** Feed addresses a web page advertises with <link rel="alternate">. */
function discoverFeedLinks(html, base) {
  const doc = parseDocument(String(html || ''), { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const types = ['application/rss+xml', 'application/atom+xml', 'application/feed+json'];
  const links = DomUtils.findAll((el) => el.name === 'link'
    && /\balternate\b/i.test(el.attribs.rel || '')
    && types.includes(lower(el.attribs.type))
    && !!el.attribs.href, doc.children);
  const seen = new Set();
  const out = [];
  for (const l of links) {
    const url = safeUrl(l.attribs.href, base);
    if (url && !seen.has(url) && !/comments/i.test(l.attribs.title || '')) { seen.add(url); out.push(url); }
  }
  return out.slice(0, 3);
}

module.exports = { parseFeed, discoverFeedLinks };
