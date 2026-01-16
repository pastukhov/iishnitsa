#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const configPath =
  getArgValue("--config") || process.env.CONFIG || "branch-protection.json";
const resolvedConfigPath = path.resolve(process.cwd(), configPath);

if (!fs.existsSync(resolvedConfigPath)) {
  console.error(`Config not found: ${resolvedConfigPath}`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(resolvedConfigPath, "utf8"));
} catch (error) {
  console.error(`Failed to parse config JSON: ${resolvedConfigPath}`);
  console.error(error.message);
  process.exit(1);
}

const requiredChecks = [
  "base-up-to-date",
  "lint",
  "typecheck",
  "format",
  "providers-mock",
  "test",
  "commitlint",
  "branch-protection-check",
];

const checks = Array.isArray(config?.required_status_checks?.checks)
  ? config.required_status_checks.checks
  : [];
const contexts = checks
  .map((check) =>
    check && typeof check.context === "string" ? check.context : "",
  )
  .filter(Boolean);

const missing = requiredChecks.filter((context) => !contexts.includes(context));

if (missing.length > 0) {
  console.error("Branch protection config is missing required checks:");
  missing.forEach((context) => console.error(`- ${context}`));
  process.exit(1);
}

console.log("Branch protection config validation passed.");
