import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendChatMessage } from "../../api";
import { MemoryStore } from "../../agent/memory";
import { createRuntime } from "../service";
import { createSkillRegistry, createSkillSession } from "../../skill-registry";

const endpoint = {
  providerId: "custom",
  baseUrl: "https://fixture.invalid",
  apiKey: "private-fixture-key",
  model: "fixture",
} as const;
const auth = async (credential: unknown) =>
  typeof credential === "string" ? { ownerId: credential } : null;
const response = () => ({
  ok: true,
  status: 200,
  headers: new Map(),
  body: null,
  text: async () =>
    JSON.stringify({ choices: [{ message: { content: "fixture answer" } }] }),
});
const collect = async (stream: AsyncIterable<unknown>) => {
  const result = [];
  for await (const e of stream) result.push(e);
  return result;
};
beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockReset().mockResolvedValue(response());
});
it("runs real scoped memory for separate authenticated owners without native storage", async () => {
  const values = new Map<string, string>();
  const memoryStore = new MemoryStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  });
  const client = createRuntime({
    execute: sendChatMessage,
    authenticate: auth,
    configure: async (owner) => ({
      endpoint,
      options: {
        memoryStore,
        memoryScope: { accountId: owner.ownerId, chatId: "fixture-chat" },
        memorySettings: {
          enabled: true,
          autoSave: true,
          autoSummary: false,
          limit: 8,
          minImportance: 0,
        },
      },
    }),
  }).forSurface("cli");
  const a = await client.createSession("alice");
  const b = await client.createSession("bob");
  await Promise.all([
    collect(client.run("alice", a, "remember alice-only")),
    collect(client.run("bob", b, "remember bob-only")),
  ]);
  expect(
    (
      await memoryStore.listMemories({
        accountId: "alice",
        chatId: "fixture-chat",
      })
    ).map((e) => e.content),
  ).toEqual(["alice-only"]);
  expect(
    (
      await memoryStore.listMemories({
        accountId: "bob",
        chatId: "fixture-chat",
      })
    ).map((e) => e.content),
  ).toEqual(["bob-only"]);
  (global.fetch as jest.Mock).mockClear();
  await collect(client.run("alice", a, "question"));
  const wire = (global.fetch as jest.Mock).mock.calls[0][1].body;
  expect(wire).toContain("alice-only");
  expect(wire).not.toContain("bob-only");
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await client.disconnect("alice", a);
  await client.disconnect("bob", b);
});
it("keeps an explicit skill activation out of memory and offline queue on failure", async () => {
  const registry = createSkillRegistry();
  registry.import(
    "---\nschema_version: 1\nname: fixture\nversion: 1.0.0\ndescription: Fixture\nsurface: chat\ntrust: untrusted\n---\nfixture-reference",
  );
  const skillSession = createSkillSession("chat");
  const activation = registry.activate(skillSession, [
    { name: "fixture", version: "1.0.0" },
  ]);
  const values = new Map<string, string>();
  const getItem = jest.fn(async (key: string) => values.get(key) ?? null);
  const setItem = jest.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  const client = createRuntime({
    execute: sendChatMessage,
    authenticate: auth,
    configure: async () => ({
      endpoint,
      options: {
        memoryStore: new MemoryStore({ getItem, setItem }),
        memoryScope: { accountId: "alice", chatId: "fixture-chat" },
        skillContext: { session: skillSession, activation, surface: "chat" },
      },
    }),
  }).forSurface("cli");
  (global.fetch as jest.Mock).mockRejectedValue(
    new Error("Network request failed private-fixture-key"),
  );
  const session = await client.createSession("alice");
  const out = await collect(client.run("alice", session, "question"));
  expect(out).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "finished", outcome: "failed" }),
    ]),
  );
  expect(JSON.stringify(out)).not.toContain("private-fixture-key");
  expect(getItem).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await client.disconnect("alice", session);
});
