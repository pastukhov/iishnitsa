declare const sessionBrand: unique symbol;
declare const activationBrand: unique symbol;
export interface SkillSession {
  readonly [sessionBrand]: true;
}
export interface SkillActivation {
  readonly [activationBrand]: true;
}
export interface SkillContextOptions {
  activation: SkillActivation;
  session: SkillSession;
  surface: "chat";
}
export interface SkillMetadata {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly surface: "chat";
  readonly trust: "untrusted";
}
export class SkillImportError extends Error {
  readonly code = "invalid_skill";
  constructor() {
    super("invalid_skill");
    this.name = "SkillImportError";
  }
}
const sessions = new WeakMap<SkillSession, { closed: boolean }>();
const activations = new WeakMap<
  SkillActivation,
  { session: SkillSession; context: string }
>();
function deny(): never {
  throw new SkillImportError();
}
function requireSession(session: SkillSession): void {
  const state = sessions.get(session);
  if (!state || state.closed) deny();
}
export function createSkillSession(surface: "chat"): SkillSession {
  if (surface !== "chat") deny();
  const session = Object.freeze({}) as SkillSession;
  sessions.set(session, { closed: false });
  return session;
}
export function closeSkillSession(session: SkillSession): void {
  const state = sessions.get(session);
  if (!state) deny();
  state.closed = true;
}
export function resolveSkillContext(
  options?: SkillContextOptions,
): string | undefined {
  if (options === undefined) return undefined;
  if (!options || options.surface !== "chat") deny();
  requireSession(options.session);
  const activation = activations.get(options.activation);
  if (!activation || activation.session !== options.session) deny();
  return activation.context;
}

// Count UTF-8 bytes without Node-only APIs, rejecting malformed Unicode and controls.
function byteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && point !== 9 && point !== 10 && point !== 13) ||
      (point >= 127 && point <= 159) ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      deny();
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
interface RecordEntry {
  metadata: Readonly<SkillMetadata>;
  raw: string;
  content: string;
}
const fields = [
  "schema_version",
  "name",
  "version",
  "description",
  "surface",
  "trust",
];
function parse(raw: string): RecordEntry {
  if (typeof raw !== "string" || raw.length > 16384 || byteLength(raw) > 16384)
    deny();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match || !match[2].trim()) deny();
  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z_]+): ([^\r\n]+)$/.exec(line);
    if (!field || !fields.includes(field[1]) || values.has(field[1])) deny();
    values.set(field[1], field[2]);
  }
  if (
    values.size !== fields.length ||
    values.get("schema_version") !== "1" ||
    values.get("surface") !== "chat" ||
    values.get("trust") !== "untrusted"
  )
    deny();
  const name = values.get("name")!;
  const version = values.get("version")!;
  const description = values.get("description")!;
  if (
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    version.length > 32 ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    description.length > 256 ||
    !description.trim()
  )
    deny();
  return {
    raw,
    content: match[2],
    metadata: Object.freeze({
      name,
      version,
      description,
      surface: "chat",
      trust: "untrusted",
    }),
  };
}

/** Imported text supplies reference context only; it never supplies runtime authority. */
export function createSkillRegistry() {
  const records = new Map<string, RecordEntry>();
  let totalBytes = 0;
  return Object.freeze({
    import(raw: string): Readonly<SkillMetadata> {
      const entry = parse(raw);
      const key = `${entry.metadata.name}@${entry.metadata.version}`;
      const existing = records.get(key);
      if (existing) {
        if (existing.raw !== raw) deny();
        return existing.metadata;
      }
      const size = byteLength(raw);
      if (records.size >= 32 || totalBytes + size > 262144) deny();
      records.set(key, entry);
      totalBytes += size;
      return entry.metadata;
    },
    activate(
      session: SkillSession,
      selections: readonly { name: string; version: string }[],
    ): SkillActivation {
      requireSession(session);
      if (
        !Array.isArray(selections) ||
        selections.length < 1 ||
        selections.length > 4
      )
        deny();
      const names = new Set<string>();
      const selected = Array.from(selections, (selection) => {
        if (
          !selection ||
          typeof selection.name !== "string" ||
          typeof selection.version !== "string" ||
          names.has(selection.name)
        )
          deny();
        names.add(selection.name);
        const entry = records.get(`${selection.name}@${selection.version}`);
        if (!entry) deny();
        return entry;
      });
      selected.sort((a, b) => (a.metadata.name < b.metadata.name ? -1 : 1));
      const context = JSON.stringify({
        type: "untrusted_skill_reference",
        skills: selected.map(({ metadata, content }) => ({
          ...metadata,
          content,
        })),
      });
      if (byteLength(context) > 8192) deny();
      const activation = Object.freeze({}) as SkillActivation;
      activations.set(activation, { session, context });
      return activation;
    },
  });
}
