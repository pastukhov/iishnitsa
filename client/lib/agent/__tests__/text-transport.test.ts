import { OpenAICompatibleDriver } from "../openai-driver";
const endpoint = {
  providerId: "custom",
  baseUrl: "https://child.invalid",
  apiKey: "child-key",
  model: "fixture",
} as const;
const fetchMock = global.fetch as jest.Mock;
const encode = (s: string) => new TextEncoder().encode(s);
const event = (delta: unknown, finish_reason?: string) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
function stream(chunks: Uint8Array[], ok = true) {
  const reader = {
    read: jest.fn(async () =>
      chunks.length ? { done: false, value: chunks.shift() } : { done: true },
    ),
    cancel: jest.fn(),
    releaseLock: jest.fn(),
  };
  const text = jest.fn(async () => "private-error");
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    body: { getReader: () => reader },
    text,
  });
  return { reader, text };
}
function send(extra = {}) {
  return new OpenAICompatibleDriver().streamChat({
    endpoint,
    messages: [{ role: "user", content: "fixture task" }],
    tools: [],
    onChunk: jest.fn(),
    textOnly: true,
    ...extra,
  } as any);
}
beforeEach(() => fetchMock.mockReset());
it("requests a bounded text completion without tools", async () => {
  stream([encode(event({ content: "answer" }, "stop"))]);
  await expect(send()).resolves.toMatchObject({
    fullContent: "answer",
    toolCalls: [],
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    model: "fixture",
    messages: [{ role: "user", content: "fixture task" }],
    stream: true,
    max_tokens: 1024,
  });
});
it.each([
  "tools",
  "function",
  "incomplete",
  "oversized-output",
  "oversized-wire",
  "json",
  "empty",
])("rejects %s without exposing a partial result", async (kind) => {
  const raw =
    kind === "tools"
      ? event(
          {
            tool_calls: [
              {
                index: 0,
                id: "fixture",
                function: { name: "fixture", arguments: "{}" },
              },
            ],
          },
          "tool_calls",
        )
      : kind === "function"
        ? event(
            { function_call: { name: "fixture", arguments: "{}" } },
            "function_call",
          )
        : kind === "incomplete"
          ? event({ content: "partial" })
          : kind === "oversized-output"
            ? event({ content: "é".repeat(2049) }, "stop")
            : kind === "oversized-wire"
              ? ":" + "x".repeat(65536)
              : kind === "json"
                ? "data: {invalid}\n\n"
                : "";
  const { reader } = stream([encode(raw)]);
  await expect(send()).rejects.toThrow();
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
it("does not read an unbounded non-stream response", async () => {
  const text = jest.fn(async () => "private text");
  fetchMock.mockResolvedValue({ ok: true, body: null, text });
  await expect(send()).rejects.toThrow();
  expect(text).not.toHaveBeenCalled();
});
it("does not read an HTTP error body", async () => {
  const { text, reader } = stream([], false);
  await expect(send()).rejects.toThrow();
  expect(text).not.toHaveBeenCalled();
  expect(reader.cancel).toHaveBeenCalledTimes(1);
});
it("accepts split UTF-8 at the exact output limit", async () => {
  const bytes = encode(event({ content: "é".repeat(2048) }, "stop"));
  stream(Array.from(bytes, (_, i) => bytes.slice(i, i + 1)));
  await expect(send()).resolves.toMatchObject({
    fullContent: "é".repeat(2048),
  });
});
it("cancels a pending reader without waiting for its response", async () => {
  const controller = new AbortController();
  const { reader } = stream([]);
  reader.read.mockImplementation(() => new Promise(() => {}));
  const pending = send({ signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  controller.abort("private reason");
  await expect(pending).rejects.toThrow("Run cancelled");
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
it("rejects tools supplied with text-only mode before fetch", async () => {
  await expect(
    send({ tools: [{ type: "function", function: { name: "fixture" } }] }),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("releases an HTTP error reader after cancellation", async () => {
  const { reader } = stream([], false);
  await expect(send()).rejects.toThrow();
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
