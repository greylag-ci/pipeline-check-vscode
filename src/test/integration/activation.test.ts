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
      "pipelineCheck.scanWorkspace",
      "pipelineCheck.findings.refresh",
      "pipelineCheck.findings.changeGrouping",
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
});
