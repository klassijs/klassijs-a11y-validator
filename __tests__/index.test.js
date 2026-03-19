const { a11yValidator, a11yValidatorFromUrl } = require('../index');
const { 
  getA11yValidator, 
  getAccessibilityError, 
  getAccessibilityTotalError,
  resetErrorCounts,
} = require('../src/accessibilityLib');
const { crawlWebsite, isValidUrl } = require('../src/urlCrawler');

// Mock the accessibilityLib module
jest.mock('../src/accessibilityLib', () => ({
  getA11yValidator: jest.fn(),
  getAccessibilityError: jest.fn(),
  getAccessibilityTotalError: jest.fn(),
  resetErrorCounts: jest.fn(),
}));

// Mock the urlCrawler module
jest.mock('../src/urlCrawler', () => ({
  crawlWebsite: jest.fn(),
  isValidUrl: jest.fn(),
}));

describe('index.js - a11yValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should call getA11yValidator with pageName', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    await a11yValidator('test-page');

    expect(getA11yValidator).toHaveBeenCalledWith('test-page', {});
  });

  test('should support options object as second argument', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    await a11yValidator('test-page', { includeTags: ['wcag21aa'] });
    expect(getA11yValidator).toHaveBeenCalledWith('test-page', { includeTags: ['wcag21aa'] });
  });
});

describe('index.js - a11yValidatorFromUrl', () => {
  let mockBrowser;
  beforeEach(() => {
    // Mock browser
    mockBrowser = {
      url: jest.fn(),
      waitUntil: jest.fn(),
    };
    global.browser = mockBrowser;

    // Reset mocks
    jest.clearAllMocks();
    isValidUrl.mockReturnValue(true);
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com', 'https://example.com/page1'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'], 1: ['https://example.com/page1'] },
    });
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);
    mockBrowser.waitUntil.mockResolvedValue(true);
    mockBrowser.pause = jest.fn().mockResolvedValue(true);
    mockBrowser.getWindowHandles = jest.fn().mockResolvedValue(['main']);
    mockBrowser.getUrl = jest.fn().mockResolvedValue('https://example.com');
    global.paths = { reports: './reports' };
    global.env = { envName: 'test' };
  });

  afterEach(() => {
    delete global.browser;
    delete global.paths;
    delete global.env;
  });

  test('should validate URL format', async () => {
    isValidUrl.mockReturnValue(false);

    await expect(a11yValidatorFromUrl('invalid-url')).rejects.toThrow('Invalid URL');
  });

  test('should throw error if browser is not available', async () => {
    delete global.browser;

    await expect(a11yValidatorFromUrl('https://example.com')).rejects.toThrow(
      'Browser instance not available'
    );
  });

  test('should crawl website and test all discovered pages', async () => {
    const discoveredUrls = [
      'https://example.com',
      'https://example.com/about',
      'https://example.com/contact',
    ];
    crawlWebsite.mockResolvedValue({
      urls: discoveredUrls,
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'], 1: ['https://example.com/about', 'https://example.com/contact'] },
    });
    getAccessibilityError.mockReturnValue(2);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(crawlWebsite).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    expect(results.totalPages).toBe(3);
    expect(results.pagesTested).toBe(3);
    expect(mockBrowser.url).toHaveBeenCalledTimes(3);
    expect(getA11yValidator).toHaveBeenCalledTimes(3);
  });

  test('should reset error counts at start', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'] },
    });

    await a11yValidatorFromUrl('https://example.com');

    expect(resetErrorCounts).toHaveBeenCalled();
  });

  test('should use custom crawler options', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'] },
    });

    await a11yValidatorFromUrl('https://example.com', {
      maxPages: 100,
      maxDepth: 5,
      excludePaths: ['/admin'],
    });

    expect(crawlWebsite).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        maxPages: 100,
        maxDepth: 5,
        excludePaths: ['/admin'],
      })
    );
  });

  test('should return summary with error counts', async () => {
    const discoveredUrls = ['https://example.com', 'https://example.com/page1'];
    crawlWebsite.mockResolvedValue({
      urls: discoveredUrls,
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'], 1: ['https://example.com/page1'] },
    });
    getAccessibilityError
      .mockReturnValueOnce(5)  // First page
      .mockReturnValueOnce(3); // Second page
    getAccessibilityTotalError.mockReturnValue(8);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.totalPages).toBe(2);
    expect(results.pagesTested).toBe(2);
    expect(results.totalErrors).toBe(8);
    expect(results.urls).toHaveLength(2);
    expect(results.urls[0].errors).toBe(5);
    expect(results.urls[1].errors).toBe(3);
  });

  test('should handle pages with no errors', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'] },
    });
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.totalErrors).toBe(0);
    expect(results.errors).toHaveLength(0);
  });

  test('should handle crawl errors gracefully', async () => {
    crawlWebsite.mockResolvedValue({
      urls: [],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: {},
    });

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.totalPages).toBe(0);
    expect(results.pagesTested).toBe(0);
  });

  test('should handle page load errors', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'] },
    });
    mockBrowser.url.mockRejectedValue(new Error('Page load failed'));

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.pagesTested).toBe(1);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].error).toBeDefined();
  });

  test('should generate page names from URLs', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com', 'https://example.com/about-us'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'], 1: ['https://example.com/about-us'] },
    });
    getAccessibilityError.mockReturnValue(0);

    await a11yValidatorFromUrl('https://example.com');

    expect(getA11yValidator).toHaveBeenCalledWith('home', expect.objectContaining({
      excludeTags: [],
      excludeRules: [],
      includeTags: null,
    }));
    expect(getA11yValidator).toHaveBeenCalledWith('about-us', expect.objectContaining({
      excludeTags: [],
      excludeRules: [],
      includeTags: null,
    }));
  });

  test('should wait for pages to load', async () => {
    crawlWebsite.mockResolvedValue({
      urls: ['https://example.com'],
      pageMap: {},
      domain: 'example.com',
      pagesByDepth: { 0: ['https://example.com'] },
    });

    await a11yValidatorFromUrl('https://example.com');

    expect(mockBrowser.waitUntil).toHaveBeenCalled();
  });
});
