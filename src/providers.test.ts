import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import {
  PROVIDER_IDS,
  PROVIDERS,
  TRIGGER_PATTERNS,
  TRIGGER_DOCUMENT_SELECTOR,
  providerForPath,
  expandBraces,
} from "./providers";

// The TRIGGER_PATTERNS ↔ activationEvents drift fence lives in
// src/manifest.test.ts (it groups with the other manifest-shape
// invariants there, including the "no unexpanded braces in
// activationEvents" leg). Don't duplicate it here.

describe("TRIGGER_PATTERNS", () => {
  it("derives a `file`-scoped DocumentFilter for each pattern", () => {
    expect(TRIGGER_DOCUMENT_SELECTOR).toHaveLength(TRIGGER_PATTERNS.length);
    for (const f of TRIGGER_DOCUMENT_SELECTOR) {
      expect(f.scheme).toBe("file");
      expect(typeof f.pattern).toBe("string");
    }
  });
});

describe("expandBraces", () => {
  // Tiny pure helper but it's the seam the manifest drift fence and
  // the glob matcher both rely on. Pin the shapes our patterns
  // actually use plus a couple of edge cases — a regression here
  // would propagate to both the runtime documentSelector and the
  // CI fence at the same time.

  it("returns the input unchanged when there are no braces", () => {
    expect(expandBraces("**/Dockerfile")).toEqual(["**/Dockerfile"]);
    expect(expandBraces("**/Jenkinsfile")).toEqual(["**/Jenkinsfile"]);
  });

  it("expands a single brace group into its alternatives", () => {
    expect(expandBraces("**/.drone.{yml,yaml}")).toEqual([
      "**/.drone.yml",
      "**/.drone.yaml",
    ]);
  });

  it("expands every brace group on the path (cartesian product)", () => {
    // None of our patterns currently use more than one brace, but
    // the helper recurses so multi-brace input should still work.
    // A future pattern (e.g. `**/.{a,b}.{c,d}`) inherits this.
    expect(expandBraces("**/.{a,b}.{c,d}").sort()).toEqual([
      "**/.a.c",
      "**/.a.d",
      "**/.b.c",
      "**/.b.d",
    ]);
  });

  it("handles three-alternative groups", () => {
    expect(expandBraces("**/x.{a,b,c}").sort()).toEqual([
      "**/x.a",
      "**/x.b",
      "**/x.c",
    ]);
  });
});

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

  it("maps the single-file providers (canonical .yml form)", () => {
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

  it("accepts the .yaml variant for every YAML-extension provider (LSP parity)", () => {
    // The upstream LSP's pipeline_check/lsp/detection.py accepts
    // both .yml AND .yaml for these six providers, and our patterns
    // were widened to match (chore: widen file-pattern tolerance).
    // Pin every newly-accepted shape so a future narrowing has to
    // remove these assertions deliberately rather than silently
    // dropping editor coverage on the .yaml variants.
    expect(providerForPath("/repo/.gitlab-ci.yaml")).toBe("gitlab");
    expect(providerForPath("/repo/azure-pipelines.yaml")).toBe("azure");
    expect(providerForPath("/repo/bitbucket-pipelines.yaml")).toBe("bitbucket");
    expect(providerForPath("/repo/.circleci/config.yaml")).toBe("circleci");
    // cloudbuild flips the canonical form: the trigger-table example
    // shows cloudbuild.yaml, but the LSP also accepts cloudbuild.yml.
    expect(providerForPath("/repo/cloudbuild.yml")).toBe("cloud-build");
    expect(providerForPath("/repo/.buildkite/pipeline.yaml")).toBe("buildkite");
  });

  it("groups Dockerfile and Containerfile under the same id", () => {
    expect(providerForPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/Containerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/build/Dockerfile")).toBe("dockerfile");
  });

  it("accepts the suffixed Dockerfile shapes (LSP parity)", () => {
    // The upstream LSP's pipeline_check/lsp/detection.py accepts
    // `Dockerfile.<suffix>` (Dockerfile.alpine, Dockerfile.dev) and
    // `*.Dockerfile` (myapp.Dockerfile) alongside the bare form.
    // Common in monorepos that ship per-target Dockerfiles. Each
    // assertion pins a real-world shape that previously slipped
    // through providerForPath as undefined and got silently dropped
    // by the disabledProviders middleware filter.
    expect(providerForPath("/repo/Dockerfile.alpine")).toBe("dockerfile");
    expect(providerForPath("/repo/Dockerfile.dev")).toBe("dockerfile");
    expect(providerForPath("/repo/Dockerfile.prod")).toBe("dockerfile");
    expect(providerForPath("/repo/myapp.Dockerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/services/api.Dockerfile")).toBe("dockerfile");
    // Lowercase variants land under the same id (Linux users with
    // lowercase build files; same case-insensitive matcher as the
    // bare Dockerfile path).
    expect(providerForPath("/repo/dockerfile.alpine")).toBe("dockerfile");
    expect(providerForPath("/repo/myapp.dockerfile")).toBe("dockerfile");
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

  it("requires `**/<name>` to match on a real segment boundary, not mid-segment", () => {
    // Regression fence: the previous translation of `**` was `.*`,
    // which crosses path separators. `**/Dockerfile` would then match
    // `myDockerfile` (no slash before the `D`), and the
    // disabledProviders middleware filter would silence the wrong file.
    expect(providerForPath("/repo/myDockerfile")).toBeUndefined();
    expect(providerForPath("/repo/notJenkinsfile")).toBeUndefined();
    expect(providerForPath("/repo/foo.github/workflows/ci.yml")).toBeUndefined();
    // Sanity: the proper-segment paths still match.
    expect(providerForPath("Dockerfile")).toBe("dockerfile");
    expect(providerForPath("a/b/Dockerfile")).toBe("dockerfile");
  });

  it("matches Dockerfile and Jenkinsfile case-insensitively", () => {
    // Windows file systems are case-insensitive but preserve the
    // on-disk case in `fsPath`. A user with `dockerfile` (lowercase)
    // or `DOCKERFILE` on disk would otherwise slip through
    // providerForPath as `undefined`, and the disabledProviders
    // middleware filter could not silence them. Same risk on
    // case-insensitive macOS APFS volumes and for users who simply
    // happen to lowercase build files. The match has to follow.
    expect(providerForPath("/repo/dockerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/DOCKERFILE")).toBe("dockerfile");
    expect(providerForPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/jenkinsfile")).toBe("jenkins");
    expect(providerForPath("/repo/JENKINSFILE")).toBe("jenkins");
    expect(providerForPath("/repo/containerfile")).toBe("dockerfile");
    expect(providerForPath("/repo/CONTAINERFILE")).toBe("dockerfile");
  });

  it("matches workflow / config filenames regardless of case", () => {
    expect(providerForPath("/repo/.gitlab-ci.YML")).toBe("gitlab");
    expect(providerForPath("/repo/.GITHUB/workflows/ci.YAML")).toBe(
      "github-actions",
    );
  });
});
