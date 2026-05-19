import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { transformDiagnostics, type DiagnosticConfig } from "./middleware";

// Minimal Diagnostic-shaped objects. The real vscode.Diagnostic
// carries much more, but transformDiagnostics + filterByThreshold
// only read `data.severity` and the array shape — anything else is
// passed through untouched.
function diag(severity: string | undefined, message = "x"): unknown {
  return severity === undefined
    ? { message, data: {} }
    : { message, data: { severity } };
}

// Mirror the URI shape providerForPath consumes: `.fsPath` is the
// only field it reads.
function uri(path: string) {
  return { fsPath: path } as unknown as Parameters<typeof transformDiagnostics>[0];
}

const NO_FILTERS: DiagnosticConfig = {
  disabledProviders: [],
  severityThreshold: "low",
};

describe("transformDiagnostics", () => {
  // The two stages compose: disabled-provider wins over the severity
  // filter (blanket drop) when both apply; severity filter applies to
  // the survivors otherwise. Tests pin both individual stages AND the
  // composition — neither piece is interesting on its own but their
  // ordering changes the user-visible behaviour.

  it("passes diagnostics through unchanged when neither filter applies", () => {
    const ds = [diag("HIGH"), diag("MEDIUM"), diag("LOW")];
    expect(
      transformDiagnostics(
        uri("/repo/.gitlab-ci.yml"),
        ds as never,
        NO_FILTERS,
      ),
    ).toEqual(ds);
  });

  describe("disabledProviders stage", () => {
    it("drops every diagnostic for a URI whose provider is disabled", () => {
      // gitlab disabled → blanket empty.
      expect(
        transformDiagnostics(
          uri("/repo/.gitlab-ci.yml"),
          [diag("CRITICAL"), diag("HIGH")] as never,
          { disabledProviders: ["gitlab"], severityThreshold: "low" },
        ),
      ).toEqual([]);
    });

    it("returns an EMPTY ARRAY (not a passthrough skip) so the publish still propagates", () => {
      // The middleware caller relies on `next(uri, [])` to wake up
      // consumers like the Findings tree — a same-URI publish with
      // zero diagnostics still triggers a refresh, which clears any
      // stale leaves from a now-disabled file.
      const result = transformDiagnostics(
        uri("/repo/.gitlab-ci.yml"),
        [diag("CRITICAL")] as never,
        { disabledProviders: ["gitlab"], severityThreshold: "low" },
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("leaves OTHER providers' diagnostics alone when only one is disabled", () => {
      // Dockerfile disabled but the URI is a GHA workflow — should
      // pass through unchanged.
      const ds = [diag("HIGH")];
      expect(
        transformDiagnostics(
          uri("/repo/.github/workflows/ci.yml"),
          ds as never,
          { disabledProviders: ["dockerfile"], severityThreshold: "low" },
        ),
      ).toEqual(ds);
    });

    it("matches lowercase Dockerfile / Jenkinsfile (providerForPath is case-insensitive)", () => {
      // Regression fence for the high-severity fix: a Windows user
      // with `dockerfile` (lowercase) on disk would otherwise slip
      // past the disable filter.
      expect(
        transformDiagnostics(
          uri("/repo/dockerfile"),
          [diag("CRITICAL")] as never,
          { disabledProviders: ["dockerfile"], severityThreshold: "low" },
        ),
      ).toEqual([]);
      expect(
        transformDiagnostics(
          uri("/repo/JENKINSFILE"),
          [diag("CRITICAL")] as never,
          { disabledProviders: ["jenkins"], severityThreshold: "low" },
        ),
      ).toEqual([]);
    });

    it("ignores unknown provider IDs in the config without affecting other rows", () => {
      // VS Code's JSON schema enforces the enum, but a manual edit
      // can sneak through. An unknown ID must not silently drop
      // unrelated diagnostics.
      const ds = [diag("HIGH")];
      expect(
        transformDiagnostics(
          uri("/repo/.gitlab-ci.yml"),
          ds as never,
          { disabledProviders: ["nope"], severityThreshold: "low" },
        ),
      ).toEqual(ds);
    });

    it("disables both dockerfile and containerfile under the single 'dockerfile' provider id", () => {
      // Containerfile and Dockerfile share a provider entry; the
      // disable knob silences both with one setting.
      const result1 = transformDiagnostics(
        uri("/repo/Containerfile"),
        [diag("CRITICAL")] as never,
        { disabledProviders: ["dockerfile"], severityThreshold: "low" },
      );
      expect(result1).toEqual([]);
    });
  });

  describe("severityThreshold stage", () => {
    it("drops diagnostics strictly below the threshold", () => {
      const result = transformDiagnostics(
        uri("/repo/.github/workflows/ci.yml"),
        [
          diag("CRITICAL"),
          diag("HIGH"),
          diag("MEDIUM"),
          diag("LOW"),
        ] as never,
        { disabledProviders: [], severityThreshold: "high" },
      );
      expect(
        result.map(
          (d) =>
            (d as unknown as { data: { severity: string } }).data.severity,
        ),
      ).toEqual(["CRITICAL", "HIGH"]);
    });

    it("preserves order across the filter (no in-place mutation surfaces)", () => {
      const ds = [
        diag("HIGH", "first"),
        diag("LOW", "skipped"),
        diag("CRITICAL", "third"),
      ];
      const result = transformDiagnostics(
        uri("/repo/.github/workflows/ci.yml"),
        ds as never,
        { disabledProviders: [], severityThreshold: "medium" },
      );
      expect(result.map((d) => (d as { message: string }).message)).toEqual([
        "first",
        "third",
      ]);
      // Source list is untouched.
      expect(ds).toHaveLength(3);
    });

    it("never drops a diagnostic whose data.severity is missing", () => {
      // The first-line-of-defence invariant: missing metadata = pass.
      // Otherwise a server upgrade that briefly publishes without
      // `data` would blank the editor.
      const result = transformDiagnostics(
        uri("/repo/.github/workflows/ci.yml"),
        [diag(undefined)] as never,
        { disabledProviders: [], severityThreshold: "critical" },
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("filter composition (the user-visible behaviour)", () => {
    it("when a provider is disabled, the severity threshold is irrelevant — blanket drop", () => {
      // The disabled-provider stage runs first; if it bites, the
      // severity threshold is never consulted. A CRITICAL finding on
      // a disabled provider still vanishes from the editor.
      const result = transformDiagnostics(
        uri("/repo/.gitlab-ci.yml"),
        [diag("CRITICAL")] as never,
        { disabledProviders: ["gitlab"], severityThreshold: "low" },
      );
      expect(result).toEqual([]);
    });

    it("when the provider is allowed, only the severity stage filters", () => {
      const result = transformDiagnostics(
        uri("/repo/.github/workflows/ci.yml"),
        [diag("CRITICAL"), diag("LOW")] as never,
        { disabledProviders: ["gitlab"], severityThreshold: "high" },
      );
      expect(result).toHaveLength(1);
      expect(
        (result[0] as unknown as { data: { severity: string } }).data
          .severity,
      ).toBe("CRITICAL");
    });

    it("URI that maps to NO provider always bypasses the disable stage", () => {
      // Random YAML that we wouldn't have published in the first
      // place; the LSP-side filter should have caught it. Defensive
      // here: providerForPath returns undefined → the disable filter
      // is a no-op even when the config lists every provider.
      const ds = [diag("CRITICAL")];
      const result = transformDiagnostics(
        uri("/repo/random.yml"),
        ds as never,
        {
          disabledProviders: [
            "github-actions",
            "gitlab",
            "azure",
            "bitbucket",
            "circleci",
            "cloud-build",
            "buildkite",
            "drone",
            "jenkins",
            "dockerfile",
          ],
          severityThreshold: "low",
        },
      );
      expect(result).toEqual(ds);
    });
  });
});
