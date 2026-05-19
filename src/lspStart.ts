// Bounded-time LSP startup, extracted from extension.ts so the timeout
// race semantics can be exercised in isolation. The shape it accepts
// is structural rather than nominally `LanguageClient` from
// vscode-languageclient — extension.ts passes the real LanguageClient,
// the tests pass a fake. Anything with `start(): Promise<void>` and
// `stop(): Promise<void>` works.

/**
 * Minimal shape `startWithTimeout` needs from a LanguageClient. We do
 * NOT depend on the concrete `LanguageClient` type here so the unit
 * tests don't have to import vscode-languageclient (which pulls in the
 * VS Code runtime).
 */
export interface StartableClient {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Race the LSP startup handshake against a hard ceiling. On timeout
 * we fire-and-forget `client.stop()` to kill the stranded subprocess
 * (best effort — the server may already be hung past saving) and
 * throw a recognisable error the caller's catch surfaces in the
 * failure toast.
 *
 * The fire-and-forget shape on the timeout-side stop() is deliberate:
 * awaiting it would mean the user waits for a hung interpreter to
 * respond before seeing the "did not finish startup" toast, which
 * defeats the point of the timeout.
 *
 * Internally the implementation is a single deferred with a `settled`
 * flag rather than `Promise.race([start, timeoutPromise])`. The race
 * shape leaks a "rejection was handled asynchronously" warning in
 * Node when fake timers fire the rejection synchronously — Promise.race
 * attaches its handler one microtask later, which Node briefly treats
 * as unhandled. The deferred avoids that two-promise dance.
 */
export function startWithTimeout(
  client: StartableClient,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Best-effort kill of the stranded subprocess; swallow any
      // stop() rejection so the timeout error is what the caller sees.
      void client.stop().catch(() => undefined);
      reject(new Error(formatTimeoutMessage(timeoutMs)));
    }, timeoutMs);
    client.start().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Exported for unit testing the timeout message contract — the toast
 * copy is part of the user-facing API and should not drift silently.
 */
export function formatTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return (
    `Language server did not finish startup within ${seconds}s. ` +
    `Check the server log; common causes are an empty ` +
    `pipelineCheck.serverArgs, an interpreter that drops into the ` +
    `REPL, or a corrupted pipeline_check install.`
  );
}
