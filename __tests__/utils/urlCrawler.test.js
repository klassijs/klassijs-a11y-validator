const { crawlWebsite, discoverPageLinks, isValidUrl } = require('../../src/urlCrawler');

describe('urlCrawler utility', () => {
  let mockBrowser;

  beforeEach(() => {
    process.env.A11Y_LINK_POLL_MS = '0';
    process.env.A11Y_POST_LOAD_DELAY_MS = '0';
    mockBrowser = {
      getUrl: jest.fn(),
      url: jest.fn(),
      execute: jest.fn(),
      waitUntil: jest.fn(),
      pause: jest.fn().mockResolvedValue(undefined),
    };
    global.browser = mockBrowser;
  });

  afterEach(() => {
    delete process.env.A11Y_LINK_POLL_MS;
    delete process.env.A11Y_POST_LOAD_DELAY_MS;
    delete global.browser;
    jest.clearAllMocks();
  });

  describe('isValidUrl', () => {
    test('should return true for valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com:8080/path?query=1')).toBe(true);
    });

    test('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(true); // Technically valid URL
    });
  });

  describe('discoverPageLinks', () => {
    test('should extract and filter internal links', async () => {
      const baseUrl = 'https://example.com';
      mockBrowser.getUrl.mockResolvedValue('https://example.com/page1');
      mockBrowser.execute.mockResolvedValue([
        'https://example.com/page2',
        'https://example.com/page3',
        'https://external.com/page',
        'https://example.com/page2#section',
        '/page4',
        'mailto:test@example.com',
        'javascript:void(0)',
      ]);

      const links = await discoverPageLinks(baseUrl, 'example.com');

      expect(links).toContain('https://example.com/page2');
      expect(links).toContain('https://example.com/page3');
      expect(links).toContain('https://example.com/page4');
      expect(links).not.toContain('https://external.com/page');
      expect(links).not.toContain('mailto:test@example.com');
    });

    test('should handle relative URLs', async () => {
      const baseUrl = 'https://example.com';
      mockBrowser.getUrl.mockResolvedValue('https://example.com');
      mockBrowser.execute.mockResolvedValue(['/about', '/contact']);

      const links = await discoverPageLinks(baseUrl, 'example.com');

      expect(links).toContain('https://example.com/about');
      expect(links).toContain('https://example.com/contact');
    });

    test('should remove duplicates', async () => {
      const baseUrl = 'https://example.com';
      mockBrowser.getUrl.mockResolvedValue('https://example.com');
      mockBrowser.execute.mockResolvedValue([
        'https://example.com/page',
        'https://example.com/page',
        'https://example.com/page?query=1',
      ]);

      const links = await discoverPageLinks(baseUrl, 'example.com');

      expect(links.filter(l => l.includes('/page')).length).toBe(1);
    });

    test('should return empty array if browser is not available', async () => {
      delete global.browser;

      await expect(discoverPageLinks('https://example.com')).rejects.toThrow(
        'Browser instance not available'
      );
    });
  });

  describe('crawlWebsite', () => {
    test('should discover pages up to maxPages limit', async () => {
      const baseUrl = 'https://example.com';
      let visitCount = 0;

      mockBrowser.getUrl.mockResolvedValue(baseUrl);
      mockBrowser.url.mockImplementation(() => {
        visitCount++;
        return Promise.resolve();
      });
      mockBrowser.waitUntil.mockResolvedValue(true);
      mockBrowser.execute.mockResolvedValue([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);

      const result = await crawlWebsite(baseUrl, { maxPages: 3, maxDepth: 2 });

      expect(result.urls.length).toBeLessThanOrEqual(3);
      expect(mockBrowser.url).toHaveBeenCalled();
    });

    test('should respect maxDepth limit', async () => {
      const baseUrl = 'https://example.com';
      const visitedUrls = [];

      mockBrowser.getUrl.mockResolvedValue(baseUrl);
      mockBrowser.url.mockImplementation((url) => {
        visitedUrls.push(url);
        return Promise.resolve();
      });
      mockBrowser.waitUntil.mockResolvedValue(true);
      mockBrowser.execute.mockResolvedValue(['https://example.com/level1']);

      await crawlWebsite(baseUrl, { maxPages: 10, maxDepth: 1 });

      // Should not go beyond depth 1
      expect(visitedUrls.length).toBeLessThanOrEqual(2); // base + level1
    });

    test('should exclude paths matching excludePaths', async () => {
      const baseUrl = 'https://example.com';
      const visitedUrls = [];

      mockBrowser.getUrl.mockResolvedValue(baseUrl);
      mockBrowser.url.mockImplementation((url) => {
        visitedUrls.push(url);
        return Promise.resolve();
      });
      mockBrowser.waitUntil.mockResolvedValue(true);
      mockBrowser.execute.mockResolvedValue([
        'https://example.com/admin',
        'https://example.com/public',
      ]);

      const urls = await crawlWebsite(baseUrl, {
        maxPages: 10,
        maxDepth: 2,
        excludePaths: ['/admin'],
      });

      expect(visitedUrls).not.toContain('https://example.com/admin');
    });

    test('should handle page load errors gracefully', async () => {
      const baseUrl = 'https://example.com';

      mockBrowser.getUrl.mockResolvedValue(baseUrl);
      mockBrowser.url.mockRejectedValue(new Error('Page load failed'));
      mockBrowser.waitUntil.mockResolvedValue(true);
      mockBrowser.execute.mockResolvedValue([]);

      // Should not throw, but continue
      const result = await crawlWebsite(baseUrl, { maxPages: 5, maxDepth: 1 });

      expect(Array.isArray(result.urls)).toBe(true);
    });

    test('should return empty array if browser is not available', async () => {
      delete global.browser;

      await expect(crawlWebsite('https://example.com')).rejects.toThrow(
        'Browser instance not available'
      );
    });

    test('should wait for page to load before discovering links', async () => {
      const baseUrl = 'https://example.com';

      mockBrowser.getUrl.mockResolvedValue(baseUrl);
      mockBrowser.url.mockResolvedValue();
      mockBrowser.waitUntil.mockResolvedValue(true);
      mockBrowser.execute.mockResolvedValue([]);

      await crawlWebsite(baseUrl, { maxPages: 1, maxDepth: 1 });

      expect(mockBrowser.waitUntil).toHaveBeenCalled();
    });
  });
});
