const fs = require('fs');
const path = require('path');

function getCliValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cells[idx] || '';
    });
    return row;
  });
}

function normalizeUrl(value) {
  try {
    return new URL(value).href.replace(/\/$/, '');
  } catch (_e) {
    return String(value || '').trim().replace(/\/$/, '');
  }
}

function findLatestSummaryJson(summaryDir) {
  if (!fs.existsSync(summaryDir)) return null;
  const files = fs
    .readdirSync(summaryDir)
    .filter((file) => file.startsWith('comprehensive-summary-') && file.endsWith('.json'))
    .map((file) => ({
      file,
      fullPath: path.join(summaryDir, file),
      mtime: fs.statSync(path.join(summaryDir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0].fullPath : null;
}

function main() {
  const args = process.argv.slice(2);
  const inventoryPath = getCliValue(args, '--inventory');
  const reportsDir = getCliValue(args, '--reports-dir') || './reports';
  const summaryPathArg = getCliValue(args, '--summary');
  const outputArg = getCliValue(args, '--output');

  if (!inventoryPath) {
    throw new Error('Missing required --inventory path to page inventory CSV');
  }

  const summaryPath = summaryPathArg || findLatestSummaryJson(path.join(reportsDir, 'summary'));
  if (!summaryPath || !fs.existsSync(summaryPath)) {
    throw new Error('No summary JSON found. Run accessibility summary generation first.');
  }

  const inventoryRows = parseCsv(fs.readFileSync(path.resolve(inventoryPath), 'utf-8'));
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const testedPages = new Set((summary.allPages || []).map((p) => normalizeUrl(p.url || p.pageName || '')));

  const buckets = {};
  inventoryRows.forEach((row) => {
    const pageType = row.pageType || 'unknown';
    const locale = row.locale || 'unknown';
    const key = `${locale}::${pageType}`;
    if (!buckets[key]) {
      buckets[key] = {
        locale,
        pageType,
        totalInventoryPages: 0,
        testedPages: 0,
      };
    }
    buckets[key].totalInventoryPages += 1;
    if (testedPages.has(normalizeUrl(row.url))) {
      buckets[key].testedPages += 1;
    }
  });

  const coverageByGroup = Object.values(buckets).map((bucket) => ({
    ...bucket,
    coveragePercent:
      bucket.totalInventoryPages === 0
        ? 0
        : Number(((bucket.testedPages / bucket.totalInventoryPages) * 100).toFixed(2)),
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    summarySource: summaryPath,
    inventorySource: path.resolve(inventoryPath),
    totals: {
      inventoryPages: inventoryRows.length,
      testedPagesMatched: coverageByGroup.reduce((acc, item) => acc + item.testedPages, 0),
    },
    coverageByGroup,
  };

  const outputPath = outputArg || path.join(reportsDir, 'coverage', 'page-type-coverage.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Coverage report created: ${outputPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
