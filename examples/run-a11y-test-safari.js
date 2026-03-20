/**
 * Alternative Example: Using Safari (macOS only, no driver needed)
 * 
 * Safari is built into macOS and doesn't require a separate driver.
 * This makes it easier to get started on macOS.
 */

const { remote } = require('webdriverio');
const { a11yValidatorFromUrl } = require('../index');
const { astellen } = require('klassijs-astellen');

// Safari configuration (macOS only)
const browserOptions = {
  capabilities: {
    browserName: 'safari',
  },
  logLevel: 'warn',
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
};

const setupGlobals = () => {
  global.browserName = 'safari';
  astellen.set('BROWSER_NAME', 'safari');
  global.env = {
    envName: process.env.ENV_NAME || 'test',
  };
  global.paths = {
    reports: process.env.REPORTS_PATH || './reports',
  };
  global.accessibilityReportList = [];
};

async function runAccessibilityTest() {
  const testUrl = process.argv[2] || 'https://example.com';

  console.log('='.repeat(60));
  console.log('Accessibility Test Runner (Safari)');
  console.log('='.repeat(60));
  console.log(`Testing URL: ${testUrl}\n`);

  let browser;

  try {
    setupGlobals();

    console.log('Initializing Safari browser...');
    console.log('Note: Safari requires enabling Remote Automation in Safari > Develop menu\n');
    
    browser = await remote(browserOptions);
    global.browser = browser;

    console.log('Safari initialized successfully!\n');

    const results = await a11yValidatorFromUrl(testUrl, {
      maxPages: 200,  // Set high to discover all pages including children
      maxDepth: 2,
      excludePaths: ['/admin', '/api', '/private'],
      count: true,
    });

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
    if (error.message.includes('Safari') || error.message.includes('remote automation')) {
      console.error('\n❌ Safari Remote Automation Error!');
      console.error('\nTo enable Safari automation:');
      console.error('1. Open Safari');
      console.error('2. Go to Safari > Settings > Advanced');
      console.error('3. Check "Show Develop menu in menu bar"');
      console.error('4. Go to Develop > Allow Remote Automation');
      console.error('5. Try running again\n');
    }
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.deleteSession();
    }
  }
}

if (require.main === module) {
  runAccessibilityTest()
    .then(() => {
      console.log('\n✅ Test completed!');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { runAccessibilityTest };
