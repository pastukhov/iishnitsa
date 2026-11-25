import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { sendChatMessage } from "../../api";

const root = path.resolve(__dirname, "../../../..");
const host = path.join(root, "scripts/fixtures/runtime-cli-host.ts");
const run = (text: string) =>
  spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "scripts/agent-cli.ts",
      "--host",
      host,
      "--text",
      text,
    ],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
it("runs the same real production scenario through mobile and Node CLI", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Map(),
    body: null,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: "fixture answer" } }] }),
  });
  const chunks: string[] = [];
  await sendChatMessage(
    [
      {
        id: "fixture-user",
        role: "user",
        content: "hello",
        timestamp: "2026-11-25",
      },
    ],
    {
      providerId: "custom",
      baseUrl: "https://fixture.invalid",
      apiKey: "fixture-secret",
      model: "fixture",
    },
    (chunk) => chunks.push(chunk),
    [],
    false,
    { memorySettings: { enabled: false, autoSave: false, autoSummary: false } },
  );
  const result = run("hello");
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const events = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.filter((e) => e.type === "output").at(-1).text).toBe(
    chunks.at(-1),
  );
  expect(events.filter((e) => e.type === "finished")).toEqual([
    expect.objectContaining({ outcome: "completed" }),
  ]);
  expect(result.stdout).not.toMatch(/fixture-secret|fixture.invalid/);
});
it("cancels the real Node provider request with bounded exit", () => {
  const result = run("wait");
  expect(result.status).toBe(130);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.trim().split("\n").at(-1)!)).toEqual(
    expect.objectContaining({ outcome: "cancelled" }),
  );
});
it("requires an explicit trusted host and never connects by default", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/agent-cli.ts"],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Usage:");
});

it("routes SIGINT from the actual CLI process to cancellation", async () => {
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "scripts/agent-cli.ts",
      "--host",
      host,
      "--text",
      "wait",
    ],
    { cwd: root },
  );
  let stdout = "",
    stderr = "",
    interrupted = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (!interrupted && stdout.includes('"type":"started"')) {
      interrupted = true;
      child.kill("SIGINT");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("CLI timeout"));
    }, 15000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  expect(interrupted).toBe(true);
  expect(code).toBe(130);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual(
    expect.objectContaining({ outcome: "cancelled" }),
  );
});
