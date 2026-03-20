const fs = require('fs');
const path = require('path');

function getCliValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
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

function buildChecklist(summary) {
  const generatedAt = new Date().toISOString();
  const domain = summary.domain || 'unknown-domain';
  const incompleteByRule = Array.isArray(summary.incompleteByRule) ? summary.incompleteByRule : [];

  let out = '';
  out += `# Manual Accessibility Review Checklist\n\n`;
  out += `- Generated at: ${generatedAt}\n`;
  out += `- Domain: ${domain}\n`;
  out += `- Total pages in summary: ${summary.totalPages || 0}\n`;
  out += `- Incomplete rule groups: ${incompleteByRule.length}\n\n`;

  out += `## Core Manual Checks\n\n`;
  out += `- [ ] Keyboard-only navigation (all critical journeys)\n`;
  out += `- [ ] Screen reader announcements (labels, roles, states)\n`;
  out += `- [ ] Focus order and visible focus indicators\n`;
  out += `- [ ] Zoom/reflow at 200% and 400%\n`;
  out += `- [ ] Language and locale behavior (including RTL where applicable)\n`;
  out += `- [ ] Error handling, validation messages, and instructions\n`;
  out += `- [ ] Captions/transcripts/audio descriptions (where media exists)\n\n`;

  out += `## Incomplete Findings From Axe\n\n`;
  if (incompleteByRule.length === 0) {
    out += `No incomplete findings were reported in this summary.\n`;
  } else {
    incompleteByRule.forEach((rule, idx) => {
      out += `### ${idx + 1}. ${rule.id || 'unknown-rule'}\n\n`;
      out += `- Description: ${rule.description || 'N/A'}\n`;
      out += `- Help: ${rule.help || 'N/A'}\n`;
      out += `- Impact: ${rule.impact || 'N/A'}\n`;
      out += `- Affected pages: ${Array.isArray(rule.pages) ? rule.pages.length : 0}\n`;
      out += `- [ ] Reviewed and disposition recorded\n\n`;
    });
  }

  out += `## Reviewer Notes\n\n`;
  out += `- Reviewer:\n`;
  out += `- Date:\n`;
  out += `- Decision:\n`;
  out += `- Follow-up tickets:\n`;

  return out;
}

function main() {
  const args = process.argv.slice(2);
  const reportsDir = getCliValue(args, '--reports-dir') || './reports';
  const summaryPathArg = getCliValue(args, '--summary');
  const outputArg = getCliValue(args, '--output');

  const summaryPath = summaryPathArg || findLatestSummaryJson(path.join(reportsDir, 'summary'));
  if (!summaryPath || !fs.existsSync(summaryPath)) {
    throw new Error('No summary JSON found. Run accessibility summary generation first.');
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const checklist = buildChecklist(summary);
  const outputPath = outputArg || path.join(reportsDir, 'manual-a11y-review.md');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, checklist, 'utf-8');

  console.log(`Manual review checklist created: ${outputPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
