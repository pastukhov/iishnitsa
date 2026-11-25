/** Shared synthetic JSON response; never delegates to a network transport. */
export const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Map(),
  body: null,
  text: async () => JSON.stringify(body),
});
