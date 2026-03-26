require('dotenv').config();
const axe = require('axe-core');
const fs = require('fs');
const path = require('path');
const { astellen } = require('klassijs-astellen');
const {dateTime} = require('../utils/dateTime');

let errorCount = 0;
let totalErrorCount = 0;

// Get browser name from global, with fallback
let browserName = global.browserName || 'chrome';
astellen.set('BROWSER_NAME', browserName);

/**
 * Validates accessibility for a page using axe-core
 * @param {string} pageName - Name/identifier for the page (used in reports)
 * @param {Object} options - Configuration options for accessibility checking
 * @param {Array<string>} options.excludeTags - WCAG tags to exclude (e.g., ['wcag22aa', 'best-practice'])
 * @param {Array<string>} options.excludeRules - Specific rule IDs to exclude (e.g., ['color-contrast', 'image-alt'])
 * @param {Array<string>} options.includeTags - Specific tags to include (if provided, only these tags will be checked)
 * @param {string} [options.reportPageUrl] - If axe returns about:blank or a bad URL, use this for saved report `url`
 * @returns {Promise<Object>} - Axe results object
 */
async function getA11yValidator(pageName, options = {}) {
  pageName = pageName || 'pageNameNotAvailable';
  const {
    excludeTags = [],
    excludeRules = [],
    includeTags = null, // If provided, only check these tags (overrides default)
    reportPageUrl = null,
  } = options;

  await browser.execute(require('axe-core').source);
  const axeCheck = await browser.execute(() => {
    return typeof axe !== 'undefined';
  });

  if (!axeCheck) {
    return null;
  }

  // Serialize arrays to JSON strings to ensure proper serialization through WebdriverIO
  const excludeTagsJson = JSON.stringify(excludeTags || []);
  const excludeRulesJson = JSON.stringify(excludeRules || []);
  const includeTagsJson = JSON.stringify(includeTags || null);
  
  // Use executeAsync - the done callback receives the result
  const results = await browser.executeAsync((excludeTagsJson, excludeRulesJson, includeTagsJson, done) => {
    // Parse JSON strings back to arrays
    const excludeTagsParam = JSON.parse(excludeTagsJson);
    const excludeRulesParam = JSON.parse(excludeRulesJson);
    const includeTagsParam = includeTagsJson ? JSON.parse(includeTagsJson) : null;
    
    const hasExplicitIncludeTags = Array.isArray(includeTagsParam) && includeTagsParam.length > 0;
    
    // Build axe configuration:
    // - If includeTags is provided, run only those tags (and honor excludeTags)
    // - Otherwise run all rules by default, except rules tagged 'experimental'
    const axeConfig = {};
    
    if (hasExplicitIncludeTags) {
      let tags = includeTagsParam;
      if (Array.isArray(excludeTagsParam) && excludeTagsParam.length > 0) {
        tags = tags.filter(tag => !excludeTagsParam.includes(tag));
      }
      axeConfig.tags = tags;
    } else {
      // By default include all rules and disable 'experimental' tagged rules.
      const allRules = typeof axe.getRules === 'function' ? axe.getRules() : [];
      if (Array.isArray(allRules) && allRules.length > 0) {
        axeConfig.rules = {};
        allRules.forEach((rule) => {
          if (Array.isArray(rule.tags) && rule.tags.includes('experimental')) {
            axeConfig.rules[rule.ruleId] = { enabled: false };
          }
        });
      }
    }
    
    // Exclude specific rules if provided (ensure excludeRulesParam is an array)
    if (Array.isArray(excludeRulesParam) && excludeRulesParam.length > 0) {
      axeConfig.rules = axeConfig.rules || {};
      excludeRulesParam.forEach(ruleId => {
        axeConfig.rules[ruleId] = { enabled: false };
      });
    }
    
    // Run axe with configuration
    axe.run(document, axeConfig, (err, results) => {
      if (err) {
        console.error('Error running axe:', err);
        done({ error: err.message || String(err) });
        return;
      }
      
      if (!results) {
        console.error('Axe returned no results');
        done({ error: 'No results from axe' });
        return;
      }
      
      // Clean results - only include serializable properties
      try {
        const cleanResults = {
          violations: results.violations || [],
          incomplete: results.incomplete || [],
          passes: results.passes || [],
          inapplicable: results.inapplicable || [],
          timestamp: results.timestamp || new Date().toISOString(),
          url: results.url || window.location.href,
          testEngine: results.testEngine || {},
          testRunner: results.testRunner || {},
          testEnvironment: results.testEnvironment || {},
          toolOptions: results.toolOptions || {}
        };
        // Pass the object directly - WebdriverIO should handle serialization
        done(cleanResults);
      } catch (serializeErr) {
        console.error('Error preparing results:', serializeErr);
        done({ error: 'Failed to prepare results' });
      }
    });
  }, excludeTagsJson, excludeRulesJson, includeTagsJson).catch((err) => {
    console.error('Error executing axe:', err);
    return null;
  });
  
  // Handle the result
  if (!results) {
    console.error('No results returned from axe.run. Check for errors.');
    return null;
  }
  
  // Check if it's an error object
  if (results.error) {
    console.error('Axe error:', results.error);
    return null;
  }

  // Report `url`: axe sometimes returns about:blank or a BiDi/internal URL even when the page under test is correct.
  if (reportPageUrl && String(reportPageUrl).trim()) {
    try {
      results.url = new URL(String(reportPageUrl).trim()).href;
    } catch (_e) {
      /* keep axe url */
    }
  } else {
    try {
      const axeUrl = results.url != null ? String(results.url).trim() : '';
      const axeBad =
        !axeUrl ||
        axeUrl === 'about:blank' ||
        axeUrl.startsWith('about:') ||
        !/^https?:\/\//i.test(axeUrl);
      if (axeBad) {
        const live = await browser.getUrl();
        if (live && /^https?:\/\//i.test(String(live).trim())) {
          results.url = String(live).trim();
        }
      }
    } catch (_e) {
      /* keep axe url */
    }
  }

  // Generate report and set error counts
  const additionalData = await browser.capabilities;
  const browserName = astellen.get('BROWSER_NAME');
  console.info('Generating Axe Report........');
  await generatelAccessibilityReport(results, additionalData, pageName, browserName);

  // Count violations and incomplete checks as errors
  errorCount = (results.violations?.length || 0) + (results.incomplete?.length || 0);
  totalErrorCount += errorCount;

  return results;
}

function getAccessibilityError() {
  return errorCount;
}

function getAccessibilityTotalError() {
  return totalErrorCount;
}

/**
 * Resets the error counts (useful when starting a new validation run)
 */
function resetErrorCounts() {
  errorCount = 0;
  totalErrorCount = 0;
}

async function generatelAccessibilityReport(fullData, additionalData, pageName, browserName) {
  // Use global variables for environment and paths
  const env = global.env || { envName: 'test' };
  const paths = global.paths || { reports: './reports' };
  const accessibilityReportList = global.accessibilityReportList || [];

  const envName = env.envName.toLowerCase();
  const sample = fs.readFileSync(path.resolve(__dirname, '../utils/ReportSample'), 'utf-8');
  const addDataInHtml = sample.replace('XXX-DetailData', JSON.stringify(fullData));

  let finalHtml = addDataInHtml.replace('XXX-AdditinalData', JSON.stringify(additionalData));
  finalHtml = finalHtml.replace('XXX-PageName', pageName);

  const dirAcc = `${paths.reports}/accessibility/${browserName}/${envName}`;
  const datatime = await dateTime();
  const fileName = `${pageName}-${browserName}_${datatime}`;

  // Create directory recursively if it doesn't exist
  if (!fs.existsSync(dirAcc)) {
    fs.mkdirSync(dirAcc, { recursive: true });
  }
  fs.writeFileSync(dirAcc + '/' + fileName + '.json', JSON.stringify(fullData, null, 4));
  
  const reportPath = `${dirAcc}/${fileName}.html`;
  fs.writeFileSync(reportPath, finalHtml, 'utf-8');
  
  // Add to report list
  accessibilityReportList.push({
    filename: `${fileName}.html`,
    path: reportPath,
  });
  
  // Update global report list
  global.accessibilityReportList = accessibilityReportList;
  
  console.info(`  📄 Report saved: ${reportPath}`);
}

module.exports = {
  getA11yValidator,
  getAccessibilityError,
  getAccessibilityTotalError,
  resetErrorCounts,
};
