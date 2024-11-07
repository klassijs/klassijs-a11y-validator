const path = require('path');

const {dateTime} = require('./utils/dateTime');
const { getAccessibilityReport, getAccessibilityError, getAccessibilityTotalError } = require('./src/accessibilityLib');

const envName = env.envName.toLowerCase();

async function accessibilityReport(pageName, count = false) {
  const datatime = await dateTime();
  await browser.pause(DELAY_1s);

  // Run the accessibility report and wait for it to complete
  await getAccessibilityReport(pageName);

  // Placeholder for where you generate the HTML report link or process the result
  console.log(
    'this is a placeholder for html links ============ ',
    path.resolve(
      paths.reports,
      browserName,
      envName,
      'accessibilityReport',
      `${pageName}-${browserName}_${datatime}.html`,
    ),
  );

  await accessibilityError(count);
  await browser.pause(DELAY_2s);
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
