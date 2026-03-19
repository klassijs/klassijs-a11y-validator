const defaultSelectors = {
  username: 'input[name="username"], input[name="email"], input[type="email"], #username, #email',
  password: 'input[name="password"], input[type="password"], #password',
  submit:
    'button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign in")',
};

function buildAuthConfig({ loginUrl, username, password, selectors = defaultSelectors } = {}) {
  if (!loginUrl) return null;

  const authConfig = {
    loginUrl,
    selectors,
  };

  // Only include credentials when both are provided.
  if (username && password) {
    authConfig.credentials = { username, password };
  }

  return authConfig;
}

module.exports = {
  defaultSelectors,
  buildAuthConfig,
};

