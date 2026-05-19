import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("vscode", () => ({}));

import { TRIGGER_PATTERNS, TRIGGER_DOCUMENT_SELECTOR } from "./providers";

describe("TRIGGER_PATTERNS", () => {
  it("derives a `file`-scoped DocumentFilter for each pattern", () => {
    expect(TRIGGER_DOCUMENT_SELECTOR).toHaveLength(TRIGGER_PATTERNS.length);
    for (const f of TRIGGER_DOCUMENT_SELECTOR) {
      expect(f.scheme).toBe("file");
      expect(typeof f.pattern).toBe("string");
    }
  });

  it("stays in sync with package.json#activationEvents", () => {
    // The manifest cannot import this module (VS Code reads it before
    // any code runs), so the activationEvents list duplicates these
    // patterns. The test below catches the drift before it ships:
    // every TRIGGER_PATTERNS entry must be reachable from at least
    // one `workspaceContains:` event, and every `workspaceContains:`
    // event must correspond to a pattern.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "..", "package.json"), "utf8"),
    ) as { activationEvents: string[] };

    const wsContains = pkg.activationEvents
      .filter((e) => e.startsWith("workspaceContains:"))
      .map((e) => e.slice("workspaceContains:".length));

    // Brace-globs collapse to one DocumentFilter pattern but expand
    // into multiple activationEvents (one per branch). Expand the
    // TRIGGER_PATTERNS list the same way so the comparison is apples
    // to apples.
    const expanded = TRIGGER_PATTERNS.flatMap(expandBraces).sort();
    const events = [...wsContains].sort();
    expect(events).toEqual(expanded);
  });
});

/**
 * Expand a single-brace pattern like `**\/foo.{yml,yaml}` into
 * `["**\/foo.yml", "**\/foo.yaml"]`. Doesn't handle nested braces —
 * good enough for our patterns and trivial to extend if a future
 * pattern needs it.
 */
function expandBraces(pattern: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(pattern);
  if (!match) return [pattern];
  const [, head, body, tail] = match;
  return body.split(",").map((alt) => `${head}${alt}${tail}`);
}
