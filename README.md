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

The easiest way to test a real website is using the provided example:

```bash
# Install dependencies first (see above)
# Then run the example with a URL
node src/run-a11y-test.js https://example.com

# Or use the npm script
pnpm example https://example.com
```

See [examples/README.md](examples/README.md) for detailed instructions and customization options.

## Usage

Here's a guide on how to use the **a11y-validator** to check the accessibility of a webpage or application:

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

**New Feature**: You can now pass a URL and the validator will automatically discover and test all pages on the website!

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

## Contributing

We welcome contributions! If you encounter any bugs, have suggestions for new features, or want to improve the documentation, feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License.
