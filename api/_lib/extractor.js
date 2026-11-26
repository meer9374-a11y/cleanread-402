import { CONFIG } from './config.js';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '...',
  copy: '(c)',
  reg: '(R)',
  trade: '(TM)',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  bull: '*',
  middot: '·',
  rarr: '->',
  larr: '<-',
};

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isNaN(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return full;
    }
    const lower = entity.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : full;
  });
}

export function validatePublicTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'Missing required "url" parameter (must be an http:// or https:// URL).' };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: `Invalid URL "${rawUrl}". Provide a valid http:// or https:// URL.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return { ok: false, error: 'Private, loopback, and link-local network addresses are disallowed.' };
  }

  return { ok: true, url: parsed.toString() };
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(href, baseUrl) {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^javascript:/i.test(trimmed) || /^mailto:/i.test(trimmed) || /^data:/i.test(trimmed)) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractStructuredLinks(html, baseUrl, maxLinks = 60) {
  const links = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch ? hrefMatch[1] || hrefMatch[2] || hrefMatch[3] : null;
    const resolved = resolveUrl(rawHref, baseUrl);
    if (!resolved || seen.has(resolved)) continue;
    const text = stripTags(inner) || resolved;
    seen.add(resolved);
    links.push({ text: text.slice(0, 160), url: resolved });
    if (links.length >= maxLinks) break;
  }
  return links;
}

export function htmlToCleanMarkdown(rawHtml, pageUrl) {
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleMatch = rawHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const descMatch =
    rawHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  const rawTitle = titleMatch ? stripTags(titleMatch[1]) : ogTitleMatch ? decodeHtmlEntities(ogTitleMatch[1].trim()) : '';
  const metaDescription = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : '';

  // Focus on <main> or <article> if sizable, else <body>
  let working = rawHtml;
  const bodyMatch = working.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) working = bodyMatch[1];

  // Strip comments and heavy non-content tags first
  working = working
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|canvas|iframe|template|form|button|select|option)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, (hdr) => {
      // Keep header only if it contains the primary <h1>
      return /<h1\b/i.test(hdr) ? hdr.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '') : '';
    });

  // Remove common ad/cookie/sidebar/popup containers by class or id attributes (single-level safe regex)
  working = working.replace(
    /<(div|section)\b[^>]*(?:id|class)\s*=\s*["'][^"']*\b(?:cookie-banner|cookie-consent|gdpr|ad-slot|adsense|advert|promo-banner|newsletter-popup|modal-backdrop|share-buttons|social-share|breadcrumbs)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );

  // If <article> or <main> exists and holds meaningful content, prefer it to eliminate residual chrome
  const mainMatch = working.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || working.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (mainMatch && stripTags(mainMatch[1]).length >= 160) {
    working = mainMatch[1];
  }

  const structuredLinks = extractStructuredLinks(working, pageUrl, 50);

  // Protect fenced code blocks so inner tags/whitespace aren't mangled
  const codeBlocks = [];
  working = working.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const langMatch = inner.match(/class=["'][^"']*language-([a-zA-Z0-9_-]+)/i);
    const lang = langMatch ? langMatch[1] : '';
    const cleanCode = decodeHtmlEntities(
      inner
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    ).trim();
    const token = `\n\n@@CODEBLOCK_${codeBlocks.length}@@\n\n`;
    codeBlocks.push(`\`\`\`${lang}\n${cleanCode}\n\`\`\``);
    return token;
  });

  // Inline code
  working = working.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => {
    const text = stripTags(inner).replace(/`/g, "'");
    return text ? `\`${text}\`` : '';
  });

  // Headings h1-h6
  working = working.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = stripTags(inner);
    if (!text) return '';
    return `\n\n${'#'.repeat(Number(level))} ${text}\n\n`;
  });

  // Blockquotes
  working = working.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const text = stripTags(inner);
    return text ? `\n\n> ${text}\n\n` : '';
  });

  // Tables (simple clean Markdown conversion)
  working = working.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableInner) => {
    const rows = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rMatch;
    while ((rMatch = rowRegex.exec(tableInner)) !== null) {
      const cells = [];
      const cellRegex = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cMatch;
      while ((cMatch = cellRegex.exec(rMatch[1])) !== null) {
        cells.push(stripTags(cMatch[2]).replace(/\|/g, '\\|'));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const colCount = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push('');
      return `| ${padded.join(' | ')} |`;
    });
    const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
    normalized.splice(1, 0, separator);
    return `\n\n${normalized.join('\n')}\n\n`;
  });

  // Links
  working = working.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
    const text = stripTags(inner);
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch ? hrefMatch[1] || hrefMatch[2] || hrefMatch[3] : null;
    const resolved = resolveUrl(rawHref, pageUrl);
    if (!text) return '';
    if (!resolved) return text;
    return `[${text}](${resolved})`;
  });

  // Images with alt text
  working = working.replace(/<img\b([^>]*)\/?>/gi, (_, attrs) => {
    const altMatch = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const alt = altMatch ? decodeHtmlEntities((altMatch[1] || altMatch[2] || '').trim()) : '';
    const src = resolveUrl(srcMatch ? srcMatch[1] || srcMatch[2] || srcMatch[3] : null, pageUrl);
    if (!alt || !src) return '';
    return `![${alt}](${src})`;
  });

  // Bold & Italic
  working = working.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    const text = stripTags(inner);
    return text ? `**${text}**` : '';
  });
  working = working.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    const text = stripTags(inner);
    return text ? `*${text}*` : '';
  });

  // Lists
  working = working.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return text ? `\n- ${text}` : '';
  });
  working = working.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n\n');

  // Horizontal rules, breaks, paragraphs, block containers
  working = working
    .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main|figure|figcaption|dl|dt|dd)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  working = decodeHtmlEntities(working);

  // Normalize line whitespace before restoring code blocks
  working = working
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore code blocks
  codeBlocks.forEach((block, idx) => {
    working = working.replace(`@@CODEBLOCK_${idx}@@`, block);
  });

  // Prepend title & meta summary if not already starting with an H1
  const headerLines = [];
  if (rawTitle && !working.startsWith('# ')) {
    headerLines.push(`# ${rawTitle}`);
  }
  if (metaDescription && !working.includes(metaDescription.slice(0, 40))) {
    headerLines.push(`> ${metaDescription}`);
  }
  const fullMarkdown = [headerLines.join('\n\n'), working].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    title: rawTitle || pageUrl,
    description: metaDescription,
    fullMarkdown,
    structuredLinks,
  };
}

export async function fetchAndExtractUrl(targetUrl, options = { demo: false, timeoutMs: 8500 }) {
  const validation = validatePublicTargetUrl(targetUrl);
  if (!validation.ok) {
    const err = new Error(validation.error);
    err.statusCode = 400;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8500);

  let response;
  try {
    response = await fetch(validation.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CleanRead-402/1.0; +https://cleanread-402.vercel.app/llms.txt) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const err = new Error(`Failed to fetch target URL: ${fetchErr.message}`);
    err.statusCode = 502;
    throw err;
  }
  clearTimeout(timer);

  if (!response.ok) {
    const err = new Error(`Upstream URL returned HTTP ${response.status} (${response.statusText || 'Error'})`);
    err.statusCode = 502;
    throw err;
  }

  const finalUrl = response.url || validation.url;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text();
  const originalBytes = Buffer.byteLength(rawText, 'utf8');

  let title = finalUrl;
  let fullMarkdown = '';
  let structuredLinks = [];

  if (contentType.includes('application/json')) {
    try {
      fullMarkdown = '```json\n' + JSON.stringify(JSON.parse(rawText), null, 2) + '\n```';
    } catch {
      fullMarkdown = rawText.trim();
    }
  } else if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
    const firstHeading = rawText.match(/^#\s+(.+)$/m);
    if (firstHeading) title = firstHeading[1].trim();
    fullMarkdown = rawText.trim();
  } else {
    const extracted = htmlToCleanMarkdown(rawText, finalUrl);
    title = extracted.title;
    fullMarkdown = extracted.fullMarkdown;
    structuredLinks = extracted.structuredLinks;
  }

  const compressedFullBytes = Buffer.byteLength(fullMarkdown, 'utf8');
  const rawTokensEstimate = Math.max(1, Math.ceil(originalBytes / 4));
  const cleanTokensEstimate = Math.max(1, Math.ceil(compressedFullBytes / 4));
  const estimatedTokensSaved = Math.max(0, rawTokensEstimate - cleanTokensEstimate);
  const compressionRatioPct =
    originalBytes > 0 ? Number((((originalBytes - compressedFullBytes) / originalBytes) * 100).toFixed(2)) : 0;

  const isDemo = Boolean(options.demo);
  const cleanMarkdown = isDemo ? fullMarkdown.slice(0, CONFIG.demoPreviewChars) : fullMarkdown;
  const compressedBytes = compressedFullBytes;

  return {
    title,
    url: finalUrl,
    cleanMarkdown,
    originalBytes,
    compressedBytes,
    estimatedTokensSaved,
    compressionRatioPct,
    demo: isDemo,
    ...(isDemo
      ? {
          previewLimitChars: CONFIG.demoPreviewChars,
          fullMarkdownChars: fullMarkdown.length,
          truncatedChars: Math.max(0, fullMarkdown.length - cleanMarkdown.length),
          upgradeHint: `Send 0.05 USDC (50000 base units) on Base to ${CONFIG.payTo} and pass X-Payment-Tx header for full unthrottled Markdown.`,
        }
      : {}),
    linksCount: structuredLinks.length,
    links: isDemo ? structuredLinks.slice(0, 10) : structuredLinks,
  };
}
