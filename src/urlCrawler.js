/**
 * URL Crawler utility to discover all pages on a website
 * Crawls a website starting from a base URL and discovers all internal links
 */

/**
 * Normalizes a URL by removing query parameters and fragments
 * This ensures we don't treat the same page with different query params as different pages
 * Also normalizes trailing slashes (treats /page and /page/ as the same)
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrl(url) {
  if (!url) return url;
  
  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;
    
    // Remove trailing slash (treats /page and /page/ as the same)
    // Keep root path as-is (https://example.com stays as https://example.com)
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    
    // Return protocol + hostname + pathname (no query, no fragment)
    return `${urlObj.protocol}//${urlObj.hostname}${pathname}`;
  } catch (e) {
    // Fallback: remove query and fragment manually
    let normalized = url.split('?')[0].split('#')[0];
    // Remove trailing slash (but keep root domain with trailing slash as-is for consistency)
    if (normalized.length > 1 && normalized.endsWith('/')) {
      // Check if it's just domain with trailing slash (e.g., https://example.com/)
      const match = normalized.match(/^(https?:\/\/[^\/]+)\/$/);
      if (!match) {
        normalized = normalized.slice(0, -1);
      }
    }
    return normalized;
  }
}

function normalizeInputUrl(url) {
  if (url === null || url === undefined) return url;
  const raw = String(url).trim();
  if (!raw) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  const looksLikeHost =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(raw) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/.*)?$/i.test(raw);
  return looksLikeHost ? `https://${raw}` : raw;
}

function normalizePathPrefix(pathname) {
  if (!pathname || pathname === '/') return '/';
  let p = String(pathname).trim();
  if (!p.startsWith('/')) p = `/${p}`;
  // Keep '/' as the root sentinel, normalize '/x/' => '/x'
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function isWithinPathPrefix(url, pathPrefix) {
  if (!url) return false;
  if (!pathPrefix || pathPrefix === '/') return true;
  try {
    const pathname = normalizePathPrefix(new URL(url).pathname);
    return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
  } catch (_e) {
    return false;
  }
}

function isHeadlessBrowserSession() {
  try {
    const caps = global.browser && global.browser.capabilities;
    if (!caps || typeof caps !== 'object') return false;
    const chromeArgs = caps['goog:chromeOptions'] && Array.isArray(caps['goog:chromeOptions'].args)
      ? caps['goog:chromeOptions'].args
      : [];
    if (chromeArgs.some((arg) => String(arg).toLowerCase().startsWith('--headless'))) {
      return true;
    }
    if (typeof caps.headless === 'boolean') return caps.headless;
    return false;
  } catch (_e) {
    return false;
  }
}

/**
 * Max time (ms) to poll until same-domain links exist (headless often paints nav late).
 * Set A11Y_LINK_POLL_MS=0 to disable. Set to a number to override all depths.
 */
function getLinkPollBudgetMs(crawlDepth) {
  const raw = process.env.A11Y_LINK_POLL_MS;
  if (raw === '0') return 0;
  if (raw !== undefined && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (crawlDepth === 0) return 30000;
  if (crawlDepth <= 3) return 12000;
  return 0;
}

/**
 * @param {string[]} links - Raw href strings from the page
 */
function filterAnchorsToInternalLinks(links, pageUrl, baseDomain) {
  const internalLinks = links
    .map((link) => {
      try {
        const url = new URL(link);

        if (url.hash && url.pathname === new URL(pageUrl).pathname && !url.search) {
          return null;
        }

        if (!['http:', 'https:'].includes(url.protocol)) {
          return null;
        }

        if (!isSameDomain(url.href, baseDomain)) {
          return null;
        }

        if (isNonHtmlResource(url.href)) {
          return null;
        }

        return url.href;
      } catch (e) {
        try {
          let fullUrl;
          if (link.startsWith('/')) {
            fullUrl = new URL(link, pageUrl).href;
          } else {
            fullUrl = new URL(link).href;
          }

          if (!isSameDomain(fullUrl, baseDomain)) {
            return null;
          }

          if (isNonHtmlResource(fullUrl)) {
            return null;
          }

          return fullUrl;
        } catch (e2) {
          return null;
        }
      }
    })
    .filter((url) => {
      if (!url) return false;

      if (!isSameDomain(url, baseDomain)) {
        return false;
      }

      if (isNonHtmlResource(url)) {
        return false;
      }

      const urlLower = url.toLowerCase();
      return (
        !urlLower.includes('mailto:') &&
        !urlLower.includes('tel:') &&
        !urlLower.includes('javascript:')
      );
    })
    .map((url) => normalizeUrl(url))
    .filter((url) => {
      if (!url) return false;
      try {
        return isSameDomain(url, baseDomain);
      } catch (e) {
        return false;
      }
    });

  const uniqueLinks = [...new Set(internalLinks)];

  return uniqueLinks.filter((link) => {
    try {
      return isSameDomain(link, baseDomain);
    } catch (e) {
      return false;
    }
  });
}

/**
 * Extracts all internal links from the current page
 * @param {string} currentPageUrl - The current page URL (used to resolve relative links)
 * @param {string} baseDomain - The base domain to match against
 * @param {number} [crawlDepth=0] - Crawl depth (polling for late-rendered links only at depth 0)
 * @returns {Promise<Array<string>>} - Array of discovered URLs from the same domain
 */
async function discoverPageLinks(currentPageUrl, baseDomain, crawlDepth = 0) {
  if (!global.browser) {
    throw new Error('Browser instance not available. Make sure browser is initialized.');
  }

  try {
    // Get the current page URL from browser (more reliable than passing it)
    let actualCurrentUrl;
    try {
      actualCurrentUrl = await global.browser.getUrl();
    } catch (e) {
      if (e.message && (
        e.message.includes('no such frame') ||
        e.message.includes('Context') ||
        e.message.includes('browsingContext')
      )) {
        throw new Error('Browser context lost - cannot discover links');
      }
      throw e;
    }
    
    const pageUrl = currentPageUrl || actualCurrentUrl;

    const runExtract = async () => {
      const executePromise = global.browser.execute(() => {
        try {
          const h = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
            window.innerHeight || 0
          );
          window.scrollTo(0, 0);
          window.scrollTo(0, h);
          window.scrollTo(0, 0);
        } catch (e) {
          /* ignore scroll errors */
        }

        function collectHrefFromRoot(root) {
          const out = [];
          if (!root || !root.querySelectorAll) return out;
          root.querySelectorAll('a[href]').forEach((a) => {
            try {
              const href = a.getAttribute('href');
              if (!href || !String(href).trim()) return;
              out.push(a.href);
            } catch (e) {
              /* ignore */
            }
          });
          root.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) {
              collectHrefFromRoot(el.shadowRoot).forEach((x) => out.push(x));
            }
          });
          return out;
        }

        const flat = collectHrefFromRoot(document);
        return [...new Set(flat)];
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Link extraction timeout after 10 seconds')), 10000)
      );
      return Promise.race([executePromise, timeoutPromise]);
    };

    let links = [];
    try {
      links = await runExtract();
    } catch (executeError) {
      if (executeError.message && (
        executeError.message.includes('no such frame') ||
        executeError.message.includes('Context') ||
        executeError.message.includes('browsingContext') ||
        executeError.message.includes('Browser context lost')
      )) {
        throw new Error('Browser context lost during link extraction');
      }
      console.warn(`    ⚠️  Could not extract links: ${executeError.message}`);
      return [];
    }

    if (!links) links = [];

    let validatedLinks = filterAnchorsToInternalLinks(links, pageUrl, baseDomain);

    const pollBudgetMs = getLinkPollBudgetMs(crawlDepth);
    if (
      pollBudgetMs > 0 &&
      validatedLinks.length === 0 &&
      typeof global.browser.pause === 'function'
    ) {
      console.info(
        `    No same-domain links yet (raw anchors: ${links.length}); polling up to ${pollBudgetMs}ms for headless/SPA. Set A11Y_LINK_POLL_MS=0 to skip.`
      );
      const stepMs = 600;
      const deadline = Date.now() + pollBudgetMs;
      while (validatedLinks.length === 0 && Date.now() < deadline) {
        await global.browser.pause(stepMs);
        try {
          links = await runExtract();
          if (!links) links = [];
          validatedLinks = filterAnchorsToInternalLinks(links, pageUrl, baseDomain);
        } catch (pollErr) {
          console.warn(`    ⚠️  Link poll extract failed: ${pollErr.message}`);
          break;
        }
      }
    }

    console.info(`    Found ${links.length} total links on page`);

    console.info(
      `    ${validatedLinks.length} unique internal links after filtering (${Math.max(0, links.length - validatedLinks.length)} external/duplicate links filtered out)`
    );

    return validatedLinks;
  } catch (error) {
    console.error('Error discovering page links:', error);
    return [];
  }
}

/**
 * Performs authentication/login if provided
 * @param {Object} authConfig - Authentication configuration
 * @param {string} authConfig.loginUrl - URL of the login page
 * @param {Function} authConfig.loginFunction - Custom async function to perform login
 * @param {Object} authConfig.credentials - Login credentials { username, password }
 * @param {Object} authConfig.selectors - CSS selectors for login form { username, password, submit }
 * @returns {Promise<boolean>} - True if authentication successful
 */
async function authenticate(authConfig = {}) {
  if (!global.browser) {
    throw new Error('Browser instance not available. Make sure browser is initialized.');
  }

  if (!authConfig.loginUrl && !authConfig.loginFunction) {
    return false; // No authentication needed
  }

  try {
    console.info('Performing authentication...');

    // Use custom login function if provided
    if (authConfig.loginFunction) {
      await authConfig.loginFunction(global.browser);
      console.info('Authentication completed using custom function.');
      return true;
    }

    // Otherwise use login URL and credentials
    if (!authConfig.loginUrl) {
      console.warn('Login URL not provided. Skipping authentication.');
      return false;
    }

    // Navigate to login page
    await global.browser.url(authConfig.loginUrl);
    await global.browser.waitUntil(
      async () => {
        const readyState = await global.browser.execute(() => document.readyState);
        return readyState === 'complete';
      },
      { timeout: 10000 }
    );

    // Use provided selectors or defaults
    const selectors = authConfig.selectors || {
      username: 'input[name="username"], input[name="email"], input[type="email"], #username, #email',
      password: 'input[name="password"], input[type="password"], #password',
      submit: 'button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign in")',
    };

    // Fill in credentials if provided
    if (authConfig.credentials) {
      const { username, password } = authConfig.credentials;

      // Find and fill username field
      try {
        const usernameField = await global.browser.$(selectors.username);
        if (await usernameField.isExisting()) {
          await usernameField.setValue(username);
        }
      } catch (e) {
        console.warn('Could not find username field:', e.message);
      }

      // Find and fill password field
      try {
        const passwordField = await global.browser.$(selectors.password);
        if (await passwordField.isExisting()) {
          await passwordField.setValue(password);
        }
      } catch (e) {
        console.warn('Could not find password field:', e.message);
      }

      // Submit the form
      try {
        const submitButton = await global.browser.$(selectors.submit);
        if (await submitButton.isExisting()) {
          await submitButton.click();
        } else {
          // Try pressing Enter on password field
          const passwordField = await global.browser.$(selectors.password);
          if (await passwordField.isExisting()) {
            await passwordField.keys('Enter');
          }
        }
      } catch (e) {
        console.warn('Could not submit login form:', e.message);
      }

      // Wait for navigation after login (or check for success indicator)
      await global.browser.waitUntil(
        async () => {
          const currentUrl = await global.browser.getUrl();
          return currentUrl !== authConfig.loginUrl;
        },
        { timeout: 10000, timeoutMsg: 'Login may have failed - still on login page' }
      );
    }

    console.info('Authentication completed.');
    return true;
  } catch (error) {
    console.error('Authentication failed:', error.message);
    return false;
  }
}

/**
 * Checks if the current page requires authentication
 * @param {Array<string>} privatePageIndicators - Indicators that suggest a private page (e.g., ['Login', 'Sign in'])
 * @returns {Promise<boolean>} - True if page appears to require authentication
 */
async function isPrivatePage(privatePageIndicators = []) {
  if (!global.browser) {
    return false;
  }

  try {
    const pageText = await global.browser.execute(() => document.body.innerText.toLowerCase());
    const currentUrl = await global.browser.getUrl().toLowerCase();

    const indicators = [
      'login',
      'sign in',
      'authentication required',
      'please log in',
      'access denied',
      'unauthorized',
      ...privatePageIndicators.map(ind => ind.toLowerCase()),
    ];

    // Check if page contains login indicators
    const hasLoginIndicator = indicators.some(indicator => 
      pageText.includes(indicator) || currentUrl.includes('login') || currentUrl.includes('signin')
    );

    return hasLoginIndicator;
  } catch (error) {
    return false;
  }
}

/**
 * Checks if a URL is a non-HTML resource (images, files, etc.)
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL is a non-HTML resource
 */
function isNonHtmlResource(url) {
  if (!url) return true;
  
  const urlLower = url.toLowerCase();
  const pathname = urlLower.split('?')[0].split('#')[0];
  
  // List of file extensions to exclude
  const nonHtmlExtensions = [
    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico', '.tiff', '.tif',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf',
    // Archives
    '.zip', '.rar', '.tar', '.gz', '.7z',
    // Media
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
    // Code/Assets
    '.css', '.js', '.json', '.xml', '.woff', '.woff2', '.ttf', '.eot', '.otf',
    // Other
    '.csv', '.tsv'
  ];
  
  return nonHtmlExtensions.some(ext => pathname.endsWith(ext));
}

/**
 * Extracts the base domain from a URL (e.g., example.com from https://www.example.com/page)
 * Handles www, subdomains, and ensures consistent domain matching
 * @param {string} url - URL to extract domain from
 * @returns {string} - Base domain (normalized, without www)
 */
function getBaseDomain(url) {
  if (!url) return '';
  
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    
    // Remove 'www.' prefix if present for consistent domain matching
    hostname = hostname.replace(/^www\./, '');
    
    // For subdomains, we keep the full domain (e.g., blog.example.com stays as blog.example.com)
    // This allows matching subdomains if needed, but you can modify this behavior
    
    return hostname.toLowerCase(); // Normalize to lowercase
  } catch (e) {
    // If URL parsing fails, try to extract domain manually
    try {
      const match = url.match(/https?:\/\/([^\/]+)/);
      if (match && match[1]) {
        return match[1].replace(/^www\./, '').toLowerCase();
      }
    } catch (e2) {
      // Ignore
    }
    return '';
  }
}

/**
 * Checks if a URL belongs to the same domain
 * Strict matching: only exact domain match (handles www variations)
 * @param {string} url - URL to check
 * @param {string} baseDomain - Base domain to compare against (normalized, without www)
 * @returns {boolean} - True if URL belongs to the same domain
 */
function isSameDomain(url, baseDomain) {
  if (!url || !baseDomain) return false;
  
  try {
    const urlDomain = getBaseDomain(url);
    
    // Exact match (handles www variations automatically via getBaseDomain)
    if (urlDomain === baseDomain) {
      return true;
    }
    
    // For subdomains: if baseDomain is "example.com" and urlDomain is "blog.example.com"
    // This allows subdomains. If you want ONLY exact domain, remove this check.
    // For now, we allow subdomains of the base domain
    if (urlDomain.endsWith('.' + baseDomain)) {
      return true;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Crawls a website starting from a base URL and discovers all pages
 * Builds a sitemap/page map of all discovered pages within the same domain
 * Note: Link discovery is unreliable in headless Chrome for many JS-heavy sites; prefer a visible browser or sitemap/explicit URLs.
 * @param {string} baseUrl - The starting URL to crawl
 * @param {Object} options - Crawler options
 * @param {number} options.maxPages - Maximum number of pages to crawl (default: 50)
 * @param {number} options.maxDepth - Maximum depth to crawl (default: 3)
 * @param {Array<string>} options.excludePaths - Paths to exclude (e.g., ['/admin', '/api'])
 * @param {Object} options.auth - Authentication configuration
 * @param {string} options.auth.loginUrl - URL of the login page
 * @param {Function} options.auth.loginFunction - Custom async function to perform login (receives browser instance)
 * @param {Object} options.auth.credentials - Login credentials { username, password }
 * @param {Object} options.auth.selectors - CSS selectors for login form { username, password, submit }
 * @param {Array<string>} options.privatePageIndicators - Text indicators that suggest a private page
 * @param {boolean} options.skipPrivatePages - If true, skip pages that appear to require authentication (default: false)
 * @returns {Promise<Object>} - Object containing { urls: Array<string>, pageMap: Object, domain: string }
 */
async function crawlWebsite(baseUrl, options = {}) {
  const {
    maxPages = null,
    maxDepth = 3,
    excludePaths = [],
    auth = null,
    privatePageIndicators = [],
    skipPrivatePages = false,
  } = options;

  if (!global.browser) {
    throw new Error('Browser instance not available. Make sure browser is initialized.');
  }

  const resolvedBaseUrl = normalizeInputUrl(baseUrl);
  const isHeadless = isHeadlessBrowserSession();
  // Extract base domain to ensure we only crawl pages from the same domain
  const baseDomain = getBaseDomain(resolvedBaseUrl);
  const basePathPrefix = (() => {
    try {
      return normalizePathPrefix(new URL(resolvedBaseUrl).pathname);
    } catch (_e) {
      return '/';
    }
  })();
  console.info(`Domain restriction: ${baseDomain}`);
  if (basePathPrefix !== '/') {
    console.info(`Path restriction: ${basePathPrefix} (subpath crawl mode)`);
  }

  // Perform authentication if provided
  if (auth) {
    const authSuccess = await authenticate(auth);
    if (!authSuccess && auth.loginUrl) {
      console.warn('Authentication may have failed. Continuing with crawl...');
    }
  }

  const discoveredUrls = new Set();
  // Normalize the base URL before starting
  const normalizedBaseUrl = normalizeUrl(resolvedBaseUrl);
  const urlsToVisit = [{ url: normalizedBaseUrl, depth: 0, parent: null }];
  const visitedUrls = new Set();
  
  // Build page map structure: { url: { depth, parent, children: [], discoveredFrom: [] } }
  const pageMap = {};

  // Check if maxPages is set to unlimited (null, undefined, 0, or negative)
  const isUnlimited = !maxPages || maxPages <= 0;
  const effectiveMaxPages = isUnlimited ? Number.MAX_SAFE_INTEGER : maxPages;

  console.info(`Starting crawl from: ${resolvedBaseUrl}`);
  if (isUnlimited) {
    console.info(`Max pages: UNLIMITED (will discover all pages)`);
  } else {
    console.info(`Max pages: ${maxPages}`);
  }
  console.info(`Max depth: ${maxDepth}`);
  console.info(`Domain: ${baseDomain} (only pages from this domain will be included)`);
  if (basePathPrefix !== '/') {
    console.info(`Path: ${basePathPrefix} (only pages under this path will be included)`);
  }
  if (auth) {
    console.info('Authentication enabled');
  }

  while (urlsToVisit.length > 0 && discoveredUrls.size < effectiveMaxPages) {
    const { url, depth, parent } = urlsToVisit.shift();
    
    // Add a small pacing delay between page navigations.
    // Headless needs more time for SPA/link discovery; headed can use a smaller delay.
    if (visitedUrls.size > 0) {
      const navDelayMs = isHeadless ? 500 : 200;
      await new Promise(resolve => setTimeout(resolve, navDelayMs));
    }
    
    // Normalize URL before checking
    const normalizedUrl = normalizeUrl(url);

    // Skip if already visited or exceeds max depth
    if (visitedUrls.has(normalizedUrl) || depth > maxDepth) {
      continue;
    }

    // Skip if URL matches exclude patterns
    const shouldExclude = excludePaths.some(pattern => {
      try {
        const urlObj = new URL(url);
        return urlObj.pathname.includes(pattern);
      } catch (e) {
        return url.includes(pattern);
      }
    });

    if (shouldExclude) {
      continue;
    }

    try {
      // Check if browser is still valid before navigation
      let browserValid = false;
      try {
        await global.browser.getUrl(); // Simple check to see if browser is still responsive
        browserValid = true;
      } catch (browserCheckError) {
        console.error(`  ❌ Browser context lost. Cannot continue crawling.`);
        console.error(`     Error: ${browserCheckError.message}`);
        console.error(`     Please restart the browser and try again.`);
        throw new Error('Browser context lost - browser session is no longer valid');
      }
      
      if (!browserValid) {
        throw new Error('Browser context is not valid');
      }
      
      // Navigate to the URL (use original URL for navigation, normalized for tracking)
      console.info(`Visiting (depth ${depth}): ${normalizedUrl}`);
      
      try {
        // Add timeout to navigation
        const navPromise = global.browser.url(normalizedUrl);
        const navTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Navigation timeout after 15 seconds')), 15000)
        );
        await Promise.race([navPromise, navTimeout]);
      } catch (navError) {
        // Check if it's a context loss error
        if (navError.message && (
          navError.message.includes('no such frame') ||
          navError.message.includes('Context') ||
          navError.message.includes('browsingContext') ||
          navError.message.includes('session not found')
        )) {
          console.error(`  ❌ Browser context lost while navigating to: ${normalizedUrl}`);
          console.error(`     This usually means the browser session was closed or crashed.`);
          console.error(`     Marking page as failed and continuing...`);
          // Mark as visited to avoid retrying
          visitedUrls.add(normalizedUrl);
          // Continue to next URL
          continue;
        }
        // Re-throw other navigation errors
        throw navError;
      }
      
      // Wait for page to load with retry logic
      try {
        await global.browser.waitUntil(
          async () => {
            try {
              const readyState = await global.browser.execute(() => document.readyState);
              return readyState === 'complete';
            } catch (e) {
              // If execute fails, browser context might be lost
              if (e.message && (
                e.message.includes('no such frame') ||
                e.message.includes('Context') ||
                e.message.includes('browsingContext')
              )) {
                throw new Error('Browser context lost during page load');
              }
              throw e;
            }
          },
          {
            timeout: 10000,
            timeoutMsg: 'Page did not load completely',
          }
        );
      } catch (waitError) {
        // Check if it's a context loss error
        if (waitError.message && (
          waitError.message.includes('no such frame') ||
          waitError.message.includes('Context') ||
          waitError.message.includes('browsingContext') ||
          waitError.message.includes('Browser context lost')
        )) {
          console.error(`  ❌ Browser context lost while waiting for page to load: ${normalizedUrl}`);
          visitedUrls.add(normalizedUrl);
          continue;
        }
        // For other timeout errors, log but continue
        console.warn(`  ⚠️  Page load timeout for: ${normalizedUrl}`);
        visitedUrls.add(normalizedUrl);
        continue;
      }

      // Brief pause after load for SPA reliability.
      // Default: 1200ms in headless, 300ms in visible mode (override with A11Y_POST_LOAD_DELAY_MS).
      const rawPost = process.env.A11Y_POST_LOAD_DELAY_MS;
      let postLoadDelayMs = isHeadless ? 1200 : 300;
      if (rawPost !== undefined && rawPost !== '') {
        const n = Number.parseInt(rawPost, 10);
        postLoadDelayMs = Number.isFinite(n) ? Math.max(0, n) : (isHeadless ? 1200 : 300);
      }
      if (postLoadDelayMs > 0 && typeof global.browser.pause === 'function') {
        await global.browser.pause(postLoadDelayMs);
      }

      // Check if this is a private page that should be skipped
      if (skipPrivatePages) {
        const isPrivate = await isPrivatePage(privatePageIndicators);
        if (isPrivate) {
          console.info(`Skipping private page: ${normalizedUrl}`);
          visitedUrls.add(normalizedUrl); // Mark as visited but don't add to discovered
          continue;
        }
      }

      // If navigation/auth redirects land on a different host, skip testing that page.
      // This prevents auth/login redirects (e.g. external IDP login) from polluting the crawl.
      try {
        const actualUrl = await global.browser.getUrl();
        if (actualUrl && /^https?:\/\//i.test(String(actualUrl))) {
          if (!isSameDomain(actualUrl, baseDomain)) {
            console.warn(`  ⚠️  Skipping redirected external URL: ${actualUrl}`);
            visitedUrls.add(normalizedUrl);
            continue;
          }
          if (!isWithinPathPrefix(actualUrl, basePathPrefix)) {
            console.info(`  ↳ Skipping redirected out-of-scope path: ${actualUrl}`);
            visitedUrls.add(normalizedUrl);
            continue;
          }
        }
      } catch (_e) {
        // If we can't read the URL, fall back to normalizedUrl checks below.
      }

      // CRITICAL: Final validation before adding - ensure it’s from the same domain
      if (!isSameDomain(normalizedUrl, baseDomain)) {
        console.warn(`  ⚠️  Skipping external URL: ${normalizedUrl}`);
        visitedUrls.add(normalizedUrl); // Mark as visited to avoid retrying
        continue;
      }

      if (!isWithinPathPrefix(normalizedUrl, basePathPrefix)) {
        console.info(`  ↳ Skipping out-of-scope path: ${normalizedUrl}`);
        visitedUrls.add(normalizedUrl);
        continue;
      }
      
      // Check for duplicates (shouldn't happen, but be extra safe)
      if (discoveredUrls.has(normalizedUrl)) {
        console.warn(`  ⚠️  Duplicate detected (should not happen): ${normalizedUrl}`);
        visitedUrls.add(normalizedUrl);
        continue;
      }
      
      // Mark as visited and discovered (using normalized URL)
      visitedUrls.add(normalizedUrl);
      discoveredUrls.add(normalizedUrl);
      
      // Update page map with parent information if available
      if (!pageMap[normalizedUrl]) {
        pageMap[normalizedUrl] = {
          url: normalizedUrl,
          depth: depth,
          parent: parent || null,
          children: [],
          discoveredFrom: [],
        };
      } else {
        // Update parent if we have one and it's not set yet
        if (parent && !pageMap[normalizedUrl].parent) {
          pageMap[normalizedUrl].parent = parent;
        }
      }
      
      // Set parent relationship if we have one
      if (parent) {
        // Add to parent's children if not already there
        if (!pageMap[parent]) {
          pageMap[parent] = {
            url: parent,
            depth: depth - 1,
            parent: null,
            children: [],
            discoveredFrom: [],
          };
        }
        if (!pageMap[parent].children.includes(normalizedUrl)) {
          pageMap[parent].children.push(normalizedUrl);
        }
        // Track where it was discovered from
        if (!pageMap[normalizedUrl].discoveredFrom.includes(parent)) {
          pageMap[normalizedUrl].discoveredFrom.push(parent);
        }
      }
      
      // Log discovered page
      if (isUnlimited) {
        console.info(`  ✓ Discovered page [${discoveredUrls.size}]: ${normalizedUrl}${pageMap[normalizedUrl].parent ? ` (from: ${pageMap[normalizedUrl].parent})` : ''}`);
      } else {
        console.info(`  ✓ Discovered page [${discoveredUrls.size}/${maxPages}]: ${normalizedUrl}${pageMap[normalizedUrl].parent ? ` (from: ${pageMap[normalizedUrl].parent})` : ''}`);
      }

      // Discover links on this page if we haven't reached max depth
      if (depth < maxDepth && discoveredUrls.size < effectiveMaxPages) {
        console.info(`  🔍 Discovering links on: ${normalizedUrl}`);
        
        // Add timeout wrapper for link discovery to prevent hanging
        let links = [];
        try {
          const discoveryPromise = discoverPageLinks(normalizedUrl, baseDomain, depth);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Link discovery timeout after 15 seconds')), 15000)
          );
          
          links = await Promise.race([discoveryPromise, timeoutPromise]);
          console.info(`  📋 Found ${links.length} links on this page`);
        } catch (discoveryError) {
          console.warn(`  ⚠️  Error discovering links on ${normalizedUrl}: ${discoveryError.message}`);
          console.warn(`     Continuing with next page...`);
          links = []; // Continue with empty links array
        }
        
        // Initialize children array in page map
        if (!pageMap[normalizedUrl]) {
          pageMap[normalizedUrl] = {
            url: normalizedUrl,
            depth: depth,
            parent: null,
            children: [],
            discoveredFrom: [],
          };
        }
        
        let linksAdded = 0;
        let linksSkipped = 0;
        
        for (const link of links) {
          // Normalize the link before checking
          const normalizedLink = normalizeUrl(link);
          
          // CRITICAL: Validate domain FIRST before any other checks
          if (!normalizedLink || !isSameDomain(normalizedLink, baseDomain)) {
            linksSkipped++;
            continue; // Skip external links or invalid URLs
          }
          if (!isWithinPathPrefix(normalizedLink, basePathPrefix)) {
            linksSkipped++;
            continue; // Skip links outside the base path subtree
          }
          
          // Skip if already visited
          if (visitedUrls.has(normalizedLink)) {
            linksSkipped++;
            // Still track relationship if it's a valid internal page
            if (pageMap[normalizedUrl] && !pageMap[normalizedUrl].children.includes(normalizedLink)) {
              pageMap[normalizedUrl].children.push(normalizedLink);
            }
            continue;
          }
          
          // Skip if already discovered (duplicate check)
          if (discoveredUrls.has(normalizedLink)) {
            linksSkipped++;
            // Still add to children relationship if not already there
            if (pageMap[normalizedUrl] && !pageMap[normalizedUrl].children.includes(normalizedLink)) {
              pageMap[normalizedUrl].children.push(normalizedLink);
            }
            continue;
          }
          
          if (discoveredUrls.size >= effectiveMaxPages) {
            break; // Stop if we've reached max pages
          }
          
          // Final validation before adding to queue
          try {
            // Double-check it's still from same domain after normalization
            if (!isSameDomain(normalizedLink, baseDomain)) {
              linksSkipped++;
              continue;
            }
            
            // Add to queue to visit
            urlsToVisit.push({ url: normalizedLink, depth: depth + 1, parent: normalizedUrl });
            linksAdded++;
          } catch (e) {
            // Skip invalid URLs
            linksSkipped++;
            continue;
          }
          
          // Add to page map
          if (!pageMap[normalizedLink]) {
            pageMap[normalizedLink] = {
              url: normalizedLink,
              depth: depth + 1,
              parent: normalizedUrl,
              children: [],
              discoveredFrom: [],
            };
          }
          
          // Track parent-child relationship
          if (!pageMap[normalizedUrl].children.includes(normalizedLink)) {
            pageMap[normalizedUrl].children.push(normalizedLink);
          }
          if (!pageMap[normalizedLink].discoveredFrom.includes(normalizedUrl)) {
            pageMap[normalizedLink].discoveredFrom.push(normalizedUrl);
          }
        }
        
        console.info(`  ✅ Added ${linksAdded} new pages to queue, skipped ${linksSkipped} (already visited/external)`);
        if (isUnlimited) {
          console.info(`  📊 Queue size: ${urlsToVisit.length}, Discovered: ${discoveredUrls.size} (unlimited)`);
        } else {
          console.info(`  📊 Queue size: ${urlsToVisit.length}, Discovered: ${discoveredUrls.size}/${maxPages}`);
        }
      }
      
      // Update page map entry for current page
      if (!pageMap[normalizedUrl]) {
        pageMap[normalizedUrl] = {
          url: normalizedUrl,
          depth: depth,
          parent: null,
          children: [],
          discoveredFrom: [],
        };
      }
    } catch (error) {
      // Check if it's a browser context loss error
      if (error.message && (
        error.message.includes('no such frame') ||
        error.message.includes('Context') ||
        error.message.includes('browsingContext') ||
        error.message.includes('session not found') ||
        error.message.includes('Browser context lost')
      )) {
        console.error(`  ❌ Browser context lost: ${normalizedUrl}`);
        console.error(`     Error: ${error.message}`);
        console.error(`     This usually means the browser session was closed or crashed.`);
        console.error(`     Cannot continue crawling. Please restart the browser and try again.`);
        // Mark current URL as visited
        visitedUrls.add(normalizedUrl);
        // Break out of the loop - browser is no longer valid
        break;
      }
      
      // For other errors, log and continue
      console.error(`  ⚠️  Error crawling ${normalizedUrl}: ${error.message}`);
      // Mark as visited to avoid infinite retries
      visitedUrls.add(normalizedUrl);
      // Continue with next URL
    }
  }

  const urlArray = Array.from(discoveredUrls);
  console.info(`\n${'='.repeat(60)}`);
  console.info(`Crawl complete. Discovered ${urlArray.length} pages within domain: ${baseDomain}`);
  
  // Warn if we hit the maxPages limit and there are still pages in queue
  if (!isUnlimited && urlArray.length >= maxPages && urlsToVisit.length > 0) {
    console.warn(`\n⚠️  WARNING: Reached maxPages limit (${maxPages})!`);
    console.warn(`   There are still ${urlsToVisit.length} pages in the queue that were not discovered.`);
    console.warn(`   Set maxPages to null or 0 for unlimited crawling, or increase maxPages to discover more pages.`);
    console.warn(`   Current queue depth range: ${Math.min(...urlsToVisit.map(u => u.depth))} - ${Math.max(...urlsToVisit.map(u => u.depth))}\n`);
  }
  
  console.info(`${'='.repeat(60)}\n`);
  
  // Log pages organized by depth
  const pagesByDepth = {};
  urlArray.forEach(url => {
    const pageInfo = pageMap[url];
    const depth = pageInfo?.depth || 0;
    if (!pagesByDepth[depth]) {
      pagesByDepth[depth] = [];
    }
    pagesByDepth[depth].push(url);
  });
  
  // Summary only - detailed lists are saved to files
  console.info('Pages discovered by depth (summary):');
  Object.keys(pagesByDepth).sort((a, b) => parseInt(a) - parseInt(b)).forEach(depth => {
    console.info(`  Depth ${depth}: ${pagesByDepth[depth].length} pages`);
  });
  
  console.info(`\n${'='.repeat(60)}`);
  console.info(`Total: ${urlArray.length} pages from domain: ${baseDomain}`);
  console.info(`${'='.repeat(60)}\n`);
  
  // Final validation: Filter page map and ensure ALL URLs are from the same domain
  const filteredPageMap = {};
  const validatedUrls = [];
  const externalUrls = [];
  const duplicateUrls = [];
  
  urlArray.forEach(url => {
    // Final domain check
    if (!isSameDomain(url, baseDomain)) {
      externalUrls.push(url);
      console.warn(`⚠️  External URL found in results (should not happen): ${url}`);
      return;
    }

    // Final path-prefix check (subpath crawl boundary)
    if (!isWithinPathPrefix(url, basePathPrefix)) {
      return;
    }

    // Check for duplicates (shouldn't happen due to Set, but verify)
    if (validatedUrls.includes(url)) {
      duplicateUrls.push(url);
      console.warn(`⚠️  Duplicate URL found (should not happen): ${url}`);
      return;
    }
    
    validatedUrls.push(url);
    if (pageMap[url]) {
      filteredPageMap[url] = pageMap[url];
    }
  });
  
  if (externalUrls.length > 0) {
    console.error(`\n❌ ERROR: ${externalUrls.length} external URL(s) found in results!`);
    console.error(`   This should not happen. External URLs:`, externalUrls);
  }
  
  if (duplicateUrls.length > 0) {
    console.error(`\n❌ ERROR: ${duplicateUrls.length} duplicate URL(s) found in results!`);
    console.error(`   This should not happen. Duplicate URLs:`, duplicateUrls);
  }
  
  console.info(`\n✅ Validation complete: ${validatedUrls.length} unique pages from domain ${baseDomain}`);
  if (externalUrls.length === 0 && duplicateUrls.length === 0) {
    console.info(`   ✓ No external pages found`);
    console.info(`   ✓ No duplicate pages found`);
  }
  
  return {
    urls: validatedUrls, // Only validated URLs from same domain, no duplicates
    pageMap: filteredPageMap,
    domain: baseDomain,
    totalPages: validatedUrls.length,
    pagesByDepth: pagesByDepth,
  };
}

/**
 * Validates if a string is a valid URL
 * @param {string} url - String to validate
 * @returns {boolean} - True if valid URL
 */
function isValidUrl(url) {
  try {
    new URL(normalizeInputUrl(url));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  crawlWebsite,
  discoverPageLinks,
  isValidUrl,
  authenticate,
  isPrivatePage,
};
