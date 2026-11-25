import type { RuntimeClient } from "./service";

/** Local I/O adapter. The host supplies authentication and the shared runtime. */
export async function runCli(
  client: RuntimeClient,
  auth: unknown,
  text: string,
  io: {
    write: (line: string) => void;
    error: (line: string) => void;
  },
  signal?: AbortSignal,
): Promise<number> {
  let sessionId: string | undefined;
  let runId: string | undefined;
  const cancel = () => {
    if (sessionId && runId)
      void client.cancel(auth, sessionId, runId).catch(() => {});
  };
  try {
    sessionId = await client.createSession(auth);
    if (signal?.aborted) return 130;
    runId = await client.start(auth, sessionId, text);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let code = 1;
    for await (const event of client.stream(auth, sessionId, runId)) {
      io.write(JSON.stringify(event) + "\n");
      if (event.type === "finished")
        code =
          event.outcome === "completed"
            ? 0
            : event.outcome === "cancelled"
              ? 130
              : 1;
    }
    return code;
  } catch {
    io.error("Runtime request failed\n");
    return 1;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (sessionId) await client.disconnect(auth, sessionId).catch(() => {});
  }
}
