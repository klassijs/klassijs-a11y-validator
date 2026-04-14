/**
 * Example: Running Accessibility Tests on a Real Website
 * 
 * This example demonstrates how to use klassijs-a11y-validator
 * to test a real website for accessibility issues.
 * 
 * Prerequisites:
 * 1. Install webdriverio: pnpm add -D webdriverio
 * 2. Install browser driver (choose one):
 *    - Chrome: brew install chromedriver (macOS) or download from chromedriver.chromium.org
 *    - Safari: Built-in on macOS (no driver needed)
 *    - Firefox: brew install geckodriver
 * 3. Make sure you have the browser installed
 * 
 * Usage:
 *   # Run full accessibility tests by crawling from a start URL
 *   node src/run-a11y-test.js https://example.com
 *   
 *   # Only crawl and discover pages (no accessibility testing)
 *   node src/run-a11y-test.js https://example.com --crawl-only
 *   # OR
 *   CRAWL_ONLY=true node src/run-a11y-test.js https://example.com
 *
 *   # Test only specific pages (single or multiple), no crawling
 *   node src/run-a11y-test.js --pages https://example.com/about
 *   node src/run-a11y-test.js https://example.com --pages /,/about,/contact
 *   node src/run-a11y-test.js --base-url https://example.com --pages /,/about,/contact
 *   node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.txt
 *   node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv
 *   node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv --csv-ignore-columns notes,status
 *   node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv --csv-ignore-columns 2,3
 *   node src/run-a11y-test.js --from-sitemap https://example.com
 *   node src/run-a11y-test.js --from-sitemap --base-url https://example.com --sitemap-url https://example.com/sitemap.xml
 *   
 *   # With different browser
 *   BROWSER=safari node src/run-a11y-test.js https://example.com
 *   BROWSER=firefox node src/run-a11y-test.js https://example.com --crawl-only
 *
 *   # Prefer sitemap URL list before link crawl: --sitemap-first or SITEMAP_FIRST=true
 *
 *   # Override crawl size: A11Y_MAX_PAGES=25 node src/run-a11y-test.js https://example.com
 *
 *   # Browser: same locally and in CI — explicit --pages / file / sitemap → headless; crawl from URL → visible.
 *   # Override: HEADLESS=true|false, VISIBLE_BROWSER=1. In CI, crawl may need: xvfb-run node src/run-a11y-test.js …
 */

const { remote } = require('webdriverio');
const { a11yValidatorFromUrl, a11yValidator, generateComprehensiveReport } = require('../index');
const { astellen } = require('klassijs-astellen');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { authenticate, normalizePathPrefix, isWithinPathPrefix } = require('./urlCrawler');
const { buildAuthConfig } = require('./auth');
const {
  discoverPagesFromSitemap,
  extractSitemapUrlsFromRobotsTxt,
  extractLocUrlsFromXml,
} = require('./sitemapDiscovery');

// Configuration for the browser
// Option 1: Use Chrome (requires chromedriver)
// Option 2: Use Safari (works on macOS without additional drivers)
// Option 3: Use Firefox (requires geckodriver)

// Set custom cache directory if provided (fixes permission issues)
// WebdriverIO uses TMPDIR or creates cache in system temp
// Setting a user-writable directory avoids permission errors
let cacheDir;
if (process.env.CACHE_DIR) {
  cacheDir = path.resolve(process.env.CACHE_DIR);
} else {
  // Use home directory as fallback to avoid permission issues
  cacheDir = path.join(os.homedir(), '.webdriverio-cache');
}

// Ensure cache directory exists and is writable BEFORE WebdriverIO tries to use it
try {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
  }
  
  // Test write permissions
  const testFile = path.join(cacheDir, '.test-write');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  
  // Set environment variables that WebdriverIO uses for cache directory
  // WebdriverIO's @wdio/utils uses os.tmpdir() which checks TMPDIR, TEMP, or TMP
  // IMPORTANT: Set these BEFORE any WebdriverIO code runs
  process.env.TMPDIR = cacheDir;
  process.env.TEMP = cacheDir;
  process.env.TMP = cacheDir;

  // Also set the specific cache directory env var if WebdriverIO supports it
  process.env.WEBDRIVER_CACHE_DIR = cacheDir;
} catch (err) {
  console.error(`❌ Error: Could not create/access cache directory ${cacheDir}: ${err.message}`);
  console.error('Please check permissions or set CACHE_DIR to a writable directory.');
  process.exit(1);
}

// Browser: explicit pages / URL list → headless; crawl-from-start-URL → visible (same in CI and locally).
// Override: HEADLESS=true|false, VISIBLE_BROWSER=1. CI does not change defaults; use xvfb-run in CI if crawl needs a display.
function resolveHeadlessChrome(mode) {
  if (process.env.VISIBLE_BROWSER === '1') return false;
  if (process.env.HEADLESS === 'false' || process.env.HEADLESS === '0') return false;
  if (process.env.HEADLESS === 'true' || process.env.HEADLESS === '1') return true;
  return mode === 'pages';
}

function buildBrowserOptions(headlessChrome) {
  const chromeArgs = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (headlessChrome) {
    chromeArgs.unshift('--window-size=1920,1080');
    chromeArgs.unshift('--headless=new');
  }
  return {
    capabilities: {
      browserName: process.env.BROWSER || 'chrome',
      'goog:chromeOptions': {
        args: chromeArgs,
      },
    },
    services:
      process.env.BROWSER === 'chrome' || !process.env.BROWSER
        ? (() => {
            try {
              require.resolve('@wdio/chromedriver-service');
              return [['chromedriver', { cacheDir: cacheDir }]];
            } catch (e) {
              return undefined;
            }
          })()
        : undefined,
    logLevel: 'warn',
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
  };
}

// Configuration for paths and environment
// These are required by the accessibility library
const setupGlobals = (browserName = 'chrome') => {
  global.browserName = browserName;
  astellen.set('BROWSER_NAME', global.browserName);

  // Set environment name (used in report paths)
  global.env = {
    envName: process.env.ENV_NAME || 'test',
  };

  // Set reports directory path
  global.paths = {
    reports: process.env.REPORTS_PATH || './reports',
  };

  // Initialize accessibility report list
  global.accessibilityReportList = [];
};

const getCliValue = (args, flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
};

const cleanUrlInput = (input) => {
  if (input === null || input === undefined) return '';
  let value = String(input);
  // Remove BOM and common zero-width characters that can appear in CSV exports
  value = value.replace(/^\uFEFF/, '');
  value = value.replace(/[\u200B-\u200D\u2060]/g, '');
  // Normalize non-breaking/odd whitespace to normal spaces, then trim
  value = value.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  // Remove ASCII control characters (including NULL) that can break URL parsing
  value = value.replace(/[\u0000-\u001F\u007F]/g, '');
  value = value.trim();
  // Strip surrounding single/double quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
};

const describeHiddenChars = (value) => {
  const s = String(value);
  const codes = [];
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127 || code === 160) {
      codes.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
  return codes.length > 0 ? codes.join(', ') : null;
};

const normalizeUrl = (input, baseUrl) => {
  const cleaned = cleanUrlInput(input);
  const looksLikeHost =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(cleaned) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/.*)?$/i.test(cleaned);
  const withScheme =
    cleaned && !/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) && looksLikeHost
      ? `https://${cleaned}`
      : cleaned;
  try {
    return new URL(withScheme, baseUrl).href;
  } catch (error) {
    const hidden = describeHiddenChars(input) || describeHiddenChars(cleaned);
    if (hidden) {
      throw new Error(`Invalid URL provided: ${JSON.stringify(cleaned)} (hidden chars: ${hidden})`);
    }
    throw new Error(`Invalid URL provided: ${JSON.stringify(cleaned)}`);
  }
};

const sanitizePageName = (url) => {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname === '/' ? 'home' : parsed.pathname.replace(/^\/+/, '');
    return `${parsed.hostname}-${pathName}`
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  } catch (_error) {
    return 'page';
  }
};

const parseSimpleCsvRows = (content) => {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1;
      }
      row.push(cell.trim());
      cell = '';
      rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
};

const parseCsvIgnoreColumns = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseCommaSeparated = (value) => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const isIgnorableExecutionError = (message) => {
  if (!message) return false;
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes('webdriver bidi command "script.callfunction" failed') ||
    normalized.includes('cannot find context with specified id') ||
    normalized.includes('no such frame') ||
    normalized.includes('browsingcontext')
  );
};

const looksLikeUrlOrPath = (value) => {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  );
};

const getPagesFromFile = (pagesFilePath, options = {}) => {
  const extension = path.extname(pagesFilePath).toLowerCase();
  const fileContent = fs.readFileSync(pagesFilePath, 'utf8');

  if (extension === '.csv') {
    const rows = parseSimpleCsvRows(fileContent);
    const ignoreColumnSpecs = options.csvIgnoreColumns || [];
    const values = [];
    const firstRow = rows[0] || [];
    const headerRow = firstRow.map((value) => value.trim().toLowerCase());
    const hasHeaderRow = headerRow.some((value) =>
      ['url', 'urls', 'path', 'paths'].includes(value)
    );

    const ignoredIndexes = new Set();
    const ignoredNames = new Set(
      ignoreColumnSpecs
        .filter((entry) => Number.isNaN(Number(entry)))
        .map((entry) => entry.toLowerCase())
    );

    ignoreColumnSpecs.forEach((entry) => {
      const index = Number(entry);
      if (Number.isInteger(index) && index >= 0) {
        ignoredIndexes.add(index);
      }
    });

    if (hasHeaderRow && ignoredNames.size > 0) {
      headerRow.forEach((name, index) => {
        if (ignoredNames.has(name)) {
          ignoredIndexes.add(index);
        }
      });
    }

    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (ignoredIndexes.has(colIndex)) return;

        const value = cell.trim();
        const lower = value.toLowerCase();
        if (!value || value.startsWith('#')) return;
        if (
          rowIndex === 0 &&
          (lower === 'url' || lower === 'urls' || lower === 'path' || lower === 'paths')
        ) {
          return;
        }
        if (!looksLikeUrlOrPath(value)) {
          return;
        }
        values.push(value);
      });
    });

    return values;
  }

  return fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
};

const parseCliOptions = async () => {
  const args = process.argv.slice(2);
  const baseUrlArg = getCliValue(args, '--base-url');
  const pagesArg = getCliValue(args, '--pages');
  const pagesFileArg = getCliValue(args, '--pages-file');
  const sitemapUrlArg = getCliValue(args, '--sitemap-url');
  const csvIgnoreColumnsArg = getCliValue(args, '--csv-ignore-columns');
  const includeTagsArg = getCliValue(args, '--include-tags');
  const excludeTagsArg = getCliValue(args, '--exclude-tags');
  const excludeRulesArg = getCliValue(args, '--exclude-rules');
  const fromSitemap = args.includes('--from-sitemap');
  const crawlOnly = process.env.CRAWL_ONLY === 'true' || args.includes('--crawl-only');
  const sitemapFirst =
    process.env.SITEMAP_FIRST === 'true' || args.includes('--sitemap-first');

  const loginUrlArg = getCliValue(args, '--login-url');
  const usernameArg = getCliValue(args, '--username');
  const passwordArg = getCliValue(args, '--password');

  // First non-flag argument that looks like a URL is treated as positional base URL.
  // This prevents file paths like "./pages.csv" from being misinterpreted as a base URL.
  const positionalUrl = args.find(
    (arg) =>
      !arg.startsWith('--') &&
      (String(arg).startsWith('http://') || String(arg).startsWith('https://'))
  );
  const baseUrl = baseUrlArg || positionalUrl || null;

  const authConfig = buildAuthConfig({
    loginUrl: loginUrlArg || process.env.LOGIN_URL || null,
    username: usernameArg || process.env.A11Y_USERNAME || null,
    password: passwordArg || process.env.A11Y_PASSWORD || null,
  });

  let pages = [];
  if (pagesArg) {
    pages = pagesArg
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizeUrl(value, baseUrl || undefined));
  }

  if (pagesFileArg) {
    const pagesFilePath = path.resolve(pagesFileArg);
    if (!fs.existsSync(pagesFilePath)) {
      throw new Error(`Pages file not found: ${pagesFilePath}`);
    }

    const filePages = getPagesFromFile(pagesFilePath, {
      csvIgnoreColumns: parseCsvIgnoreColumns(csvIgnoreColumnsArg),
    })
      .map((value) => normalizeUrl(value, baseUrl || undefined));

    pages = [...pages, ...filePages];
  }

  if (fromSitemap) {
    const sitemapUrls = sitemapUrlArg
      ? sitemapUrlArg
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => normalizeUrl(value, baseUrl || undefined))
      : [];

    let sitemapPages = await discoverPagesFromSitemap({
      baseUrl,
      sitemapUrls,
    });
    try {
      const pp = normalizePathPrefix(new URL(baseUrl).pathname);
      if (pp !== '/') {
        sitemapPages = sitemapPages.filter((u) => isWithinPathPrefix(u, pp));
      }
    } catch (_e) {
      // keep full sitemap list if base URL is invalid
    }
    pages = [...pages, ...sitemapPages];
  }

  // De-duplicate while preserving order.
  pages = [...new Set(pages)];

  return {
    baseUrl,
    pages,
    crawlOnly,
    fromSitemap,
    sitemapFirst,
    authConfig,
    a11yRuleOptions: {
      includeTags: parseCommaSeparated(includeTagsArg || process.env.A11Y_INCLUDE_TAGS),
      excludeTags: parseCommaSeparated(excludeTagsArg || process.env.A11Y_EXCLUDE_TAGS),
      excludeRules: parseCommaSeparated(excludeRulesArg || process.env.A11Y_EXCLUDE_RULES),
    },
    mode: pages.length > 0 ? 'pages' : 'crawl',
  };
};

async function runAccessibilityTest() {
  const options = await parseCliOptions();
  const testUrl = options.baseUrl;
  const authConfig = options.authConfig;
  const a11yRuleOptions = options.a11yRuleOptions || {};

  if (options.mode === 'crawl' && !testUrl) {
    console.error('❌ Missing URL.');
    console.error('Usage examples:');
    console.error('  node src/run-a11y-test.js https://example.com');
    console.error('  node src/run-a11y-test.js --pages https://example.com/about');
    console.error('  node src/run-a11y-test.js https://example.com --pages /,/about,/contact');
    console.error('  node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.txt');
    console.error('  node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv');
    console.error('  node src/run-a11y-test.js --from-sitemap https://example.com');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Accessibility Test Runner');
  console.log('='.repeat(60));
  if (options.mode === 'pages') {
    console.log(`Testing ${options.pages.length} specific page(s)\n`);
    if (options.fromSitemap) {
      console.log('Source: sitemap discovery');
    }
  } else {
    console.log(`Testing URL: ${testUrl}\n`);
  }

  let browser;

  const headlessChrome = resolveHeadlessChrome(options.mode);
  const browserOptions = buildBrowserOptions(headlessChrome);

  try {
    setupGlobals(browserOptions.capabilities.browserName || 'chrome');

    // Initialize the browser
    console.log('Initializing browser...');
    console.log(`Using browser: ${browserOptions.capabilities.browserName}`);
    const isChrome = !process.env.BROWSER || process.env.BROWSER === 'chrome';
    if (isChrome) {
      const modeLabel = options.mode === 'pages' ? 'explicit URL list' : 'crawl from start URL';
      console.log(
        headlessChrome
          ? `Chrome: headless (--headless=new) — ${modeLabel}`
          : `Chrome: visible window — ${modeLabel}`
      );
    }

    try {
      browser = await remote(browserOptions);
      global.browser = browser;
      console.log('Browser initialized successfully!\n');
    } catch (browserError) {
      const errorMsg = browserError.message || '';
      const isPermissionError = errorMsg.includes('EACCES') || errorMsg.includes('permission denied');
      const isDriverError = errorMsg.includes('chromedriver') || errorMsg.includes('executable') || errorMsg.includes('geckodriver');
      
      if (isPermissionError || isDriverError) {
        console.error('\n❌ Browser Driver Error Detected!');
        
        if (isPermissionError) {
          console.error('\n⚠️  Permission Denied Error:');
          console.error('   WebdriverIO cannot create the driver cache directory.');
          console.error('\n   Quick Fix - Use a custom cache directory:');
          console.error(`   CACHE_DIR=~/.webdriverio-cache node examples/run-a11y-test.js ${testUrl}`);
          console.error('\n   Or fix permissions on the temp directory:');
          console.error('   sudo chmod 1777 /var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T');
          console.error('   (Replace with your actual temp directory path)');
        }
        
        console.error('\nTroubleshooting options:');
        console.error('1. Use Safari (easiest on macOS, no drivers needed):');
        console.error(`   BROWSER=safari node examples/run-a11y-test.js ${testUrl}`);
        console.error('\n2. Install chromedriver manually (bypasses auto-download):');
        console.error('   macOS: brew install chromedriver');
        console.error('   Or download from: https://chromedriver.chromium.org/');
        console.error('   Make sure it\'s in your PATH: which chromedriver');
        console.error('\n3. Use Firefox instead:');
        console.error('   brew install geckodriver');
        console.error(`   BROWSER=firefox node examples/run-a11y-test.js ${testUrl}`);
        console.error('\n4. Set custom cache directory (fixes permission issues):');
        console.error(`   CACHE_DIR=~/.webdriverio-cache node examples/run-a11y-test.js ${testUrl}`);
        console.error('   Or export it: export CACHE_DIR=~/.webdriverio-cache');
        console.error('\n5. Clean and retry:');
        console.error('   rm -rf /tmp/chromedriver* ~/.webdriverio-cache');
        console.error(`   Then: node examples/run-a11y-test.js ${testUrl}\n`);
      }
      throw browserError;
    }
    
    const testStartTime = Date.now();
    let results;
    let executionErrors = [];

    const runPagesModeTests = async (pagesToTest, summaryLabel) => {
      const pageErrors = [];
      const pagesWithA11yIssues = [];
      const localExecutionErrors = [];

      // Reset counters for a clean run (provided by the module)
      if (global.accessibilityLib && typeof global.accessibilityLib.resetErrorCounts === 'function') {
        global.accessibilityLib.resetErrorCounts();
      }

      for (const pageUrl of pagesToTest) {
        console.log(`\nTesting page: ${pageUrl}`);
        try {
          await browser.url(pageUrl);
          const reportName = sanitizePageName(pageUrl);
          await a11yValidator(reportName, true, a11yRuleOptions);

          // Track per-page and total errors (if available)
          const perPageErrors =
            global.accessibilityLib && typeof global.accessibilityLib.getAccessibilityError === 'function'
              ? global.accessibilityLib.getAccessibilityError()
              : null;
          if (typeof perPageErrors === 'number' && perPageErrors > 0) {
            pagesWithA11yIssues.push({ url: pageUrl, errors: perPageErrors });
          }
        } catch (pageError) {
          if (isIgnorableExecutionError(pageError.message)) {
            localExecutionErrors.push({
              url: pageUrl,
              error: pageError.message,
            });
            continue;
          }

          pageErrors.push({
            url: pageUrl,
            error: pageError.message,
          });
        }
      }

      const totalErrors =
        global.accessibilityLib && typeof global.accessibilityLib.getAccessibilityTotalError === 'function'
          ? global.accessibilityLib.getAccessibilityTotalError()
          : null;

      const localResults = {
        mode: 'pages',
        crawlOnly: false,
        totalPages: pagesToTest.length,
        pagesTested: pagesToTest.length,
        totalErrors,
        errors: [...pagesWithA11yIssues, ...pageErrors],
      };

      // Match crawl+test behavior: generate one consolidated summary whenever at least one page was tested.
      if (pagesToTest.length >= 1) {
        const firstUrl = pagesToTest[0];
        const domain = new URL(firstUrl).hostname.replace(/^www\./, '');
        const totalDurationMs = Date.now() - testStartTime;
        const totalDuration = `${Math.max(1, Math.round(totalDurationMs / 1000))}s`;
        await generateComprehensiveReport(localResults, domain, '0s', totalDuration);
        if (summaryLabel) {
          console.log(`Consolidated summary generated (${summaryLabel}).`);
        }
      }
      return { results: localResults, executionErrors: localExecutionErrors };
    };

    if (options.mode === 'pages') {
      console.log(
        `Explicit page mode (${options.pages.length} URL(s)): --pages, --pages-file, or --from-sitemap — crawl is disabled; totalPages equals this list only.`
      );
      if (authConfig) {
        console.log('Authenticating before explicit page tests...');
        await authenticate(authConfig);
      }
      const pageRun = await runPagesModeTests(options.pages, 'explicit pages mode');
      results = pageRun.results;
      executionErrors = pageRun.executionErrors;
    } else {
      // Same defaults + options as a minimal consumer (only count, crawlOnly, maxPages, maxDepth,
      // skipPrivatePages). Do not add excludePaths/privatePageIndicators here — that diverged from
      // `require('…')` usage and changed discovery. CLI-only: auth + axe tag/rule filters.
      const crawlOnly = options.crawlOnly;
      const useSitemapFirst = options.sitemapFirst === true;
      // Match typical project usage: maxPages 10, maxDepth 50 (override with A11Y_MAX_PAGES).
      const rawMaxPages = Number.parseInt(process.env.A11Y_MAX_PAGES || '10', 10);
      const crawlMaxPages =
        Number.isFinite(rawMaxPages) && rawMaxPages > 0 ? rawMaxPages : 10;
      if (headlessChrome) {
        console.warn('');
        console.warn(
          '⚠️  Link crawling from a start URL is unreliable in headless Chrome on many sites (often only 1 page).'
        );
        console.warn(
          '   Use a visible browser (omit HEADLESS / set HEADLESS=false), or use --pages, --from-sitemap, or sitemapFirst in code.'
        );
        console.warn('');
      }
      console.log(
        `Crawl mode → a11yValidatorFromUrl (maxPages=${crawlMaxPages}, maxDepth=50, sitemapFirst=${useSitemapFirst}). Same API as require('klassijs-a11y-validator').`
      );
      results = await a11yValidatorFromUrl(testUrl, {
        count: true,
        crawlOnly,
        maxPages: crawlMaxPages,
        maxDepth: 50,
        skipPrivatePages: true,
        sitemapFirst: useSitemapFirst,
        auth: authConfig,
        includeTags: a11yRuleOptions.includeTags,
        excludeTags: a11yRuleOptions.excludeTags,
        excludeRules: a11yRuleOptions.excludeRules,
      });

      if (Array.isArray(results.errors)) {
        const keptErrors = [];
        const ignoredExecutionErrors = [];
        results.errors.forEach((entry) => {
          if (entry && isIgnorableExecutionError(entry.error)) {
            ignoredExecutionErrors.push(entry);
          } else {
            keptErrors.push(entry);
          }
        });
        results.errors = keptErrors;
        executionErrors = ignoredExecutionErrors;
      }
    }

    // Display results summary
    if (results.crawlOnly) {
      console.log('Crawl-Only Results');
      console.log(`Total pages discovered: ${results.totalPages}`);
      console.log(`\nTo run accessibility tests, remove --crawl-only flag or set CRAWL_ONLY=false`);
    } else {
      console.log('Test Results Summary');
      console.log(`Total pages discovered: ${results.totalPages}`);
      if (typeof results.pagesTested === 'number') {
        console.log(`Pages tested: ${results.pagesTested}`);
      }
      if (typeof results.totalErrors === 'number') {
        console.log(`Total accessibility errors: ${results.totalErrors}`);
      }
    }

    if (executionErrors.length > 0) {
      console.log(`\nIgnored ${executionErrors.length} transient browser execution error(s) (not included in accessibility summary).`);
    }

    console.log('Reports Generated');
    console.log(`Check the reports directory: ${global.paths.reports}`);

    // Return results for further processing if needed
    return results;

  } catch (error) {
    console.error('\n❌ Error during accessibility testing:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  } finally {
    // Clean up: close the browser session
    if (browser) {
      console.log('Closing browser...');
      await browser.deleteSession();
      console.log('Browser closed.');
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  runAccessibilityTest()
    .then(() => {
      console.log('\n✅ Accessibility test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Accessibility test failed!');
      if (error?.message) {
        console.error(error.message);
      }
      if (error?.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
      process.exit(1);
    });
}

module.exports = {
  runAccessibilityTest,
  // Expose internals for unit testing (no runtime behavior changes).
  _test: {
    cleanUrlInput,
    describeHiddenChars,
    normalizeUrl,
    parseSimpleCsvRows,
    parseCsvIgnoreColumns,
    looksLikeUrlOrPath,
    getPagesFromFile,
    parseCliOptions,
    extractSitemapUrlsFromRobotsTxt,
    extractLocUrlsFromXml,
    discoverPagesFromSitemap,
    resolveHeadlessChrome,
    buildBrowserOptions,
  },
};
