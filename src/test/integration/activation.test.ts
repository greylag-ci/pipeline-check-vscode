// Integration tests booted by @vscode/test-electron. These run inside
// a real extension host, so `vscode` is the genuine namespace — no
// stubs, no vi.mock. The unit-test suite (vitest, src/*.test.ts)
// covers pure logic; this file covers the contracts that only a live
// VS Code can verify: extension activation, command registration,
// view registration, configuration schema correctness.
//
// The workspace under test is `test-fixtures/sample-workflow/` (set
// in .vscode-test.mjs). Opening it triggers our `workspaceContains:`
// activation event because of the `.github/workflows/*.yml` fixture
// inside.

import assert from "node:assert";
import * as vscode from "vscode";

const EXTENSION_ID = "greylag-ci.pipeline-check";

suite("Pipeline-Check — activation", () => {
  test("extension is installed and activates", async function () {
    // VS Code's first boot in a CI environment can be slow.
    this.timeout(15000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext, `extension ${EXTENSION_ID} not found`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "extension failed to activate");
  });

  test("contributes every command declared in package.json", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    await ext.activate();
    const registered = await vscode.commands.getCommands(true);
    const expected = [
      "pipelineCheck.restart",
      "pipelineCheck.showLog",
      "pipelineCheck.copyInstallCommand",
      "pipelineCheck.installInTerminal",
      "pipelineCheck.upgradeInTerminal",
      "pipelineCheck.scanWorkspace",
      "pipelineCheck.findings.refresh",
      "pipelineCheck.findings.changeGrouping",
      "pipelineCheck.findings.toggleSeverity",
      "pipelineCheck.findings.filter",
      "pipelineCheck.findings.copyRuleId",
      "pipelineCheck.findings.openRuleDocs",
      "pipelineCheck.findings.openNonPreview",
      "pipelineCheck.goToNextFinding",
      "pipelineCheck.goToPreviousFinding",
    ];
    for (const cmd of expected) {
      assert.ok(
        registered.includes(cmd),
        `command ${cmd} did not register`,
      );
    }
  });

  test("Findings view is registered under the Pipeline-Check container", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    await ext.activate();
    // VS Code's `<viewId>.focus` command is auto-generated for every
    // registered view. The presence of the command is a proxy for
    // "the view registered" without needing private API.
    const registered = await vscode.commands.getCommands(true);
    assert.ok(
      registered.includes("pipelineCheck.findings.focus"),
      "Findings view did not register (pipelineCheck.findings.focus missing)",
    );
  });

  test("configuration schema exposes every documented setting", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    await ext.activate();
    const config = vscode.workspace.getConfiguration("pipelineCheck");
    // `inspect` returns metadata about a setting; defaults from the
    // package.json schema flow through this API. Used here as a
    // smoke-test that the manifest contributions deserialised.
    for (const key of [
      "serverCommand",
      "serverArgs",
      "severityThreshold",
      "disabledProviders",
      "codeLens.enabled",
      "scanOnSave",
      "trace.server",
    ]) {
      const info = config.inspect(key);
      assert.ok(
        info !== undefined,
        `setting pipelineCheck.${key} is not in the schema`,
      );
    }
  });

  test("untrustedWorkspaces capability is declared as 'limited'", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    const caps = ext.packageJSON.capabilities;
    assert.ok(caps, "capabilities block missing from package.json");
    assert.strictEqual(
      caps.untrustedWorkspaces?.supported,
      "limited",
      "untrustedWorkspaces.supported is not 'limited'",
    );
    assert.strictEqual(
      caps.virtualWorkspaces,
      false,
      "virtualWorkspaces should be false (extension spawns a child process)",
    );
  });

  test("scanWorkspace finds the fixture's workflow file in a real workspace", async function () {
    // Regression fence for the nested-brace findFiles bug that
    // produced "no scannable files found" even with workflows present.
    // The unit suite pins findScannableFiles' shape; this test runs
    // the whole command against a real VS Code findFiles to confirm
    // the actual glob resolution finds the fixture.
    this.timeout(15000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    await ext.activate();

    // The workspace is `test-fixtures/sample-workflow/` (set in
    // .vscode-test.mjs). It contains `.github/workflows/release.yml`.
    // Verify findFiles independently — same call shape scanWorkspace
    // uses internally — and confirm at least one workflow shows up.
    const found = await vscode.workspace.findFiles(
      "**/.github/workflows/*.{yml,yaml}",
      "**/{node_modules,.git}/**",
    );
    assert.ok(
      found.some((u) => u.fsPath.endsWith("release.yml")),
      `findFiles missed the fixture workflow: ${found.map((u) => u.fsPath).join(", ")}`,
    );

    // The command itself should resolve without throwing. The LSP
    // child may not be running in CI (Python is not necessarily on
    // PATH); the scan walk is independent of the LSP — it just opens
    // documents so the (running or not) server sees them. The
    // assertion is the negative one: no exception.
    await vscode.commands.executeCommand("pipelineCheck.scanWorkspace");
  });

  test("workspace-trust capability blocks workspace-overridable settings without an explicit prompt", () => {
    // serverCommand and serverArgs spawn a child process; the manifest
    // declares both as `machine-overridable` so a workspace cannot
    // silently override them. Pinned here so a future schema edit
    // that demotes their scope can't slip through review.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    const props = ext.packageJSON.contributes?.configuration?.properties as
      | Record<string, { scope?: string }>
      | undefined;
    assert.ok(props, "configuration.properties missing from package.json");
    assert.strictEqual(
      props["pipelineCheck.serverCommand"]?.scope,
      "machine-overridable",
      "pipelineCheck.serverCommand must stay machine-overridable",
    );
    assert.strictEqual(
      props["pipelineCheck.serverArgs"]?.scope,
      "machine-overridable",
      "pipelineCheck.serverArgs must stay machine-overridable",
    );
  });

  test("viewsWelcome contributes scan-ready, install-prompt, and upgrade-prompt entries", () => {
    // v1.1.0 added a third welcome entry for the engine-out-of-date
    // case so the panel can promote the Upgrade action instead of the
    // generic Install one. The three when clauses must remain mutually
    // exclusive so VS Code never renders two banners at once; the
    // unit-suite mirror in src/manifest.test.ts pins the full
    // expression shape, this integration test just verifies the live
    // manifest contributes all three.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert(ext);
    const welcome = ext.packageJSON.contributes?.viewsWelcome as
      | Array<{ view: string; when?: string }>
      | undefined;
    assert.ok(welcome, "viewsWelcome block missing from package.json");
    const onFindings = welcome.filter(
      (w) => w.view === "pipelineCheck.findings",
    );
    assert.strictEqual(
      onFindings.length,
      3,
      "findings view should have three viewsWelcome entries (ready + install-prompt + upgrade-prompt)",
    );
    assert.ok(
      onFindings.some((w) => w.when === "pipelineCheck.lspReady"),
      "missing ready-state welcome entry",
    );
    assert.ok(
      onFindings.some(
        (w) =>
          w.when ===
          "!pipelineCheck.lspReady && !pipelineCheck.engineOutOfDate",
      ),
      "missing install-prompt welcome entry",
    );
    assert.ok(
      onFindings.some((w) => w.when === "pipelineCheck.engineOutOfDate"),
      "missing upgrade-prompt welcome entry",
    );
  });
});
