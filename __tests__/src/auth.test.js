const { buildAuthConfig } = require('../../src/auth');

describe('auth config builder', () => {
  test('returns null when loginUrl missing', () => {
    expect(buildAuthConfig({ loginUrl: null })).toBeNull();
  });

  test('builds config with selectors and without credentials when username/password missing', () => {
    const cfg = buildAuthConfig({
      loginUrl: 'https://example.com/login',
      username: null,
      password: null,
    });

    expect(cfg).toEqual(
      expect.objectContaining({
        loginUrl: 'https://example.com/login',
        selectors: expect.objectContaining({
          username: expect.any(String),
          password: expect.any(String),
          submit: expect.any(String),
        }),
      })
    );
    expect(cfg.credentials).toBeUndefined();
  });

  test('includes credentials only when username and password are both provided', () => {
    const cfg = buildAuthConfig({
      loginUrl: 'https://example.com/login',
      username: 'user',
      password: 'pass',
    });

    expect(cfg.credentials).toEqual({ username: 'user', password: 'pass' });
  });
});

