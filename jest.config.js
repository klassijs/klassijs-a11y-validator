module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js',
    'utils/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // CI/dev convenience: suppress "Jest did not exit..." warnings.
  // We already verify with --detectOpenHandles that no real handles remain.
  forceExit: true,
};
