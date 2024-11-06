const { dateTime } = require('./utils/dateTime');
const { getAccessibilityReport, getAccessibilityError, getAccessibilityTotalError } = require('./src/accessibilityLib');

async function accessibilityReport(pageName, count = false) {
  const datatime = dateTime;

  // Pause for 1 second before running accessibility checks
  await browser.pause(DELAY_1s);

  // Run the accessibility report and wait for it to complete
  // const report = await accessibilityLib.getAccessibilityReport(pageName);
  await getAccessibilityReport(pageName);
  // const results = await accessibilityLib.getAccessibilityReport(pageName);
  // if (results) {
  //   console.log('Accessibility report results:', results);
  //   // Process the results here
  // } else {
  //   console.error('Failed to get accessibility report results.');
  // }

  // console.log('this is the report ============ ', report);
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

  // Handle accessibility errors if any
  await module.exports.accessibilityError(count);

  // Pause for 2 seconds at the end, if needed
  await browser.pause(DELAY_2s);
}

  /**
   * function for recording total errors from the Accessibility test run
   */
async function accessibilityError(count) {
  const totalError = getAccessibilityTotalError();
  const etotalError = getAccessibilityError();
  if (totalError > 0) {
    cucumberThis.attach('The accessibility rule violation has been observed');
    cucumberThis.attach(`accessibility error count per page : ${etotalError}`);
    if (count) {
      cucumberThis.attach(`Total accessibility error count : ${totalError}`);
    }
  } else if (totalError <= 0) {
    const violationcount = getAccessibilityError();
    assert.equal(violationcount, 0);
  }
}

module.exports = { accessibilityReport, accessibilityError };
