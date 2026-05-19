// Pure severity-threshold filter, factored out of the LSP middleware so
// it can be unit-tested without booting VS Code or the language client.
// extension.ts wires this into `middleware.handleDiagnostics`; the
// findings tree never sees diagnostics that didn't pass through here,
// so the threshold knob lands at one place.

// Upstream severity ranks. Higher = more severe. The server stuffs the
// pipeline-check severity name into Diagnostic.data["severity"] (e.g.
// "CRITICAL"). The LSP DiagnosticSeverity enum collapses CRITICAL +
// HIGH into a single Error value, so we cannot filter precisely on the
// LSP severity alone.
export const SEVERITY_RANK = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export type ThresholdName = "low" | "medium" | "high" | "critical";

// Threshold knob values. Map each to the rank a diagnostic must reach
// to survive the filter.
export const THRESHOLD_RANK: Record<ThresholdName, number> = {
  low: SEVERITY_RANK.LOW,
  medium: SEVERITY_RANK.MEDIUM,
  high: SEVERITY_RANK.HIGH,
  critical: SEVERITY_RANK.CRITICAL,
};

// Internal: any object that may carry the pipeline-check severity name
// on its `data` extension. vscode.Diagnostic does not declare `data`,
// so we read it through a structural cast rather than constraining the
// caller's generic.
type WithSeverityData = { data?: { severity?: string } };

/**
 * Returns true if `diag` should remain visible at the given threshold.
 *
 * Invariants the tests pin down:
 *   - A diagnostic with no `data.severity` always passes. The middleware
 *     must not silently hide a publish that lacks the metadata (older
 *     server, or any non-pipeline-check publish that flowed through).
 *   - A diagnostic with an unknown `data.severity` name passes too,
 *     same reason — we never disappear something we don't recognise.
 *   - An unknown `threshold` name falls back to LOW, so a hand-edited
 *     settings.json with a bogus value can't accidentally drop every
 *     finding.
 */
export function passesThreshold(diag: object, threshold: string): boolean {
  const minRank =
    THRESHOLD_RANK[threshold as ThresholdName] ?? SEVERITY_RANK.LOW;
  const name = (diag as WithSeverityData).data?.severity;
  if (!name) {
    return true;
  }
  const rank = SEVERITY_RANK[name as keyof typeof SEVERITY_RANK];
  return rank === undefined || rank >= minRank;
}

export function filterByThreshold<T extends object>(
  diagnostics: readonly T[],
  threshold: string,
): T[] {
  return diagnostics.filter((d) => passesThreshold(d, threshold));
}
