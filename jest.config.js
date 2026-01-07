module.exports = {
  preset: "jest-expo",
  testMatch: [
    "**/__tests__/**/*.test.(ts|tsx|js)",
    "**/?(*.)+(spec|test).(ts|tsx|js)",
  ],
  collectCoverage: true,
  collectCoverageFrom: [
    "client/**/*.{ts,tsx}",
    "!client/**/*.d.ts",
    "!**/node_modules/**",
  ],
  coverageReporters: ["text", "lcov"],
};
