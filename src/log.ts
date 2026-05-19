// Client-side structured logging that lands in the same
// "Pipeline-Check" output channel as the LSP server's
// `window/logMessage` traffic, distinguished by a `[client]` prefix.
//
// The point is to leave breadcrumbs when a user reports a bug:
// without these lines we have no way to tell whether the command
// fired, how long the work took, or where it failed. The output
// channel is the right home — users can already focus it via
// `Pipeline-Check: Show language server output`, and it's the
// natural place to look.

import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

/**
 * Set the output channel logs are written to. Called once from
 * activate() after the LanguageClient has constructed its channel,
 * so client logs and server logs share the same surface.
 */
export function setLogChannel(c: vscode.OutputChannel): void {
  channel = c;
}

/**
 * Append a single line, prefixed `[client] HH:MM:SS.mmm <level>`, to
 * the configured output channel. Silent no-op until `setLogChannel`
 * has been called — keeps activation-order edge cases from throwing.
 */
export function log(
  level: "info" | "warn" | "error",
  message: string,
): void {
  if (!channel) return;
  channel.appendLine(`[client] ${timestamp()} ${level.padEnd(5)} ${message}`);
}

export const info = (msg: string) => log("info", msg);
export const warn = (msg: string) => log("warn", msg);
export const error = (msg: string) => log("error", msg);

/**
 * Wraps a thunk so its start, end, and duration land in the log.
 * Useful for commands the user fires — `command ran for 1.3s`
 * is exactly the kind of breadcrumb that turns a vague bug report
 * into an actionable one.
 */
export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  info(`${label}: start`);
  try {
    const result = await fn();
    info(`${label}: ok in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`${label}: failed in ${Date.now() - started}ms — ${msg}`);
    throw err;
  }
}

/**
 * Render the current time as `HH:MM:SS.mmm` so log lines sort and
 * align on the leading column. Exported for unit testing.
 */
export function formatTimestamp(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function timestamp(): string {
  return formatTimestamp(new Date());
}
