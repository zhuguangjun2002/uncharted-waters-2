/*
  Dedicated jest config for the batch navigation audit (npm run audit:navigation).

  It reuses the same transform and asset mapping as the main jest config but
  matches *.audit.ts instead of *.test.ts, so the (potentially long-running)
  map-wide sweep never runs as part of `npm test`.
*/
module.exports = {
  transform: {
    '\\.tsx?$': '@swc/jest',
  },
  moduleNameMapper: {
    '\\.(png|bin|wasm|ogg|mp3)$': 'identity-obj-proxy',
  },
  testEnvironment: 'jsdom',
  testMatch: ['**/*.audit.ts'],
};
