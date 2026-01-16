/**
 * Example: Running Accessibility Tests with Authentication
 * 
 * This example shows how to test websites that have both public and private pages
 * requiring authentication.
 */

const { remote } = require('webdriverio');
const { a11yValidatorFromUrl } = require('../index');
const { astellen } = require('klassijs-astellen');

const browserOptions = {
  capabilities: {
    browserName: process.env.BROWSER || 'chrome',
    'goog:chromeOptions': {
      args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  logLevel: 'warn',
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
};

const setupGlobals = () => {
  global.browserName = browserOptions.capabilities.browserName || 'chrome';
  astellen.set('BROWSER_NAME', global.browserName);
  global.env = {
    envName: process.env.ENV_NAME || 'test',
  };
  global.paths = {
    reports: process.env.REPORTS_PATH || './reports',
  };
  global.accessibilityReportList = [];
};

async function runAccessibilityTestWithAuth() {
  const testUrl = process.argv[2] || 'https://example.com';
  const loginUrl = process.argv[3] || process.env.LOGIN_URL;
  const username = process.argv[4] || process.env.A11Y_USERNAME;
  const password = process.argv[5] || process.env.A11Y_PASSWORD;

  console.log('='.repeat(60));
  console.log('Accessibility Test Runner (with Authentication)');
  console.log('='.repeat(60));
  console.log(`Testing URL: ${testUrl}`);
  if (loginUrl) {
    console.log(`Login URL: ${loginUrl}`);
    console.log(`Username: ${username ? '***' : 'Not provided'}`);
  }
  console.log('');

  let browser;

  try {
    setupGlobals();

    console.log('Initializing browser...');
    console.log(`Using browser: ${browserOptions.capabilities.browserName}\n`);
    
    try {
      browser = await remote(browserOptions);
      global.browser = browser;
      console.log('Browser initialized successfully!\n');
    } catch (browserError) {
      if (browserError.message.includes('chromedriver') || browserError.message.includes('executable')) {
        console.error('\n❌ Browser driver error. See troubleshooting in README.\n');
      }
      throw browserError;
    }

    // Configure authentication
    const authConfig = loginUrl ? {
      loginUrl: loginUrl,
      credentials: {
        username: username,
        password: password,
      },
      // Customize selectors based on your login form
      selectors: {
        username: 'input[name="username"], input[name="email"], input[type="email"], #username, #email',
        password: 'input[name="password"], input[type="password"], #password',
        submit: 'button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign in")',
      },
      // Alternative: Use a custom login function for complex authentication
      // loginFunction: async (browser) => {
      //   await browser.url(loginUrl);
      //   await browser.waitForExist('input[name="username"]');
      //   await browser.$('input[name="username"]').setValue(username);
      //   await browser.$('input[name="password"]').setValue(password);
      //   await browser.$('button[type="submit"]').click();
      //   // Wait for successful login (adjust selector as needed)
      //   await browser.waitUntil(async () => {
      //     const url = await browser.getUrl();
      //     return !url.includes('login');
      //   }, { timeout: 10000 });
      // },
    } : null;

    if (!authConfig && (username || password)) {
      console.warn('⚠️  Warning: Login credentials provided but no login URL. Authentication will be skipped.\n');
    }

    // Run accessibility validation
    const results = await a11yValidatorFromUrl(testUrl, {
      maxPages: 200,  // Set high to discover all pages including children
      maxDepth: 3,
      excludePaths: ['/api', '/webhooks'],
      count: true,
      auth: authConfig,
      skipPrivatePages: false,  // Set to true to skip private pages instead of authenticating
      privatePageIndicators: ['Login', 'Sign in', 'Authentication required'],
    });

    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('Test Results Summary');
    console.log('='.repeat(60));
    console.log(`Total pages discovered: ${results.totalPages}`);
    console.log(`Pages tested: ${results.pagesTested}`);
    console.log(`Total accessibility errors: ${results.totalErrors}`);
    console.log(`Pages with errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log('\nPages with accessibility issues:');
      results.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.url}`);
        if (error.errors) {
          console.log(`     Errors: ${error.errors}`);
        }
      });
    }

    console.log(`\nReports saved to: ${global.paths.reports}`);
    return results;

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.deleteSession();
    }
  }
}

if (require.main === module) {
  runAccessibilityTestWithAuth()
    .then(() => {
      console.log('\n✅ Test completed!');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { runAccessibilityTestWithAuth };
