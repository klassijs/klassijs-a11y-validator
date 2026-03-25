const path = require('path');
const fs = require("fs");

const { getA11yValidator, getAccessibilityError, getAccessibilityTotalError, resetErrorCounts } = require('./src/accessibilityLib');
const { crawlWebsite, isValidUrl, authenticate, isPrivatePage } = require('./src/urlCrawler');
const { discoverPagesFromSitemap } = require('./src/sitemapDiscovery');
const { getPagesFromFile } = require('./src/pagesFileParser');
const { dateTime } = require('./utils/dateTime');

const accessibility_lib = path.resolve(__dirname, './src/accessibilityLib.js');
if (fs.existsSync(accessibility_lib)) {
  const rList = [];
  global.accessibilityLib = require(accessibility_lib);
  global.accessibilityReportList = rList;
} else console.error('No Accessibility Lib');

/**
 * Axe returns arrays; guard against odd serialization (object keyed by index, or JSON string).
 */
function normalizeAxeRuleArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') return Object.values(parsed);
      } catch (_e) {
        return [];
      }
    }
    return [];
  }
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/**
 * Safe to embed inside <script>: raw "</script>" in JSON strings would close the tag and hide the rest of the page.
 */
function jsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Escape text/attribute fragments embedded in summary HTML (axe messages may contain `<`, `&`, etc.). */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Prefer JSON files that pair 1:1 with HTML paths recorded during this run (avoids merging stale reports
 * left in the accessibility folder from older runs).
 */
function collectJsonPathsFromAccessibilityReportList() {
  const list = global.accessibilityReportList;
  if (!Array.isArray(list) || list.length === 0) return null;
  const paths = new Set();
  for (const entry of list) {
    if (!entry || !entry.path) continue;
    const jsonPath = String(entry.path).replace(/\.html$/i, '.json');
    if (fs.existsSync(jsonPath)) paths.add(path.resolve(jsonPath));
  }
  return paths.size > 0 ? [...paths] : null;
}

/**
 * Axe uses `incomplete`; tolerate alternate shapes if a wrapper ever changes the payload.
 */
function extractIncompleteFromReport(reportData) {
  if (!reportData || typeof reportData !== 'object') return [];
  const raw =
    reportData.incomplete ??
    reportData.incompleteResults ??
    reportData.incompleteChecks ??
    (reportData.results && reportData.results.incomplete) ??
    (reportData.axeResults && reportData.axeResults.incomplete);
  let list = normalizeAxeRuleArray(raw);
  if (list.length > 0) return list;
  if (Array.isArray(reportData.frames)) {
    const merged = [];
    for (const fr of reportData.frames) {
      if (!fr || typeof fr !== 'object') continue;
      merged.push(...normalizeAxeRuleArray(fr.incomplete));
    }
    return merged;
  }
  return [];
}

/**
 * Resolve directories that contain per-page JSON/HTML for this run.
 * Prefer paths recorded when reports were written (matches browser folder name exactly).
 */
function resolveAccessibilityReportsDirs(reportsDir, browserName, envName) {
  const list = global.accessibilityReportList;
  const dirs = new Set();
  if (Array.isArray(list) && list.length > 0) {
    list.forEach((entry) => {
      if (entry && entry.path) {
        const dir = path.dirname(entry.path);
        if (dir) dirs.add(dir);
      }
    });
  }
  if (dirs.size > 0) {
    return Array.from(dirs).filter((d) => fs.existsSync(d));
  }

  const envLower = String(envName || 'test').toLowerCase();
  const fallback = path.join(reportsDir, 'accessibility', browserName, envLower);
  if (fs.existsSync(fallback)) {
    return [fallback];
  }

  const base = path.join(reportsDir, 'accessibility');
  if (!fs.existsSync(base)) {
    return [fallback];
  }

  const found = [];
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(base, d.name, envLower);
    if (fs.existsSync(candidate)) {
      const jsonCount = fs.readdirSync(candidate).filter((f) => f.endsWith('.json')).length;
      if (jsonCount > 0) found.push(candidate);
    }
  }
  return found.length > 0 ? found : [fallback];
}

function getBrowserNameForReportPath() {
  try {
    const { astellen } = require('klassijs-astellen');
    const b = astellen.get('BROWSER_NAME');
    if (b) return String(b);
  } catch (_e) {
    /* klassijs-astellen optional in some consumers */
  }
  return global.browserName ? String(global.browserName) : 'chrome';
}

function getLegacySinglePageSummaryState() {
  if (!global.__a11yLegacySinglePageSummaryState) {
    global.__a11yLegacySinglePageSummaryState = {
      startedAtMs: Date.now(),
      pageCount: 0,
      hasGeneratedSummary: false,
    };
  }
  return global.__a11yLegacySinglePageSummaryState;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function resolveDomainForSummary() {
  const baseUrl = global.env?.base_url || '';
  if (!baseUrl) return 'unknown-domain';
  try {
    return new URL(baseUrl).hostname || 'unknown-domain';
  } catch (_e) {
    return 'unknown-domain';
  }
}

async function maybeGenerateSummaryForLegacySinglePageFlow(count) {
  const state = getLegacySinglePageSummaryState();
  // Only generate for legacy single-page flows when caller indicates "final/total"
  // using count=true and we've validated more than one page.
  if (!count || state.pageCount <= 1 || state.hasGeneratedSummary) return;

  const now = Date.now();
  const domain = resolveDomainForSummary();
  const totalDuration = formatDuration(now - state.startedAtMs);
  await generateComprehensiveReport({}, domain, '0s', totalDuration);
  state.hasGeneratedSummary = true;
}

/**
 * Validates accessibility for a single page
 * @param {string} pageName - Name/identifier for the page (used in reports)
 * @param {boolean|Object} countOrOptions - Whether to include total error count in output, or options object
 * @param {Object} options - Configuration options for accessibility checking (if countOrOptions is boolean, this is ignored)
 * @param {Array<string>} options.excludeTags - WCAG tags to exclude (e.g., ['wcag22aa', 'best-practice'])
 * @param {Array<string>} options.excludeRules - Specific rule IDs to exclude (e.g., ['color-contrast', 'image-alt'])
 * @param {Array<string>} options.includeTags - Specific tags to include (if provided, only these tags will be checked)
 */
async function a11yValidator(pageName, countOrOptions = false, options = {}) {
  // Handle backward compatibility: if countOrOptions is boolean, treat it as count
  const count = typeof countOrOptions === 'boolean' ? countOrOptions : false;
  const a11yOptions = typeof countOrOptions === 'object' ? countOrOptions : options;
  
  // Run the accessibility report and wait for it to complete
  await getA11yValidator(pageName, a11yOptions);
  await accessibilityError(count);

  // Backward-compatible behavior for legacy tests:
  // if the single-page API is called for multiple pages in one run, auto-generate
  // comprehensive summary without requiring test code changes.
  const state = getLegacySinglePageSummaryState();
  state.pageCount += 1;
  await maybeGenerateSummaryForLegacySinglePageFlow(count);
}

/**
 * Validates accessibility for all pages discovered from a starting URL
 * Crawls the website starting from the provided URL and tests each discovered page
 * @param {string} url - The starting URL to crawl and validate
 * @param {Object} options - Options for crawling and validation
 * @param {boolean} options.count - Whether to include total error count in output (default: true)
 * @param {number|null} options.maxPages - Maximum number of pages to crawl (default: 50). Set to null or 0 for unlimited crawling
 * @param {number} options.maxDepth - Maximum depth to crawl (default: 3)
 * @param {Array<string>} options.excludePaths - Paths to exclude from crawling (e.g., ['/admin', '/api'])
 * @param {Object} options.auth - Authentication configuration for private pages
 * @param {string} options.auth.loginUrl - URL of the login page
 * @param {Function} options.auth.loginFunction - Custom async function to perform login (receives browser instance)
 * @param {Object} options.auth.credentials - Login credentials { username, password }
 * @param {Object} options.auth.selectors - CSS selectors for login form { username, password, submit }
 * @param {Array<string>} options.privatePageIndicators - Text indicators that suggest a private page
 * @param {boolean} options.skipPrivatePages - If true, skip pages that appear to require authentication (default: false)
 * @param {boolean} options.crawlOnly - If true, only crawl and discover pages without running accessibility tests (default: false)
 * @param {Array<string>} options.excludeTags - WCAG tags to exclude from checking (e.g., ['wcag22aa', 'best-practice'])
 *   Available tags: 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'wcag2aaa', 'wcag21aaa', 'wcag22aaa', 'best-practice'
 * @param {Array<string>} options.excludeRules - Specific axe rule IDs to exclude (e.g., ['color-contrast', 'image-alt'])
 *   See https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md for available rules
 * @param {Array<string>} options.includeTags - Specific tags to include (if provided, only these tags will be checked, overrides default)
 *   If not provided, defaults to all WCAG 2.0/2.1/2.2 Level A and AA plus best-practice
 * @param {number|null} options.maxPagesToTest - Maximum number of pages to actually test (default: null = test all discovered pages)
 *   Useful for quick checks: discover all pages but only test a subset (e.g., test only 5 pages out of 83 discovered)
 * @param {boolean} [options.sitemapFirst=false] - If true, discover URLs from sitemap/robots before link crawling (capped by maxPages). Default is link crawl first so maxPages applies to discovered links.
 * @returns {Promise<Object>} - Summary of validation results or crawl results if crawlOnly is true
 */
async function a11yValidatorFromUrl(url, options = {}) {
  const {
    count = true,
    maxPages = 50,
    maxDepth = 3,
    excludePaths = [],
    auth = null,
    privatePageIndicators = [],
    skipPrivatePages = false,
    crawlOnly = false,
    excludeTags = [],
    excludeRules = [],
    includeTags = null,
    maxPagesToTest = null, // Limit how many pages to test (null = test all)
    sitemapFirst = false,
    sitemapUrls = null,
    sitemapUrl = null,
  } = options;

  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL provided: ${url}`);
  }

  if (!global.browser) {
    throw new Error('Browser instance not available. Make sure browser is initialized before calling this function.');
  }

  console.info(`Starting accessibility validation for URL: ${url}`);
  
  // Reset error counts for new validation run
  resetErrorCounts();
  
  // Start timer for crawl duration
  const crawlStartTime = Date.now();

  let crawlResult = null;
  const effectiveSitemapUrls = Array.isArray(sitemapUrls)
    ? sitemapUrls
    : sitemapUrls
      ? [sitemapUrls]
      : sitemapUrl
        ? [sitemapUrl]
        : [];

  // Optional sitemap-first: load URL list from sitemap/robots before link crawling.
  if (sitemapFirst) {
    try {
      const discoveredFromSitemap = await discoverPagesFromSitemap({
        baseUrl: url,
        sitemapUrls: effectiveSitemapUrls,
      });

      if (Array.isArray(discoveredFromSitemap) && discoveredFromSitemap.length > 0) {
        const effectiveMaxPages = !maxPages || maxPages <= 0 ? Number.MAX_SAFE_INTEGER : maxPages;

        const filteredUrls = discoveredFromSitemap
          .filter((pageUrl) => {
            if (!excludePaths || excludePaths.length === 0) return true;
            return !excludePaths.some((pattern) => {
              try {
                const urlObj = new URL(pageUrl);
                return urlObj.pathname.includes(pattern);
              } catch (_e) {
                return String(pageUrl).includes(pattern);
              }
            });
          })
          .slice(0, effectiveMaxPages);

        if (filteredUrls.length > 0) {
          const domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
          const pageMap = {};
          const pagesByDepth = { 0: [] };
          filteredUrls.forEach((pageUrl) => {
            pageMap[pageUrl] = { depth: 0, parent: null, children: [], discoveredFrom: [] };
            pagesByDepth[0].push(pageUrl);
          });

          crawlResult = {
            urls: filteredUrls,
            pageMap,
            domain,
            pagesByDepth,
            totalPages: filteredUrls.length,
          };
        }
      }
    } catch (sitemapErr) {
      console.warn(`Sitemap discovery failed; falling back to crawler. ${sitemapErr.message}`);
    }
  }

  // Fall back to crawler if sitemap discovery did not yield any pages.
  if (!crawlResult) {
    crawlResult = await crawlWebsite(url, {
      maxPages,
      maxDepth,
      excludePaths,
      auth,
      privatePageIndicators,
      skipPrivatePages,
    });
  }

  // Calculate duration for whichever discovery method ran.
  const crawlEndTime = Date.now();
  const crawlDurationMs = crawlEndTime - crawlStartTime;
  
  // Helper function to format duration as "Xh Xm Xs"
  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
  };
  
  const crawlDuration = formatDuration(crawlDurationMs);

  const { urls: discoveredUrls, pageMap, domain, pagesByDepth } = crawlResult;

  if (discoveredUrls.length === 0) {
    console.warn('No pages discovered. Make sure the URL is accessible and contains internal links.');
    return {
      totalPages: 0,
      pagesTested: 0,
      totalErrors: 0,
      urls: [],
      pageMap: {},
      domain: domain || '',
    };
  }

  // Helper function to save sitemap files (used in both crawl-only and full test modes)
  const saveSitemapFiles = async () => {
    try {
      const reportsDir = global.paths?.reports || './reports';
      const pageMapDir = `${reportsDir}/sitemap`;
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(pageMapDir)) {
        fs.mkdirSync(pageMapDir, { recursive: true });
      }
      
      const timestamp = await dateTime();
      const baseFileName = `sitemap-${domain}-${timestamp}`;
      
      // Save JSON sitemap
      const pageMapFile = `${pageMapDir}/${baseFileName}.json`;
      const sitemapData = {
        domain: domain,
        baseUrl: url,
        totalPages: discoveredUrls.length,
        crawlDate: new Date().toISOString(),
        pageMap: pageMap,
        urlList: discoveredUrls,
        pagesByDepth: pagesByDepth || {},
      };
      
      fs.writeFileSync(pageMapFile, JSON.stringify(sitemapData, null, 2), 'utf-8');
      console.info(`\nPage map (JSON) saved to: ${pageMapFile}`);
      
      // Save human-readable page list
      const pageListFile = `${pageMapDir}/${baseFileName}.txt`;
      let pageListContent = `Sitemap for: ${domain}\n`;
      pageListContent += `Base URL: ${url}\n`;
      pageListContent += `Crawl Date: ${new Date().toISOString()}\n`;
      pageListContent += `Total Pages Discovered: ${discoveredUrls.length}\n`;
      pageListContent += `${'='.repeat(80)}\n\n`;
      
      // List all pages (simple list, no relationships)
      pageListContent += `ALL PAGES (${discoveredUrls.length} total):\n`;
      pageListContent += `${'-'.repeat(80)}\n`;
      discoveredUrls.forEach((pageUrl, index) => {
        pageListContent += `${(index + 1).toString().padStart(3, ' ')}. ${pageUrl}\n`;
      });
      
      pageListContent += `\n\n${'='.repeat(80)}\n`;
      pageListContent += `PAGES BY DEPTH:\n`;
      pageListContent += `${'='.repeat(80)}\n\n`;
      
      // Organize by depth (simple list, no relationships)
      Object.keys(pagesByDepth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(depth => {
        pageListContent += `Depth ${depth} (${pagesByDepth[depth].length} pages):\n`;
        pageListContent += `${'-'.repeat(80)}\n`;
        pagesByDepth[depth].forEach((pageUrl, index) => {
          pageListContent += `  ${(index + 1).toString().padStart(2, ' ')}. ${pageUrl}\n`;
        });
        pageListContent += `\n`;
      });
      
      fs.writeFileSync(pageListFile, pageListContent, 'utf-8');
      console.info(`Page list (TXT) saved to: ${pageListFile}`);
      
      // Save simple HTML sitemap for easy viewing
      const htmlSitemapFile = `${pageMapDir}/${baseFileName}.html`;
      let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sitemap - ${domain}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        h2 { color: #666; margin-top: 30px; }
        .stats { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .stats p { margin: 5px 0; }
        .page-list { list-style: none; padding: 0; }
        .page-item { padding: 8px; margin: 5px 0; background: #f9f9f9; border-left: 3px solid #4CAF50; }
        .page-item:hover { background: #e8f5e9; }
        .depth-badge { display: inline-block; background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; margin-right: 10px; }
        a { color: #2196F3; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .relationship { font-size: 12px; color: #666; margin-left: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🌐 Sitemap: ${domain}</h1>
        <div class="stats">
            <p><strong>Base URL:</strong> <a href="${url}" target="_blank">${url}</a></p>
            <p><strong>Total Pages:</strong> ${discoveredUrls.length}</p>
            <p><strong>Crawl Date:</strong> ${new Date().toISOString()}</p>
        </div>
        
        <h2>All Pages (${discoveredUrls.length})</h2>
        <ul class="page-list">`;
      
      discoveredUrls.forEach((pageUrl, index) => {
        htmlContent += `
            <li class="page-item">
                <a href="${pageUrl}" target="_blank">${pageUrl}</a>
            </li>`;
      });
      
      htmlContent += `
        </ul>
    </div>
</body>
</html>`;
      
      fs.writeFileSync(htmlSitemapFile, htmlContent, 'utf-8');
      console.info(`Page list (HTML) saved to: ${htmlSitemapFile}`);
      
      return {
        json: pageMapFile,
        txt: pageListFile,
        html: htmlSitemapFile,
      };
    } catch (error) {
      console.warn('Could not save page map files:', error.message);
      return null;
    }
  };

  // If crawlOnly is true, return after crawling without running accessibility tests
  if (crawlOnly) {
    // Save sitemap files BEFORE returning
    await saveSitemapFiles();
    
    // Calculate statistics
    const pagesWithChildren = discoveredUrls.filter(url => {
      const pageInfo = pageMap[url];
      return pageInfo?.children && pageInfo.children.length > 0;
    });
    
    const pagesWithoutChildren = discoveredUrls.filter(url => {
      const pageInfo = pageMap[url];
      return !pageInfo?.children || pageInfo.children.length === 0;
    });
    
    const totalChildren = discoveredUrls.reduce((sum, url) => {
      const pageInfo = pageMap[url];
      return sum + (pageInfo?.children?.length || 0);
    }, 0);
    
    const maxDepth = Math.max(...discoveredUrls.map(url => (pageMap[url]?.depth || 0)));
    
    console.info(`\n${'='.repeat(60)}`);
    console.info(`Crawl-Only Mode: Summary`);
    console.info(`${'='.repeat(60)}`);
    console.info(`Domain: ${domain}`);
    console.info(`Total pages discovered: ${discoveredUrls.length}`);
    console.info(`Maximum depth: ${maxDepth}`);
    console.info(`Crawl duration: ${crawlDuration}`);
    
    if (pagesByDepth) {
      console.info(`\nPages by depth:`);
      Object.keys(pagesByDepth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(depth => {
        console.info(`  Depth ${depth}: ${pagesByDepth[depth].length} pages`);
      });
    }
    
    console.info(`\nPage relationships:`);
    console.info(`  Pages with children: ${pagesWithChildren.length}`);
    console.info(`  Pages without children (leaf nodes): ${pagesWithoutChildren.length}`);
    console.info(`  Total parent-child relationships: ${totalChildren}`);
    
    console.info(`\n${'='.repeat(60)}`);
    console.info(`Detailed page lists have been saved to files:`);
    console.info(`  - JSON sitemap (complete data)`);
    console.info(`  - TXT page list (human-readable)`);
    console.info(`  - HTML sitemap (visual)`);
    console.info(`${'='.repeat(60)}\n`);
    
      return {
        crawlOnly: true,
        totalPages: discoveredUrls.length,
        pagesTested: 0,
        totalErrors: 0,
        urls: discoveredUrls.map(url => ({
          url: url,
          pageName: '',
          errors: 0,
          status: 'not_tested',
        })),
        errors: [],
        pageMap: pageMap,
        domain: domain,
        pagesByDepth: pagesByDepth,
        crawlDuration: crawlDuration,
        crawlDurationMs: crawlDurationMs,
        message: 'Crawl completed. Accessibility testing was skipped (crawlOnly mode).',
      };
  }

  // Determine how many pages to actually test
  const pagesToTest = maxPagesToTest && maxPagesToTest > 0 
    ? Math.min(maxPagesToTest, discoveredUrls.length)
    : discoveredUrls.length;
  
  const pagesSkipped = discoveredUrls.length - pagesToTest;
  
  console.info(`\n${'='.repeat(60)}`);
  console.info(`Starting Accessibility Testing`);
  console.info(`${'='.repeat(60)}`);
  console.info(`Total pages discovered: ${discoveredUrls.length}`);
  if (maxPagesToTest && maxPagesToTest > 0 && pagesSkipped > 0) {
    console.info(`Pages to test: ${pagesToTest} (limited by maxPagesToTest=${maxPagesToTest})`);
    console.info(`Pages skipped: ${pagesSkipped} (not tested)`);
  } else {
    console.info(`Total pages to test: ${pagesToTest} (ALL discovered pages will be tested)`);
  }
  console.info(`Domain: ${domain}`);
  console.info(`Crawl duration: ${crawlDuration}`);
  
  // Show breakdown by depth
  if (pagesByDepth) {
    console.info(`\nPages by depth:`);
    Object.keys(pagesByDepth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(depth => {
      console.info(`  Depth ${depth}: ${pagesByDepth[depth].length} pages`);
    });
  }
  
  console.info(`${'='.repeat(60)}\n`);

  const results = {
    totalPages: discoveredUrls.length,
    pagesTested: 0,
    totalErrors: 0,
    urls: [],
    errors: [],
    pageMap: pageMap,
    domain: domain,
    testedPages: [], // Track all tested pages
    pagesSkipped: pagesSkipped, // Track pages that were skipped
    pagesToTest: pagesToTest, // Number of pages that should be tested
  };

  // Test each discovered page (up to maxPagesToTest limit)
  if (maxPagesToTest && maxPagesToTest > 0 && pagesSkipped > 0) {
    console.info(`Running accessibility tests on ${pagesToTest} pages (${pagesSkipped} pages will be skipped)...\n`);
  } else {
    console.info('Running accessibility tests on all discovered pages...\n');
  }
  
  for (let i = 0; i < pagesToTest; i++) {
    const pageUrl = discoveredUrls[i];
    try {
      console.info(`[${i + 1}/${pagesToTest}] Testing: ${pageUrl}`);
      
      // Navigate to the page
      await global.browser.url(pageUrl);
      
      // Wait for page to load
      await global.browser.waitUntil(
        async () => {
          const readyState = await global.browser.execute(() => document.readyState);
          return readyState === 'complete';
        },
        {
          timeout: 10000,
          timeoutMsg: 'Page did not load completely',
        }
      );
      
      // Small delay to ensure page is fully ready
      await global.browser.pause(500);
      
      // Ensure we're in the correct tab (not the Bidi tab)
      try {
        const windowHandles = await global.browser.getWindowHandles();
        if (windowHandles.length > 1) {
          const currentUrl = await global.browser.getUrl();
          // If current URL suggests we're in a Bidi tab, switch to main tab
          if (!currentUrl || currentUrl === pageUrl) {
            // We're in the right tab
          } else {
            // Switch to the first window handle (usually the main page)
            await global.browser.switchToWindow(windowHandles[0]);
            // Wait a moment after switching
            await global.browser.pause(200);
          }
        }
      } catch (switchErr) {
        // If window switching fails, continue anyway
        console.warn('Could not verify window context:', switchErr.message);
      }

      // Generate a page name from the URL
      const urlObj = new URL(pageUrl);
      const pageName = urlObj.pathname === '/' || urlObj.pathname === '' 
        ? 'home' 
        : urlObj.pathname.replace(/\//g, '_').replace(/^_|_$/g, '').substring(0, 50) || 'page';

      // Run accessibility validation with configuration options
      await getA11yValidator(pageName, {
        excludeTags,
        excludeRules,
        includeTags,
      });
      
      const pageErrors = getAccessibilityError();
      results.pagesTested++;
      results.totalErrors += pageErrors;
      
      const pageResult = {
        url: pageUrl,
        pageName,
        errors: pageErrors,
        status: pageErrors > 0 ? 'has_errors' : 'passed',
      };
      
      results.urls.push(pageResult);
      results.testedPages.push(pageUrl);

      if (pageErrors > 0) {
        console.info(`  ⚠️  Found ${pageErrors} accessibility error(s)`);
        results.errors.push({
          url: pageUrl,
          pageName,
          errors: pageErrors,
        });
      } else {
        console.info(`  ✅ No accessibility errors found`);
      }
      
      console.info(''); // Add spacing between pages
      
    } catch (error) {
      console.error(`  ❌ Error testing ${pageUrl}:`, error.message);
      results.errors.push({
        url: pageUrl,
        error: error.message,
        status: 'error',
      });
      // Still count as tested (even if it failed)
      results.pagesTested++;
      results.testedPages.push(pageUrl);
    }
  }
  
  console.info(`${'='.repeat(60)}`);
  console.info(`Accessibility Testing Complete`);
  console.info(`${'='.repeat(60)}`);
  console.info(`Pages discovered: ${discoveredUrls.length}`);
  console.info(`Pages tested: ${results.pagesTested}/${results.pagesToTest || discoveredUrls.length}`);
  if (results.pagesSkipped > 0) {
    console.info(`Pages skipped: ${results.pagesSkipped} (not tested due to maxPagesToTest limit)`);
  }
  console.info(`Pages with errors: ${results.errors.length}`);
  console.info(`Total errors found: ${results.totalErrors}`);
  console.info(`${'='.repeat(60)}\n`);

  // Save page map and page list to files (reuse the helper function)
  await saveSitemapFiles();

  // Calculate total duration (crawl + testing)
  const totalEndTime = Date.now();
  const totalDurationMs = totalEndTime - crawlStartTime;
  const totalDuration = formatDuration(totalDurationMs);

  // Generate comprehensive summary report (groups pages by same issues)
  await generateComprehensiveReport(results, domain, crawlDuration, totalDuration);

  // Report final results
  await accessibilityError(count);
  
  console.info(`\n${'='.repeat(60)}`);
  console.info(`Final Validation Summary`);
  console.info(`${'='.repeat(60)}`);
  console.info(`Domain: ${domain}`);
  console.info(`Total pages discovered: ${results.totalPages}`);
  if (results.pagesSkipped > 0) {
    console.info(`Pages tested: ${results.pagesTested}/${results.pagesToTest} (${results.pagesSkipped} pages skipped due to maxPagesToTest limit)`);
  } else {
    console.info(`Pages tested: ${results.pagesTested} (${results.pagesTested === results.totalPages ? 'ALL pages tested ✓' : 'Some pages may have been skipped'})`);
  }
  console.info(`Total accessibility errors: ${results.totalErrors}`);
  console.info(`Pages with errors: ${results.errors.length}`);
  console.info(`Crawl duration: ${crawlDuration}`);
  console.info(`Total duration (crawl + testing): ${totalDuration}`);
  
  if (results.testedPages.length > 0) {
    console.info(`\nAll tested pages:`);
    results.testedPages.forEach((url, index) => {
      const pageResult = results.urls.find(u => u.url === url);
      const status = pageResult?.status === 'has_errors' ? '⚠️' : pageResult?.status === 'error' ? '❌' : '✅';
      console.info(`  ${status} ${index + 1}. ${url}`);
    });
  }
  
  console.info(`${'='.repeat(60)}\n`);

  return results;
}

/**
 * Validates accessibility for a set of explicit pages provided in a `.txt` or `.csv` file.
 * Each line/row should contain a full URL, or a relative path (requires `options.baseUrl`).
 *
 * @param {string} pagesFilePath
 * @param {Object} options
 * @param {string|null} options.baseUrl - Required if the file contains relative paths.
 * @param {string|string[]} options.csvIgnoreColumns - CSV columns to ignore (header name or index).
 * @param {boolean} options.count - Whether to record total error count.
 * @param {Object|null} options.auth - Authentication configuration for protected pages.
 * @param {boolean} options.crawlOnly - If true, it will not run axe validation.
 * @param {number|null} options.maxPagesToTest - Limit how many entries to actually test.
 * @param {Array<string>} options.excludeTags
 * @param {Array<string>} options.excludeRules
 * @param {Array<string>|null} options.includeTags
 */
async function a11yValidatorFromPagesFile(pagesFilePath, options = {}) {
  const {
    count = true,
    baseUrl = null,
    csvIgnoreColumns = [],
    auth = null,
    crawlOnly = false,
    maxPagesToTest = null,
    excludeTags = [],
    excludeRules = [],
    includeTags = null,
  } = options;

  if (!pagesFilePath) throw new Error('pagesFilePath is required');

  if (!global.browser) {
    throw new Error('Browser instance not available. Make sure browser is initialized before calling this function.');
  }

  resetErrorCounts();

  const fileStartTime = Date.now();
  const pages = getPagesFromFile(pagesFilePath, { baseUrl, csvIgnoreColumns });

  const crawlEndTime = Date.now();
  const crawlDurationMs = crawlEndTime - fileStartTime;

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  };

  const crawlDuration = formatDuration(crawlDurationMs);

  if (!pages || pages.length === 0) {
    return {
      totalPages: 0,
      pagesTested: 0,
      totalErrors: 0,
      urls: [],
      errors: [],
      pageMap: {},
      domain: '',
      testedPages: [],
      pagesSkipped: 0,
      pagesToTest: 0,
      crawlOnly: !!crawlOnly,
      crawlDuration,
      message: 'No pages found in provided file.',
    };
  }

  const domain = (() => {
    try {
      return new URL(pages[0]).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_e) {
      return '';
    }
  })();

  const effectiveMax = maxPagesToTest && maxPagesToTest > 0 ? Math.min(maxPagesToTest, pages.length) : pages.length;
  const pagesSkipped = pages.length - effectiveMax;

  const pageMap = {};
  const pagesByDepth = { 0: [] };
  pages.forEach((pageUrl) => {
    pageMap[pageUrl] = { depth: 0, parent: null, children: [], discoveredFrom: [] };
    pagesByDepth[0].push(pageUrl);
  });

  if (crawlOnly) {
    return {
      crawlOnly: true,
      totalPages: pages.length,
      pagesTested: 0,
      totalErrors: 0,
      urls: pages.map((url) => ({ url, pageName: '', errors: 0, status: 'not_tested' })),
      errors: [],
      pageMap,
      domain,
      pagesByDepth,
      crawlDuration,
      message: 'Page list loaded; accessibility testing skipped (crawlOnly mode).',
    };
  }

  // Perform login once for the entire browser session, if auth is configured.
  if (auth) {
    await authenticate(auth);
  }

  const results = {
    totalPages: pages.length,
    pagesTested: 0,
    totalErrors: 0,
    urls: [],
    errors: [],
    pageMap,
    domain,
    testedPages: [],
    pagesSkipped,
    pagesToTest: effectiveMax,
  };

  for (let i = 0; i < effectiveMax; i++) {
    const pageUrl = pages[i];
    try {
      await global.browser.url(pageUrl);

      await global.browser.waitUntil(
        async () => {
          const readyState = await global.browser.execute(() => document.readyState);
          return readyState === 'complete';
        },
        {
          timeout: 10000,
          timeoutMsg: 'Page did not load completely',
        }
      );

      await global.browser.pause(500);

      // Ensure we're in the correct tab (not the WebdriverIO Bidi tab)
      try {
        const windowHandles = await global.browser.getWindowHandles();
        if (windowHandles.length > 1) {
          const currentUrl = await global.browser.getUrl();
          if (!currentUrl || currentUrl === pageUrl) {
            // already in the right tab
          } else {
            await global.browser.switchToWindow(windowHandles[0]);
            await global.browser.pause(200);
          }
        }
      } catch (_switchErr) {
        // ignore and continue
      }

      const urlObj = new URL(pageUrl);
      const pageName =
        urlObj.pathname === '/' || urlObj.pathname === ''
          ? 'home'
          : urlObj.pathname
              .replace(/\//g, '_')
              .replace(/^_|_$/g, '')
              .substring(0, 50) || 'page';

      await getA11yValidator(pageName, { excludeTags, excludeRules, includeTags });

      const pageErrors = getAccessibilityError();
      results.pagesTested++;
      results.totalErrors += pageErrors;

      const pageResult = {
        url: pageUrl,
        pageName,
        errors: pageErrors,
        status: pageErrors > 0 ? 'has_errors' : 'passed',
      };

      results.urls.push(pageResult);
      results.testedPages.push(pageUrl);

      if (pageErrors > 0) {
        results.errors.push({ url: pageUrl, pageName, errors: pageErrors });
      }
    } catch (error) {
      results.errors.push({ url: pageUrl, error: error.message, status: 'error' });
      results.pagesTested++;
      results.testedPages.push(pageUrl);
    }
  }

  const totalEndTime = Date.now();
  const totalDurationMs = totalEndTime - fileStartTime;
  const totalDuration = formatDuration(totalDurationMs);

  // Match crawl-based flow: generate summary whenever at least one page was tested (not only when >1).
  if (results.testedPages.length > 0) {
    await generateComprehensiveReport(results, domain, crawlDuration, totalDuration);
  }

  await accessibilityError(count);

  return results;
}

/**
 * Generates a comprehensive summary report that groups pages by the same accessibility issues
 * @param {Object} results - Test results object
 * @param {string} domain - Domain being tested
 * @param {string} crawlDuration - Duration of crawl
 * @param {string} totalDuration - Total duration (crawl + testing)
 */
async function generateComprehensiveReport(results, domain, crawlDuration, totalDuration) {
  try {
    const envName = global.env?.envName?.toLowerCase() || 'test';
    const browserName = getBrowserNameForReportPath();
    const reportsDir = global.paths?.reports || './reports';
    const summaryDir = `${reportsDir}/summary`;
    const accessibilityReportsDirs = resolveAccessibilityReportsDirs(reportsDir, browserName, envName);

    let uniqueReportPaths = collectJsonPathsFromAccessibilityReportList();
    if (!uniqueReportPaths || uniqueReportPaths.length === 0) {
      const reportFilePaths = [];
      accessibilityReportsDirs.forEach((dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .forEach((f) => reportFilePaths.push(path.join(dir, f)));
      });
      uniqueReportPaths = [...new Set(reportFilePaths)];
    }

    if (uniqueReportPaths.length === 0) {
      console.warn(
        'No accessibility JSON reports found (check reports path and browser/env folder). Skipping comprehensive summary generation.'
      );
      return;
    }

    // Create summary directory if it doesn't exist
    if (!fs.existsSync(summaryDir)) {
      fs.mkdirSync(summaryDir, { recursive: true });
    }

    // Read all individual page reports
    const pageReports = [];
    const summaryDirAbs = path.resolve(summaryDir);

    for (const filePath of uniqueReportPaths) {
      try {
        const file = path.basename(filePath);
        const reportDir = path.dirname(filePath);
        const reportData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Extract page name from filename (same convention as accessibilityLib)
        const pageName = file.replace(`-${browserName}_`, '_').replace('.json', '');
        const pageUrl = reportData.url || '';

        const pageHtmlAbs = path.join(reportDir, file.replace(/\.json$/i, '.html'));
        const localReportHref = fs.existsSync(pageHtmlAbs)
          ? path.relative(summaryDirAbs, pageHtmlAbs).split(path.sep).join('/')
          : null;

        pageReports.push({
          pageName,
          url: pageUrl,
          localReportHref,
          violations: normalizeAxeRuleArray(reportData.violations),
          incomplete: extractIncompleteFromReport(reportData),
          passes: normalizeAxeRuleArray(reportData.passes),
          inapplicable: normalizeAxeRuleArray(reportData.inapplicable),
        });
      } catch (e) {
        console.warn(`Could not read report file ${filePath}: ${e.message}`);
      }
    }
    
    // Group violations by rule ID
    const violationsByRule = {};
    const incompleteByRule = {};
    
    pageReports.forEach((pageReport) => {
      try {
        // Process violations
        pageReport.violations.forEach((violation) => {
          if (!violation || typeof violation !== 'object') return;
          const ruleId = violation.id;
          if (!violationsByRule[ruleId]) {
            violationsByRule[ruleId] = {
              id: ruleId,
              description: violation.description,
              help: violation.help,
              helpUrl: violation.helpUrl,
              impact: violation.impact,
              tags: violation.tags || [],
              pages: [],
              totalInstances: 0,
            };
          }

          const instanceCount = violation.nodes?.length || 0;
          const pageUrl = pageReport.url || pageReport.pageName || '';
          if (pageUrl) {
            violationsByRule[ruleId].pages.push({
              url: pageUrl,
              pageName: pageReport.pageName || pageUrl,
              instances: instanceCount,
              nodes: violation.nodes || [],
              localReportHref: pageReport.localReportHref,
            });
            violationsByRule[ruleId].totalInstances += instanceCount;
          }
        });

        // Process incomplete checks (axe "manual review" bucket only)
        pageReport.incomplete.forEach((incomplete) => {
          if (!incomplete || typeof incomplete !== 'object') return;
          const ruleId =
            incomplete.id != null
              ? incomplete.id
              : incomplete.ruleId != null
                ? incomplete.ruleId
                : '__unknown_rule__';
          if (!incompleteByRule[ruleId]) {
            incompleteByRule[ruleId] = {
              id: ruleId,
              description: incomplete.description,
              help: incomplete.help,
              helpUrl: incomplete.helpUrl,
              impact: incomplete.impact,
              tags: incomplete.tags || [],
              pages: [],
              totalInstances: 0,
            };
          }

          const instanceCount = incomplete.nodes?.length || 0;
          const pageUrl = pageReport.url || pageReport.pageName || 'Unknown page';
          const pageName = pageReport.pageName || pageUrl || 'Unknown page';
          incompleteByRule[ruleId].pages.push({
            url: pageUrl,
            pageName: pageName,
            instances: instanceCount,
            nodes: incomplete.nodes || [],
            localReportHref: pageReport.localReportHref,
          });
          incompleteByRule[ruleId].totalInstances += instanceCount;
        });
      } catch (aggErr) {
        console.warn(`Could not aggregate report for page "${pageReport.pageName}": ${aggErr.message}`);
      }
    });

    const incompleteRowsAcrossPages = pageReports.reduce((n, p) => n + p.incomplete.length, 0);
    console.info(
      `Comprehensive summary: ${uniqueReportPaths.length} page JSON file(s); ${incompleteRowsAcrossPages} incomplete row(s); ${Object.keys(incompleteByRule).length} unique incomplete rule type(s).`
    );
    
    // Calculate statistics
    const totalPages = pageReports.length;
    const pagesWithViolations = new Set();
    const pagesWithIncomplete = new Set();
    
    Object.values(violationsByRule).forEach(rule => {
      rule.pages.forEach(page => pagesWithViolations.add(page.url));
    });
    
    Object.values(incompleteByRule).forEach(rule => {
      rule.pages.forEach(page => pagesWithIncomplete.add(page.url));
    });
    
    // Identify site-wide issues (affecting >50% of pages)
    const siteWideViolations = Object.values(violationsByRule)
      .filter(rule => rule.pages.length > totalPages * 0.5)
      .sort((a, b) => b.pages.length - a.pages.length);
    
    const siteWideIncomplete = Object.values(incompleteByRule)
      .filter(rule => rule.pages.length > totalPages * 0.5)
      .sort((a, b) => b.pages.length - a.pages.length);
    
    // Sort violations by number of affected pages (most common first)
    const sortedViolations = Object.values(violationsByRule)
      .sort((a, b) => b.pages.length - a.pages.length);
    
    const sortedIncomplete = Object.values(incompleteByRule)
      .sort((a, b) => b.pages.length - a.pages.length);
    
    // Generate timestamp
    const timestamp = await dateTime();
    const baseFileName = `comprehensive-summary-${domain}-${timestamp}`;
    
    // Save JSON summary
    const summaryData = {
      domain,
      totalPages,
      pagesWithViolations: pagesWithViolations.size,
      pagesWithIncomplete: pagesWithIncomplete.size,
      totalViolations: Object.keys(violationsByRule).length,
      totalIncomplete: Object.keys(incompleteByRule).length,
      siteWideViolations: siteWideViolations.length,
      siteWideIncomplete: siteWideIncomplete.length,
      crawlDuration,
      totalDuration,
      generatedAt: new Date().toISOString(),
      violationsByRule: sortedViolations,
      incompleteByRule: sortedIncomplete,
      siteWideViolationsList: siteWideViolations,
      siteWideIncompleteList: siteWideIncomplete,
      allPages: pageReports.map(p => ({ url: p.url, pageName: p.pageName, localReportHref: p.localReportHref })),
    };
    
    const jsonFile = `${summaryDir}/${baseFileName}.json`;
    fs.writeFileSync(jsonFile, JSON.stringify(summaryData, null, 2), 'utf-8');
    console.info(`\nComprehensive summary (JSON) saved to: ${jsonFile}`);
    
    // Generate HTML summary report
    const htmlFile = `${summaryDir}/${baseFileName}.html`;
    const htmlContent = generateSummaryHTML(summaryData, sortedViolations, sortedIncomplete, siteWideViolations, siteWideIncomplete);
    fs.writeFileSync(htmlFile, htmlContent, 'utf-8');
    console.info(`Comprehensive summary (HTML) saved to: ${htmlFile}`);
    
  } catch (error) {
    console.warn('Could not generate comprehensive summary report:', error.message);
  }
}

/**
 * Renders the instance count as a link to the per-page HTML report when available.
 * @param {string} [hashFragment] - e.g. '#menu2' for Incomplete (must match utils/ReportSample tab ids)
 */
function instancesCountMarkup(page, hashFragment) {
  const n = page.instances || 0;
  const label = `${n} instance${n !== 1 ? 's' : ''}`;
  const href = page.localReportHref;
  if (href) {
    const safeHref = href.split('/').map(encodeURIComponent).join('/');
    const hash =
      hashFragment && String(hashFragment).trim() !== ''
        ? String(hashFragment).startsWith('#')
          ? hashFragment
          : `#${hashFragment}`
        : '';
    const title =
      hash === '#menu2'
        ? 'Open full page report (Incomplete tab)'
        : hash === '#menu1'
          ? 'Open full page report (Violations tab)'
          : 'Open full page report';
    return `<a href="${safeHref}${hash}" class="instances-count instances-count-link" title="${title}">${label}</a>`;
  }
  return `<span class="instances-count">${label}</span>`;
}

/**
 * Generates HTML content for the comprehensive summary report
 */
function generateSummaryHTML(summaryData, sortedViolations, sortedIncomplete, siteWideViolations, siteWideIncomplete) {
  const { domain, totalPages, pagesWithViolations, pagesWithIncomplete, totalViolations, totalIncomplete, siteWideViolations: siteWideCountFromData, siteWideIncomplete: siteWideIncompleteCount, crawlDuration, totalDuration, generatedAt } = summaryData;
  const esc = escapeHtml;

  const incompleteRules =
    Array.isArray(sortedIncomplete) && sortedIncomplete.length > 0
      ? sortedIncomplete
      : Array.isArray(summaryData.incompleteByRule)
        ? summaryData.incompleteByRule
        : [];
  
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprehensive Accessibility Summary - ${domain}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #f5f5f5; padding: 20px; line-height: 1.6; }
        .container { max-width: 1400px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-bottom: 30px; }
        h2 { color: #34495e; margin-top: 30px; margin-bottom: 15px; padding: 10px; background: #ecf0f1; border-left: 4px solid #3498db; }
        h3 { color: #555; margin-top: 20px; margin-bottom: 10px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-card.warning { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
        .stat-card.success { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
        .stat-card.info { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
        .stat-number { font-size: 2.5em; font-weight: bold; margin: 10px 0; }
        .stat-label { font-size: 0.9em; opacity: 0.9; }
        .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin: 30px 0; }
        .chart-container { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .chart-container h3 { margin-bottom: 15px; color: #34495e; }
        .chart-wrapper { position: relative; height: 300px; }
        .violation-group { margin: 25px 0; padding: 20px; background: #fff; border: 1px solid #ddd; border-radius: 6px; border-left: 4px solid #e74c3c; }
        .violation-group.site-wide { border-left-color: #f39c12; background: #fffbf0; }
        .violation-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .violation-title { font-size: 1.2em; font-weight: bold; color: #2c3e50; }
        .violation-meta { font-size: 0.9em; color: #7f8c8d; }
        .impact-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 0.85em; font-weight: bold; margin-left: 10px; }
        .impact-serious { background: #e74c3c; color: white; }
        .impact-moderate { background: #f39c12; color: white; }
        .impact-minor { background: #3498db; color: white; }
        .impact-critical { background: #8e44ad; color: white; }
        .pages-list { margin-top: 15px; max-height: none; overflow: visible; }
        .page-item { padding: 10px; margin: 5px 0; background: #f8f9fa; border-left: 3px solid #3498db; border-radius: 4px; }
        .page-item:hover { background: #e9ecef; }
        .violation-content { display: block; overflow: visible; transition: max-height 0.4s ease-out, opacity 0.3s ease-out; max-height: 5000px; opacity: 1; }
        .violation-content.collapsed { max-height: 0 !important; opacity: 0; overflow: hidden; padding: 0 !important; margin: 0 !important; }
        .violation-content:not(.collapsed) { max-height: none !important; overflow: visible !important; }
        .page-url { color: #3498db; text-decoration: none; font-weight: 500; }
        .page-url:hover { text-decoration: underline; }
        .instances-count { display: inline-block; background: #e74c3c; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.85em; margin-left: 10px; }
        a.instances-count-link { cursor: pointer; text-decoration: none; color: white; }
        a.instances-count-link:hover { filter: brightness(1.08); text-decoration: underline; }
        .help-link { color: #3498db; text-decoration: none; font-size: 0.9em; }
        .help-link:hover { text-decoration: underline; }
        .tags { margin-top: 10px; }
        .tag { display: inline-block; background: #ecf0f1; padding: 4px 10px; border-radius: 12px; font-size: 0.8em; margin: 3px; color: #555; }
        .summary-section { margin: 30px 0; padding: 20px; background: #f8f9fa; border-radius: 6px; }
        .no-issues { text-align: center; padding: 40px; color: #27ae60; font-size: 1.2em; }
        .site-wide-badge { display: inline-block; background: #f39c12; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.8em; margin-left: 10px; font-weight: bold; }
        .collapsible-header { cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between; }
        .collapsible-header:hover { background: #e8f4f8; }
        .collapse-icon { display: inline-block; margin-right: 10px; transition: transform 0.3s; font-size: 1.2em; }
        .collapse-icon.collapsed { transform: rotate(-90deg); }
        .collapsible-content { display: block; overflow: visible; transition: max-height 0.4s ease-out, opacity 0.3s ease-out; max-height: 50000px; opacity: 1; }
        .collapsible-content.collapsed { max-height: 0 !important; opacity: 0; overflow: hidden; padding: 0 !important; margin: 0 !important; }
        .collapsible-content:not(.collapsed) { max-height: none !important; overflow: visible !important; }
        .section-controls { margin: 10px 0; text-align: right; }
        .section-controls button { background: #3498db; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px; font-size: 0.9em; }
        .section-controls button:hover { background: #2980b9; }
        .violation-toggle { cursor: pointer; }
        .violation-content { display: block; overflow: hidden; transition: max-height 0.4s ease-out, opacity 0.3s ease-out; max-height: 5000px; opacity: 1; }
        .violation-content.collapsed { max-height: 0 !important; opacity: 0; overflow: hidden; padding: 0 !important; margin: 0 !important; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Comprehensive Accessibility Summary</h1>
        <div class="summary-section">
            <h3>Domain: ${domain}</h3>
            <p><strong>Generated:</strong> ${new Date(generatedAt).toLocaleString()}</p>
            <p><strong>Crawl Duration:</strong> ${crawlDuration}</p>
            <p><strong>Total Duration:</strong> ${totalDuration}</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${totalPages}</div>
                <div class="stat-label">Total Pages Tested</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-number">${pagesWithViolations}</div>
                <div class="stat-label">Pages with Violations</div>
            </div>
            <div class="stat-card info">
                <div class="stat-number">${pagesWithIncomplete}</div>
                <div class="stat-label">Pages Needing Review</div>
            </div>
            <div class="stat-card warning">
                <div class="stat-number">${totalViolations}</div>
                <div class="stat-label">Unique Violation Types</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${siteWideCountFromData}</div>
                <div class="stat-label">Site-Wide Issues</div>
            </div>
        </div>
        
        <h2>📈 Visual Analytics</h2>
        <div class="charts-grid">
            <div class="chart-container">
                <h3>Top Violations by Type</h3>
                <div class="chart-wrapper">
                    <canvas id="violationsChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <h3>Impact Level Distribution</h3>
                <div class="chart-wrapper">
                    <canvas id="impactChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <h3>Pages with Most Violations</h3>
                <div class="chart-wrapper">
                    <canvas id="pagesChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <h3>Site-Wide vs Page-Specific Issues</h3>
                <div class="chart-wrapper">
                    <canvas id="scopeChart"></canvas>
                </div>
            </div>
        </div>`;
  
  // Prepare chart data
  const topViolations = sortedViolations.slice(0, 10).map(v => ({
    label: v.help || v.id,
    pages: v.pages.length,
    instances: v.totalInstances
  }));
  
  const impactData = {};
  sortedViolations.forEach(v => {
    const impact = v.impact || 'unknown';
    impactData[impact] = (impactData[impact] || 0) + v.totalInstances;
  });
  
  const pageViolationCounts = {};
  sortedViolations.forEach(rule => {
    rule.pages.forEach(page => {
      if (!pageViolationCounts[page.url]) {
        pageViolationCounts[page.url] = { url: page.url, count: 0 };
      }
      pageViolationCounts[page.url].count += page.instances;
    });
  });
  const topPages = Object.values(pageViolationCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const siteWideCount = sortedViolations.filter(v => v.pages.length > totalPages * 0.5).length;
  const pageSpecificCount = sortedViolations.length - siteWideCount;

  // Site-wide issues section
  if (siteWideViolations.length > 0) {
    html += `
        <div class="section-controls">
            <button onclick="window.toggleAll('siteWideSection', true)">Expand All</button>
            <button onclick="window.toggleAll('siteWideSection', false)">Collapse All</button>
        </div>
        <h2 class="collapsible-header" onclick="window.toggleSection('siteWideSection')" style="cursor: pointer;">
            <span><span class="collapse-icon collapsed" id="siteWideIcon">▼</span>🚨 Site-Wide Issues (Affecting >50% of Pages)</span>
            <span style="font-size: 0.7em; color: #7f8c8d;">(${siteWideViolations.length} issues)</span>
        </h2>
        <div id="siteWideSection" class="collapsible-content collapsed" style="padding: 20px 0;">
            <p style="margin-bottom: 20px; color: #e74c3c; font-weight: bold;">These issues affect most pages and should be fixed first for maximum impact.</p>`;
    
    siteWideViolations.forEach((rule, index) => {
      const impactClass = rule.impact ? `impact-${rule.impact}` : 'impact-moderate';
      const percentage = Math.round((rule.pages.length / totalPages) * 100);
      const title = esc(rule.help || rule.id);
      const desc = esc(rule.description || '');
      const helpUrl = rule.helpUrl ? esc(rule.helpUrl) : '';
      html += `
        <div class="violation-group site-wide">
            <div class="violation-header violation-toggle" onclick="window.toggleViolation('siteWideViolation${index}')" style="cursor: pointer;">
                <div>
                    <span class="collapse-icon" id="siteWideViolation${index}Icon">▼</span>
                    <span class="violation-title">${title}</span>
                    <span class="impact-badge ${impactClass}">${esc(rule.impact || 'unknown')}</span>
                    <span class="site-wide-badge">${percentage}% of pages</span>
                </div>
                <div class="violation-meta">
                    ${rule.totalInstances} total instances across ${rule.pages.length} pages
                </div>
            </div>
            <div id="siteWideViolation${index}" class="violation-content collapsed">
                <p style="margin: 10px 0; color: #555;">${desc}</p>
                ${helpUrl ? `<a href="${helpUrl}" target="_blank" rel="noopener noreferrer" class="help-link">Learn more →</a>` : ''}
                <div class="tags">
                    ${rule.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
                </div>
                <div class="pages-list">
                    <strong>Affected Pages (${rule.pages.length}):</strong>
                    ${rule.pages && rule.pages.length > 0 ? rule.pages.map(page => {
                        const pageUrl = page.url || page.pageName || 'Unknown page';
                        const displayUrl = pageUrl || 'Unknown page';
                        return `
                        <div class="page-item">
                            <a href="${esc(pageUrl)}" target="_blank" rel="noopener noreferrer" class="page-url">${esc(displayUrl)}</a>
                            ${instancesCountMarkup(page, '#menu1')}
                        </div>`;
                    }).join('') : '<p style="color: #999; font-style: italic;">No pages available</p>'}
                </div>
            </div>
        </div>`;
    });
    html += `</div>`;
  }
  
  // All violations section
  if (sortedViolations.length > 0) {
    html += `
        <div class="section-controls">
            <button onclick="window.toggleAll('allViolationsSection', true)">Expand All</button>
            <button onclick="window.toggleAll('allViolationsSection', false)">Collapse All</button>
        </div>
        <h2 class="collapsible-header" onclick="window.toggleSection('allViolationsSection')" style="cursor: pointer;">
            <span><span class="collapse-icon collapsed" id="allViolationsIcon">▼</span>⚠️ All Violations (Grouped by Issue Type)</span>
            <span style="font-size: 0.7em; color: #7f8c8d;">(${sortedViolations.length} issues)</span>
        </h2>
        <div id="allViolationsSection" class="collapsible-content collapsed" style="padding: 20px 0;">
            <p style="margin-bottom: 20px;">Pages are grouped by the same accessibility issues. Fixing a common issue once can help multiple pages.</p>`;
    
    sortedViolations.forEach((rule, index) => {
      const isSiteWide = rule.pages.length > totalPages * 0.5;
      const impactClass = rule.impact ? `impact-${rule.impact}` : 'impact-moderate';
      const title = esc(rule.help || rule.id);
      const desc = esc(rule.description || '');
      const helpUrl = rule.helpUrl ? esc(rule.helpUrl) : '';
      html += `
        <div class="violation-group ${isSiteWide ? 'site-wide' : ''}">
            <div class="violation-header violation-toggle" onclick="window.toggleViolation('allViolation${index}')" style="cursor: pointer;">
                <div>
                    <span class="collapse-icon collapsed" id="allViolation${index}Icon">▼</span>
                    <span class="violation-title">${title}</span>
                    <span class="impact-badge ${impactClass}">${esc(rule.impact || 'unknown')}</span>
                    ${isSiteWide ? '<span class="site-wide-badge">Site-Wide</span>' : ''}
                </div>
                <div class="violation-meta">
                    ${rule.totalInstances} instances on ${rule.pages.length} page${rule.pages.length !== 1 ? 's' : ''}
                </div>
            </div>
            <div id="allViolation${index}" class="violation-content collapsed">
                <p style="margin: 10px 0; color: #555;">${desc}</p>
                ${helpUrl ? `<a href="${helpUrl}" target="_blank" rel="noopener noreferrer" class="help-link">Learn more →</a>` : ''}
                <div class="tags">
                    ${rule.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
                </div>
                <div class="pages-list">
                    <strong>Pages with this issue (${rule.pages.length}):</strong>
                    ${rule.pages && rule.pages.length > 0 ? rule.pages.map(page => {
                        const pageUrl = page.url || page.pageName || 'Unknown page';
                        const displayUrl = pageUrl || 'Unknown page';
                        return `
                        <div class="page-item">
                            <a href="${esc(pageUrl)}" target="_blank" rel="noopener noreferrer" class="page-url">${esc(displayUrl)}</a>
                            ${instancesCountMarkup(page, '#menu1')}
                        </div>`;
                    }).join('') : '<p style="color: #999; font-style: italic;">No pages available</p>'}
                </div>
            </div>
        </div>`;
    });
    html += `</div>`;
  } else if (incompleteRules.length > 0) {
    html += `
        <div class="summary-section" style="background: #fff8e6; border-left: 4px solid #f39c12;">
            <p><strong>No automated violations</strong> (failed axe checks) were reported on these pages.</p>
            <p style="margin-top: 8px;">There are still <strong>incomplete</strong> findings below that need manual review.</p>
        </div>`;
  } else {
    html += `
        <div class="no-issues">
            ✅ No violations found across all pages!
        </div>`;
  }
  
  // Incomplete checks section (axe “needs review” bucket) — expanded by default so manual review is visible
  if (incompleteRules.length > 0) {
    html += `
        <div class="section-controls">
            <button onclick="window.toggleAll('incompleteSection', true)">Expand All</button>
            <button onclick="window.toggleAll('incompleteSection', false)">Collapse All</button>
        </div>
        <h2 class="collapsible-header" onclick="window.toggleSection('incompleteSection')" style="cursor: pointer;">
            <span><span class="collapse-icon collapsed" id="incompleteIcon">▼</span>🔍 Issues Needing Manual Review</span>
            <span style="font-size: 0.7em; color: #7f8c8d;">(${incompleteRules.length} issues)</span>
        </h2>
        <div id="incompleteSection" class="collapsible-content collapsed" style="padding: 20px 0;">
            <p style="margin-bottom: 20px;">These incomplete checks require manual verification to determine if they are real issues.</p>`;
    
    incompleteRules.forEach((rule, index) => {
      const isSiteWide = rule.pages.length > totalPages * 0.5;
      const title = esc(rule.help || rule.id);
      const desc = esc(rule.description || '');
      const helpUrl = rule.helpUrl ? esc(rule.helpUrl) : '';
      html += `
        <div class="violation-group ${isSiteWide ? 'site-wide' : ''}">
            <div class="violation-header violation-toggle" onclick="window.toggleViolation('incompleteViolation${index}')" style="cursor: pointer;">
                <div>
                    <span class="collapse-icon collapsed" id="incompleteViolation${index}Icon">▼</span>
                    <span class="violation-title">${title}</span>
                    ${isSiteWide ? '<span class="site-wide-badge">Site-Wide</span>' : ''}
                </div>
                <div class="violation-meta">
                    ${rule.totalInstances} instances on ${rule.pages.length} page${rule.pages.length !== 1 ? 's' : ''}
                </div>
            </div>
            <div id="incompleteViolation${index}" class="violation-content collapsed">
                <p style="margin: 10px 0; color: #555;">${desc}</p>
                ${helpUrl ? `<a href="${helpUrl}" target="_blank" rel="noopener noreferrer" class="help-link">Learn more →</a>` : ''}
                ${rule.tags && rule.tags.length > 0 ? `
                <div class="tags">
                    ${rule.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
                </div>` : ''}
                <div class="pages-list">
                    <strong>Pages needing review (${rule.pages ? rule.pages.length : 0}):</strong>
                    ${rule.pages && rule.pages.length > 0 ? rule.pages.map(page => {
                        const pageUrl = page.url || page.pageName || 'Unknown page';
                        const displayUrl = pageUrl || 'Unknown page';
                        return `
                        <div class="page-item">
                            <a href="${esc(pageUrl)}" target="_blank" rel="noopener noreferrer" class="page-url">${esc(displayUrl)}</a>
                            ${instancesCountMarkup(page, '#menu2')}
                        </div>`;
                    }).join('') : '<p style="color: #999; font-style: italic; padding: 10px;">No pages available</p>'}
                </div>
            </div>
        </div>`;
    });
    html += `</div>`;
  }

  // Charts + UI handlers after all sections so a malformed chart payload cannot prevent
  // violation/incomplete HTML from being parsed (e.g. "</script>" in embedded JSON).
  html += `
    <script>
(function() {
    try {
        // Top Violations Chart
        const violationsCtx = document.getElementById('violationsChart').getContext('2d');
        new Chart(violationsCtx, {
            type: 'bar',
            data: {
                labels: ${jsonForInlineScript(topViolations.map(v => v.label.length > 30 ? v.label.substring(0, 30) + '...' : v.label))},
                datasets: [{
                    label: 'Affected Pages',
                    data: ${jsonForInlineScript(topViolations.map(v => v.pages))},
                    backgroundColor: 'rgba(231, 76, 60, 0.8)',
                    borderColor: 'rgba(231, 76, 60, 1)',
                    borderWidth: 1
                }, {
                    label: 'Total Instances',
                    data: ${jsonForInlineScript(topViolations.map(v => v.instances))},
                    backgroundColor: 'rgba(243, 156, 18, 0.8)',
                    borderColor: 'rgba(243, 156, 18, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
        
        // Impact Level Distribution Chart
        const impactCtx = document.getElementById('impactChart').getContext('2d');
        const impactLabels = ${jsonForInlineScript(Object.keys(impactData))};
        const impactColors = {
            'critical': 'rgba(142, 68, 173, 0.8)',
            'serious': 'rgba(231, 76, 60, 0.8)',
            'moderate': 'rgba(243, 156, 18, 0.8)',
            'minor': 'rgba(52, 152, 219, 0.8)',
            'unknown': 'rgba(149, 165, 166, 0.8)'
        };
        new Chart(impactCtx, {
            type: 'doughnut',
            data: {
                labels: impactLabels,
                datasets: [{
                    data: ${jsonForInlineScript(Object.values(impactData))},
                    backgroundColor: impactLabels.map(label => impactColors[label] || impactColors['unknown']),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
        
        // Pages with Most Violations Chart
        const pagesCtx = document.getElementById('pagesChart').getContext('2d');
        new Chart(pagesCtx, {
            type: 'bar',
            data: {
                labels: ${jsonForInlineScript(topPages.map(p => {
                  const url = p.url.length > 40 ? p.url.substring(0, 40) + '...' : p.url;
                  return url;
                }))},
                datasets: [{
                    label: 'Violation Instances',
                    data: ${jsonForInlineScript(topPages.map(p => p.count))},
                    backgroundColor: 'rgba(52, 152, 219, 0.8)',
                    borderColor: 'rgba(52, 152, 219, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Violations: ' + context.parsed.x;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true
                    }
                }
            }
        });
        
        // Site-Wide vs Page-Specific Chart
        const scopeCtx = document.getElementById('scopeChart').getContext('2d');
        new Chart(scopeCtx, {
            type: 'pie',
            data: {
                labels: ['Site-Wide Issues', 'Page-Specific Issues'],
                datasets: [{
                    data: [${siteWideCount}, ${pageSpecificCount}],
                    backgroundColor: [
                        'rgba(243, 156, 18, 0.8)',
                        'rgba(52, 152, 219, 0.8)'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = ${Math.max(1, siteWideCount + pageSpecificCount)};
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
    } catch (chartErr) {
        console.warn('Summary charts could not be rendered:', chartErr);
    }
})();
    </script>
    <script>
        window.toggleSection = function(sectionId) {
            console.log('toggleSection called with:', sectionId);
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId + 'Icon');
            if (section) {
                const isCollapsed = section.classList.contains('collapsed');
                if (isCollapsed) {
                    section.classList.remove('collapsed');
                    section.style.maxHeight = 'none';
                    const height = section.scrollHeight;
                    section.style.maxHeight = height + 'px';
                    if (icon) {
                        icon.classList.remove('collapsed');
                    }
                    setTimeout(function() {
                        section.style.maxHeight = 'none';
                    }, 400);
                } else {
                    const currentHeight = section.scrollHeight;
                    section.style.maxHeight = currentHeight + 'px';
                    section.offsetHeight;
                    section.classList.add('collapsed');
                    section.style.maxHeight = '0';
                    if (icon) {
                        icon.classList.add('collapsed');
                    }
                }
            } else {
                console.error('Section not found:', sectionId);
            }
        };
        
        window.toggleViolation = function(violationId) {
            console.log('toggleViolation called with:', violationId);
            const violation = document.getElementById(violationId);
            const icon = document.getElementById(violationId + 'Icon');
            if (violation) {
                const isCollapsed = violation.classList.contains('collapsed');
                if (isCollapsed) {
                    violation.classList.remove('collapsed');
                    violation.style.maxHeight = 'none';
                    const height = violation.scrollHeight;
                    violation.style.maxHeight = height + 'px';
                    if (icon) {
                        icon.classList.remove('collapsed');
                    }
                    setTimeout(function() {
                        violation.style.maxHeight = 'none';
                    }, 400);
                } else {
                    const currentHeight = violation.scrollHeight;
                    violation.style.maxHeight = currentHeight + 'px';
                    violation.offsetHeight;
                    violation.classList.add('collapsed');
                    violation.style.maxHeight = '0';
                    if (icon) {
                        icon.classList.add('collapsed');
                    }
                }
            } else {
                console.error('Violation not found:', violationId);
            }
        };
        
        window.toggleAll = function(sectionId, expand) {
            console.log('toggleAll called with:', sectionId, expand);
            const section = document.getElementById(sectionId);
            if (!section) {
                console.error('Section not found:', sectionId);
                return;
            }
            
            if (expand && section.classList.contains('collapsed')) {
                const sectionIcon = document.getElementById(sectionId + 'Icon');
                section.classList.remove('collapsed');
                section.style.maxHeight = section.scrollHeight + 'px';
                if (sectionIcon) {
                    sectionIcon.classList.remove('collapsed');
                }
                setTimeout(function() {
                    toggleViolationsInSection(sectionId, expand);
                }, 50);
            } else {
                toggleViolationsInSection(sectionId, expand);
            }
        };
        
        function toggleViolationsInSection(sectionId, expand) {
            const section = document.getElementById(sectionId);
            if (!section) return;
            
            const violations = section.querySelectorAll('.violation-content');
            console.log('Found violations:', violations.length);
            violations.forEach((v) => {
                const id = v.id;
                const icon = document.getElementById(id + 'Icon');
                if (expand) {
                    v.classList.remove('collapsed');
                    v.style.maxHeight = 'none';
                    const height = v.scrollHeight;
                    v.style.maxHeight = height + 'px';
                    if (icon) icon.classList.remove('collapsed');
                    setTimeout(function() {
                        v.style.maxHeight = 'none';
                    }, 400);
                } else {
                    const currentHeight = v.scrollHeight;
                    v.style.maxHeight = currentHeight + 'px';
                    v.offsetHeight;
                    v.classList.add('collapsed');
                    v.style.maxHeight = '0';
                    if (icon) icon.classList.add('collapsed');
                }
            });
        }
    </script>`;
  
  html += `
    </div>
</body>
</html>`;
  
  return html;
}

/**
 * function for recording total errors from the Accessibility test run
 */
async function accessibilityError(count) {
  const totalError = getAccessibilityTotalError();
  const etotalError = getAccessibilityError();
  if (totalError > 0) {
    // cucumberThis.attach('The accessibility rule violation has been observed');
    // cucumberThis.attach(`accessibility error count per page : ${etotalError}`);
    if (count) {
      // cucumberThis.attach(`Total accessibility error count : ${totalError}`);
    }
  } else if (totalError <= 0) {
    const violationcount = getAccessibilityError();
    // assert.equal(violationcount, 0);
  }
}

module.exports = { 
  a11yValidator,
  a11yValidatorFromUrl,
  a11yValidatorFromPagesFile,
  generateComprehensiveReport,
};
