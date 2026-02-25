module.exports = {
  extends: ["@commitlint/config-conventional"],
  ignorePatterns: [(msg) => msg.trim() === "Initial plan"],
};
