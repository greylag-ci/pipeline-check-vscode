// Diagnostic-publish transform that the LanguageClient middleware
// chains. Extracted out of extension.ts so the composition of the
// per-provider disable filter and the per-severity threshold filter
// can be unit-tested without booting an LSP — neither piece is
// individually interesting (each has its own test file), but their
// composition is what the user actually sees, and that was untested.
//
// Two filters in order:
//   1. If the URI maps to a `disabledProviders[*]` entry, drop ALL
//      diagnostics for that URI. Returns an empty array so the
//      middleware still calls next(uri, []) and the publish wakes
//      consumers up (so a later "unset disable" produces a refresh).
//   2. Otherwise, drop every diagnostic below
//      `pipelineCheck.severityThreshold`.

import type * as vscode from "vscode";

import { providerForPath, type ProviderId } from "./providers";
import { filterByThreshold } from "./severityFilter";

/**
 * Anything the middleware needs from the live VS Code configuration.
 * Passing this as a value (rather than reading `vscode.workspace`
 * here) keeps the function pure and testable.
 */
export interface DiagnosticConfig {
  readonly disabledProviders: readonly string[];
  readonly severityThreshold: string;
}

/**
 * Filter a freshly-published diagnostic batch through the two-stage
 * settings filter. Pure: identical inputs produce identical outputs;
 * no side effects.
 */
export function transformDiagnostics(
  uri: vscode.Uri,
  diagnostics: readonly vscode.Diagnostic[],
  config: DiagnosticConfig,
): vscode.Diagnostic[] {
  const disabled = new Set(config.disabledProviders as ProviderId[]);
  const provider = providerForPath(uri.fsPath);
  if (provider && disabled.has(provider)) {
    // Empty array (not "skip the call") so the publish still
    // propagates — consumers like the Findings tree rely on the
    // batch arrival to re-render even when the count is zero.
    return [];
  }
  return filterByThreshold(diagnostics, config.severityThreshold);
}
