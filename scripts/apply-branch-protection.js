#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const repo =
  getArgValue("--repo") ||
  process.env.GITHUB_REPOSITORY ||
  process.env.REPO;
const branch = getArgValue("--branch") || process.env.BRANCH || "main";
const configPath =
  getArgValue("--config") || process.env.CONFIG || "branch-protection.json";

if (!repo) {
  console.error(
    "Missing repo. Pass --repo owner/name or set GITHUB_REPOSITORY.",
  );
  process.exit(1);
}

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

const endpoint = `repos/${repo}/branches/${branch}/protection`;

try {
  execFileSync(
    "gh",
    [
      "api",
      "-X",
      "PUT",
      endpoint,
      "-H",
      "Accept: application/vnd.github+json",
      "--input",
      "-",
    ],
    {
      input: JSON.stringify(config),
      stdio: "inherit",
    },
  );
  console.log(`Applied branch protection to ${repo}:${branch}`);
} catch (error) {
  console.error("Failed to apply branch protection.");
  console.error(error.message);
  process.exit(1);
}
