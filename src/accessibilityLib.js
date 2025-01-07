require('dotenv').config();
const axe = require('axe-core');
const fs = require('fs');
const path = require('path');
const { astellen } = require('klassijs-astellen');
const {dateTime} = require('../utils/dateTime');

let errorCount = 0;
let totalErrorCount = 0;

astellen.set('BROWSER_NAME', browserName);
const envName = env.envName.toLowerCase();

async function getA11yValidator(pageName) {
  pageName = pageName || 'pageNameNotAvailable';

  await browser.execute(require('axe-core').source);
  const axeCheck = await browser.execute(() => {
    return typeof axe !== 'undefined';
  });

  if (!axeCheck) {
    return null;
  }

  const results = await new Promise((resolve) => {
    browser
      .executeAsync((done) => {
        axe.run((err, results) => {
          if (err) {
            console.error('Error running axe:', err);
            done(null);
          } else {
            // Serialize results to ensure proper deserialization
            const serializedResults = JSON.stringify(results);
            done(serializedResults);
          }
        });
      })
      .then((res) => {
        resolve(JSON.parse(res)); // Deserialize the results
      })
      .catch((err) => {
        console.error('Error in promise resolution:', err);
        resolve(null);
      });
  });

  if (!results) {
    console.error('No results returned from axe.run. Check for errors.');
    return null;
  }

  const additionalData = await browser.capabilities;
  const browserName = astellen.get('BROWSER_NAME');
  console.info('Generating Axe Report........');
  await generatelAccessibilityReport(results, additionalData, pageName, browserName);

  errorCount = results.violations.length + results.incomplete.length;
  totalErrorCount += errorCount;

  return results;
}

function getAccessibilityError() {
  return errorCount;
}

function getAccessibilityTotalError() {
  return totalErrorCount;
}

async function generatelAccessibilityReport(fullData, additionalData, pageName, browserName) {
  const sample = fs.readFileSync(path.resolve(__dirname, '../utils/ReportSample'), 'utf-8');
  const addDataInHtml = sample.replace('XXX-DetailData', JSON.stringify(fullData));

  let finalHtml = addDataInHtml.replace('XXX-AdditinalData', JSON.stringify(additionalData));
  finalHtml = finalHtml.replace('XXX-PageName', pageName);

  const dirAcc = `${paths.reports}/${browserName}/${envName}/accessibilityReport`;
  const datatime = await dateTime();
  const fileName = `${pageName}-${browserName}_${datatime}`;

  if (!fs.existsSync(dirAcc)) {
    fs.mkdirSync(dirAcc);
  }
  fs.writeFileSync(dirAcc + '/' + fileName + '.json', JSON.stringify(fullData, null, 4));
  fs.writeFileSync(
    dirAcc + '/' + fileName + '.html',
    finalHtml,
    'utf-8',
    accessibilityReportList.push({
      filename: `${fileName}.html`,
      path: `${dirAcc}/${fileName}.html`,
    }),
  );
}

module.exports = {
  getA11yValidator,
  getAccessibilityError,
  getAccessibilityTotalError,
};
