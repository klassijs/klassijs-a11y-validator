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
 *   
 *   # With different browser
 *   BROWSER=safari node src/run-a11y-test.js https://example.com
 *   BROWSER=firefox node src/run-a11y-test.js https://example.com --crawl-only
 */

const { remote } = require('webdriverio');
const { a11yValidatorFromUrl, a11yValidator } = require('../index');
const { astellen } = require('klassijs-astellen');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Configuration for the browser
// Option 1: Use Chrome (requires chromedriver)
// Option 2: Use Safari (works on macOS without additional drivers)
// Option 3: Use Firefox (requires geckodriver)
// Debug: Log environment differences between IDE and terminal
// This helps identify why it works in IDE but not in terminal
const debugEnv = process.env.DEBUG_ENV === 'true';
if (debugEnv) {
  console.log('\n🔍 Environment Debug Info:');
  console.log(`  User: ${os.userInfo().username}`);
  console.log(`  Home: ${os.homedir()}`);
  console.log(`  Original TMPDIR: ${process.env.TMPDIR || '(not set)'}`);
  console.log(`  Original TEMP: ${process.env.TEMP || '(not set)'}`);
  console.log(`  Original TMP: ${process.env.TMP || '(not set)'}`);
  console.log(`  System tempdir: ${os.tmpdir()}`);
  console.log(`  Process PID: ${process.pid}`);
  console.log(`  Node version: ${process.version}`);
  console.log(`  Platform: ${process.platform}`);
  console.log('');
}

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
    if (debugEnv) {
      console.log(`✅ Created cache directory: ${cacheDir}`);
    }
  }
  
  // Test write permissions
  const testFile = path.join(cacheDir, '.test-write');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  
  // Set environment variables that WebdriverIO uses for cache directory
  // WebdriverIO's @wdio/utils uses os.tmpdir() which checks TMPDIR, TEMP, or TMP
  // IMPORTANT: Set these BEFORE any WebdriverIO code runs
  const originalTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = cacheDir;
  process.env.TEMP = cacheDir;
  process.env.TMP = cacheDir;
  
  // Also set the specific cache directory env var if WebdriverIO supports it
  process.env.WEBDRIVER_CACHE_DIR = cacheDir;
  
  if (debugEnv) {
    console.log(`  New TMPDIR: ${process.env.TMPDIR}`);
    console.log(`  New TEMP: ${process.env.TEMP}`);
    console.log(`  New TMP: ${process.env.TMP}`);
    console.log(`  os.tmpdir() now returns: ${os.tmpdir()}`);
    console.log('');
  }
  
  console.log(`Using cache directory: ${cacheDir}`);
  if (originalTmpdir && originalTmpdir !== cacheDir) {
    console.log(`⚠️  Note: Overrode TMPDIR from "${originalTmpdir}" to "${cacheDir}"`);
    console.log(`   This is why it might work in IDE (different TMPDIR) but not in terminal.`);
  }
} catch (err) {
  console.error(`❌ Error: Could not create/access cache directory ${cacheDir}: ${err.message}`);
  console.error('Please check permissions or set CACHE_DIR to a writable directory.');
  if (debugEnv) {
    console.error(`\nDebug info:`);
    console.error(`  Directory: ${cacheDir}`);
    console.error(`  Exists: ${fs.existsSync(cacheDir)}`);
    try {
      const stats = fs.statSync(cacheDir);
      console.error(`  Mode: ${stats.mode.toString(8)}`);
      console.error(`  UID: ${stats.uid}, GID: ${stats.gid}`);
    } catch (e) {
      console.error(`  Cannot stat: ${e.message}`);
    }
  }
  process.exit(1);
}

// Configure browser options
// Note: If you have @wdio/chromedriver-service installed, you can use the services config
// Otherwise, WebdriverIO will try to download chromedriver automatically
const browserOptions = {
  capabilities: {
    browserName: process.env.BROWSER || 'chrome', // 'chrome', 'firefox', 'safari'
    'goog:chromeOptions': {
      args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'], // Remove '--headless' to see the browser
    },
  },
  // Try to use chromedriver service with custom cache directory if available
  // This requires @wdio/chromedriver-service to be installed
  // If not installed, WebdriverIO will fall back to auto-download (which should use TMPDIR)
  services: (process.env.BROWSER === 'chrome' || !process.env.BROWSER) ? 
    (() => {
      try {
        require.resolve('@wdio/chromedriver-service');
        return [['chromedriver', { cacheDir: cacheDir }]];
      } catch (e) {
        // Service not installed, WebdriverIO will use TMPDIR for cache
        return undefined;
      }
    })() : undefined,
  logLevel: 'warn', // Reduce log noise
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
};

// Configuration for paths and environment
// These are required by the accessibility library
const setupGlobals = () => {
  // Set browser name (used in report paths)
  global.browserName = browserOptions.capabilities.browserName || 'chrome';
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

const normalizeUrl = (input, baseUrl) => {
  try {
    return new URL(input, baseUrl).href;
  } catch (error) {
    throw new Error(`Invalid URL provided: "${input}"`);
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

const parseCliOptions = () => {
  const args = process.argv.slice(2);
  const baseUrlArg = getCliValue(args, '--base-url');
  const pagesArg = getCliValue(args, '--pages');
  const pagesFileArg = getCliValue(args, '--pages-file');
  const csvIgnoreColumnsArg = getCliValue(args, '--csv-ignore-columns');
  const crawlOnly = process.env.CRAWL_ONLY === 'true' || args.includes('--crawl-only');

  // First non-flag argument is treated as positional URL.
  const positionalUrl = args.find((arg) => !arg.startsWith('--'));
  const baseUrl = baseUrlArg || positionalUrl || null;

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

  // De-duplicate while preserving order.
  pages = [...new Set(pages)];

  return {
    baseUrl,
    pages,
    crawlOnly,
    mode: pages.length > 0 ? 'pages' : 'crawl',
  };
};

async function runAccessibilityTest() {
  const options = parseCliOptions();
  const testUrl = options.baseUrl;

  if (options.mode === 'crawl' && !testUrl) {
    console.error('❌ Missing URL.');
    console.error('Usage examples:');
    console.error('  node src/run-a11y-test.js https://example.com');
    console.error('  node src/run-a11y-test.js --pages https://example.com/about');
    console.error('  node src/run-a11y-test.js https://example.com --pages /,/about,/contact');
    console.error('  node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.txt');
    console.error('  node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Accessibility Test Runner');
  console.log('='.repeat(60));
  if (options.mode === 'pages') {
    console.log(`Testing ${options.pages.length} specific page(s)\n`);
  } else {
    console.log(`Testing URL: ${testUrl}\n`);
  }

  let browser;

  try {
    // Setup global variables required by the validator
    setupGlobals();

    // Initialize the browser
    console.log('Initializing browser...');
    console.log(`Using browser: ${browserOptions.capabilities.browserName}`);
    
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
    
    let results;

    if (options.mode === 'pages') {
      console.log('Running explicit page tests (crawl disabled)...');
      const pageErrors = [];

      for (const pageUrl of options.pages) {
        console.log(`\nTesting page: ${pageUrl}`);
        try {
          await browser.url(pageUrl);
          const reportName = sanitizePageName(pageUrl);
          await a11yValidator(reportName, true);
        } catch (pageError) {
          pageErrors.push({
            url: pageUrl,
            error: pageError.message,
          });
        }
      }

      results = {
        mode: 'pages',
        crawlOnly: false,
        totalPages: options.pages.length,
        pagesTested: options.pages.length,
        totalErrors: null,
        errors: pageErrors,
      };
    } else {
      // Set crawlOnly to true to only discover pages without running accessibility tests
      // Useful for testing the crawler and verifying all pages are found
      const crawlOnly = options.crawlOnly;
      results = await a11yValidatorFromUrl(testUrl, {
        maxPages: null,      // Set to null for unlimited (discovers ALL pages including children)
        maxDepth: 10,        // Maximum depth to crawl (set high to find all nested pages)
        excludePaths: [      // Exclude these paths from testing
          '/admin',
          '/api',
          '/private',
        ],
        count: true,         // Include total error count
        crawlOnly: crawlOnly, // Set to true to only crawl without testing
        maxPagesToTest: null, // Limit how many pages to test (5 for testing new features, set to null to test all discovered pages)
        // auth: authConfig,  // Uncomment to enable authentication
        // skipPrivatePages: false,  // Set to true to skip pages that require login
        // privatePageIndicators: ['Login', 'Sign in'],  // Custom indicators for private pages
      });
    }

    // Display results summary
    if (results.crawlOnly) {
      // console.log('\n' + '='.repeat(60));
      console.log('Crawl-Only Results');
      // console.log('='.repeat(60));
      console.log(`Total pages discovered: ${results.totalPages}`);
      // console.log(`Pages tested: 0 (testing was skipped)`);
      console.log(`\nTo run accessibility tests, remove --crawl-only flag or set CRAWL_ONLY=false`);
    } else {
      // console.log('\n' + '='.repeat(60));
      console.log('Test Results Summary');
      // console.log('='.repeat(60));
      console.log(`Total pages discovered: ${results.totalPages}`);
      if (typeof results.pagesTested === 'number') {
        console.log(`Pages tested: ${results.pagesTested}`);
      }
      if (typeof results.totalErrors === 'number') {
        console.log(`Total accessibility errors: ${results.totalErrors}`);
      }
      // console.log(`Pages with errors: ${results.errors.length}`);
    }

    if (results.errors.length > 0) {
      console.log('\nPages with accessibility issues:');
      results.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.url}`);
        if (error.errors) {
          console.log(`     Errors: ${error.errors}`);
        }
        if (error.error) {
          console.log(`     Error: ${error.error}`);
        }
      });
    }

    // console.log('\n' + '='.repeat(60));
    console.log('Reports Generated');
    // console.log('='.repeat(60));
    console.log(`Check the reports directory: ${global.paths.reports}`);
    // console.log(`Reports are organized by: ${global.browserName}/${global.env.envName}/accessibilityReport/`);
    // console.log('Each page has both HTML and JSON report files.\n');

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
      process.exit(1);
    });
}

module.exports = { runAccessibilityTest };
