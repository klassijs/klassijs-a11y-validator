const path = require('path');

// const {dateTime} = require('./utils/dateTime');
const { getAccessibilityReport, getAccessibilityError, getAccessibilityTotalError } = require('./src/accessibilityLib');
const fs = require("fs");

// const envName = env.envName.toLowerCase();

const accessibility_lib = path.resolve(__dirname, './src/accessibilityLib.js');
if (fs.existsSync(accessibility_lib)) {
  const rList = [];
  global.accessibilityLib = require(accessibility_lib);
  global.accessibilityReportList = rList;
} else console.error('No Accessibility Lib');

async function accessibilityReport(pageName, count = false) {
  // Run the accessibility report and wait for it to complete
  await getAccessibilityReport(pageName);
  await accessibilityError(count);
}

/**
 * function for recording total errors from the Accessibility test run
 */
async function accessibilityError(count) {
  const totalError = await getAccessibilityTotalError();
  const etotalError = await getAccessibilityError();
  if (totalError > 0) {
    cucumberThis.attach('The accessibility rule violation has been observed');
    cucumberThis.attach(`accessibility error count per page : ${etotalError}`);
    if (count) {
      cucumberThis.attach(`Total accessibility error count : ${totalError}`);
    }
  } else if (totalError <= 0) {
    const violationcount = await getAccessibilityError();
    assert.equal(violationcount, 0);
  }
}

module.exports = { accessibilityReport };
