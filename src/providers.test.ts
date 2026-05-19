import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("vscode", () => ({}));

import {
  PROVIDER_IDS,
  PROVIDERS,
  TRIGGER_PATTERNS,
  TRIGGER_DOCUMENT_SELECTOR,
  providerForPath,
} from "./providers";

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

describe("PROVIDERS map", () => {
  it("covers every entry in PROVIDER_IDS", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id]).toBeDefined();
      expect(PROVIDERS[id].length).toBeGreaterThan(0);
    }
  });

  it("TRIGGER_PATTERNS is the union of every provider's patterns", () => {
    const flattened = PROVIDER_IDS.flatMap((id) => PROVIDERS[id]);
    expect([...TRIGGER_PATTERNS].sort()).toEqual([...flattened].sort());
  });
});

describe("providerForPath", () => {
  it("maps GitHub Actions workflow paths", () => {
    expect(providerForPath("/repo/.github/workflows/release.yml")).toBe(
      "github-actions",
    );
    expect(providerForPath("/repo/.github/workflows/ci.yaml")).toBe(
      "github-actions",
    );
  });

  it("maps the single-file providers", () => {
    expect(providerForPath("/repo/.gitlab-ci.yml")).toBe("gitlab");
    expect(providerForPath("/repo/azure-pipelines.yml")).toBe("azure");
    expect(providerForPath("/repo/bitbucket-pipelines.yml")).toBe("bitbucket");
    expect(providerForPath("/repo/.circleci/config.yml")).toBe("circleci");
    expect(providerForPath("/repo/cloudbuild.yaml")).toBe("cloud-build");
    expect(providerForPath("/repo/.buildkite/pipeline.yml")).toBe("buildkite");
    expect(providerForPath("/repo/.drone.yml")).toBe("drone");
    expect(providerForPath("/repo/.drone.yaml")).toBe("drone");
    expect(providerForPath("/repo/Jenkinsfile")).toBe("jenkins");
  });

  it("groups Dockerfile and Containerfile under the same id", () => {
    expect(providerForPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/Containerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/build/Dockerfile")).toBe("dockerfile");
  });

  it("normalises Windows backslashes before matching", () => {
    expect(providerForPath("C:\\repo\\.github\\workflows\\ci.yml")).toBe(
      "github-actions",
    );
    expect(providerForPath("C:\\repo\\Dockerfile")).toBe("dockerfile");
  });

  it("returns undefined for unmatched paths", () => {
    expect(providerForPath("/repo/package.json")).toBeUndefined();
    expect(providerForPath("/repo/mkdocs.yml")).toBeUndefined();
    expect(providerForPath("/repo/values.yaml")).toBeUndefined();
  });
});
