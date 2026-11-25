import { validateMemoryScope, type MemoryScope } from "./agent/memory";
import { nativeStorage, type RuntimeStorage } from "./runtime/storage";
import { throwIfCancelled } from "./runtime/cancellation";
const DAY = 86400000;
const KEY = "@local_suggestions_v1";
const FEEDBACK = ["shorter", "more_detail", "length_ok"] as const;
export type Feedback = (typeof FEEDBACK)[number];
export type SuggestionKind = "concise" | "detailed";
const TEMPLATES = {
  concise: {
    title: "Consider shorter replies",
    text: "A preference for concise replies may be worth reviewing.",
  },
  detailed: {
    title: "Consider more detail",
    text: "A preference for more detailed replies may be worth reviewing.",
  },
} as const;
interface Observation {
  feedback: Feedback;
  source: "mobile_feedback";
  day: number;
  expiresAt: number;
}
interface Draft {
  kind: SuggestionKind;
  createdAt: number;
  expiresAt: number;
  active: false;
  trust: "untrusted";
}
interface Entry {
  scope: MemoryScope;
  enabled: boolean;
  epoch: number;
  revision: number;
  observations: Observation[];
  drafts: Draft[];
}
interface Document {
  version: 1;
  revision: number;
  scopes: Entry[];
}
export interface Candidate {
  readonly kind: SuggestionKind;
  readonly title: string;
  readonly text: string;
  readonly trust: "untrusted";
  readonly confidence: number;
  readonly support: number;
  readonly source: "mobile_feedback";
}
export interface SuggestionsView {
  readonly enabled: boolean;
  readonly epoch: number;
  readonly revision: number;
  readonly observations: readonly Readonly<Observation>[];
  readonly candidates: readonly Candidate[];
  readonly drafts: readonly Readonly<Draft & { title: string; text: string }>[];
}
declare const reviewBrand: unique symbol;
export interface ReviewTicket {
  readonly [reviewBrand]: true;
}
const reviews = new WeakMap<
  ReviewTicket,
  {
    storage: RuntimeStorage;
    scope: string;
    revision: number;
    kind: SuggestionKind;
    expiresAt: number;
  }
>();
const tails = new WeakMap<RuntimeStorage, Promise<unknown>>();
function fail(): never {
  throw new Error("Local suggestions unavailable");
}
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const keys = (v: any, names: string[]) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));
const scopeKey = (scope: MemoryScope) =>
  JSON.stringify([scope.accountId, scope.chatId]);
const kind = (v: unknown): v is SuggestionKind =>
  v === "concise" || v === "detailed";
function candidates(entry: Entry, now: number): Candidate[] {
  return (["concise", "detailed"] as const).flatMap((kind) => {
    if (entry.drafts.some((d) => d.kind === kind)) return [];
    const positive = kind === "concise" ? "shorter" : "more_detail";
    let support = 0,
      net = 0,
      total = 0;
    for (const o of entry.observations) {
      const weight = Math.max(0, 1 - (now - o.day) / (7 * DAY));
      total += weight;
      if (o.feedback === positive) {
        support++;
        net += weight;
      } else net -= weight;
    }
    const rawConfidence = Math.max(0, net / (total + 2));
    const confidence = Math.round(rawConfidence * 1000) / 1000;
    return support >= 2 && rawConfidence >= 0.4
      ? [
          Object.freeze({
            kind,
            ...TEMPLATES[kind],
            trust: "untrusted" as const,
            confidence,
            support,
            source: "mobile_feedback" as const,
          }),
        ]
      : [];
  });
}
function snapshot(entry: Entry | undefined, now: number): SuggestionsView {
  return Object.freeze({
    enabled: entry?.enabled ?? false,
    epoch: entry?.epoch ?? 0,
    revision: entry?.revision ?? 0,
    observations: Object.freeze(
      (entry?.observations ?? []).map((o) => Object.freeze({ ...o })),
    ),
    candidates: Object.freeze(entry ? candidates(entry, now) : []),
    drafts: Object.freeze(
      (entry?.drafts ?? []).map((d) =>
        Object.freeze({ ...d, ...TEMPLATES[d.kind] }),
      ),
    ),
  });
}

export class SuggestionsStore {
  constructor(
    private readonly storage: RuntimeStorage = nativeStorage,
    private readonly now: () => number = Date.now,
  ) {}
  private async load(): Promise<{ doc: Document; purged: boolean }> {
    const raw = await this.storage.getItem(KEY);
    if (raw === null)
      return { doc: { version: 1, revision: 0, scopes: [] }, purged: false };
    if (raw.length > 524288) fail();
    const doc = JSON.parse(raw);
    const now = this.now();
    if (
      !keys(doc, ["version", "revision", "scopes"]) ||
      doc.version !== 1 ||
      !integer(doc.revision) ||
      !Array.isArray(doc.scopes) ||
      doc.scopes.length > 32
    )
      fail();
    const storedRevision = doc.revision;
    let purged = false;
    const seen = new Set<string>();
    for (const e of doc.scopes) {
      if (
        !keys(e, [
          "scope",
          "enabled",
          "epoch",
          "revision",
          "observations",
          "drafts",
        ]) ||
        !keys(e.scope, ["accountId", "chatId"]) ||
        typeof e.enabled !== "boolean" ||
        !integer(e.epoch) ||
        !integer(e.revision) ||
        e.epoch < 1 ||
        e.epoch > e.revision ||
        e.revision > storedRevision ||
        !Array.isArray(e.observations) ||
        e.observations.length > 32 ||
        !Array.isArray(e.drafts) ||
        e.drafts.length > 2
      )
        fail();
      validateMemoryScope(e.scope);
      const key = scopeKey(e.scope);
      if (seen.has(key)) fail();
      seen.add(key);
      for (const o of e.observations)
        if (
          !keys(o, ["feedback", "source", "day", "expiresAt"]) ||
          !FEEDBACK.includes(o.feedback) ||
          o.source !== "mobile_feedback" ||
          !integer(o.day) ||
          o.day % DAY !== 0 ||
          o.day > now ||
          o.expiresAt !== o.day + 7 * DAY
        )
          fail();
      const draftKinds = new Set();
      for (const d of e.drafts) {
        if (
          !keys(d, ["kind", "createdAt", "expiresAt", "active", "trust"]) ||
          !kind(d.kind) ||
          !integer(d.createdAt) ||
          d.createdAt % DAY !== 0 ||
          d.createdAt > now ||
          d.expiresAt !== d.createdAt + 30 * DAY ||
          d.active !== false ||
          d.trust !== "untrusted" ||
          draftKinds.has(d.kind)
        )
          fail();
        draftKinds.add(d.kind);
      }
      const count = e.observations.length + e.drafts.length;
      e.observations = e.observations.filter(
        (o: Observation) => now < o.expiresAt,
      );
      e.drafts = e.drafts.filter((d: Draft) => now < d.expiresAt);
      if (count !== e.observations.length + e.drafts.length) {
        purged = true;
        e.revision = this.next(doc);
      }
    }
    return { doc, purged };
  }
  private tx<T>(
    scope: MemoryScope,
    signal: AbortSignal | undefined,
    write: boolean,
    action: (doc: Document, scope: MemoryScope, now: number) => T,
  ): Promise<T> {
    const captured = validateMemoryScope(scope);
    const run = (tails.get(this.storage) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        try {
          throwIfCancelled(signal);
          const { doc, purged } = await this.load();
          throwIfCancelled(signal);
          const now = this.now();
          if (!integer(now)) fail();
          const result = action(doc, captured, now);
          throwIfCancelled(signal);
          if (write || purged) {
            const raw = JSON.stringify(doc);
            if (raw.length > 524288) fail();
            await this.storage.setItem(KEY, raw);
          }
          return result;
        } catch {
          throwIfCancelled(signal);
          return fail();
        }
      });
    tails.set(
      this.storage,
      run.catch(() => {}),
    );
    return run;
  }
  private entry(doc: Document, scope: MemoryScope) {
    return doc.scopes.find((e) => scopeKey(e.scope) === scopeKey(scope));
  }
  private next(doc: Document) {
    if (doc.revision >= Number.MAX_SAFE_INTEGER) fail();
    return ++doc.revision;
  }
  status(scope: MemoryScope, signal?: AbortSignal) {
    return this.tx(scope, signal, false, (doc, s, now) =>
      snapshot(this.entry(doc, s), now),
    );
  }
  setEnabled(scope: MemoryScope, enabled: boolean, signal?: AbortSignal) {
    return this.tx(scope, signal, true, (doc, s, now) => {
      if (typeof enabled !== "boolean") fail();
      let e = this.entry(doc, s);
      const revision = this.next(doc);
      if (!e) {
        if (doc.scopes.length >= 32) fail();
        e = {
          scope: s,
          enabled,
          epoch: revision,
          revision,
          observations: [],
          drafts: [],
        };
        doc.scopes.push(e);
      } else {
        e.enabled = enabled;
        e.epoch = revision;
        e.revision = revision;
      }
      return snapshot(e, now);
    });
  }
  record(
    scope: MemoryScope,
    epoch: number,
    feedback: Feedback,
    signal?: AbortSignal,
  ) {
    return this.tx(scope, signal, true, (doc, s, now) => {
      const e = this.entry(doc, s);
      if (!e?.enabled || e.epoch !== epoch || !FEEDBACK.includes(feedback))
        fail();
      const day = Math.floor(now / DAY) * DAY;
      e.observations.push({
        feedback,
        source: "mobile_feedback",
        day,
        expiresAt: day + 7 * DAY,
      });
      e.observations = e.observations.slice(-32);
      e.revision = this.next(doc);
      return snapshot(e, now);
    });
  }
  review(
    scope: MemoryScope,
    revision: number,
    selected: SuggestionKind,
    signal?: AbortSignal,
  ) {
    return this.tx(scope, signal, false, (doc, s, now) => {
      const e = this.entry(doc, s);
      if (!e?.enabled || e.revision !== revision) fail();
      const candidate = candidates(e, now).find((c) => c.kind === selected);
      if (!candidate) fail();
      const ticket = Object.freeze({}) as ReviewTicket;
      reviews.set(ticket, {
        storage: this.storage,
        scope: scopeKey(s),
        revision,
        kind: selected,
        expiresAt: now + 300000,
      });
      return Object.freeze({ ticket, candidate });
    });
  }
  accept(scope: MemoryScope, ticket: ReviewTicket, signal?: AbortSignal) {
    return this.tx(scope, signal, true, (doc, s, now) => {
      const review = reviews.get(ticket);
      const e = this.entry(doc, s);
      if (
        !review ||
        review.storage !== this.storage ||
        review.scope !== scopeKey(s) ||
        !e?.enabled ||
        review.revision !== e.revision ||
        now >= review.expiresAt ||
        !candidates(e, now).some((c) => c.kind === review.kind)
      )
        fail();
      const day = Math.floor(now / DAY) * DAY;
      e.drafts.push({
        kind: review.kind,
        createdAt: day,
        expiresAt: day + 30 * DAY,
        active: false,
        trust: "untrusted",
      });
      e.revision = this.next(doc);
      return snapshot(e, now);
    });
  }
  clear(scope: MemoryScope, signal?: AbortSignal) {
    return this.tx(scope, signal, true, (doc, s, now) => {
      this.next(doc);
      doc.scopes = doc.scopes.filter((e) => scopeKey(e.scope) !== scopeKey(s));
      return snapshot(undefined, now);
    });
  }
}
