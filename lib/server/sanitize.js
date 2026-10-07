'use strict';
// Turning the HTML a feed hands us into something safe to show.
//
// Feed content is written by strangers, so it is never passed through: it is
// parsed, and only an allowlist of structure is written back out (paragraphs,
// headings, lists, quotes, code, emphasis and plain http(s) links). Every text
// node is escaped on the way out and no attribute survives except a link's
// validated href, so nothing a feed sends can run script, load a remote
// image or restyle the page. Images, video and embeds are dropped: the
// preview is the article's words, and "Open full article" is one tap away.

const { parseDocument } = require('htmlparser2');

const MAX_HTML = 60000;

// Removed with everything inside them.
const DROP = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math',
  'form', 'button', 'input', 'select', 'textarea', 'option', 'video', 'audio', 'canvas',
  'head', 'title', 'meta', 'link', 'base', 'picture', 'source', 'track', 'img', 'map',
  'area', 'frame', 'frameset', 'dialog', 'nav', 'aside', 'figcaption',
]);
// Inline wrappers whose children are kept but whose tag is not.
const UNWRAP_INLINE = new Set([
  'span', 'font', 'u', 'mark', 'small', 'big', 'abbr', 'acronym', 'time', 'cite', 'q', 's',
  'strike', 'del', 'ins', 'label', 'dfn', 'kbd', 'samp', 'var', 'bdi', 'bdo', 'wbr', 'nobr',
]);
const INLINE_RENAME = { b: 'strong', strong: 'strong', i: 'em', em: 'em', code: 'code', tt: 'code', sub: 'sub', sup: 'sup' };

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** An absolute http(s) URL for `href` relative to `base`, or null. */
function safeUrl(href, base) {
  if (!href) return null;
  try {
    const url = base ? new URL(String(href).trim(), base) : new URL(String(href).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hasVisibleText(html) {
  return /\S/.test(String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ''));
}

function textOf(node) {
  if (node.type === 'text') return node.data;
  if (node.type === 'cdata') return (node.children || []).map(textOf).join('');
  if (node.children && !DROP.has(String(node.name || '').toLowerCase())) return node.children.map(textOf).join('');
  return '';
}

function inline(nodes, ctx) {
  let out = '';
  for (const node of nodes || []) {
    if (node.type === 'text') { out += escapeText(node.data.replace(/\s+/g, ' ')); continue; }
    if (node.type === 'cdata') { out += inline(node.children, ctx); continue; }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
    const name = String(node.name).toLowerCase();
    if (DROP.has(name)) continue;
    if (name === 'br') { out += '<br>'; continue; }
    if (name === 'a') {
      const href = safeUrl(node.attribs && node.attribs.href, ctx.base);
      const inner = inline(node.children, ctx);
      if (!hasVisibleText(inner)) continue;
      out += href
        ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
        : inner;
      continue;
    }
    const renamed = INLINE_RENAME[name];
    if (renamed) {
      const inner = inline(node.children, ctx);
      if (hasVisibleText(inner)) out += `<${renamed}>${inner}</${renamed}>`;
      continue;
    }
    // Anything else met inside a line of text (a stray div in a link, an
    // unknown tag) contributes its words and nothing else.
    out += ` ${inline(node.children, ctx)} `;
  }
  return out.replace(/ {2,}/g, ' ');
}

function blocks(nodes, ctx) {
  const parts = [];
  let run = '';
  let lastBreak = false;
  const flush = () => {
    const trimmed = run.replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
    if (hasVisibleText(trimmed)) parts.push(`<p>${trimmed}</p>`);
    run = '';
    lastBreak = false;
  };
  for (const node of nodes || []) {
    if (node.type === 'text') {
      run += escapeText(node.data.replace(/\s+/g, ' '));
      if (/\S/.test(node.data)) lastBreak = false;
      continue;
    }
    if (node.type === 'cdata') { parts.push(...[flush(), blocks(node.children, ctx)].filter(Boolean)); continue; }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
    const name = String(node.name).toLowerCase();
    if (DROP.has(name)) continue;
    if (name === 'br') {
      // Two line breaks in a row are how many feeds write a paragraph break.
      if (lastBreak) flush(); else { run += '<br>'; lastBreak = true; }
      continue;
    }
    if (name === 'a' || INLINE_RENAME[name] || UNWRAP_INLINE.has(name)) {
      run += UNWRAP_INLINE.has(name) ? inline(node.children, ctx) : inline([node], ctx);
      lastBreak = false;
      continue;
    }
    flush();
    if (name === 'p') {
      const inner = blocks(node.children, ctx);
      if (inner) parts.push(inner);
    } else if (/^h[1-6]$/.test(name)) {
      const inner = inline(node.children, ctx).trim();
      if (hasVisibleText(inner)) parts.push(name === 'h1' || name === 'h2' ? `<h3>${inner}</h3>` : `<h4>${inner}</h4>`);
    } else if (name === 'ul' || name === 'ol') {
      const items = (node.children || [])
        .filter((c) => c.type === 'tag' && String(c.name).toLowerCase() === 'li')
        .map((li) => {
          const hasBlock = (li.children || []).some((c) => c.type === 'tag' && /^(p|ul|ol|blockquote|pre|div)$/i.test(c.name));
          const inner = hasBlock ? blocks(li.children, ctx) : inline(li.children, ctx).trim();
          return hasVisibleText(inner) ? `<li>${inner}</li>` : '';
        })
        .join('');
      if (items) parts.push(`<${name}>${items}</${name}>`);
    } else if (name === 'blockquote') {
      const inner = blocks(node.children, ctx);
      if (inner) parts.push(`<blockquote>${inner}</blockquote>`);
    } else if (name === 'pre') {
      const text = textOf(node).replace(/^\n+|\s+$/g, '');
      if (text) parts.push(`<pre><code>${escapeText(text)}</code></pre>`);
    } else if (name === 'hr') {
      parts.push('<hr>');
    } else {
      // div, section, article, figure, table cells and the rest: their
      // contents, laid out as blocks of their own.
      const inner = blocks(node.children, ctx);
      if (inner) parts.push(inner);
    }
  }
  flush();
  return parts.filter(Boolean).join('');
}

/**
 * Safe HTML for a post's preview. Plain text (no tags at all) becomes one
 * paragraph per blank-line-separated block.
 */
function sanitizeArticleHtml(input, base) {
  const html = String(input || '').trim();
  if (!html) return '';
  if (!/<[a-z!/][^>]*>/i.test(html)) {
    const decoded = htmlToText(html, { keepNewlines: true });
    return decoded
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeText(p)}</p>`)
      .join('')
      .slice(0, MAX_HTML);
  }
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const out = blocks(doc.children, { base });
  if (out.length <= MAX_HTML) return out;
  // Too long to keep: stop at the last whole block that fits.
  const cut = out.lastIndexOf('</', MAX_HTML);
  const end = cut > 0 ? out.indexOf('>', cut) + 1 : 0;
  return end > 0 ? closeOpen(out.slice(0, end)) : '';
}

// After cutting at a closing tag, close whatever block is still open.
function closeOpen(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)(p|h3|h4|ul|ol|li|blockquote|pre|code|a|strong|em|sub|sup)\b[^>]*>/g)) {
    if (m[1]) { const i = stack.lastIndexOf(m[2]); if (i >= 0) stack.length = i; } else stack.push(m[2]);
  }
  return html + stack.reverse().map((t) => `</${t}>`).join('');
}

/** The words in some HTML, whitespace collapsed (or kept as newlines). */
function htmlToText(input, { keepNewlines = false } = {}) {
  const html = String(input || '');
  if (!html) return '';
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true });
  const BLOCK = /^(p|div|br|li|ul|ol|h[1-6]|blockquote|pre|tr|td|th|section|article|header|footer|figure|hr)$/;
  let out = '';
  (function walk(nodes) {
    for (const node of nodes || []) {
      if (node.type === 'text') out += node.data;
      else if (node.type === 'cdata') walk(node.children);
      else if (node.type === 'tag') {
        const name = String(node.name).toLowerCase();
        if (DROP.has(name)) continue;
        const block = BLOCK.test(name);
        if (block) out += keepNewlines ? '\n\n' : ' ';
        walk(node.children);
        if (block) out += keepNewlines ? '\n\n' : ' ';
      }
    }
  })(doc.children);
  if (keepNewlines) return out.replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return out.replace(/\s+/g, ' ').trim();
}

/** A short plain-text excerpt for the list, cut at a word. */
function excerpt(text, max = 280) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

module.exports = { sanitizeArticleHtml, htmlToText, excerpt, safeUrl, escapeText };
