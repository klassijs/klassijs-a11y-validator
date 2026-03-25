const cleanUrlInput = (input) => {
  if (input === null || input === undefined) return '';
  let value = String(input);
  // Remove BOM and common zero-width characters that can appear in exports.
  value = value.replace(/^\uFEFF/, '');
  value = value.replace(/[\u200B-\u200D\u2060]/g, '');
  // Normalize non-breaking/odd whitespace to normal spaces, then trim.
  value = value.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  // Remove ASCII control characters.
  value = value.replace(/[\u0000-\u001F\u007F]/g, '');
  value = value.trim();
  // Strip surrounding quotes if present.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
};

const normalizeUrl = (input, baseUrl) => {
  const cleaned = cleanUrlInput(input);
  return new URL(cleaned, baseUrl).href;
};

const extractSitemapUrlsFromRobotsTxt = (robotsTxt, baseUrl) => {
  const lines = robotsTxt.split(/\r?\n/);
  const urls = lines
    .map((line) => line.trim())
    .filter((line) => /^sitemap:/i.test(line))
    .map((line) => line.replace(/^sitemap:\s*/i, '').trim())
    .filter(Boolean)
    .map((value) => normalizeUrl(value, baseUrl));
  return [...new Set(urls)];
};

const extractLocUrlsFromXml = (xml, baseUrl) => {
  const urls = [];
  const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    try {
      urls.push(normalizeUrl(raw, baseUrl));
    } catch (_e) {
      // ignore invalid entries
    }
  }
  return [...new Set(urls)];
};

const getHostname = (url) => new URL(url).hostname.replace(/^www\./, '').toLowerCase();

const isSameHostname = (candidateUrl, baseUrl) => {
  const candidateHost = getHostname(candidateUrl);
  const baseHost = getHostname(baseUrl);
  return candidateHost === baseHost || candidateHost.endsWith(`.${baseHost}`);
};

const fetchText = async (url) => {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available in this runtime');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  if (typeof timeout.unref === 'function') timeout.unref();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'klassijs-a11y-validator/1.0' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Discover same-domain pages from sitemap(s).
 * Tries robots.txt sitemap directives first (unless sitemapUrls provided),
 * and falls back to common sitemap endpoints when robots doesn't provide any.
 */
async function discoverPagesFromSitemap({ baseUrl, sitemapUrls = [] }) {
  if (!baseUrl) throw new Error('baseUrl is required');

  const baseHostname = getHostname(baseUrl);
  const uniquePages = new Set();

  // BFS queue so we can follow sitemapindex entries.
  const queue = [...(sitemapUrls || [])];

  const visitedSitemaps = new Set();

  const commonSitemapCandidates = [
    '/sitemap_index.xml',
    '/sitemapindex.xml',
    '/sitemap.xml',
    '/sitemap-index.xml',
    '/wp-sitemap.xml',
    '/sitemap1.xml',
    '/sitemap0.xml',
  ];

  const enqueueSitemapUrl = (maybeUrl) => {
    if (!maybeUrl) return;
    try {
      const normalized = new URL(cleanUrlInput(maybeUrl), baseUrl).href;
      if (!visitedSitemaps.has(normalized)) queue.push(normalized);
    } catch (_e) {
      // ignore invalid sitemap url
    }
  };

  // Populate sitemap URL queue from robots.txt when not explicitly provided.
  if (queue.length === 0) {
    const robotsUrl = normalizeUrl('/robots.txt', baseUrl);
    try {
      const robotsTxt = await fetchText(robotsUrl);
      queue.push(...extractSitemapUrlsFromRobotsTxt(robotsTxt, baseUrl));
    } catch (_e) {
      // robots fetch failure should not break discovery
    }
  }

  // If robots didn't help, try common sitemap endpoints.
  if (queue.length === 0) {
    commonSitemapCandidates.forEach((candidate) => enqueueSitemapUrl(candidate));
  }

  while (queue.length > 0) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl) continue;

    if (visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);

    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch (_e) {
      continue; // try next candidate
    }

    const locUrls = extractLocUrlsFromXml(xml, baseUrl);

    // Detect sitemap index: if there's at least one <sitemapindex> / <sitemap> entry, follow links.
    const isIndex = /<sitemapindex\b/i.test(xml) || /<sitemap>\s*<loc>/i.test(xml);

    if (isIndex) {
      // For indexes, loc URLs are nested sitemaps (sitemap urls), not pages.
      locUrls.forEach((nested) => enqueueSitemapUrl(nested));
      continue;
    }

    // For urlset, loc URLs are pages.
    locUrls.forEach((pageUrl) => {
      // Constrain to same site/hostname (allows subdomains of base).
      if (getHostname(pageUrl) === baseHostname || getHostname(pageUrl).endsWith(`.${baseHostname}`)) {
        uniquePages.add(pageUrl);
      }
    });
  }

  return [...uniquePages];
}

module.exports = {
  cleanUrlInput,
  normalizeUrl,
  extractSitemapUrlsFromRobotsTxt,
  extractLocUrlsFromXml,
  discoverPagesFromSitemap,
};

