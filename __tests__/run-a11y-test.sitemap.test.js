const { _test } = require('../src/run-a11y-test');

describe('run-a11y-test sitemap helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('extractSitemapUrlsFromRobotsTxt parses sitemap directives', () => {
    const robotsTxt = `
      User-agent: *
      Sitemap: https://example.com/sitemap.xml
      Sitemap: https://example.com/sitemap-posts.xml
    `;

    const urls = _test.extractSitemapUrlsFromRobotsTxt(robotsTxt, 'https://example.com');
    expect(urls).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap-posts.xml',
    ]);
  });

  test('extractLocUrlsFromXml extracts <loc> URLs', () => {
    const xml = `
      <urlset>
        <url><loc>https://example.com/page1</loc></url>
        <url><loc>/page2</loc></url>
      </urlset>
    `;

    const urls = _test.extractLocUrlsFromXml(xml, 'https://example.com');
    expect(urls).toEqual(['https://example.com/page1', 'https://example.com/page2']);
  });

  test('discoverPagesFromSitemap supports a direct urlset sitemap', async () => {
    const sitemap1Xml = `
      <urlset>
        <url><loc>https://example.com/page1</loc></url>
        <url><loc>https://example.com/page2</loc></url>
        <url><loc>https://other.com/hidden</loc></url>
      </urlset>
    `;

    global.fetch.mockImplementation(async (url) => {
      if (url === 'https://example.com/sitemap1.xml') {
        return { ok: true, status: 200, text: async () => sitemap1Xml };
      }
      return { ok: false, status: 404, text: async () => '' };
    });

    const pages = await _test.discoverPagesFromSitemap({
      baseUrl: 'https://example.com',
      sitemapUrls: ['https://example.com/sitemap1.xml'],
    });

    expect(pages.sort()).toEqual(['https://example.com/page1', 'https://example.com/page2'].sort());
  });

  test('discoverPagesFromSitemap supports sitemapindex recursion', async () => {
    const indexXml = `
      <sitemapindex>
        <sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-b.xml</loc></sitemap>
      </sitemapindex>
    `;

    const sitemapAXml = `
      <urlset>
        <url><loc>https://example.com/page1</loc></url>
        <url><loc>https://other.com/pageX</loc></url>
      </urlset>
    `;

    const sitemapBXml = `
      <urlset>
        <url><loc>/page2</loc></url>
      </urlset>
    `;

    global.fetch.mockImplementation(async (url) => {
      if (url === 'https://example.com/index.xml') {
        return { ok: true, status: 200, text: async () => indexXml };
      }
      if (url === 'https://example.com/sitemap-a.xml') {
        return { ok: true, status: 200, text: async () => sitemapAXml };
      }
      if (url === 'https://example.com/sitemap-b.xml') {
        return { ok: true, status: 200, text: async () => sitemapBXml };
      }
      return { ok: false, status: 404, text: async () => '' };
    });

    const pages = await _test.discoverPagesFromSitemap({
      baseUrl: 'https://example.com',
      sitemapUrls: ['https://example.com/index.xml'],
    });

    expect(pages.sort()).toEqual(['https://example.com/page1', 'https://example.com/page2'].sort());
  });
});

