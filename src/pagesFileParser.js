const fs = require('fs');

const cleanUrlInput = (input) => {
  if (input === null || input === undefined) return '';
  let value = String(input);
  value = value.replace(/^\uFEFF/, ''); // BOM
  value = value.replace(/[\u200B-\u200D\u2060]/g, ''); // zero-width
  value = value.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' '); // whitespace oddities
  value = value.replace(/[\u0000-\u001F\u007F]/g, ''); // control chars
  value = value.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
};

const normalizeUrl = (input, baseUrl) => {
  const cleaned = cleanUrlInput(input);
  const looksLikeHost =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i.test(cleaned) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/.*)?$/i.test(cleaned);
  const withScheme =
    cleaned && !/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) && looksLikeHost
      ? `https://${cleaned}`
      : cleaned;
  const base = (() => {
    if (!baseUrl) return baseUrl;
    const b = cleanUrlInput(baseUrl);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(b)) return b;
    return `https://${b}`;
  })();
  return new URL(withScheme, base).href;
};

const looksLikeUrlOrPath = (value) => {
  if (!value) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return true;
  // allow relative paths like /about or about or ./about
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  return false;
};

const parseSimpleCsvRows = (content) => {
  // Minimal CSV splitter: handles quoted values by tracking quotes and escaping.
  const rows = [];
  let currentRow = [];
  let currentValue = '';
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(cleanUrlInput(currentValue));
    currentValue = '';
  };

  const pushRow = () => {
    // Skip completely empty rows.
    const isEmpty = currentRow.every((v) => !v);
    if (!isEmpty) rows.push(currentRow);
    currentRow = [];
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      // Escaped quote
      currentValue += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === ',') {
      pushValue();
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      // Handle CRLF/LF/CR
      if (ch === '\r' && next === '\n') i++;
      pushValue();
      pushRow();
      continue;
    }

    currentValue += ch;
  }

  // Flush last value/row
  pushValue();
  pushRow();

  return rows;
};

const parseIgnoreColumns = (ignoreColumns) => {
  if (!ignoreColumns) return [];
  if (Array.isArray(ignoreColumns)) return ignoreColumns.map(String).map((s) => s.trim()).filter(Boolean);
  return String(ignoreColumns)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Parse `.txt` / `.csv` containing URLs or relative page paths.
 * - `.txt`: one URL/path per line (blank lines ignored)
 * - `.csv`: first column is treated as the page/url by default. You may also ignore columns
 *   (by header name or index) using `csvIgnoreColumns`.
 */
function getPagesFromFile(pagesFilePath, options = {}) {
  const { baseUrl, csvIgnoreColumns = [] } = options;
  if (!pagesFilePath) throw new Error('pagesFilePath is required');

  const content = fs.readFileSync(pagesFilePath, 'utf8');
  const extension = String(pagesFilePath).toLowerCase().endsWith('.csv') ? 'csv' : 'txt';

  if (extension === 'txt') {
    const lines = content
      .split(/\r?\n/)
      .map((l) => cleanUrlInput(l))
      .filter(Boolean);

    const pages = lines
      .filter((line) => looksLikeUrlOrPath(line))
      .map((line) => {
        if (line.startsWith('http://') || line.startsWith('https://')) return line;
        if (!baseUrl) throw new Error(`baseUrl is required for relative path: ${line}`);
        return normalizeUrl(line, baseUrl);
      });

    return [...new Set(pages)];
  }

  // csv
  const rows = parseSimpleCsvRows(content);
  if (rows.length === 0) return [];

  const ignoreColumns = parseIgnoreColumns(csvIgnoreColumns);

  let header = null;
  let startRowIndex = 0;

  // Detect header row if first row contains non-url-ish values and matches ignore column names.
  // We'll treat the first row as header if any ignoreColumns looks like a header string.
  if (ignoreColumns.length > 0) {
    header = rows[0].map((v) => cleanUrlInput(v));
    startRowIndex = 1;
  } else {
    // No ignore columns: treat first column of every row as the URL/path (header optional).
    startRowIndex = 0;
  }

  const findUrlColumnIndex = (row) => {
    if (!Array.isArray(row) || row.length === 0) return 0;
    return 0;
  };

  const pages = [];

  for (let r = startRowIndex; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    if (header) {
      // Remove ignored columns by index/name if requested, but keep first non-ignored value as URL.
      const ignored = new Set();
      ignoreColumns.forEach((col) => {
        const asIndex = Number(col);
        if (!Number.isNaN(asIndex) && asIndex >= 0) {
          ignored.add(asIndex);
          return;
        }
        const idx = header.findIndex((h) => h && h.toLowerCase() === String(col).toLowerCase());
        if (idx >= 0) ignored.add(idx);
      });

      const urlIdx = findUrlColumnIndex(row);
      // Prefer the first value that "looks like url/path" and isn't ignored.
      let candidate = null;
      for (let i = 0; i < row.length; i++) {
        if (ignored.has(i)) continue;
        const v = row[i];
        if (looksLikeUrlOrPath(v)) {
          candidate = v;
          break;
        }
      }
      if (!candidate) continue;

      const value = candidate;
      if (value.startsWith('http://') || value.startsWith('https://')) {
        pages.push(value);
      } else {
        if (!baseUrl) throw new Error(`baseUrl is required for relative path: ${value}`);
        pages.push(normalizeUrl(value, baseUrl));
      }
    } else {
      const value = row[0];
      if (!looksLikeUrlOrPath(value)) continue;
      if (value.startsWith('http://') || value.startsWith('https://')) {
        pages.push(value);
      } else {
        if (!baseUrl) throw new Error(`baseUrl is required for relative path: ${value}`);
        pages.push(normalizeUrl(value, baseUrl));
      }
    }
  }

  return [...new Set(pages)];
}

module.exports = {
  cleanUrlInput,
  normalizeUrl,
  getPagesFromFile,
};

