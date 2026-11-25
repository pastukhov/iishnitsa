import {
  RunCancelledError,
  throwIfCancelled,
} from "@/lib/runtime/cancellation";
import { nativeStorage, type RuntimeStorage } from "@/lib/runtime/storage";

export const MAX_MEMORY_RESULTS = 100;
export const DEFAULT_MEMORY_LIMIT = 8;

// User preferences may predate the store cap; low-level queries remain strict.
export function normalizeMemoryLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_MEMORY_LIMIT;
  return Math.min(MAX_MEMORY_RESULTS, Math.max(1, Math.floor(value)));
}

export type MemoryType = "user" | "task" | "fact" | "system";
export interface MemorySettings {
  enabled: boolean;
  autoSave: boolean;
  autoSummary: boolean;
  limit: number;
  minImportance: number;
  summaryTtlMs?: number;
}
export interface MemoryScope {
  accountId: string;
  chatId: string;
}
export interface MemoryProvenance {
  source: "explicit" | "summary" | "import";
  sourceId: string;
}
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  createdAt: number;
  lastAccessedAt: number;
  ttlMs: number;
  scope: MemoryScope;
  provenance: MemoryProvenance;
}
export class MemoryStoreError extends Error {
  constructor() {
    super("Memory storage operation failed");
    this.name = "MemoryStoreError";
  }
}
const MEMORY_KEY = "@ai_agent_memory";
const LEGACY_KEY = "@ai_agent_memory_legacy_backup";
const DAY = 86400000;
const TYPES: readonly string[] = ["user", "task", "fact", "system"];
interface Envelope {
  version: 2;
  revision: number;
  deletionOperationId?: string;
  entries: MemoryEntry[];
  legacy: unknown[] | null;
}
interface Loaded {
  envelope: Envelope;
  legacyRaw?: string;
}
let sequence = 0;
// Hosts sharing one backend must share the same adapter object. The native
// default is a singleton; independent adapters must not block one another.
const storageTails = new WeakMap<RuntimeStorage, Promise<unknown>>();
function fail(): never {
  throw new MemoryStoreError();
}
function transaction<T>(
  storage: RuntimeStorage,
  operation: () => Promise<T>,
): Promise<T> {
  const tail = storageTails.get(storage) ?? Promise.resolve();
  const result = tail.then(operation).catch((error) => {
    if (error instanceof RunCancelledError) throw error;
    throw new MemoryStoreError();
  });
  storageTails.set(
    storage,
    result.catch(() => {}),
  );
  return result;
}
function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
// Invalid legacy preferences deactivate memory; never truncate an identity.
export function normalizeMemoryAccountId(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return text(normalized, 128) ? normalized : "";
}

export function validateMemoryScope(scope: MemoryScope): Readonly<MemoryScope> {
  if (!object(scope) || !text(scope.accountId, 128) || !text(scope.chatId, 128))
    fail();
  return Object.freeze({ accountId: scope.accountId, chatId: scope.chatId });
}
function sameScope(a: MemoryScope, b: MemoryScope): boolean {
  return a.accountId === b.accountId && a.chatId === b.chatId;
}
function ttl(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 365 * DAY
  )
    fail();
  return value;
}
function validateBase(value: unknown): asserts value is Record<string, any> {
  if (
    !object(value) ||
    !text(value.id, 128) ||
    !TYPES.includes(value.type) ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    value.content.length > 4096 ||
    typeof value.importance !== "number" ||
    !Number.isFinite(value.importance) ||
    value.importance < 0 ||
    value.importance > 1 ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    !Number.isFinite(value.lastAccessedAt) ||
    value.lastAccessedAt < 0
  )
    fail();
}
function validateEntry(value: unknown): MemoryEntry {
  validateBase(value);
  const scope = validateMemoryScope(value.scope);
  if (
    !object(value.provenance) ||
    !["explicit", "summary", "import"].includes(value.provenance.source) ||
    !text(value.provenance.sourceId, 128)
  )
    fail();
  return {
    id: value.id,
    type: value.type,
    content: value.content,
    importance: value.importance,
    createdAt: value.createdAt,
    lastAccessedAt: value.lastAccessedAt,
    ttlMs: ttl(value.ttlMs),
    scope,
    provenance: {
      source: value.provenance.source,
      sourceId: value.provenance.sourceId,
    },
  };
}
function validateLegacy(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000) fail();
  for (const entry of value) {
    validateBase(entry);
    if (
      entry.scope !== undefined ||
      entry.provenance !== undefined ||
      (entry.ttlMs !== undefined &&
        (typeof entry.ttlMs !== "number" || !Number.isFinite(entry.ttlMs)))
    )
      fail();
  }
  return value;
}
function validateEnvelope(value: unknown): Envelope {
  if (
    !object(value) ||
    value.version !== 2 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 1000 ||
    (value.deletionOperationId !== undefined &&
      !text(value.deletionOperationId, 128))
  )
    fail();
  const entries = value.entries.map(validateEntry);
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = JSON.stringify([
      entry.scope.accountId,
      entry.scope.chatId,
      entry.id,
    ]);
    if (keys.has(key)) fail();
    keys.add(key);
  }
  return {
    version: 2,
    revision: value.revision,
    ...(value.deletionOperationId !== undefined
      ? { deletionOperationId: value.deletionOperationId }
      : {}),
    entries,
    legacy: value.legacy === null ? null : validateLegacy(value.legacy),
  };
}
async function load(storage: RuntimeStorage): Promise<Loaded> {
  const raw = await storage.getItem(MEMORY_KEY);
  if (raw === null)
    return { envelope: { version: 2, revision: 0, entries: [], legacy: null } };
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed))
    return {
      envelope: {
        version: 2,
        revision: 0,
        entries: [],
        legacy: validateLegacy(parsed),
      },
      legacyRaw: raw,
    };
  return { envelope: validateEnvelope(parsed) };
}
async function prepareMutation(
  loaded: Loaded,
  storage: RuntimeStorage,
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal);
  if (loaded.legacyRaw === undefined) return;
  const backup = await storage.getItem(LEGACY_KEY);
  throwIfCancelled(signal);
  if (backup !== null && backup !== loaded.legacyRaw) fail();
  if (backup === null) await storage.setItem(LEGACY_KEY, loaded.legacyRaw);
}
async function persist(
  envelope: Envelope,
  storage: RuntimeStorage,
): Promise<void> {
  if (!Number.isSafeInteger(envelope.revision)) fail();
  await storage.setItem(MEMORY_KEY, JSON.stringify(envelope));
}
function expired(entry: MemoryEntry): boolean {
  return Date.now() - entry.createdAt >= entry.ttlMs;
}
function backupKey(scope: MemoryScope): string {
  return `@ai_agent_memory_backup:${JSON.stringify(scope)}`;
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
interface SearchOptions {
  scope: MemoryScope;
  query?: string;
  limit?: number;
  minImportance?: number;
  types?: MemoryType[];
}
interface NewMemory {
  scope: MemoryScope;
  provenance: MemoryProvenance;
  type: MemoryType;
  content: string;
  importance: number;
  id?: string;
  ttlMs?: number;
}

export class MemoryStore {
  constructor(private readonly storage: RuntimeStorage = nativeStorage) {}
  async addMemory(
    input: NewMemory,
    signal?: AbortSignal,
  ): Promise<MemoryEntry> {
    throwIfCancelled(signal);
    if (!object(input)) fail();
    const now = Date.now();
    const entry = validateEntry({
      ...input,
      id:
        input.id ??
        `mem_${now}_${++sequence}_${Math.random().toString(16).slice(2)}`,
      createdAt: now,
      lastAccessedAt: now,
      ttlMs: input.ttlMs ?? 30 * DAY,
    });
    return transaction(this.storage, async () => {
      throwIfCancelled(signal);
      const loaded = await load(this.storage);
      throwIfCancelled(signal);
      const state = loaded.envelope;
      const existing = state.entries.find(
        (x) => sameScope(x.scope, entry.scope) && x.id === entry.id,
      );
      if (existing) {
        const semantic = (value: MemoryEntry) =>
          JSON.stringify([
            value.type,
            value.content,
            value.importance,
            value.ttlMs,
            value.provenance.source,
            value.provenance.sourceId,
          ]);
        if (semantic(existing) !== semantic(entry)) fail();
        return copy(existing);
      }
      if (state.entries.length >= 1000) fail();
      await prepareMutation(loaded, this.storage, signal);
      throwIfCancelled(signal);
      state.entries.push(entry);
      state.revision++;
      // Commit point: an invoked storage write cannot be physically cancelled.
      // Cancellation while queued/loading/preparing must never reach this call.
      await persist(state, this.storage);
      return copy(entry);
    });
  }
  async getRelevantMemories(options: SearchOptions): Promise<MemoryEntry[]> {
    const scope = validateMemoryScope(options?.scope);
    const query = options.query ?? "";
    const limit = options.limit ?? DEFAULT_MEMORY_LIMIT;
    const min = options.minImportance ?? 0;
    if (
      typeof query !== "string" ||
      query.length > 256 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_MEMORY_RESULTS ||
      !Number.isFinite(min) ||
      min < 0 ||
      min > 1 ||
      (options.types !== undefined &&
        (!Array.isArray(options.types) ||
          options.types.some((t) => !TYPES.includes(t))))
    )
      fail();
    const types = options.types?.slice();
    return transaction(this.storage, async () => {
      const { envelope } = await load(this.storage);
      return envelope.entries
        .filter(
          (e) =>
            sameScope(e.scope, scope) &&
            !expired(e) &&
            e.importance >= min &&
            (!types || types.includes(e.type)) &&
            e.content.toLowerCase().includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            b.importance - a.importance ||
            b.lastAccessedAt - a.lastAccessedAt ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit);
    });
  }
  async listMemories(scope: MemoryScope): Promise<MemoryEntry[]> {
    const captured = validateMemoryScope(scope);
    return transaction(this.storage, async () =>
      (await load(this.storage)).envelope.entries
        .filter((e) => sameScope(e.scope, captured) && !expired(e))
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    );
  }
  async searchMemories(
    scope: MemoryScope,
    query: string,
    limit?: number,
  ): Promise<MemoryEntry[]> {
    return this.getRelevantMemories({ scope, query, limit });
  }
  async exportMemories(scope: MemoryScope): Promise<string> {
    const captured = validateMemoryScope(scope);
    return transaction(this.storage, async () =>
      JSON.stringify({
        version: 2,
        scope: captured,
        entries: (await load(this.storage)).envelope.entries.filter((e) =>
          sameScope(e.scope, captured),
        ),
      }),
    );
  }
  private async remove(
    scope: MemoryScope,
    predicate: (entry: MemoryEntry) => boolean,
  ): Promise<void> {
    const captured = validateMemoryScope(scope);
    return transaction(this.storage, async () => {
      const loaded = await load(this.storage);
      const state = loaded.envelope;
      const retained = state.entries.filter(
        (entry) => !sameScope(entry.scope, captured) || !predicate(entry),
      );
      if (retained.length === state.entries.length) return;
      await prepareMutation(loaded, this.storage);
      const entries = state.entries.filter((e) => sameScope(e.scope, captured));
      const deletionOperationId = `delete_${Date.now()}_${++sequence}_${Math.random().toString(16).slice(2)}`;
      await this.storage.setItem(
        backupKey(captured),
        JSON.stringify({
          version: 2,
          scope: captured,
          expectedRevision: state.revision + 1,
          deletionOperationId,
          entries,
        }),
      );
      state.entries = retained;
      state.deletionOperationId = deletionOperationId;
      state.revision++;
      await persist(state, this.storage);
    });
  }
  async deleteMemory(scope: MemoryScope, id: string): Promise<void> {
    validateMemoryScope(scope);
    if (!text(id, 128)) fail();
    return this.remove(scope, (e) => e.id === id);
  }
  async clear(scope: MemoryScope): Promise<void> {
    return this.remove(scope, () => true);
  }
  async purgeExpired(scope: MemoryScope): Promise<void> {
    return this.remove(scope, expired);
  }
  async exportBackup(scope: MemoryScope): Promise<string | null> {
    const captured = validateMemoryScope(scope);
    return transaction(this.storage, async () => {
      const raw = await this.storage.getItem(backupKey(captured));
      if (raw !== null) this.validateBackup(raw, captured);
      return raw;
    });
  }
  private validateBackup(
    raw: string,
    scope: MemoryScope,
  ): {
    expectedRevision: number;
    deletionOperationId?: string;
    entries: MemoryEntry[];
  } {
    const value = JSON.parse(raw);
    if (
      !object(value) ||
      value.version !== 2 ||
      !sameScope(validateMemoryScope(value.scope), scope) ||
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 1 ||
      (value.deletionOperationId !== undefined &&
        !text(value.deletionOperationId, 128))
    )
      fail();
    const validated = validateEnvelope({
      version: 2,
      revision: 0,
      entries: value.entries,
      legacy: null,
    });
    if (validated.entries.some((e) => !sameScope(e.scope, scope))) fail();
    return {
      expectedRevision: value.expectedRevision,
      deletionOperationId: value.deletionOperationId,
      entries: validated.entries,
    };
  }
  async restoreBackup(scope: MemoryScope): Promise<void> {
    const captured = validateMemoryScope(scope);
    return transaction(this.storage, async () => {
      const raw = await this.storage.getItem(backupKey(captured));
      if (raw === null) fail();
      const backup = this.validateBackup(raw, captured);
      const loaded = await load(this.storage);
      const state = loaded.envelope;
      if (
        loaded.legacyRaw !== undefined ||
        state.revision !== backup.expectedRevision ||
        backup.deletionOperationId === undefined ||
        state.deletionOperationId !== backup.deletionOperationId
      )
        fail();
      const entries = [
        ...state.entries.filter((e) => !sameScope(e.scope, captured)),
        ...backup.entries,
      ];
      if (entries.length > 1000) fail();
      state.entries = entries;
      state.revision++;
      await persist(state, this.storage);
    });
  }
  async migrateLegacy(): Promise<void> {
    return transaction(this.storage, async () => {
      const loaded = await load(this.storage);
      await prepareMutation(loaded, this.storage);
      if (loaded.legacyRaw !== undefined)
        await persist(loaded.envelope, this.storage);
    });
  }
  async exportLegacy(): Promise<string | null> {
    return transaction(this.storage, async () => {
      const loaded = await load(this.storage);
      if (loaded.legacyRaw !== undefined) return loaded.legacyRaw;
      if (loaded.envelope.legacy === null) return null;
      const backup = await this.storage.getItem(LEGACY_KEY);
      if (
        backup === null ||
        JSON.stringify(validateLegacy(JSON.parse(backup))) !==
          JSON.stringify(loaded.envelope.legacy)
      )
        fail();
      return backup;
    });
  }
  async rollbackMigration(): Promise<void> {
    return transaction(this.storage, async () => {
      const loaded = await load(this.storage);
      const state = loaded.envelope;
      if (
        loaded.legacyRaw !== undefined ||
        state.revision !== 0 ||
        state.entries.length !== 0 ||
        state.legacy === null
      )
        fail();
      const backup = await this.storage.getItem(LEGACY_KEY);
      if (
        backup === null ||
        JSON.stringify(validateLegacy(JSON.parse(backup))) !==
          JSON.stringify(state.legacy)
      )
        fail();
      await this.storage.setItem(MEMORY_KEY, backup);
    });
  }
}
