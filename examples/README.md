# Running Accessibility Tests - Examples

This directory contains practical examples of how to use `klassijs-a11y-validator` with real websites.

## Quick Start

### 1. Install Dependencies

First, you need to install WebdriverIO and a browser driver:

```bash
# Install WebdriverIO
pnpm add -D @wdio/cli webdriverio

# For Chrome (recommended)
pnpm add -D chromedriver

# OR for Firefox
pnpm add -D geckodriver
```

### 2. Run the Example

```bash
# Test a specific URL
node src/run-a11y-test.js https://example.com

# Or test the default (example.com)
node src/run-a11y-test.js
```

## Configuration Options

### Environment Variables

You can configure the test run using environment variables:

```bash
# Set environment name (affects report directory structure)
export ENV_NAME=production

# Set custom reports path
export REPORTS_PATH=./my-reports

# Run the test
node src/run-a11y-test.js https://yourwebsite.com
```

### Customizing the Test

Edit `run-a11y-test.js` to customize:

- **Browser**: Change `browserName` in `browserOptions` (chrome, firefox, safari, etc.)
- **Headless mode**: Remove `'--headless'` from chromeOptions to see the browser
- **Max pages**: Adjust `maxPages` in the `a11yValidatorFromUrl` call
- **Max depth**: Adjust `maxDepth` to control how deep to crawl
- **Exclude paths**: Add paths to `excludePaths` array to skip certain pages

## Example Output

```
============================================================
Accessibility Test Runner
============================================================
Testing URL: https://example.com

Initializing browser...
Browser initialized successfully!

Starting accessibility validation for URL: https://example.com
Starting crawl from: https://example.com
Max pages: 10, Max depth: 2
Visiting (depth 0): https://example.com
[1/3] Testing: https://example.com
Generating Axe Report........
[2/3] Testing: https://example.com/about
Generating Axe Report........
[3/3] Testing: https://example.com/contact
Generating Axe Report........

============================================================
Test Results Summary
============================================================
Total pages discovered: 3
Pages tested: 3
Total accessibility errors: 5
Pages with errors: 2

Pages with accessibility issues:
  1. https://example.com
     Errors: 3
  2. https://example.com/about
     Errors: 2

============================================================
Reports Generated
============================================================
Check the reports directory: ./reports
Reports are organized by: chrome/test/accessibilityReport/
Each page has both HTML and JSON report files.

✅ Accessibility test completed successfully!
```

## Testing Private/Protected Pages

If your website has pages that require authentication, you can provide login credentials:

```bash
# Using environment variables (recommended for security)
export LOGIN_URL="https://yourwebsite.com/login"
export A11Y_USERNAME="your-username"
export A11Y_PASSWORD="your-password"

node src/run-a11y-test-with-auth.js https://yourwebsite.com

# Or pass credentials as arguments
node src/run-a11y-test-with-auth.js https://yourwebsite.com https://yourwebsite.com/login username password
```

### Authentication Options

You can configure authentication in several ways:

**Option 1: Simple credentials with auto-detection**
```javascript
const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
  auth: {
    loginUrl: 'https://yourwebsite.com/login',
    credentials: {
      username: 'your-username',
      password: 'your-password',
    },
  },
});
```

**Option 2: Custom selectors**
```javascript
const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
  auth: {
    loginUrl: 'https://yourwebsite.com/login',
    credentials: {
      username: 'your-username',
      password: 'your-password',
    },
    selectors: {
      username: '#email-field',
      password: '#password-field',
      submit: 'button.login-button',
    },
  },
});
```

**Option 3: Custom login function (for complex authentication)**
```javascript
const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
  auth: {
    loginFunction: async (browser) => {
      await browser.url('https://yourwebsite.com/login');
      await browser.$('#username').setValue('user');
      await browser.$('#password').setValue('pass');
      await browser.$('#submit').click();
      // Wait for successful login
      await browser.waitUntil(async () => {
        const url = await browser.getUrl();
        return !url.includes('login');
      });
    },
  },
});
```

**Option 4: Skip private pages instead of authenticating**
```javascript
const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
  skipPrivatePages: true,  // Skip pages that require login
  privatePageIndicators: ['Login', 'Sign in', 'Access denied'],
});
```

## Using in Your Own Code

You can also use the validator in your own test scripts:

```javascript
const { remote } = require('webdriverio');
const { a11yValidatorFromUrl } = require('klassijs-a11y-validator');
const { astellen } = require('klassijs-astellen');

(async () => {
  // Setup globals
  global.browserName = 'chrome';
  astellen.set('BROWSER_NAME', 'chrome');
  global.env = { envName: 'test' };
  global.paths = { reports: './reports' };
  global.accessibilityReportList = [];

  // Initialize browser
  global.browser = await remote({
    capabilities: { browserName: 'chrome' }
  });

  // Run validation (with optional authentication)
  const results = await a11yValidatorFromUrl('https://yourwebsite.com', {
    maxPages: 20,
    maxDepth: 3,
    auth: {
      loginUrl: 'https://yourwebsite.com/login',
      credentials: {
        username: process.env.USERNAME,
        password: process.env.PASSWORD,
      },
    },
  });

  console.log(`Found ${results.totalErrors} errors across ${results.pagesTested} pages`);

  // Cleanup
  await global.browser.deleteSession();
})();
```

## Troubleshooting

### Chromedriver Download/Installation Errors

If you see errors like "chromedriver executable is missing":

**Option 1: Install chromedriver manually (Recommended)**
```bash
# macOS
brew install chromedriver

# Or download from https://chromedriver.chromium.org/
# Make sure it's in your PATH
```

**Option 2: Use Safari (macOS only, easiest)**
```bash
# Safari doesn't need a driver on macOS
BROWSER=safari node src/run-a11y-test.js https://example.com

# Or use the Safari-specific example (if it exists)
node src/run-a11y-test-safari.js https://example.com
```

**Option 3: Clean chromedriver cache**
```bash
# Remove corrupted cache
rm -rf /tmp/chromedriver*

# Try again
node src/run-a11y-test.js https://example.com
```

**Option 4: Use Firefox**
```bash
# Install geckodriver
brew install geckodriver

# Run with Firefox
BROWSER=firefox node src/run-a11y-test.js https://example.com
```

### Safari Remote Automation Error

If using Safari, you need to enable remote automation:
1. Open Safari
2. Safari > Settings > Advanced
3. Check "Show Develop menu in menu bar"
4. Develop > Allow Remote Automation

### Browser Not Starting

- Make sure Chrome/Firefox/Safari is installed
- Check that chromedriver/geckodriver is in your PATH
- Try running without `--headless` to see browser errors
- Check browser console for additional error messages

### No Pages Discovered

- Check that the website has internal links
- Verify the URL is accessible
- Try increasing `maxDepth` or `maxPages`
- Check browser console for JavaScript errors

### Reports Not Generated

- Verify `paths.reports` is set correctly
- Check file system permissions
- Ensure the directory structure can be created

## Next Steps

- Integrate into CI/CD pipelines
- Add to your existing test suites
- Customize report templates
- Set up scheduled accessibility monitoring
