import AsyncStorage from "@react-native-async-storage/async-storage";
import { MemoryStore, MemoryStoreError, validateMemoryScope } from "../memory";
const key = "@ai_agent_memory";
const legacyKey = "@ai_agent_memory_legacy_backup";
const a = { accountId: "account", chatId: "a" };
const b = { accountId: "account", chatId: "b" };
const c = { accountId: "other", chatId: "a" };
const input = (scope = a, id = "one", content = "espresso") => ({
  scope,
  id,
  content,
  type: "fact" as const,
  importance: 0.8,
  provenance: { source: "explicit" as const, sourceId: "message-1" },
});
const legacy = [
  {
    id: "old",
    type: "fact",
    content: "unscoped",
    importance: 0.9,
    createdAt: 1,
    lastAccessedAt: 1,
    ttlMs: 1,
  },
];
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    async (k: string) => storage.get(k) ?? null,
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (k: string, v: string) => {
      storage.set(k, v);
    },
  );
});
afterEach(() => jest.useRealTimers());
it("isolates account/chat reads, search and export with immutable scope and provenance", async () => {
  const store = new MemoryStore();
  await store.addMemory(input());
  await store.addMemory(input(b, "one", "tea"));
  await store.addMemory(input(c, "one", "other"));
  expect((await store.listMemories(a)).map((x) => x.content)).toEqual([
    "espresso",
  ]);
  expect(
    (
      await store.getRelevantMemories({
        scope: b,
        query: "TEA",
        types: ["fact"],
        minImportance: 0.7,
        limit: 1,
      })
    ).map((x) => x.content),
  ).toEqual(["tea"]);
  expect(await store.searchMemories(a, "tea")).toEqual([]);
  expect(JSON.parse(await store.exportMemories(a))).toMatchObject({
    version: 2,
    scope: a,
    entries: [
      {
        content: "espresso",
        provenance: { source: "explicit", sourceId: "message-1" },
      },
    ],
  });
  expect(Object.isFrozen(validateMemoryScope(a))).toBe(true);
});
it("reads do not write, migrate or expose the real old array format", async () => {
  const raw = JSON.stringify(legacy, null, 2);
  storage.set(key, raw);
  const store = new MemoryStore();
  expect(await store.listMemories(a)).toEqual([]);
  expect(await store.getRelevantMemories({ scope: a })).toEqual([]);
  expect(await store.exportLegacy()).toBe(raw);
  expect(await store.exportBackup(a)).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(storage.get(key)).toBe(raw);
});
it("migrates with exact durable legacy backup and supports safe rollback", async () => {
  const raw = JSON.stringify(legacy, null, 2);
  storage.set(key, raw);
  const store = new MemoryStore();
  await store.migrateLegacy();
  expect(storage.get(legacyKey)).toBe(raw);
  expect(JSON.parse(storage.get(key)!)).toEqual({
    version: 2,
    revision: 0,
    entries: [],
    legacy,
  });
  await store.migrateLegacy();
  expect(await store.exportLegacy()).toBe(raw);
  await store.rollbackMigration();
  expect(storage.get(key)).toBe(raw);
});
it.each([legacyKey, key])(
  "preserves original on migration write failure at %s and safely retries",
  async (failingKey) => {
    const raw = JSON.stringify(legacy);
    storage.set(key, raw);
    let fail = true;
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (k: string, v: string) => {
        if (k === failingKey && fail) {
          fail = false;
          throw Error("secret storage detail");
        }
        storage.set(k, v);
      },
    );
    const store = new MemoryStore();
    await expect(store.migrateLegacy()).rejects.toThrow(
      "Memory storage operation failed",
    );
    expect(storage.get(key)).toBe(raw);
    await store.migrateLegacy();
    expect(await store.exportLegacy()).toBe(raw);
  },
);
it("first mutation quarantines legacy and rollback cannot erase later writes", async () => {
  const raw = JSON.stringify(legacy);
  storage.set(key, raw);
  const store = new MemoryStore();
  await store.addMemory(input());
  expect(await store.exportLegacy()).toBe(raw);
  await expect(store.rollbackMigration()).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(await store.listMemories(a)).toHaveLength(1);
});
it.each([
  "not JSON",
  JSON.stringify({ version: 9 }),
  JSON.stringify({ version: 2, revision: 0, entries: [{}], legacy: null }),
  JSON.stringify([{}]),
])("rejects malformed storage without overwriting it", async (raw) => {
  storage.set(key, raw);
  const store = new MemoryStore();
  await expect(store.addMemory(input())).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  await expect(store.listMemories(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(storage.get(key)).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("serializes independent instances and avoids stale read resurrection", async () => {
  const first = new MemoryStore(),
    second = new MemoryStore();
  await Promise.all([
    first.addMemory(input()),
    second.addMemory(input(a, "two", "tea")),
  ]);
  expect(await first.listMemories(a)).toHaveLength(2);
  await Promise.all([first.listMemories(a), second.deleteMemory(a, "one")]);
  expect((await first.listMemories(a)).map((x) => x.id)).toEqual(["two"]);
  await Promise.all([
    first.listMemories(a),
    second.addMemory(input(a, "three")),
  ]);
  expect(await first.listMemories(a)).toHaveLength(2);
});
it("failed writes cannot poison another operation or cached state", async () => {
  const store = new MemoryStore();
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error("secret"));
  await expect(store.addMemory(input())).rejects.toThrow(
    "Memory storage operation failed",
  );
  expect(await store.listMemories(a)).toEqual([]);
  await store.addMemory(input());
  expect(await store.listMemories(a)).toHaveLength(1);
});
it("expires at the exact deadline but preserves expired rows in export and backup", async () => {
  jest.useFakeTimers().setSystemTime(1000);
  const store = new MemoryStore();
  await store.addMemory({ ...input(), ttlMs: 10 });
  await store.addMemory({ ...input(b), ttlMs: 10 });
  jest.setSystemTime(1010);
  expect(await store.listMemories(a)).toEqual([]);
  expect(JSON.parse(await store.exportMemories(a)).entries).toHaveLength(1);
  await store.purgeExpired(a);
  expect(JSON.parse(await store.exportMemories(a)).entries).toEqual([]);
  expect(JSON.parse(await store.exportMemories(b)).entries).toHaveLength(1);
  expect(await store.exportBackup(a)).toContain("espresso");
  await store.restoreBackup(a);
  expect(JSON.parse(await store.exportMemories(a)).entries[0]).toMatchObject({
    createdAt: 1000,
    ttlMs: 10,
  });
});
it.each(["delete", "clear"])(
  "backs up scoped %s and restores exact records without touching other scopes",
  async (action) => {
    const store = new MemoryStore();
    const original = await store.addMemory(input());
    await store.addMemory(input(b));
    if (action === "delete") await store.deleteMemory(a, "one");
    else await store.clear(a);
    expect(await store.listMemories(a)).toEqual([]);
    expect(await store.listMemories(b)).toHaveLength(1);
    await store.restoreBackup(a);
    expect(await store.listMemories(a)).toEqual([original]);
    await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(
      MemoryStoreError,
    );
  },
);
it("restore rejects newer writes, mismatched backups, and absent backups", async () => {
  const store = new MemoryStore();
  await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
  await store.addMemory(input());
  await store.clear(a);
  await store.addMemory(input(b));
  await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(await store.listMemories(b)).toHaveLength(1);
});
it("requires backup success before delete and can retry after primary deletion failure", async () => {
  const store = new MemoryStore();
  await store.addMemory(input());
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
    Error("backup error"),
  );
  await expect(store.clear(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(await store.listMemories(a)).toHaveLength(1);
  let fail = true;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (k: string, v: string) => {
      if (k === key && fail) {
        fail = false;
        throw Error("write error");
      }
      storage.set(k, v);
    },
  );
  await expect(store.clear(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(await store.listMemories(a)).toHaveLength(1);
  await store.clear(a);
  await store.restoreBackup(a);
  expect(await store.listMemories(a)).toHaveLength(1);
});
it("deduplicates exact explicit IDs but rejects conflicting semantic payload", async () => {
  const store = new MemoryStore();
  const original = await store.addMemory(input());
  expect(await store.addMemory(input())).toEqual(original);
  await expect(
    store.addMemory(input(a, "one", "changed")),
  ).rejects.toBeInstanceOf(MemoryStoreError);
  expect(await store.listMemories(a)).toEqual([original]);
});
it.each([
  null,
  {},
  { accountId: "", chatId: "a" },
  { accountId: "a", chatId: " " },
  { accountId: "a".repeat(129), chatId: "a" },
])("rejects invalid scope before storage access", async (scope) => {
  const store = new MemoryStore();
  await expect(store.listMemories(scope as any)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(() => validateMemoryScope(scope as any)).toThrow(MemoryStoreError);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});
it.each([
  { content: "" },
  { content: "x".repeat(4097) },
  { importance: NaN },
  { importance: 2 },
  { ttlMs: 0 },
  { ttlMs: -1 },
  { ttlMs: Infinity },
  { ttlMs: 366 * 86400000 },
  { type: "other" },
  { provenance: { source: "other", sourceId: "a" } },
  { provenance: { source: "explicit", sourceId: "" } },
])("rejects invalid new records %p", async (fields) => {
  await expect(
    new MemoryStore().addMemory({ ...input(), ...fields } as any),
  ).rejects.toBeInstanceOf(MemoryStoreError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each([
  { query: "x".repeat(257) },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
  { minImportance: -1 },
  { types: ["other"] },
])("rejects invalid search options %p", async (options) => {
  await expect(
    new MemoryStore().getRelevantMemories({ scope: a, ...options } as any),
  ).rejects.toBeInstanceOf(MemoryStoreError);
});
it("defaults finite retention and generates distinct IDs", async () => {
  const store = new MemoryStore();
  const { id, ...entry } = input();
  const one = await store.addMemory(entry),
    two = await store.addMemory(entry);
  expect(one.id).not.toBe(two.id);
  expect(one.ttlMs).toBe(30 * 86400000);
});

const record = (scope = a, id = "one") => ({
  ...input(scope, id),
  createdAt: 1000,
  lastAccessedAt: 1000,
  ttlMs: 365 * 86400000,
});
const envelope = (entries: unknown[] = [], revision = 0, old: unknown = null) =>
  JSON.stringify({ version: 2, revision, entries, legacy: old });
const backupKey = (scope = a) =>
  `@ai_agent_memory_backup:${JSON.stringify(scope)}`;
it("ranks and filters deterministically without touching access timestamps", async () => {
  jest.useFakeTimers().setSystemTime(2000);
  storage.set(
    key,
    envelope([
      { ...record(a, "low"), importance: 0.1 },
      { ...record(a, "older"), importance: 0.9, lastAccessedAt: 1000 },
      { ...record(a, "recent-b"), importance: 0.9, lastAccessedAt: 1500 },
      { ...record(a, "recent-a"), importance: 0.9, lastAccessedAt: 1500 },
      { ...record(a, "task"), type: "task" },
      record(b),
    ]),
  );
  const store = new MemoryStore();
  expect(
    (
      await store.getRelevantMemories({
        scope: a,
        minImportance: 0.5,
        types: ["fact"],
      })
    ).map((e) => e.id),
  ).toEqual(["recent-a", "recent-b", "older"]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("rejects global capacity overflow without evicting existing or expired records", async () => {
  storage.set(
    key,
    envelope(Array.from({ length: 1000 }, (_, i) => record(a, `id-${i}`))),
  );
  const before = storage.get(key);
  await expect(new MemoryStore().addMemory(input(b))).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(storage.get(key)).toBe(before);
});
it.each([
  { revision: -1 },
  { revision: 1.5 },
  { entries: {} },
  { entries: Array(1001).fill(record()) },
  { entries: [record(), record()] },
  { legacy: {} },
  { legacy: [{ ...legacy[0], scope: a }] },
  {
    legacy: [
      { ...legacy[0], provenance: { source: "explicit", sourceId: "one" } },
    ],
  },
  { legacy: [{ ...legacy[0], ttlMs: "wrong" }] },
  { entries: [{ ...record(), createdAt: -1 }] },
  { entries: [{ ...record(), lastAccessedAt: -1 }] },
  { entries: [{ ...record(), provenance: null }] },
])("rejects corrupt envelope fields %p", async (fields) => {
  const raw = JSON.stringify({
    version: 2,
    revision: 0,
    entries: [],
    legacy: null,
    ...fields,
  });
  storage.set(key, raw);
  await expect(new MemoryStore().listMemories(a)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(storage.get(key)).toBe(raw);
});
it.each([
  null,
  { version: 3 },
  { scope: b },
  { expectedRevision: 0 },
  { expectedRevision: 1.5 },
  { entries: [record(b)] },
])("rejects malformed or cross-scope backup %p", async (fields) => {
  const raw =
    fields === null
      ? "null"
      : JSON.stringify({
          version: 2,
          scope: a,
          expectedRevision: 1,
          entries: [],
          ...fields,
        });
  storage.set(backupKey(), raw);
  const store = new MemoryStore();
  await expect(store.exportBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
  await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("rejects restore capacity overflow before writing", async () => {
  storage.set(
    key,
    JSON.stringify({
      ...JSON.parse(envelope([record(b)], 1)),
      deletionOperationId: "capacity-operation",
    }),
  );
  storage.set(
    backupKey(),
    JSON.stringify({
      version: 2,
      scope: a,
      expectedRevision: 1,
      deletionOperationId: "capacity-operation",
      entries: Array.from({ length: 1000 }, (_, i) => record(a, `id-${i}`)),
    }),
  );
  await expect(new MemoryStore().restoreBackup(a)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it.each([null, JSON.stringify([{ ...legacy[0], content: "changed" }])])(
  "refuses legacy export and rollback when durable backup differs: %p",
  async (backup) => {
    storage.set(key, envelope([], 0, legacy));
    if (backup !== null) storage.set(legacyKey, backup);
    const store = new MemoryStore();
    await expect(store.exportLegacy()).rejects.toBeInstanceOf(MemoryStoreError);
    await expect(store.rollbackMigration()).rejects.toBeInstanceOf(
      MemoryStoreError,
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);
it("refuses to overwrite an existing different legacy backup", async () => {
  storage.set(key, JSON.stringify(legacy));
  storage.set(legacyKey, "[]");
  await expect(new MemoryStore().migrateLegacy()).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("does not rollback empty current stores or populated zero revisions", async () => {
  const store = new MemoryStore();
  expect(await store.exportLegacy()).toBeNull();
  await store.migrateLegacy();
  await expect(store.rollbackMigration()).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  storage.set(key, envelope([record()], 0, legacy));
  await expect(store.rollbackMigration()).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  storage.set(key, JSON.stringify(legacy));
  await expect(store.rollbackMigration()).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
});
it("restores only migrated storage and rejects unsafe revision overflow", async () => {
  storage.set(key, JSON.stringify(legacy));
  storage.set(
    backupKey(),
    JSON.stringify({ version: 2, scope: a, expectedRevision: 1, entries: [] }),
  );
  await expect(new MemoryStore().restoreBackup(a)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  storage.set(key, envelope([], Number.MAX_SAFE_INTEGER));
  await expect(new MemoryStore().addMemory(input())).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
it("returns detached records and snapshots input before asynchronous storage", async () => {
  const actual = input();
  const store = new MemoryStore();
  const pending = store.addMemory(actual);
  actual.scope = { ...b };
  actual.provenance.sourceId = "changed";
  actual.content = "changed";
  const saved = await pending;
  saved.provenance.sourceId = "returned mutation";
  const listed = await store.listMemories(a);
  expect(listed[0].content).toBe("espresso");
  expect(listed[0].provenance.sourceId).toBe("message-1");
  listed[0].content = "mutated list";
  expect((await store.listMemories(a))[0].content).toBe("espresso");
});
it("rejects invalid IDs and read failures with safe errors", async () => {
  const store = new MemoryStore();
  await expect(store.deleteMemory(a, "")).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
    Error("private data"),
  );
  await expect(store.listMemories(a)).rejects.toThrow(
    "Memory storage operation failed",
  );
  await expect(
    store.getRelevantMemories({ scope: a, types: "fact" } as any),
  ).rejects.toBeInstanceOf(MemoryStoreError);
  await expect(store.searchMemories(a, 42 as any)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
});
it("rejects missing add input with the same safe public error", async () => {
  await expect(new MemoryStore().addMemory(null as any)).rejects.toBeInstanceOf(
    MemoryStoreError,
  );
});

it.each(["clear", "delete", "purge"])(
  "preserves the recoverable backup when %s removes nothing",
  async (operation) => {
    const store = new MemoryStore();
    const original = await store.addMemory(input());
    await store.clear(a);
    const primary = storage.get(key);
    const backup = await store.exportBackup(a);
    jest.clearAllMocks();
    if (operation === "clear") await store.clear(a);
    else if (operation === "delete") await store.deleteMemory(a, "missing");
    else await store.purgeExpired(a);
    expect(storage.get(key)).toBe(primary);
    expect(await store.exportBackup(a)).toBe(backup);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await store.restoreBackup(a);
    expect(await store.listMemories(a)).toEqual([original]);
  },
);

it.each(["clear", "delete", "purge"])(
  "does not migrate unscoped legacy for a no-op %s",
  async (operation) => {
    const raw = JSON.stringify(legacy, null, 2);
    storage.set(key, raw);
    const store = new MemoryStore();
    if (operation === "clear") await store.clear(a);
    else if (operation === "delete") await store.deleteMemory(a, "missing");
    else await store.purgeExpired(a);
    expect(storage.get(key)).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

it.each([
  [a, false],
  [b, false],
  [a, true],
] as const)(
  "rejects failed deletion revision alias with later scope %p and previous deletion %p",
  async (laterScope, previousDeletion) => {
    const store = new MemoryStore();
    const original = await store.addMemory(input());
    if (previousDeletion) {
      await store.clear(a);
      await store.restoreBackup(a);
    }
    const write = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
    let failPrimary = true;
    (AsyncStorage.setItem as jest.Mock).mockImplementation(
      async (storageKey: string, raw: string) => {
        if (storageKey === key && failPrimary) {
          failPrimary = false;
          throw new Error("primary deletion failed");
        }
        return write(storageKey, raw);
      },
    );
    await expect(store.clear(a)).rejects.toBeInstanceOf(MemoryStoreError);
    const backup = await store.exportBackup(a);
    expect(JSON.parse(backup!).entries).toEqual([original]);
    const added = await store.addMemory(
      input(laterScope, "later", "new record"),
    );
    const persisted = storage.get(key);
    await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(
      MemoryStoreError,
    );
    expect(storage.get(key)).toBe(persisted);
    expect(JSON.parse(storage.get(key)!).entries).toEqual(
      expect.arrayContaining([original, added]),
    );
    expect(await store.exportBackup(a)).toBe(backup);
  },
);

it("exports older unmarked backups but refuses automatic restoration", async () => {
  storage.set(key, envelope([], 1));
  const raw = JSON.stringify({
    version: 2,
    scope: a,
    expectedRevision: 1,
    entries: [record()],
  });
  storage.set(backupKey(), raw);
  const store = new MemoryStore();
  expect(await store.exportBackup(a)).toBe(raw);
  await expect(store.restoreBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
  expect(storage.get(key)).toBe(envelope([], 1));
});

it("validates optional deletion markers in primary state and backups", async () => {
  const store = new MemoryStore();
  storage.set(
    key,
    JSON.stringify({ ...JSON.parse(envelope()), deletionOperationId: 42 }),
  );
  await expect(store.listMemories(a)).rejects.toBeInstanceOf(MemoryStoreError);
  storage.set(
    backupKey(),
    JSON.stringify({
      version: 2,
      scope: a,
      expectedRevision: 1,
      entries: [],
      deletionOperationId: "",
    }),
  );
  await expect(store.exportBackup(a)).rejects.toBeInstanceOf(MemoryStoreError);
});

it("assigns a fresh deletion marker on retry and restores only the committed attempt", async () => {
  const store = new MemoryStore();
  await store.addMemory(input());
  const write = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  let failPrimary = true;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (k: string, raw: string) => {
      if (k === key && failPrimary) {
        failPrimary = false;
        throw Error("failed");
      }
      return write(k, raw);
    },
  );
  await expect(store.clear(a)).rejects.toBeInstanceOf(MemoryStoreError);
  const failed = JSON.parse((await store.exportBackup(a))!);
  await store.clear(a);
  const committed = JSON.parse((await store.exportBackup(a))!);
  expect(typeof committed.deletionOperationId).toBe("string");
  expect(committed.deletionOperationId).not.toBe(failed.deletionOperationId);
  expect(JSON.parse(storage.get(key)!).deletionOperationId).toBe(
    committed.deletionOperationId,
  );
  await store.restoreBackup(a);
  expect(await store.listMemories(a)).toHaveLength(1);
});
