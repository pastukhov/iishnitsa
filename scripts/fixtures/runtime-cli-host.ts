import { sendChatMessage } from "../../client/lib/api";
import { createRuntime } from "../../client/lib/runtime/service";

globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  if (body.messages.at(-1)?.content === "wait")
    return new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error("cancelled"));
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("cancelled")),
        { once: true },
      );
    });
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: null,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: "fixture answer" } }] }),
  } as Response;
};
export function createCliHost() {
  const runtime = createRuntime({
    execute: sendChatMessage,
    maxRunMs: 100,
    authenticate: async (auth) =>
      auth === "local-fixture" ? { ownerId: "fixture-owner" } : null,
    configure: async () => ({
      endpoint: {
        providerId: "custom",
        baseUrl: "https://fixture.invalid",
        apiKey: "fixture-secret",
        model: "fixture",
      },
      options: {
        memorySettings: {
          enabled: false,
          autoSave: false,
          autoSummary: false,
          limit: 8,
          minImportance: 0,
        },
      },
    }),
  });
  return { client: runtime.forSurface("cli"), auth: "local-fixture" };
}
