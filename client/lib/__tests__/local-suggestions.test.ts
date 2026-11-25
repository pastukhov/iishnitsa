import { SuggestionsStore } from "../local-suggestions";
const DAY = 86400000;
const scope = { accountId: "fixture-account", chatId: "fixture-chat" };
function setup() {
  let time = 10 * DAY;
  const values = new Map<string, string>();
  const storage = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return {
    values,
    storage,
    store: new SuggestionsStore(storage, () => time),
    advance: (days: number) => {
      time += days * DAY;
    },
  };
}
async function evidence(
  set: ReturnType<typeof setup>,
  signals: string[] = ["shorter", "shorter", "shorter"],
) {
  let view = await set.store.setEnabled(scope, true);
  for (const feedback of signals)
    view = await set.store.record(scope, view.epoch, feedback as any);
  return view;
}
it("is off by default and rejects collection without consent", async () => {
  const s = setup();
  expect(await s.store.status(scope)).toMatchObject({
    enabled: false,
    observations: [],
    candidates: [],
    drafts: [],
  });
  await expect(s.store.record(scope, 0, "shorter")).rejects.toThrow();
  expect(s.storage.setItem).not.toHaveBeenCalled();
});
it("stores only fixed structured evidence with source and expiry", async () => {
  const s = setup();
  const v = await evidence(s);
  expect(v.observations[0]).toEqual({
    feedback: "shorter",
    source: "mobile_feedback",
    day: 10 * DAY,
    expiresAt: 17 * DAY,
  });
  expect(v.candidates[0]).toMatchObject({
    kind: "concise",
    trust: "untrusted",
    confidence: 0.6,
    support: 3,
  });
  expect(v.drafts).toEqual([]);
  expect(Object.isFrozen(v.candidates[0])).toBe(true);
  const raw = [...s.values.values()][0];
  expect(raw).not.toMatch(/prompt|token|https:|system|apiKey/);
});
it.each([
  "raw chat https://secret.invalid",
  { feedback: "shorter", text: "secret" },
  "tool_result",
  "model_output",
  null,
])("rejects unapproved signal payload %j", async (feedback) => {
  const s = setup();
  const v = await s.store.setEnabled(scope, true);
  await expect(
    s.store.record(scope, v.epoch, feedback as any),
  ).rejects.toThrow();
  expect((await s.store.status(scope)).observations).toEqual([]);
});
it.each([
  {
    signals: ["shorter", "shorter", "shorter"],
    kind: "concise",
    confidence: 0.6,
  },
  {
    signals: ["more_detail", "more_detail", "more_detail"],
    kind: "detailed",
    confidence: 0.6,
  },
  {
    signals: ["shorter", "shorter", "more_detail"],
    kind: undefined,
    confidence: undefined,
  },
  {
    signals: ["shorter", "shorter", "length_ok"],
    kind: undefined,
    confidence: undefined,
  },
])("matches fixed replay: $signals", async ({ signals, kind, confidence }) => {
  const s = setup();
  const v = await evidence(s, signals);
  expect(v.candidates[0]?.kind).toBe(kind);
  expect(v.candidates[0]?.confidence).toBe(confidence);
});
it("decays confidence deterministically and expires evidence", async () => {
  const s = setup();
  const first = await evidence(s);
  s.advance(2);
  const later = await s.store.status(scope);
  expect(later.candidates[0].confidence).toBeLessThan(
    first.candidates[0].confidence,
  );
  s.advance(5);
  expect(await s.store.status(scope)).toMatchObject({
    observations: [],
    candidates: [],
  });
});
it("requires exact explicit review and only creates an inactive scoped draft", async () => {
  const s = setup();
  const v = await evidence(s);
  await expect(s.store.accept(scope, {} as any)).rejects.toThrow();
  const review = await s.store.review(scope, v.revision, "concise");
  const accepted = await s.store.accept(scope, review.ticket);
  expect(accepted.drafts).toHaveLength(1);
  expect(accepted.drafts[0]).toMatchObject({
    kind: "concise",
    active: false,
    trust: "untrusted",
  });
  expect(accepted.candidates).toEqual([]);
  await expect(s.store.accept(scope, review.ticket)).rejects.toThrow();
  expect(
    (await s.store.status({ ...scope, accountId: "other" })).drafts,
  ).toEqual([]);
  s.advance(30);
  expect((await s.store.status(scope)).drafts).toEqual([]);
});
it("invalidates reviews after evidence changes or five minutes", async () => {
  const s = setup();
  let v = await evidence(s);
  const r = await s.store.review(scope, v.revision, "concise");
  v = await s.store.record(scope, v.epoch, "shorter");
  await expect(s.store.accept(scope, r.ticket)).rejects.toThrow();
  const fresh = await s.store.review(scope, v.revision, "concise");
  s.advance(5 / 1440);
  await expect(s.store.accept(scope, fresh.ticket)).rejects.toThrow();
});
it("binds reviews to scope and backend", async () => {
  const s = setup();
  const v = await evidence(s);
  const r = await s.store.review(scope, v.revision, "concise");
  await expect(
    s.store.accept({ ...scope, chatId: "other" }, r.ticket),
  ).rejects.toThrow();
  await expect(setup().store.accept(scope, r.ticket)).rejects.toThrow();
});
it("opt-out stops collection and a new opt-in cannot revive old consent", async () => {
  const s = setup();
  const v = await evidence(s);
  const review = await s.store.review(scope, v.revision, "concise");
  await s.store.setEnabled(scope, false);
  await expect(s.store.record(scope, v.epoch, "shorter")).rejects.toThrow();
  await expect(s.store.accept(scope, review.ticket)).rejects.toThrow();
  await s.store.setEnabled(scope, true);
  await expect(s.store.record(scope, v.epoch, "shorter")).rejects.toThrow();
});
it("clear deletes observations and drafts and prevents stale resurrection", async () => {
  const s = setup();
  let v = await evidence(s);
  const review = await s.store.review(scope, v.revision, "concise");
  v = await s.store.accept(scope, review.ticket);
  await s.store.clear(scope);
  expect(await s.store.status(scope)).toMatchObject({
    enabled: false,
    observations: [],
    drafts: [],
    candidates: [],
  });
  await s.store.setEnabled(scope, true);
  await expect(s.store.record(scope, v.epoch, "shorter")).rejects.toThrow();
  await expect(s.store.accept(scope, review.ticket)).rejects.toThrow();
});
it("bounds evidence and scopes without evicting another scope", async () => {
  const s = setup();
  const v = await s.store.setEnabled(scope, true);
  for (let i = 0; i < 40; i++) await s.store.record(scope, v.epoch, "shorter");
  expect((await s.store.status(scope)).observations).toHaveLength(32);
  for (let i = 1; i < 32; i++)
    await s.store.setEnabled({ ...scope, chatId: `chat-${i}` }, true);
  await expect(
    s.store.setEnabled({ ...scope, chatId: "overflow" }, true),
  ).rejects.toThrow();
  expect((await s.store.status(scope)).observations).toHaveLength(32);
});
it("serializes independent instances and read versus record/delete without lost updates", async () => {
  const s = setup();
  const other = new SuggestionsStore(s.storage, () => 10 * DAY);
  const v = await s.store.setEnabled(scope, true);
  await Promise.all([
    s.store.record(scope, v.epoch, "shorter"),
    other.record(scope, v.epoch, "more_detail"),
    s.store.status(scope),
  ]);
  expect((await other.status(scope)).observations).toHaveLength(2);
  await Promise.all([s.store.status(scope), other.clear(scope)]);
  expect((await s.store.status(scope)).observations).toEqual([]);
});
it("does not overwrite corrupt data or claim success after failed writes", async () => {
  const s = setup();
  await s.store.setEnabled(scope, true);
  const key = [...s.values.keys()][0];
  s.values.set(key, '{"version":1,"raw":"secret"}');
  await expect(s.store.status(scope)).rejects.toThrow(
    "Local suggestions unavailable",
  );
  expect(s.values.get(key)).toContain("secret");
  s.values.clear();
  s.storage.setItem.mockRejectedValueOnce(new Error("private storage error"));
  await expect(s.store.setEnabled(scope, true)).rejects.toThrow(
    "Local suggestions unavailable",
  );
  expect((await s.store.status(scope)).enabled).toBe(false);
});
it("cancels after a delayed load before persisting any signal", async () => {
  const s = setup();
  const v = await s.store.setEnabled(scope, true);
  let resolve!: (v: string | null) => void;
  const raw = [...s.values.values()][0];
  s.storage.getItem.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const controller = new AbortController();
  const pending = s.store.record(scope, v.epoch, "shorter", controller.signal);
  await new Promise((r) => setImmediate(r));
  controller.abort();
  resolve(raw);
  await expect(pending).rejects.toThrow("Run cancelled");
  expect((await s.store.status(scope)).observations).toEqual([]);
});
it("physically purges expired evidence and drafts during a serialized read", async () => {
  const s = setup();
  let v = await evidence(s);
  const review = await s.store.review(scope, v.revision, "concise");
  await s.store.accept(scope, review.ticket);
  s.advance(30);
  await s.store.status(scope);
  const persisted = JSON.parse([...s.values.values()][0]).scopes[0];
  expect(persisted.observations).toEqual([]);
  expect(persisted.drafts).toEqual([]);
});
it.each([
  [
    "version",
    (d: any) => {
      d.version = 2;
    },
  ],
  [
    "revision",
    (d: any) => {
      d.revision = -1;
    },
  ],
  [
    "scope fields",
    (d: any) => {
      d.scopes[0].scope.extra = "private";
    },
  ],
  [
    "consent",
    (d: any) => {
      d.scopes[0].enabled = "yes";
    },
  ],
  [
    "epoch",
    (d: any) => {
      d.scopes[0].epoch = 0;
    },
  ],
  [
    "duplicate scope",
    (d: any) => {
      d.scopes.push(d.scopes[0]);
    },
  ],
  [
    "observation source",
    (d: any) => {
      d.scopes[0].observations[0].source = "model";
    },
  ],
  [
    "raw observation",
    (d: any) => {
      d.scopes[0].observations[0].text = "private payload";
    },
  ],
  [
    "observation expiry",
    (d: any) => {
      d.scopes[0].observations[0].expiresAt += DAY;
    },
  ],
  [
    "future timestamp",
    (d: any) => {
      d.scopes[0].observations[0].day = 20 * DAY;
    },
  ],
  [
    "active draft",
    (d: any) => {
      d.scopes[0].drafts[0].active = true;
    },
  ],
  [
    "trusted draft",
    (d: any) => {
      d.scopes[0].drafts[0].trust = "trusted";
    },
  ],
  [
    "unknown template",
    (d: any) => {
      d.scopes[0].drafts[0].kind = "custom";
    },
  ],
  [
    "duplicate draft",
    (d: any) => {
      d.scopes[0].drafts.push(d.scopes[0].drafts[0]);
    },
  ],
] as const)(
  "rejects malformed persisted %s without rewriting it",
  async (_name, change) => {
    const s = setup();
    const v = await evidence(s);
    const r = await s.store.review(scope, v.revision, "concise");
    await s.store.accept(scope, r.ticket);
    const key = [...s.values.keys()][0],
      doc = JSON.parse(s.values.get(key)!);
    change(doc);
    const corrupted = JSON.stringify(doc);
    s.values.set(key, corrupted);
    await expect(s.store.status(scope)).rejects.toThrow(
      "Local suggestions unavailable",
    );
    expect(s.values.get(key)).toBe(corrupted);
  },
);
it("bounds serialized input and refuses exhausted revision identifiers", async () => {
  const s = setup();
  await s.store.setEnabled(scope, true);
  const key = [...s.values.keys()][0];
  const doc = JSON.parse(s.values.get(key)!);
  s.values.set(key, "x".repeat(524289));
  await expect(s.store.status(scope)).rejects.toThrow();
  doc.revision = Number.MAX_SAFE_INTEGER;
  s.values.set(key, JSON.stringify(doc));
  await expect(s.store.setEnabled(scope, true)).rejects.toThrow();
});
it("clear affects only its exact scope and failed clear preserves recoverable data", async () => {
  const s = setup();
  await evidence(s);
  const other = { ...scope, chatId: "other" };
  const v = await s.store.setEnabled(other, true);
  await s.store.record(other, v.epoch, "more_detail");
  s.storage.setItem.mockRejectedValueOnce(Error("disk"));
  await expect(s.store.clear(scope)).rejects.toThrow();
  expect((await s.store.status(scope)).observations).toHaveLength(3);
  await s.store.clear(scope);
  expect((await s.store.status(other)).observations).toHaveLength(1);
});
it("does not resurrect expired data when a read races explicit deletion", async () => {
  const s = setup();
  await evidence(s);
  s.advance(7);
  await Promise.all([
    s.store.status(scope),
    new SuggestionsStore(s.storage, () => 17 * DAY).clear(scope),
  ]);
  expect(JSON.parse([...s.values.values()][0]).scopes).toEqual([]);
});
it("does not round confidence upward across the promotion threshold", async () => {
  const s = setup();
  await evidence(s, ["shorter", "shorter"]);
  s.advance(2.338);
  expect((await s.store.status(scope)).candidates).toEqual([]);
});
it("rejects stale or unavailable candidates at review time", async () => {
  const s = setup();
  const v = await evidence(s);
  await expect(
    s.store.review(scope, v.revision, "unknown" as any),
  ).rejects.toThrow();
  await s.store.record(scope, v.epoch, "shorter");
  await expect(s.store.review(scope, v.revision, "concise")).rejects.toThrow();
  await expect(
    s.store.review({ ...scope, chatId: "missing" }, 0, "concise"),
  ).rejects.toThrow();
});
it("refuses invalid consent values and invalid clock state without writes", async () => {
  const s = setup();
  await expect(s.store.setEnabled(scope, "true" as any)).rejects.toThrow();
  await expect(
    new SuggestionsStore(s.storage, () => NaN).setEnabled(scope, true),
  ).rejects.toThrow();
  expect(s.storage.setItem).not.toHaveBeenCalled();
});
