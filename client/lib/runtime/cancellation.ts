/** Cancellation reasons are private host data and never enter public errors. */
export class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "RunCancelledError";
  }
}
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunCancelledError();
}
export function cancellable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new RunCancelledError());
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (signal.aborted) reject(new RunCancelledError());
        else resolve(value);
      },
      (error) => {
        cleanup();
        reject(signal.aborted ? new RunCancelledError() : error);
      },
    );
    if (signal.aborted) abort();
  });
}
export function combineRunSignals(...signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  }
  return {
    signal: controller.signal,
    close: () => {
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
  };
}
