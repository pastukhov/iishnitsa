import { runCli } from "../cli";
import { createRuntime, type ChatExecutor } from "../service";
const endpoint = {
  providerId: "custom",
  baseUrl: "https://fixture.invalid",
  apiKey: "secret",
  model: "fixture",
} as const;
function setup(
  execute: ChatExecutor = async (_m, _e, chunk) => {
    chunk("answer");
  },
) {
  const client = createRuntime({
    execute,
    authenticate: async (auth) =>
      auth === "fixture" ? { ownerId: "owner" } : null,
    configure: async () => ({ endpoint }),
  }).forSurface("cli");
  const io = { write: jest.fn(), error: jest.fn() };
  return { client, io };
}
it("prints runtime events with success exit", async () => {
  const { client, io } = setup();
  expect(await runCli(client, "fixture", "hello", io)).toBe(0);
  expect(io.write).toHaveBeenCalledWith(
    expect.stringContaining('"outcome":"completed"'),
  );
  expect(io.error).not.toHaveBeenCalled();
});
it("returns fixed auth and host failures without private errors", async () => {
  const { client, io } = setup();
  expect(await runCli(client, "bad", "hello", io)).toBe(1);
  expect(io.error).toHaveBeenCalledWith("Runtime request failed\n");
  const failed = setup(async () => {
    throw Error("secret https://fixture.invalid");
  });
  expect(await runCli(failed.client, "fixture", "hello", failed.io)).toBe(1);
  expect(JSON.stringify(failed.io.write.mock.calls)).not.toMatch(
    /secret|fixture.invalid/,
  );
});
it("does not start a pre-cancelled request", async () => {
  const execute = jest.fn(async () => {});
  const { client, io } = setup(execute);
  const controller = new AbortController();
  controller.abort();
  expect(await runCli(client, "fixture", "hello", io, controller.signal)).toBe(
    130,
  );
  expect(execute).not.toHaveBeenCalled();
});
it("cancels when interrupted during streaming", async () => {
  const controller = new AbortController();
  const { client, io } = setup(
    async (_m, _e, _chunk, _s, _enabled, options) => {
      await new Promise<void>((resolve) =>
        options!.signal!.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    },
  );
  io.write.mockImplementation((line) => {
    if (line.includes('"started"')) controller.abort();
  });
  expect(await runCli(client, "fixture", "hello", io, controller.signal)).toBe(
    130,
  );
  expect(io.error).not.toHaveBeenCalled();
});
it("disconnects and reports only a safe error if output sink fails", async () => {
  const { client, io } = setup();
  const disconnect = jest.spyOn(client, "disconnect");
  io.write.mockImplementation(() => {
    throw Error("private sink failure");
  });
  expect(await runCli(client, "fixture", "hello", io)).toBe(1);
  expect(disconnect).toHaveBeenCalled();
  expect(io.error).toHaveBeenCalledWith("Runtime request failed\n");
});
