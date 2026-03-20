const { discoverPagesFromSitemap } = require('../src/sitemapDiscovery');

describe('sitemapDiscovery', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('discoverPagesFromSitemap supports direct urlset sitemap', async () => {
    const baseUrl = 'https://example.com';
    const sitemapUrl = 'https://example.com/sitemap.xml';

    global.fetch.mockImplementation(async (url) => {
      const xml = `
        <urlset>
          <url><loc>https://example.com/a</loc></url>
          <url><loc>https://example.com/b</loc></url>
          <url><loc>https://other.com/should-be-excluded</loc></url>
        </urlset>
      `;
      return {
        ok: true,
        status: 200,
        text: async () => xml,
      };
    });

    const pages = await discoverPagesFromSitemap({
      baseUrl,
      sitemapUrls: [sitemapUrl],
    });

    expect(pages).toEqual(
      expect.arrayContaining(['https://example.com/a', 'https://example.com/b'])
    );
    expect(pages).not.toEqual(expect.arrayContaining(['https://other.com/should-be-excluded']));
  });

  test('discoverPagesFromSitemap supports sitemapindex recursion', async () => {
    const baseUrl = 'https://example.com';
    const sitemapIndexUrl = 'https://example.com/sitemap_index.xml';
    const nestedSitemapUrl = 'https://example.com/sitemap_a.xml';

    global.fetch.mockImplementation(async (url) => {
      if (String(url) === sitemapIndexUrl) {
        const xml = `
          <sitemapindex>
            <sitemap><loc>${nestedSitemapUrl}</loc></sitemap>
          </sitemapindex>
        `;
        return { ok: true, status: 200, text: async () => xml };
      }

      const nestedXml = `
        <urlset>
          <url><loc>https://example.com/a</loc></url>
          <url><loc>https://example.com/c</loc></url>
        </urlset>
      `;
      return { ok: true, status: 200, text: async () => nestedXml };
    });

    const pages = await discoverPagesFromSitemap({
      baseUrl,
      sitemapUrls: [sitemapIndexUrl],
    });

    expect(pages).toEqual(expect.arrayContaining(['https://example.com/a', 'https://example.com/c']));
  });
});

