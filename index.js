const path = require('path');
const fs = require("fs");

const { getA11yValidator, getAccessibilityError, getAccessibilityTotalError, resetErrorCounts } = require('./src/accessibilityLib');
const { crawlWebsite, isValidUrl } = require('./src/urlCrawler');
const { dateTime } = require('./utils/dateTime');

const accessibility_lib = path.resolve(__dirname, './src/accessibilityLib.js');
if (fs.existsSync(accessibility_lib)) {
  const rList = [];
  global.accessibilityLib = require(accessibility_lib);
  global.accessibilityReportList = rList;
} else console.error('No Accessibility Lib');

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
  
  // Crawl the website to discover all pages
  const crawlResult = await crawlWebsite(url, {
    maxPages,
    maxDepth,
    excludePaths,
    auth,
    privatePageIndicators,
    skipPrivatePages,
  });

  // Calculate crawl duration
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

  // Report final results
  await accessibilityError(count);

  // Calculate total duration (crawl + testing)
  const totalEndTime = Date.now();
  const totalDurationMs = totalEndTime - crawlStartTime;
  const totalDuration = formatDuration(totalDurationMs);
  
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
};
