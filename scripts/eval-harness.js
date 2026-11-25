const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.dirname(require.resolve("../package.json"));
const reportPath = path.join(root, "tmp", "harness-eval.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.rmSync(reportPath, { force: true });
const result = spawnSync(
  process.execPath,
  [
    require.resolve("jest/bin/jest"),
    "--runInBand",
    "--runTestsByPath",
    "client/lib/__tests__/harness-eval.test.ts",
    "client/lib/runtime/__tests__/service-security.test.ts",
    "client/lib/runtime/__tests__/service.test.ts",
  ],
  {
    cwd: root,
    env: { ...process.env, HARNESS_EVAL_REPORT: reportPath },
    stdio: "inherit",
  },
);
if (result.error || result.status !== 0) {
  fs.rmSync(reportPath, { force: true });
  process.exit(result.status || 1);
}
try {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (
    report.schemaVersion !== 1 ||
    report.status !== "passed" ||
    !report.scenarios?.length ||
    !report.mutationProbes?.length
  ) {
    throw new Error("Invalid report");
  }
  console.log(
    `Harness eval: ${report.scenarios.length} scenarios, ${report.mutationProbes.length} mutation probes passed.`,
  );
  console.log(`Report: ${reportPath}`);
} catch {
  fs.rmSync(reportPath, { force: true });
  console.error("Harness eval did not produce a valid report.");
  process.exitCode = 1;
}
