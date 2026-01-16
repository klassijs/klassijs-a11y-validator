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
jest.mock('../utils/urlCrawler', () => ({
  crawlWebsite: jest.fn(),
  isValidUrl: jest.fn(),
}));

describe('index.js - a11yValidator', () => {
  let mockCucumberThis;
  let mockAssert;

  beforeEach(() => {
    // Mock global variables
    mockCucumberThis = {
      attach: jest.fn(),
    };
    global.cucumberThis = mockCucumberThis;

    mockAssert = {
      equal: jest.fn(),
    };
    global.assert = mockAssert;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete global.cucumberThis;
    delete global.assert;
  });

  test('should call getA11yValidator with pageName', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    await a11yValidator('test-page');

    expect(getA11yValidator).toHaveBeenCalledWith('test-page');
  });

  test('should attach error messages when errors are found', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(5);
    getAccessibilityTotalError.mockReturnValue(5);

    await a11yValidator('test-page', false);

    expect(mockCucumberThis.attach).toHaveBeenCalledWith('The accessibility rule violation has been observed');
    expect(mockCucumberThis.attach).toHaveBeenCalledWith('accessibility error count per page : 5');
    expect(mockCucumberThis.attach).not.toHaveBeenCalledWith(expect.stringContaining('Total accessibility error count'));
  });

  test('should attach total error count when count parameter is true', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(3);
    getAccessibilityTotalError.mockReturnValue(10);

    await a11yValidator('test-page', true);

    expect(mockCucumberThis.attach).toHaveBeenCalledWith('The accessibility rule violation has been observed');
    expect(mockCucumberThis.attach).toHaveBeenCalledWith('accessibility error count per page : 3');
    expect(mockCucumberThis.attach).toHaveBeenCalledWith('Total accessibility error count : 10');
  });

  test('should assert zero errors when no violations found', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    await a11yValidator('test-page');

    expect(mockAssert.equal).toHaveBeenCalledWith(0, 0);
    expect(mockCucumberThis.attach).not.toHaveBeenCalled();
  });

  test('should handle zero total errors but non-zero page errors', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(2);
    getAccessibilityTotalError.mockReturnValue(0);

    await a11yValidator('test-page');

    // When totalError is 0, it should assert even if page error is non-zero
    // This seems like a potential bug in the original code, but we test the actual behavior
    expect(mockAssert.equal).toHaveBeenCalledWith(2, 0);
  });

  test('should work with default count parameter (false)', async () => {
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(1);
    getAccessibilityTotalError.mockReturnValue(1);

    await a11yValidator('test-page');

    expect(mockCucumberThis.attach).toHaveBeenCalledTimes(2);
    expect(mockCucumberThis.attach).not.toHaveBeenCalledWith(expect.stringContaining('Total accessibility error count'));
  });
});

describe('index.js - a11yValidatorFromUrl', () => {
  let mockBrowser;
  let mockCucumberThis;
  let mockAssert;

  beforeEach(() => {
    // Mock browser
    mockBrowser = {
      url: jest.fn(),
      waitUntil: jest.fn(),
    };
    global.browser = mockBrowser;

    // Mock global variables
    mockCucumberThis = {
      attach: jest.fn(),
    };
    global.cucumberThis = mockCucumberThis;

    mockAssert = {
      equal: jest.fn(),
    };
    global.assert = mockAssert;

    // Reset mocks
    jest.clearAllMocks();
    isValidUrl.mockReturnValue(true);
    crawlWebsite.mockResolvedValue(['https://example.com', 'https://example.com/page1']);
    getA11yValidator.mockResolvedValue({});
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);
    mockBrowser.waitUntil.mockResolvedValue(true);
  });

  afterEach(() => {
    delete global.browser;
    delete global.cucumberThis;
    delete global.assert;
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
    crawlWebsite.mockResolvedValue(discoveredUrls);
    getAccessibilityError.mockReturnValue(2);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(crawlWebsite).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    expect(results.totalPages).toBe(3);
    expect(results.pagesTested).toBe(3);
    expect(mockBrowser.url).toHaveBeenCalledTimes(3);
    expect(getA11yValidator).toHaveBeenCalledTimes(3);
  });

  test('should reset error counts at start', async () => {
    crawlWebsite.mockResolvedValue(['https://example.com']);

    await a11yValidatorFromUrl('https://example.com');

    expect(resetErrorCounts).toHaveBeenCalled();
  });

  test('should use custom crawler options', async () => {
    crawlWebsite.mockResolvedValue(['https://example.com']);

    await a11yValidatorFromUrl('https://example.com', {
      maxPages: 100,
      maxDepth: 5,
      excludePaths: ['/admin'],
    });

    expect(crawlWebsite).toHaveBeenCalledWith('https://example.com', {
      maxPages: 100,
      maxDepth: 5,
      excludePaths: ['/admin'],
    });
  });

  test('should return summary with error counts', async () => {
    const discoveredUrls = ['https://example.com', 'https://example.com/page1'];
    crawlWebsite.mockResolvedValue(discoveredUrls);
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
    crawlWebsite.mockResolvedValue(['https://example.com']);
    getAccessibilityError.mockReturnValue(0);
    getAccessibilityTotalError.mockReturnValue(0);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.totalErrors).toBe(0);
    expect(results.errors).toHaveLength(0);
  });

  test('should handle crawl errors gracefully', async () => {
    crawlWebsite.mockResolvedValue([]);

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.totalPages).toBe(0);
    expect(results.pagesTested).toBe(0);
  });

  test('should handle page load errors', async () => {
    crawlWebsite.mockResolvedValue(['https://example.com']);
    mockBrowser.url.mockRejectedValue(new Error('Page load failed'));

    const results = await a11yValidatorFromUrl('https://example.com');

    expect(results.pagesTested).toBe(0);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].error).toBeDefined();
  });

  test('should generate page names from URLs', async () => {
    crawlWebsite.mockResolvedValue([
      'https://example.com',
      'https://example.com/about-us',
    ]);
    getAccessibilityError.mockReturnValue(0);

    await a11yValidatorFromUrl('https://example.com');

    expect(getA11yValidator).toHaveBeenCalledWith('home');
    expect(getA11yValidator).toHaveBeenCalledWith('about-us');
  });

  test('should wait for pages to load', async () => {
    crawlWebsite.mockResolvedValue(['https://example.com']);

    await a11yValidatorFromUrl('https://example.com');

    expect(mockBrowser.waitUntil).toHaveBeenCalled();
  });
});
