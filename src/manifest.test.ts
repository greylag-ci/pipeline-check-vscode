import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// No vscode runtime touched here — the manifest is pure JSON.
vi.mock("vscode", () => ({}));

import { LSP_READY_CONTEXT_KEY } from "./lspState";

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

interface Manifest {
  readonly contributes: {
    readonly viewsWelcome: ManifestViewsWelcome[];
    readonly commands: ManifestCommand[];
  };
  readonly activationEvents: string[];
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
