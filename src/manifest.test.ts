import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// No vscode runtime touched here — the manifest is pure JSON.
vi.mock("vscode", () => ({}));

import { LSP_READY_CONTEXT_KEY } from "./lspState";
import { expandBraces, PROVIDER_IDS, TRIGGER_PATTERNS } from "./providers";

interface ManifestViewsWelcome {
  readonly view: string;
  readonly contents: string;
  readonly when?: string;
}

interface ManifestCommand {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

interface ManifestConfigurationProperty {
  readonly type: string | string[];
  readonly items?: { readonly type: string; readonly enum?: string[] };
  readonly enum?: string[];
  readonly default?: unknown;
}

interface Manifest {
  readonly contributes: {
    readonly viewsWelcome: ManifestViewsWelcome[];
    readonly commands: ManifestCommand[];
    readonly configuration: {
      readonly properties: Record<string, ManifestConfigurationProperty>;
    };
  };
  readonly activationEvents: string[];
  readonly keywords: string[];
  readonly capabilities?: {
    readonly untrustedWorkspaces?: { readonly supported: string };
    readonly virtualWorkspaces?: boolean;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf8"),
) as Manifest;

const welcome = manifest.contributes.viewsWelcome;

describe("viewsWelcome — conditional install/scan/upgrade panels", () => {
  // The findings panel ships THREE welcome entries — one for the
  // ready state (scan workspace), one for the missing-engine state
  // (install prompt), and one for the out-of-date engine state
  // (upgrade prompt). The three `when` clauses MUST be mutually
  // exclusive so VS Code never renders two banners simultaneously.
  // These tests pin both the count and the gating expressions so a
  // future edit can't collapse them.

  it("contributes exactly three entries on the findings view", () => {
    const onFindings = welcome.filter(
      (w) => w.view === "pipelineCheck.findings",
    );
    expect(onFindings).toHaveLength(3);
  });

  it("gates the ready entry behind the LSP-ready context key", () => {
    const ready = welcome.find(
      (w) => w.when === LSP_READY_CONTEXT_KEY,
    );
    expect(ready, "ready-state welcome entry missing").toBeDefined();
  });

  it("gates the install-prompt entry on '!lspReady && !engineOutOfDate'", () => {
    // The compound expression is what keeps install-prompt and
    // upgrade-prompt mutually exclusive. A regression here would
    // surface both banners when the engine is too old.
    const notReady = welcome.find(
      (w) =>
        w.when ===
        `!${LSP_READY_CONTEXT_KEY} && !pipelineCheck.engineOutOfDate`,
    );
    expect(notReady, "install-prompt welcome entry missing").toBeDefined();
  });

  it("gates the upgrade-prompt entry on the engineOutOfDate key", () => {
    const upgrade = welcome.find(
      (w) => w.when === "pipelineCheck.engineOutOfDate",
    );
    expect(upgrade, "upgrade-prompt welcome entry missing").toBeDefined();
  });

  it("upgrade entry promotes 'Upgrade in terminal' as its primary CTA", () => {
    const upgrade = welcome.find(
      (w) => w.when === "pipelineCheck.engineOutOfDate",
    );
    expect(upgrade?.contents).toMatch(
      /^\[Upgrade in terminal\]\(command:pipelineCheck\.upgradeInTerminal\)$/m,
    );
  });

  it("ready entry promotes 'Scan workspace' as the primary CTA", () => {
    // A button-styled link is a markdown link alone on its line. The
    // contents string uses literal \n separators, so the regex below
    // matches the line shape directly.
    const ready = welcome.find((w) => w.when === LSP_READY_CONTEXT_KEY);
    expect(ready?.contents).toMatch(
      /^\[Scan workspace\]\(command:pipelineCheck\.scanWorkspace\)$/m,
    );
  });

  it("install-prompt entry exposes 'Install in terminal' as the primary CTA", () => {
    const notReady = welcome.find(
      (w) =>
        w.when ===
        `!${LSP_READY_CONTEXT_KEY} && !pipelineCheck.engineOutOfDate`,
    );
    expect(notReady?.contents).toMatch(
      /^\[Install in terminal\]\(command:pipelineCheck\.installInTerminal\)$/m,
    );
  });

  it("install-prompt entry offers 'Retry connection' as a secondary CTA", () => {
    const notReady = welcome.find(
      (w) =>
        w.when ===
        `!${LSP_READY_CONTEXT_KEY} && !pipelineCheck.engineOutOfDate`,
    );
    expect(notReady?.contents).toMatch(
      /^\[Retry connection\]\(command:pipelineCheck\.restart\)$/m,
    );
  });

  it("install-prompt entry references pipeline-check[lsp] so users know what to install", () => {
    const notReady = welcome.find(
      (w) =>
        w.when ===
        `!${LSP_READY_CONTEXT_KEY} && !pipelineCheck.engineOutOfDate`,
    );
    expect(notReady?.contents).toContain("pipeline-check[lsp]");
  });

  it("ready entry tells users about the keyboard navigation shortcuts", () => {
    // Alt+F8 / Shift+Alt+F8 is the navigation surface; users
    // typically discover it through this welcome screen. Pinning the
    // text guards against a regression that strips the discoverability.
    const ready = welcome.find((w) => w.when === LSP_READY_CONTEXT_KEY);
    expect(ready?.contents).toContain("Alt+F8");
    expect(ready?.contents).toContain("Shift+Alt+F8");
  });

  it("neither entry surfaces 'Copy install command' as a primary button (the rejected UX)", () => {
    // Copy-install-command is still registered for headless flows but
    // must NOT appear as a top-level button in either welcome state.
    // The rework was specifically about this CTA being out of place.
    for (const w of welcome.filter(
      (e) => e.view === "pipelineCheck.findings",
    )) {
      expect(w.contents).not.toMatch(
        /^\[Copy install command\]/m,
      );
    }
  });
});

describe("commands — install paths registered", () => {
  // The welcome panel references both `installInTerminal` and
  // `copyInstallCommand`. These tests guard against a manifest edit
  // that removes a command the welcome panel still tries to invoke.

  const commands = new Set(
    manifest.contributes.commands.map((c) => c.command),
  );

  it("declares pipelineCheck.installInTerminal", () => {
    expect(commands.has("pipelineCheck.installInTerminal")).toBe(true);
  });

  it("declares pipelineCheck.copyInstallCommand", () => {
    expect(commands.has("pipelineCheck.copyInstallCommand")).toBe(true);
  });

  it("declares every command the welcome panels link to", () => {
    // Extract every `command:pipelineCheck.…` link target from the
    // welcome contents and confirm each one is a declared command.
    for (const w of welcome.filter(
      (e) => e.view === "pipelineCheck.findings",
    )) {
      // Dotted command IDs (e.g. `pipelineCheck.findings.refresh`) need
      // `.` in the class — otherwise the match stops at the first dot
      // and a future welcome edit linking to a dotted command would slip
      // past this regression fence.
      const targets = [...w.contents.matchAll(/command:(pipelineCheck\.[A-Za-z.]+)/g)]
        .map((m) => m[1]);
      for (const target of targets) {
        expect(
          commands.has(target),
          `welcome panel links to ${target} but it is not in contributes.commands`,
        ).toBe(true);
      }
    }
  });
});

describe("capabilities — locked-down workspace trust", () => {
  // Pipeline-Check spawns a Python child process; this MUST stay
  // declared as 'limited' for untrusted workspaces so VS Code's
  // workspace-trust gate kicks in for the process-spawning settings.
  it("declares untrustedWorkspaces.supported = 'limited'", () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(
      "limited",
    );
  });

  it("declares virtualWorkspaces = false", () => {
    expect(manifest.capabilities?.virtualWorkspaces).toBe(false);
  });
});

// ─── disabledProviders enum sync ────────────────────────────────────

// The set of providers the upstream LSP's `supported_providers()`
// dispatch table emits diagnostics for, mapped onto the extension's
// internal provider IDs. Pinned here so a future widening upstream
// (a new single-file provider like `harness` or `devenv` joining
// `pipeline_check/lsp/scan.py`) forces an explicit local update of
// PROVIDER_IDS + the manifest enum + this list — rather than silently
// drifting and leaving users with diagnostics they can't disable.
//
// Name mapping: `github` → `github-actions`, `cloudbuild` → `cloud-build`;
// everything else is the identity.
const LSP_SUPPORTED_PROVIDER_IDS = [
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
] as const;

describe("disabledProviders — enum in lockstep with PROVIDER_IDS and the LSP", () => {
  // Three surfaces must agree on the same provider-id list:
  //
  //   1. The manifest's `pipelineCheck.disabledProviders` enum
  //      (user-visible Settings UI dropdown).
  //   2. `PROVIDER_IDS` from src/providers.ts (drives the
  //      middleware filter `providerForPath`).
  //   3. The upstream LSP's `supported_providers()` set in
  //      pipeline_check/lsp/scan.py (what the engine actually scans).
  //
  // A drift between #1 and #2 means the Settings UI lets the user
  // pick a provider the middleware doesn't recognise (the filter is
  // a no-op for unknown IDs, so the user's intent is silently
  // dropped). A drift between #2 and #3 means we're either filtering
  // for a provider the LSP never publishes, or we have no path to
  // silence diagnostics from a provider the LSP DOES publish. Both
  // failure modes are silent without these fences.

  const disabledProvidersSchema =
    manifest.contributes.configuration.properties[
      "pipelineCheck.disabledProviders"
    ];
  const manifestEnum = disabledProvidersSchema?.items?.enum ?? [];

  it("declares the disabledProviders setting as an array with an enum", () => {
    // Pin the shape so a future edit that drops the enum (turning
    // the setting into a free-form string list) trips this test
    // and forces a deliberate decision.
    expect(disabledProvidersSchema?.type).toBe("array");
    expect(disabledProvidersSchema?.items?.type).toBe("string");
    expect(manifestEnum.length).toBeGreaterThan(0);
  });

  it("manifest enum matches PROVIDER_IDS exactly (no drift in either direction)", () => {
    // toSorted'd comparison so the test fails with a readable
    // symmetric-difference even if the orderings drifted.
    expect([...manifestEnum].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("PROVIDER_IDS matches the upstream LSP's supported set (drift fence)", () => {
    // When upstream pipeline_check widens `supported_providers()` —
    // e.g. adding `harness` or `devenv` — update
    // LSP_SUPPORTED_PROVIDER_IDS above (and PROVIDER_IDS + the
    // manifest enum) in the same commit. This test fires LOUDLY so
    // the change can't slip in silently and leave users unable to
    // disable diagnostics for the new provider.
    expect([...PROVIDER_IDS].sort()).toEqual(
      [...LSP_SUPPORTED_PROVIDER_IDS].sort(),
    );
  });

  it("default is an empty array (no provider silenced out of the box)", () => {
    // A non-empty default would surprise users — installing the
    // extension shouldn't silence anything.
    expect(disabledProvidersSchema?.default).toEqual([]);
  });
});

// ─── keywords reflect what the LSP actually scans ───────────────────

describe("keywords — marketplace search relevance matches scanned providers", () => {
  // Marketplace search ranks by keyword relevance. Listing providers
  // we don't actually scan in-editor (e.g. `terraform`, `kubernetes`,
  // `helm`, `cloudformation` — the multi-file context-heavy providers
  // explicitly deferred per the README) misleads users searching for
  // those terms: they install the extension, open a Terraform file,
  // see no findings, and bounce. Keep the keyword list aligned with
  // PROVIDER_IDS (loosely — keyword spelling can differ from the
  // internal ID, e.g. `github-actions` vs `github`).

  it("does not include providers the LSP doesn't scan", () => {
    // The set the LSP intentionally doesn't dispatch to (per
    // pipeline_check/lsp/scan.py's leading comment): multi-file
    // / context-heavy providers. If we ever start scanning these
    // in-editor, drop them from this list AND add them to the
    // disabledProviders enum + PROVIDER_IDS in the same commit.
    const NOT_SCANNED_IN_EDITOR = [
      "terraform",
      "cloudformation",
      "kubernetes",
      "helm",
      "aws",
    ];
    for (const k of NOT_SCANNED_IN_EDITOR) {
      expect(
        manifest.keywords,
        `keyword '${k}' is for a provider the LSP doesn't scan — marketplace searchers will install and see no findings`,
      ).not.toContain(k);
    }
  });

  it("includes the broad CI/CD discovery terms", () => {
    // `ci` / `cd` / `security` / `pipeline` are the high-value
    // generic searches. Pin them so a marketplace-polish pass
    // doesn't accidentally strip the discoverability terms.
    for (const k of ["ci", "cd", "security", "pipeline"]) {
      expect(manifest.keywords).toContain(k);
    }
  });
});

// ─── activationEvents in lockstep with TRIGGER_PATTERNS ─────────────

describe("activationEvents — exact expansion of TRIGGER_PATTERNS", () => {
  // Two surfaces describe the same set of files the extension cares
  // about:
  //
  //   1. `TRIGGER_PATTERNS` in src/providers.ts — drives the LSP
  //      `documentSelector`, the workspace-scan command, and the
  //      middleware filter via `providerForPath`.
  //   2. `activationEvents` in package.json — VS Code's gate for
  //      waking the extension up when a matching file is present.
  //
  // VS Code's `workspaceContains:` grammar does NOT support brace
  // expansion: `workspaceContains:**/foo.{yml,yaml}` is a literal
  // string match and won't fire on either extension. So
  // `activationEvents` must explicitly enumerate every expanded
  // form of `TRIGGER_PATTERNS` (brace-expanded), each prefixed with
  // `workspaceContains:`.
  //
  // A drift here is silent: the extension simply doesn't wake up
  // when the user opens a `.gitlab-ci.yaml` file, the file never
  // reaches the LSP, and the user sees no findings. This test
  // closes that gap by failing CI on any divergence.

  const workspaceContainsEvents = manifest.activationEvents
    .filter((e) => e.startsWith("workspaceContains:"))
    .map((e) => e.slice("workspaceContains:".length));

  const expectedActivationPatterns = [...TRIGGER_PATTERNS].flatMap(
    expandBraces,
  );

  it("activationEvents enumerates exactly the brace-expanded TRIGGER_PATTERNS", () => {
    // Sorted symmetric-difference comparison so a missing OR an
    // extra activationEvent both surface readably.
    expect([...workspaceContainsEvents].sort()).toEqual(
      [...expectedActivationPatterns].sort(),
    );
  });

  it("no activationEvent carries unexpanded braces (VS Code treats them as literal)", () => {
    // Defence against a future paste-back where someone copies a
    // brace-form pattern in. VS Code would match the literal text
    // and silently never activate.
    for (const event of workspaceContainsEvents) {
      expect(
        event,
        `activationEvent '${event}' carries unexpanded braces — VS Code does not brace-expand workspaceContains:`,
      ).not.toMatch(/\{[^{}]+\}/);
    }
  });
});

// ─── enumDescriptions length parity ─────────────────────────────────

describe("enumDescriptions — every settings enum has same-length descriptions", () => {
  // VS Code's Settings UI renders the description for `enum[i]` from
  // `enumDescriptions[i]`. A length mismatch silently drops the tail —
  // either the user sees a raw provider ID with no explanation, or
  // (worse) sees the description for the WRONG enum value because the
  // array indexes shifted. Pin both arrays the same length per
  // setting.

  const PROPERTIES = manifest.contributes.configuration.properties;

  type EnumProperty = {
    readonly key: string;
    readonly enum: readonly string[];
    readonly enumDescriptions: readonly string[] | undefined;
  };

  function collectEnumProperties(): EnumProperty[] {
    const out: EnumProperty[] = [];
    for (const [key, prop] of Object.entries(PROPERTIES)) {
      // Schema reaches `enum` either directly (string setting) or
      // under `items` (array-of-string setting). Both shapes need
      // length-parity with their sibling `enumDescriptions`.
      // `enumDescriptions` is a VS Code extension to JSON Schema not
      // captured by the local Manifest interface; widen via `unknown`
      // to read it without expanding the interface.
      const raw = prop as unknown as Record<string, unknown>;
      const direct = raw.enum;
      const directDescs = raw.enumDescriptions;
      if (Array.isArray(direct)) {
        out.push({
          key,
          enum: direct as string[],
          enumDescriptions: Array.isArray(directDescs)
            ? (directDescs as string[])
            : undefined,
        });
      }
      const items = raw.items as Record<string, unknown> | undefined;
      if (items && Array.isArray(items.enum)) {
        out.push({
          key: `${key}.items`,
          enum: items.enum as string[],
          enumDescriptions: Array.isArray(items.enumDescriptions)
            ? (items.enumDescriptions as string[])
            : undefined,
        });
      }
    }
    return out;
  }

  const enumProperties = collectEnumProperties();

  it("collects at least one enum-bearing setting (sanity check on the walker)", () => {
    // A future schema rewrite that hides enums behind `oneOf` /
    // `anyOf` would silently return zero from the walker and the
    // length-parity check would pass vacuously. Pin the floor.
    expect(enumProperties.length).toBeGreaterThanOrEqual(3);
  });

  for (const { key, enum: values, enumDescriptions } of enumProperties) {
    it(`${key}: enumDescriptions length matches enum length (or is absent)`, () => {
      if (enumDescriptions === undefined) {
        // Absent enumDescriptions is allowed — the UI falls back to
        // the raw enum value. The failure mode this test guards
        // against is a LENGTH MISMATCH, not a missing array.
        return;
      }
      expect(
        enumDescriptions.length,
        `${key}: enum has ${values.length} entries but enumDescriptions has ${enumDescriptions.length}`,
      ).toBe(values.length);
    });
  }
});
