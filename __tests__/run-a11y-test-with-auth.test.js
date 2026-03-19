jest.mock('webdriverio', () => ({
  remote: jest.fn(),
}));

jest.mock('../index', () => ({
  a11yValidatorFromUrl: jest.fn(),
}));

const { remote } = require('webdriverio');
const { a11yValidatorFromUrl } = require('../index');
const { runAccessibilityTestWithAuth } = require('../src/run-a11y-test-with-auth');

describe('run-a11y-test-with-auth runner', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.clearAllMocks();
    process.argv = [
      'node',
      'src/run-a11y-test-with-auth.js',
      'https://example.com',
      'https://example.com/login',
      'test-user',
      'test-pass',
    ];

    remote.mockResolvedValue({
      deleteSession: jest.fn().mockResolvedValue(undefined),
    });

    a11yValidatorFromUrl.mockResolvedValue({
      totalPages: 1,
      pagesTested: 1,
      totalErrors: 0,
      errors: [],
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  test('calls a11yValidatorFromUrl with authConfig and closes session', async () => {
    await runAccessibilityTestWithAuth();

    expect(remote).toHaveBeenCalledTimes(1);
    expect(a11yValidatorFromUrl).toHaveBeenCalledTimes(1);

    const [passedUrl, passedOptions] = a11yValidatorFromUrl.mock.calls[0];
    expect(passedUrl).toBe('https://example.com');
    expect(passedOptions).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          loginUrl: 'https://example.com/login',
          credentials: {
            username: 'test-user',
            password: 'test-pass',
          },
        }),
      })
    );

    // Ensure we clean up the session in finally
    const browser = await remote.mock.results[0].value;
    expect(browser.deleteSession).toHaveBeenCalledTimes(1);
  });
});

