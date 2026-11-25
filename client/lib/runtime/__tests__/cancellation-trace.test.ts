import { sendChatMessage } from "../../api";
import { clearClientCache } from "../../mcp-client";
import type { ExecutionEvent } from "../../agent/execution-trace";

const endpoint = {
  providerId: "custom" as const,
  baseUrl: "https://llm.invalid",
  apiKey: "fixture",
  model: "fixture",
};
const server = {
  id: "mcp",
  name: "fixture",
  url: "https://mcp.invalid",
  enabled: true,
};
const fetchMock = global.fetch as jest.Mock;
const response = (value: unknown) => ({
  ok: true,
  status: 200,
  body: null,
  headers: new Map(),
  text: async () => JSON.stringify(value),
});

test.each(["approval", "dispatched"])(
  "real API closes MCP operation on cancellation during %s",
  async (phase) => {
    clearClientCache();
    fetchMock.mockReset();
    const controller = new AbortController();
    const events: ExecutionEvent[] = [];
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === server.url) {
        if (body.method === "tools/call") {
          reached();
          return new Promise(() => {});
        }
        const result =
          body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "change",
                    description: "fixture",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : {};
        return response({ jsonrpc: "2.0", id: body.id, result });
      }
      return response({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call",
                  type: "function",
                  function: { name: "mcp__change", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    });
    const run = sendChatMessage(
      [{ id: "user", role: "user", content: "fixture", timestamp: 1 }],
      endpoint,
      jest.fn(),
      [server],
      true,
      {
        signal: controller.signal,
        memorySettings: { enabled: false, autoSave: false, autoSummary: false },
        onExecutionEvent: (event) => events.push(event),
        toolPolicy: {
          registry: [
            {
              target: { kind: "mcp", name: "change", server },
              risk: "mutating",
            },
          ],
          requestApproval: (request) => {
            if (phase === "approval") {
              reached();
              return new Promise(() => {});
            }
            return { decision: "approve", request };
          },
        },
      },
    );
    await ready;
    controller.abort();
    await expect(run).rejects.toThrow("Run cancelled");
    const starts = events.filter((event) => event.type === "operation_started");
    for (const start of starts) {
      expect(
        events.filter(
          (event) =>
            event.type === "operation_finished" &&
            event.operationId === start.operationId,
        ),
      ).toHaveLength(1);
    }
    expect(
      events.filter(
        (event) =>
          event.type === "operation_finished" && event.operation === "mcp",
      ),
    ).toEqual([
      expect.objectContaining({
        dispatch: phase === "approval" ? "not_dispatched" : "attempted",
        outcome: phase === "approval" ? "failed" : "unknown",
      }),
    ]);
    expect(events.at(-1)?.type).toBe("run_finished");
    const before = JSON.stringify(events);
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(events)).toBe(before);
  },
);
