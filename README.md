# klassijs A11y (Accessibility) Validator

## Overview

**klassijs-a11y-validator** is a powerful tool designed to automate the **verification of accessibility compliance** for digital content, such as websites or applications. It helps developers and testers identify accessibility issues to ensure compliance with WCAG (Web Content Accessibility Guidelines) by programmatically testing elements against established standards (e.g., WCAG 2.0,2.1,2.2 on level A, AA and AAA). The function aims to ensure a more inclusive user experience, especially for individuals with disabilities, by identifying and helping resolve accessibility issues.

## Key Features:

- **Automated Accessibility Testing**: Quickly validates the accessibility of web pages and applications.
- **Website Crawling**: Automatically discovers and tests all pages on a website from a starting URL.
- **Compliance Checks**: Ensures your application meets WCAG 2.0/2.1/2.2 guidelines and other accessibility standards.
- **Detailed Reporting**: Provides detailed reports on accessibility issues found during validation.
- **Customizable Rules**: Customize which accessibility rules you want to check based on your project's needs.
- **Integration Ready**: Easily integrate into your CI/CD pipelines for continuous accessibility validation.

## Installation

You can easily install the **a11y-validator** using **pnpm**. Follow the steps below:

1. Open your terminal and navigate to your project directory.
2. Run the following command:
   ```bash
   pnpm add klassijs-a11y-validator
   ```

### Additional Dependencies for Browser Automation

To run tests on real websites, you'll also need WebdriverIO and a browser driver:

```bash
# Install WebdriverIO
pnpm add -D @wdio/cli webdriverio

# For Chrome (recommended)
pnpm add -D chromedriver

# OR for Firefox
pnpm add -D geckodriver
```

## Quick Start - Testing a Real Website

The runner in `src/run-a11y-test.js` now supports four modes:
- Crawl and test an entire site from a start URL
- Crawl-only (discover pages without accessibility checks)
- Test specific page(s) only (single URL, comma list, or file list)
- Discover pages from XML sitemaps and test them

For `crawl` and `crawl-only`, discovery now works as:
1. Try sitemap discovery first (`robots.txt` sitemap entries, then `/sitemap.xml`)
2. If no sitemap pages are found, fall back to normal on-page link crawling

```bash
# 1) Crawl and test from a start URL
node src/run-a11y-test.js https://example.com

# 2) Crawl-only (discover pages, skip a11y tests)
node src/run-a11y-test.js https://example.com --crawl-only

# 3) Test specific pages only (no crawling)
node src/run-a11y-test.js https://example.com --pages /,/about,/contact

# Auth (optional): use login + credentials for private pages
node src/run-a11y-test.js https://example.com \
  --login-url https://example.com/login \
  --username test-user \
  --password test-pass

# 4) Test pages from file (`.txt` or `.csv`)
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.txt
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv

# 5) CSV: ignore columns by header name or zero-based index
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv --csv-ignore-columns notes,status
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv --csv-ignore-columns 2,3

# 6) Discover pages from sitemap(s) and test them
node src/run-a11y-test.js --from-sitemap https://example.com
node src/run-a11y-test.js --from-sitemap --base-url https://example.com --sitemap-url https://example.com/sitemap.xml
```

### NPM Scripts

The package provides scripts for each mode:

```bash
# Crawl and test
pnpm a11y:crawl https://example.com

# Crawl only
pnpm a11y:crawl-only https://example.com

# Specific page(s)
pnpm a11y:pages https://example.com/about
node src/run-a11y-test.js --base-url https://example.com --pages /,/about,/contact

# Pages from file
pnpm a11y:pages-file ./pages.txt
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.txt
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv
node src/run-a11y-test.js --base-url https://example.com --pages-file ./pages.csv --csv-ignore-columns notes,status

# From sitemap
node src/run-a11y-test.js --from-sitemap https://example.com
node src/run-a11y-test.js --from-sitemap --base-url https://example.com --sitemap-url https://example.com/sitemap.xml

# Auth examples (optional)
pnpm a11y:crawl https://example.com --login-url https://example.com/login --username test-user --password test-pass
```

`pages.txt` and `pages.csv` support:
- One URL or path per line
- Blank lines
- Comments starting with `#`

For CSV files, you can ignore columns with:
- `--csv-ignore-columns notes,status` (header names)
- `--csv-ignore-columns 2,3` (zero-based indexes)

Example:

```txt
# Relative paths
/
/about
/contact

# Absolute URL also works
https://example.com/pricing
```

CSV example:

```csv
url,path
https://example.com/pricing,/about
/contact,
```

## Usage

You can use the validator via:
- The CLI runner (`src/run-a11y-test.js`) for real-site automation
- The API (`a11yValidator` / `a11yValidatorFromUrl`) inside your own scripts

### CLI Runner Modes (`src/run-a11y-test.js`)

#### 1) Crawl and test a whole site

```bash
node src/run-a11y-test.js https://yourwebsite.com
```

This mode:
- Crawls internal pages from the start URL
- Runs accessibility checks on discovered pages
- Generates reports in the reports directory
- Uses sitemap-first discovery with crawler fallback automatically

#### 2) Crawl-only (discover pages only)

```bash
node src/run-a11y-test.js https://yourwebsite.com --crawl-only
# OR
CRAWL_ONLY=true node src/run-a11y-test.js https://yourwebsite.com
```

This mode:
- Crawls and lists discoverable pages
- Skips accessibility checks
- Helps verify coverage before full testing
- Uses sitemap-first discovery with crawler fallback automatically

#### 3) Test only specific pages (no crawling)

```bash
# Single explicit page
node src/run-a11y-test.js --pages https://yourwebsite.com/about

# Multiple pages using paths (with base URL)
node src/run-a11y-test.js https://yourwebsite.com --pages /,/about,/contact
# OR
node src/run-a11y-test.js --base-url https://yourwebsite.com --pages /,/about,/contact

# From file
node src/run-a11y-test.js --base-url https://yourwebsite.com --pages-file ./pages.txt
node src/run-a11y-test.js --base-url https://yourwebsite.com --pages-file ./pages.csv
```

Use this mode when you only want to validate selected pages instead of the full site.

#### 4) Test pages discovered from sitemaps

```bash
# Use robots.txt -> Sitemap directives (fallback to /sitemap.xml)
node src/run-a11y-test.js --from-sitemap https://yourwebsite.com

# Provide one or more sitemap URLs directly (comma-separated)
node src/run-a11y-test.js --from-sitemap --base-url https://yourwebsite.com --sitemap-url https://yourwebsite.com/sitemap.xml,https://yourwebsite.com/sitemap-posts.xml
```

This mode:
- Discovers URLs from XML sitemap files (including sitemap indexes)
- Filters to the same domain as `--base-url` (or the positional URL)
- Tests discovered pages using the same report pipeline as other test modes

### Single Page Validation

1. **Import the Tool**:
   Import the `a11y-validator` module into your project:
   ```javascript
   const { a11yValidator } = require('klassijs-a11y-validator');
   ```

2. **Run Accessibility Validation on Current Page**:
   The `a11yValidator` function validates the page that the browser is currently on:
   ```javascript
   // Make sure browser is already navigated to the page
   await browser.url('https://yourwebsite.com');
   
   // Run validation
   await a11yValidator('home-page', true);
   ```

### Multi-Page Validation from URL

1. **Import the URL Validator**:
   ```javascript
   const { a11yValidatorFromUrl } = require('klassijs-a11y-validator');
   ```

2. **Run Accessibility Validation on Entire Website**:
   ```javascript
   async function validateEntireWebsite() {
       try {
           // Make sure browser is initialized before calling
           const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
               maxPages: 50,        // Maximum pages to crawl (default: 50)
               maxDepth: 3,          // Maximum crawl depth (default: 3)
               excludePaths: ['/admin', '/api'], // Paths to exclude
               count: true,          // Include total error count (default: true)
               // Accessibility rule configuration (optional):
               excludeTags: [],      // Exclude WCAG tags (e.g., ['wcag22aa', 'best-practice'])
               excludeRules: [],     // Exclude specific rules (e.g., ['color-contrast'])
               includeTags: null    // Only check specific tags (overrides defaults)
           });
           
           console.log(`Tested ${results.pagesTested} pages`);
           console.log(`Found ${results.totalErrors} total accessibility errors`);
           console.log(`Pages with errors: ${results.errors.length}`);
       } catch (error) {
           console.error('Error during accessibility validation:', error);
       }
   }

   validateEntireWebsite();
   ```

   The `a11yValidatorFromUrl` function will:
   - Crawl the website starting from the provided URL
   - Discover all internal pages (respecting same-domain and depth limits)
   - Test each discovered page for accessibility issues
   - Generate individual reports for each page
   - Return a summary of all results

3. **Review the Reports**:
   The results will contain:
    - **Individual HTML/JSON reports** for each page tested (saved to reports directory)
    - **Summary object** with:
      - Total pages discovered and tested
      - Total accessibility errors found
      - List of pages with errors
      - Error count per page
    - Each report includes:
      - Issue descriptions
      - Severity levels (critical, serious, moderate, minor)
      - Affected elements
      - Recommended fixes


## Configuration

### Accessibility Rule Configuration

You can customize which accessibility standards and rules are checked:

```javascript
await a11yValidatorFromUrl('https://yourwebsite.com', {
    // Exclude specific WCAG standards
    excludeTags: ['wcag22aa', 'best-practice'],  // Exclude WCAG 2.2 Level AA and best practices
    
    // Exclude specific rules
    excludeRules: ['color-contrast', 'image-alt'],  // Exclude color contrast and image alt checks
    
    // Only check specific standards (overrides defaults)
    includeTags: ['wcag2a', 'wcag2aa'],  // Only check WCAG 2.0 Level A and AA
});
```

**Available WCAG Tags:**
- `wcag2a` - WCAG 2.0 Level A
- `wcag2aa` - WCAG 2.0 Level AA
- `wcag2aaa` - WCAG 2.0 Level AAA
- `wcag21a` - WCAG 2.1 Level A
- `wcag21aa` - WCAG 2.1 Level AA
- `wcag21aaa` - WCAG 2.1 Level AAA
- `wcag22aa` - WCAG 2.2 Level AA
- `wcag22aaa` - WCAG 2.2 Level AAA
- `best-practice` - Additional best practices

**Note:** `wcag22a` (WCAG 2.2 Level A) is not available in axe-core 4.10.2. WCAG 2.2 Level A rules are tagged with specific success criteria tags (e.g., `wcag221`, `wcag222`, `wcag224`) rather than a general `wcag22a` tag.

**Default Configuration:**
By default, the tool checks all WCAG 2.0, 2.1, and 2.2 standards at Level A and AA (where supported), plus best practices. This ensures comprehensive coverage of most legal and compliance requirements.

**Example: Check only WCAG 2.1 Level AA:**
```javascript
await a11yValidatorFromUrl('https://yourwebsite.com', {
    includeTags: ['wcag21aa']
});
```

**Example: Exclude color contrast checks:**
```javascript
await a11yValidatorFromUrl('https://yourwebsite.com', {
    excludeRules: ['color-contrast']
});
```

### Crawler Options

When using `a11yValidatorFromUrl`, you can customize the crawling behavior:

```javascript
await a11yValidatorFromUrl('https://yourwebsite.com', {
    maxPages: 100,              // Maximum number of pages to crawl (default: 50)
    maxDepth: 5,                 // Maximum depth to crawl from starting URL (default: 3)
    excludePaths: [              // Paths to exclude from crawling
        '/admin',
        '/api',
        '/private'
    ],
    maxPagesToTest: 5,           // Limit how many pages to test (default: null = test all)
                                  // Useful for quick checks: discover all pages but only test a few
    count: true                   // Include total error count in output (default: true)
});
```

**Example: Quick Check (Discover All, Test Only 5)**
```javascript
// Discover all 83 pages, but only test 5 of them for a quick check
await a11yValidatorFromUrl('https://yourwebsite.com', {
    maxPages: null,        // Discover all pages
    maxPagesToTest: 5,     // But only test 5 pages
});
```

### Browser Requirements

The validator requires a browser instance to be available globally. Make sure you have initialized your browser automation framework (e.g., WebdriverIO) before calling the validator functions:

```javascript
// Example with WebdriverIO
const { remote } = require('webdriverio');

(async () => {
    global.browser = await remote({
        capabilities: { browserName: 'chrome' }
    });
    
    // Now you can use the validator
    await a11yValidatorFromUrl('https://yourwebsite.com');
    
    await browser.deleteSession();
})();
```

### Authentication (Optional)

`src/run-a11y-test.js` can authenticate before crawling/testing when you pass login info.

CLI flags:
- `--login-url <url>`
- `--username <username>`
- `--password <password>`

Environment variables (also supported):
- `LOGIN_URL`
- `A11Y_USERNAME`
- `A11Y_PASSWORD`

Example:
```bash
pnpm a11y:crawl https://example.com \
  --login-url https://example.com/login \
  --username test-user \
  --password test-pass
```

Note: `src/run-a11y-test-with-auth.js` is still present as a standalone example, but the recommended approach is to use `src/run-a11y-test.js` with the auth flags above.

## Troubleshooting

### Quick Decision Tree

- If you get `EACCES` or `permission denied`: set `CACHE_DIR=~/.webdriverio-cache` and retry.
- If Chrome driver fails to start: use `BROWSER=safari` on macOS for a quick unblock.
- If Safari is not an option: install driver manually (`brew install chromedriver` or `brew install geckodriver`), then verify with `which`.
- If issues persist: clear caches (`rm -rf /tmp/chromedriver* ~/.webdriverio-cache`) and run again.

### Browser Driver / Permission Errors

If you see errors such as `EACCES`, `permission denied`, or chromedriver/geckodriver executable issues:

```bash
# Use a user-writable cache directory
CACHE_DIR=~/.webdriverio-cache node src/run-a11y-test.js https://example.com

# Or export it for your session
export CACHE_DIR=~/.webdriverio-cache
node src/run-a11y-test.js https://example.com
```

If Chrome setup is problematic on macOS, use Safari (no extra driver install required):

```bash
BROWSER=safari node src/run-a11y-test.js https://example.com
```

Or install a browser driver manually:

```bash
# Chrome
brew install chromedriver

# Firefox
brew install geckodriver
```

Useful checks:

```bash
which chromedriver
which geckodriver
```

If you still have temp/cache issues, clean old driver caches and retry:

```bash
rm -rf /tmp/chromedriver* ~/.webdriverio-cache
```

## Contributing

We welcome contributions! If you encounter any bugs, have suggestions for new features, or want to improve the documentation, feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
