import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../client/lib/runtime/cli";
import type { RuntimeClient } from "../client/lib/runtime/service";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--host" || args[2] !== "--text") {
    process.stderr.write(
      "Usage: npx tsx scripts/agent-cli.ts --host <trusted-local-module> --text <message>\n",
    );
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    // Explicit local host composition only; never load a path from remote input.
    const module = await import(pathToFileURL(resolve(args[1])).href);
    const create = module.createCliHost ?? module.default?.createCliHost;
    if (typeof create !== "function") throw new Error("Invalid host");
    const host: { client: RuntimeClient; auth: unknown } = await create();
    process.exitCode = await runCli(
      host.client,
      host.auth,
      args[3],
      {
        write: (line) => {
          process.stdout.write(line);
        },
        error: (line) => {
          process.stderr.write(line);
        },
      },
      controller.signal,
    );
  } catch {
    process.stderr.write("Runtime host failed\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
void main();
