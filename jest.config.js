module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  roots: ["<rootDir>/client"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "babel-jest",
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/client/$1",
    "^@shared/(.*)$": "<rootDir>/shared/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  collectCoverageFrom: [
    "client/lib/**/*.{ts,tsx}",
    "!client/lib/**/*.d.ts",
    "!client/lib/prompts-data.ts",
    "!client/lib/mcp-prompts.ts",
    "!client/lib/prompts.ts",
    "!**/node_modules/**",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  coverageDirectory: "coverage",
};
