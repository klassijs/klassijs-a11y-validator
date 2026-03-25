const fs = require('fs');
const os = require('os');
const path = require('path');

const { getPagesFromFile } = require('../src/pagesFileParser');

describe('pagesFileParser', () => {
  test('parses .txt with relative paths using baseUrl', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-pages-txt-'));
    const filePath = path.join(tmpDir, 'pages.txt');

    fs.writeFileSync(filePath, '/about\n/contact\n\n', 'utf8');

    const pages = getPagesFromFile(filePath, { baseUrl: 'https://example.com' });

    expect(pages).toEqual([
      'https://example.com/about',
      'https://example.com/contact',
    ]);
  });

  test('parses .csv and ignores columns by header name', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-pages-csv-'));
    const filePath = path.join(tmpDir, 'pages.csv');

    fs.writeFileSync(
      filePath,
      'url,pagetype\nhttps://example.com,public\nhttps://example.com/about,private\n',
      'utf8'
    );

    const pages = getPagesFromFile(filePath, {
      csvIgnoreColumns: ['pagetype'],
    });

    expect(pages).toEqual(['https://example.com', 'https://example.com/about']);
  });

  test('parses .csv relative paths and ignores columns by index', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-pages-csv-idx-'));
    const filePath = path.join(tmpDir, 'pages.csv');

    fs.writeFileSync(
      filePath,
      'path,pagetype\n/about,public\n/contact,public\n',
      'utf8'
    );

    const pages = getPagesFromFile(filePath, {
      baseUrl: 'https://example.com',
      csvIgnoreColumns: ['1'], // ignore second column by index
    });

    expect(pages).toEqual(['https://example.com/about', 'https://example.com/contact']);
  });
});

