import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../../api";
import { createTextDelegation } from "../../agent/text-delegation";
import { createRuntime } from "../service";
import { createWebAdapter } from "../adapters";
import { MemoryStore } from "../../agent/memory";
import { createSkillRegistry, createSkillSession } from "../../skill-registry";
const endpoint = {
  providerId: "custom",
  baseUrl: "https://parent.invalid",
  apiKey: "parent-key",
  model: "fixture",
} as const;
const child = {
  ...endpoint,
  baseUrl: "https://child.invalid",
  apiKey: "child-key",
};
function response(text: string) {
  let pending = true;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          pending
            ? ((pending = false),
              {
                done: false,
                value: new TextEncoder().encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\n`,
                ),
              })
            : { done: true },
        cancel: jest.fn(),
        releaseLock: jest.fn(),
      }),
    },
  };
}
async function collect(events: AsyncIterable<unknown>) {
  const values = [];
  for await (const value of events) values.push(value);
  return values;
}
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock)
    .mockReset()
    .mockImplementation(async (url: string) =>
      response(
        url.startsWith(child.baseUrl)
          ? "child-private-reference"
          : "parent answer",
      ),
    );
});
it("runs trusted delegation through runtime without promoting its data or authority", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const memoryStore = new MemoryStore(storage);
  const scope = { accountId: "alice", chatId: "chat" };
  await memoryStore.addMemory({
    scope,
    provenance: { source: "explicit", sourceId: "fixture" },
    type: "fact",
    content: "parent-memory",
    importance: 1,
  });
  const registry = createSkillRegistry();
  registry.import(
    "---\nschema_version: 1\nname: fixture\nversion: 1.0.0\ndescription: Fixture\nsurface: chat\ntrust: untrusted\n---\nparent-skill",
  );
  const session = createSkillSession("chat");
  const activation = registry.activate(session, [
    { name: "fixture", version: "1.0.0" },
  ]);
  const client = createRuntime({
    execute: sendChatMessage,
    authenticate: async (auth) =>
      auth === "alice" ? { ownerId: "alice" } : null,
    configure: async () => ({
      endpoint,
      options: {
        textDelegation: createTextDelegation({
          endpoint: child,
          tasks: ["bounded fixture"],
        }),
        skillContext: { session, activation, surface: "chat" },
        memoryStore,
        memoryScope: scope,
        memorySettings: {
          enabled: true,
          autoSave: true,
          autoSummary: false,
          limit: 8,
          minImportance: 0,
        },
      },
    }),
  }).forSurface("web");
  const id = await client.createSession("alice");
  const events = await collect(client.run("alice", id, "parent request"));
  expect(events.at(-1)).toMatchObject({
    type: "finished",
    outcome: "completed",
  });
  expect(JSON.stringify(events)).not.toContain("child-private-reference");
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls[0][1].body).not.toMatch(
    /parent-memory|parent-skill|parent request|tools/,
  );
  expect(calls[1][1].body).toContain("parent-skill");
  expect(calls[1][1].body).not.toContain("child-private-reference");
  expect(JSON.stringify([...values])).not.toContain("child-private-reference");
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await client.disconnect("alice", id);
});
it("rejects remote delegation configuration before execution", async () => {
  const client = createRuntime({
    execute: sendChatMessage,
    authenticate: async () => ({ ownerId: "alice" }),
    configure: async () => ({ endpoint }),
  }).forSurface("web");
  const web = createWebAdapter(client, () => "alice");
  const created = await web.handle({}, { type: "create" });
  if (created.type !== "session") throw Error("fixture");
  expect(
    await web.handle(
      {},
      {
        type: "run",
        sessionId: created.sessionId,
        text: "fixture",
        textDelegation: { tasks: ["fixture"], tools: ["fixture"] },
      },
    ),
  ).toEqual({ type: "error", code: "request_failed" });
  expect(global.fetch).not.toHaveBeenCalled();
  await client.disconnect("alice", created.sessionId);
});
it("disconnect aborts the child and never dispatches the parent", async () => {
  (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const client = createRuntime({
    execute: sendChatMessage,
    authenticate: async () => ({ ownerId: "alice" }),
    configure: async () => ({
      endpoint,
      options: {
        textDelegation: createTextDelegation({
          endpoint: child,
          tasks: ["fixture"],
        }),
      },
    }),
  }).forSurface("web");
  const id = await client.createSession("alice");
  await client.start("alice", id, "parent");
  await new Promise((r) => setImmediate(r));
  await client.disconnect("alice", id);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(
    true,
  );
});
