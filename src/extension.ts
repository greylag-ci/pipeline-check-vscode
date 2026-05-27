// Entry point for the Pipeline-Check VS Code extension.
//
// All this client does is spawn `python -m pipeline_check.lsp` over stdio
// and bridge it to VS Code's LanguageClient. Every rule decision, every
// hover prose string, and every diagnostic comes from the Python server
// — the TypeScript side stays a thin transport adapter so the editor
// findings match `pipeline_check --output json` byte-for-byte (modulo
// position translation).
//
// The server itself lives upstream in `dmartinochoa/pipeline-check`
// under `pipeline_check/lsp/`; install via `python -m pip install
// "pipeline-check[lsp]"`.

import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
  TransportKind,
} from "vscode-languageclient/node";
import { PipelineCheckCodeActionProvider } from "./codeActions";
import { FindingsCodeLensProvider } from "./codeLens";
import { checkForEngineUpdate } from "./engineUpdates";
import { FindingsTreeProvider } from "./findingsView";
import {
  copyInstallCommandToClipboard,
  installInTerminal,
  upgradeInTerminal,
} from "./install";
import * as clientLog from "./log";
import { startWithTimeout } from "./lspStart";
import { setEngineOutOfDate, setLspReady } from "./lspState";
import { transformDiagnostics } from "./middleware";
import { goToFinding } from "./navigate";
import {
  PreflightError,
  runPreflight,
  shouldPreflight,
} from "./preflight";
import {
  providerForPath,
  TRIGGER_DOCUMENT_SELECTOR,
} from "./providers";
import { changeGrouping, toggleSeverity } from "./quickPicks";
import { createScanOnSaveHandler } from "./scanOnSave";
import { registerStatusBar, setEngineVersion } from "./statusBar";
import { scanWorkspace } from "./workspaceScan";
import { showWhatsNewIfUpgraded } from "./whatsNew";

/**
 * Wrapper around `scanWorkspace()` for the two user-fired commands
 * (`Scan workspace` and `Refresh findings`). `scanWorkspace` re-throws
 * if `findScannableFiles` rejects (workspace closed mid-scan, fs error
 * before the loop is set up); without this wrapper, the command's
 * rejected promise lands as a generic "Command 'X' resulted in an
 * error" toast divorced from the click. The wrapper writes a real
 * breadcrumb to the log and shows a Pipeline-Check-branded toast so
 * the user can act on the failure.
 *
 * Per-file errors during the loop are already counted as `failed` and
 * surfaced through `formatSummary`; this path is strictly for failures
 * that prevent the scan from running at all.
 */
async function runScanCommand(): Promise<void> {
  try {
    await scanWorkspace();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    clientLog.error(`scan: failed to start — ${message}`);
    void vscode.window.showErrorMessage(
      `Pipeline-Check: scan could not start — ${message}`,
    );
  }
}

const LANGUAGE_ID = "pipelineCheck";
const LANGUAGE_NAME = "Pipeline-Check";
const OUTPUT_CHANNEL = "Pipeline-Check";

// `setStatusBarMessage` TTL for transient confirmations (clipboard
// writes, etc.). Two seconds is long enough to be readable and short
// enough that a stream of copies doesn't pile up.
const CONFIRM_TTL_MS = 2000;

// Structural shape of a Findings-tree leaf node, used by the
// context-menu commands. The real LeafNode lives in findingsView.ts;
// duplicating just the fields the commands read keeps extension.ts
// independent of the tree's internal type definitions.
type LeafLike = {
  readonly finding?: {
    readonly ruleId?: string;
    readonly docsUrl?: string;
    readonly uri?: vscode.Uri;
    readonly diagnostic?: { readonly range?: vscode.Range };
  };
};

let client: LanguageClient | undefined;
// Disposable for the onDidChangeState listener registered against the
// current `client`. We hang on to it so `stopClient` can dispose it
// before the next `startClient` builds a fresh listener — otherwise a
// crash on the previous client would still fire into our handler and
// flip `lspReady` against the live client.
let clientStateChangeDisposable: vscode.Disposable | undefined;
// Captured at activate() so startClient (and any restart triggered
// later) can reach globalState for the engine-update check without
// the activate→startClient call having to plumb it through every
// internal hop. Cleared on deactivate.
let extensionContext: vscode.ExtensionContext | undefined;
// Hard ceiling on how long `client.start()` is allowed to run before
// we treat the LSP as broken. Without this, a `serverArgs: []`
// (configured Python interpreter drops into the REPL waiting on
// stdin), or any Python interpreter that hangs during module import,
// leaves `activate()` pending forever — the install-prompt welcome
// panel stays up and the user has no way to know the difference
// between "LSP is slow" and "LSP will never come up". 30 s is well
// above the cold-start budget on Windows (where pyc compilation can
// add several seconds the first time pipeline_check.lsp imports).
const START_TIMEOUT_MS = 30_000;

function buildClient(): LanguageClient {
  const config = vscode.workspace.getConfiguration("pipelineCheck");
  const command = config.get<string>("serverCommand", "python");
  const args = config.get<string[]>("serverArgs", ["-m", "pipeline_check.lsp"]);

  const serverOptions: ServerOptions = {
    run: { command, args, transport: TransportKind.stdio },
    debug: { command, args, transport: TransportKind.stdio },
  };

  // Match by path glob instead of language ID. Language-based selectors
  // would let unrelated YAML files (mkdocs.yml, Helm `values.yaml`,
  // package.json, etc.) reach the LSP and rely on the server's
  // content-and-path filter to bounce them. Path-based selectors keep
  // that filter as a backstop but hand the server only candidate files
  // in the first place — smaller cross-section, no dependency on whether
  // the user has the official GitHub Actions extension installed
  // (which would otherwise hijack the `github-actions-workflow`
  // language ID for `.github/workflows/*.yml`). The pattern list itself
  // lives in providers.ts so the documentSelector, activationEvents,
  // and the workspace-scan command can't drift apart.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [...TRIGGER_DOCUMENT_SELECTOR],
    synchronize: {
      configurationSection: "pipelineCheck",
    },
    outputChannelName: OUTPUT_CHANNEL,
    middleware: {
      // Two-stage filter (composition lives in middleware.ts): drop
      // every diagnostic for a URI whose provider the user has
      // silenced via `disabledProviders`, otherwise drop those below
      // the configured `severityThreshold`. Re-reads the config on
      // each publish so a settings change takes effect on the next
      // scan without a server restart.
      handleDiagnostics: (uri, diagnostics, next) => {
        const config = vscode.workspace.getConfiguration("pipelineCheck");
        next(
          uri,
          transformDiagnostics(uri, diagnostics, {
            disabledProviders: config.get<string[]>("disabledProviders", []),
            severityThreshold: config.get<string>("severityThreshold", "low"),
          }),
        );
      },
    },
  };

  return new LanguageClient(
    LANGUAGE_ID,
    LANGUAGE_NAME,
    serverOptions,
    clientOptions,
  );
}

async function startClient(): Promise<void> {
  if (client) {
    // Bail without restart-loops if someone double-fires the activation
    // event. The restart command goes through stopClient first, so
    // this guard is the genuinely-duplicate case.
    return;
  }
  // Capture the client we just built into a local. The module-level
  // `client` can be reassigned by a concurrent `stopClient()` while we
  // sit on the `await` below; reading off the local keeps the
  // post-start wiring referencing the SAME client we awaited, and lets
  // us cleanly detect the "ours got swapped out" case before touching
  // shared state.
  const local = buildClient();
  client = local;
  // The output channel is created by LanguageClient as a side effect of
  // construction, so it is always present here. Capture it before we
  // drop the broken client on failure (the "Open server log" action
  // below still needs to focus it to surface the server's traceback).
  const outputChannel: vscode.OutputChannel = local.outputChannel;
  // Point the client-side logger at the same channel the LSP server
  // writes to, so [client] and [server] lines interleave with shared
  // timestamps — much easier to read when triaging a bug report.
  clientLog.setLogChannel(outputChannel);

  // Fast-fail preflight: probe `python -c "import pipeline_check"`
  // before LanguageClient.start() spawns the full LSP. The probe
  // returns in well under a second for a missing install; without it
  // the user pays the 30-second start ceiling to learn the same thing.
  // Gated to the default "python -m pipeline_check.lsp" shape via
  // shouldPreflight so a custom wrapper script doesn't see a spurious
  // failure.
  const config = vscode.workspace.getConfiguration("pipelineCheck");
  const command = config.get<string>("serverCommand", "python");
  const args = config.get<string[]>("serverArgs", ["-m", "pipeline_check.lsp"]);
  if (shouldPreflight(command, args)) {
    try {
      clientLog.info("language server: preflight import check");
      const { version } = await runPreflight(command);
      clientLog.info(`language server: preflight ok (engine v${version})`);
      // Publish the captured version to the status-bar tooltip so the
      // user can confirm at a glance which engine they're talking to —
      // useful when triaging a "why isn't this rule firing?" report.
      setEngineVersion(version);
      // Fire-and-forget the daily PyPI poll for a newer engine
      // version. Every failure path inside `checkForEngineUpdate` is
      // silent (logged, no toast); the function self-throttles via
      // globalState so this call is safe on every startClient pass.
      if (extensionContext) {
        void checkForEngineUpdate(extensionContext, version);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clientLog.error(`language server: preflight failed — ${message}`);
      // Branch the failure UX on the reason code:
      //   - missing / other → "Install in terminal" (fresh install)
      //   - out_of_date     → "Upgrade in terminal" (run pip --upgrade)
      // Both paths also offer "Open server log". A null reason (a
      // non-PreflightError that slipped through) falls through to the
      // install path, which is the safer of the two.
      //
      // The same reason code flips the `engineOutOfDate` context key
      // so the welcome panel swaps to its upgrade-prompt variant. The
      // toast and the welcome panel surface the SAME action; users
      // who dismiss the toast still find the CTA in the panel.
      const isOutOfDate =
        err instanceof PreflightError && err.reason === "out_of_date";
      setEngineOutOfDate(isOutOfDate);
      const primaryAction = isOutOfDate
        ? "Upgrade in terminal"
        : "Install in terminal";
      // If the probe captured a version before rejecting, surface it
      // in the status bar even on the out-of-date path — the user is
      // about to upgrade, but until they do, the bar should reflect
      // reality (which engine is currently spawning).
      if (err instanceof PreflightError && err.version) {
        setEngineVersion(err.version);
      }
      void vscode.window
        .showErrorMessage(
          `Pipeline-Check: ${message}.`,
          primaryAction,
          "Open server log",
        )
        .then((choice) => {
          if (choice === "Install in terminal") {
            installInTerminal();
          } else if (choice === "Upgrade in terminal") {
            upgradeInTerminal();
          } else if (choice === "Open server log") {
            outputChannel.show();
          }
        });
      // Same concurrent-restart guard as the catch below: only clear
      // shared state if our client is still the live one.
      if (client === local) {
        client = undefined;
        setLspReady(false);
      }
      return;
    }
  }

  try {
    clientLog.info("language server: starting");
    await startWithTimeout(local, START_TIMEOUT_MS);
    // Concurrent-restart race: if stopClient() ran while we were
    // awaiting, the module-level `client` was already reassigned (or
    // cleared). The LSP we just started is orphaned — best-effort kill
    // it so we don't leak a subprocess, and bail without flipping any
    // shared state that now belongs to a different client.
    if (client !== local) {
      clientLog.warn(
        "language server: start completed but client was swapped during startup; killing orphan",
      );
      void local.stop().catch(() => undefined);
      return;
    }
    clientLog.info("language server: started");
    setLspReady(true);
    // Watch the post-start lifecycle so a mid-session crash (server
    // process exits, LanguageClient's auto-restart exhausts) flips the
    // welcome panel back to the install-prompt state. Without this,
    // `lspReady` only ever transitions back to false on an explicit
    // stop/restart — a crashed server would leave the panel saying
    // "Scan workspace" even though clicking it produces no findings.
    // The listener lives in module scope so stopClient can tear it
    // down before a restart builds a new one against the new client.
    clientStateChangeDisposable = local.onDidChangeState((event) => {
      if (event.newState === State.Stopped) {
        clientLog.warn("language server: state transitioned to stopped");
        setLspReady(false);
        // Clear the status-bar engine line on a mid-session crash so
        // the tooltip stops claiming a server is connected. A normal
        // restart will re-publish the version via runPreflight on the
        // next startClient pass.
        setEngineVersion(undefined);
      } else if (event.newState === State.Running) {
        setLspReady(true);
      }
    });
  } catch (err) {
    // The most common cause is `python -m pipeline_check.lsp` failing:
    // either Python is not on PATH or the [lsp] extra is not installed.
    // Surface the install command and the server log as two distinct
    // actions so the user can act on either without re-reading the
    // notification body. The notification chrome already shows the
    // extension name, so the message body doesn't repeat it.
    //
    // The notification is fire-and-forget: `showErrorMessage` resolves
    // only when the user clicks a button or closes the toast, and
    // `activate()` already awaits this path. Awaiting here would block
    // activation indefinitely whenever nobody is around to click
    // (CI, automation, headless extension host). Detaching keeps the
    // user's buttons live while letting startClient return.
    const message = err instanceof Error ? err.message : String(err);
    clientLog.error(`language server: failed to start — ${message}`);
    void vscode.window
      .showErrorMessage(
        `Language server failed to start (${message}).`,
        "Install in terminal",
        "Open server log",
      )
      .then((choice) => {
        if (choice === "Install in terminal") {
          installInTerminal();
        } else if (choice === "Open server log") {
          outputChannel.show();
        }
      });
    // Only clear the module slot if it still points at OUR client. If
    // stopClient already swapped in a new one (concurrent restart),
    // clobbering would strand the new client. Same idea on the ready
    // flag — leave it alone unless we're the live client.
    if (client === local) {
      client = undefined;
      setLspReady(false);
    }
  }
}

// Hard ceiling on how long deactivate / restart waits for the LSP
// child to shut down cleanly. A deadlocked server would otherwise
// hold the deactivate path indefinitely and VS Code reports "Window
// not responding".
const STOP_TIMEOUT_MS = 2000;

async function stopClient(): Promise<void> {
  if (!client) {
    return;
  }
  const local = client;
  client = undefined;
  setLspReady(false);
  // Clear the cached engine version so the status-bar tooltip doesn't
  // pretend a server is connected after deactivate / restart. The next
  // successful startClient will republish a fresh value.
  setEngineVersion(undefined);
  // Clear the upgrade-prompt context key. If the user fixed the
  // engine via the in-toast upgrade flow and clicks Restart, the
  // welcome panel should fall back to its scan-workspace state on
  // the next successful start rather than staying pinned to the
  // upgrade panel.
  setEngineOutOfDate(false);
  // Drop the state-change listener BEFORE awaiting stop(). Otherwise
  // the Stopped transition that stop() triggers re-fires our handler
  // against the now-detached client and calls setLspReady(false) a
  // second time. Cheap, but the second flip is misleading in the log.
  if (clientStateChangeDisposable) {
    clientStateChangeDisposable.dispose();
    clientStateChangeDisposable = undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      local.stop(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    // If stop() didn't win the race the client is stranded; dispose
    // explicitly so its subscriptions don't outlive us.
    local.dispose?.();
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Stash the context so startClient (and any subsequent restart)
  // can reach globalState for the daily engine-update check. Cleared
  // in deactivate to avoid leaking a reference across host restarts.
  extensionContext = context;
  // The Findings tree reads from already-published diagnostics, so we
  // wire it up before starting the client. That way, if the server
  // takes a moment to come up (or fails outright), the panel is still
  // visible and surfaces findings the moment the first publish lands.
  // Seed the welcome-panel context key before any UI renders so the
  // install-prompt is what shows up on the very first frame; flipped
  // to true by startClient on a successful connection.
  setLspReady(false);

  const findingsProvider = new FindingsTreeProvider(context);
  const findingsView = vscode.window.createTreeView("pipelineCheck.findings", {
    treeDataProvider: findingsProvider,
    showCollapseAll: true,
  });
  // Two-phase wiring: the view needs the provider at construction
  // time, but the provider needs the view to drive its activity-bar
  // badge. Handing the view back closes the loop and triggers an
  // initial badge update.
  findingsProvider.setTreeView(findingsView);
  // Status bar item lives at the bottom-left and shows the per-
  // severity tally. Click reveals the Findings panel. registerStatusBar
  // pushes the item onto context.subscriptions internally.
  registerStatusBar(context);
  // CodeLens summary at the top of every scanned file. Reads from the
  // same diagnostic stream the tree does; click navigates to the
  // Findings panel for drill-down.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [...TRIGGER_DOCUMENT_SELECTOR],
      new FindingsCodeLensProvider(context),
    ),
  );
  // Rule-agnostic CodeActions on every pipeline-check diagnostic.
  // Open rule docs, Copy rule ID, and Reveal-in-panel — all reachable
  // from the editor lightbulb without a panel round-trip.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [...TRIGGER_DOCUMENT_SELECTOR],
      new PipelineCheckCodeActionProvider(),
      {
        providedCodeActionKinds:
          PipelineCheckCodeActionProvider.providedCodeActionKinds,
      },
    ),
  );
  context.subscriptions.push(
    findingsView,
    // Workspace scan: open every candidate file so the LSP runs its
    // didOpen pipeline on each. Findings panel updates as the server
    // publishes; no extra state to manage.
    vscode.commands.registerCommand("pipelineCheck.scanWorkspace", () =>
      runScanCommand(),
    ),
    // "Refresh Findings" was historically a tree-only re-render. Now
    // that we have a real scan command, refresh runs an actual scan so
    // the button matches the user's mental model — clicking "refresh"
    // should fetch fresh data, not re-paint stale data. The tree
    // updates automatically as scan publishes arrive (R10).
    vscode.commands.registerCommand("pipelineCheck.findings.refresh", () =>
      runScanCommand(),
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.changeGrouping",
      () => changeGrouping(findingsProvider),
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.toggleSeverity",
      () => toggleSeverity(findingsProvider),
    ),
    // Context-menu entries on a Findings tree leaf. VS Code passes the
    // TreeNode as the first argument; we read the `finding` shape off
    // it. Both commands are gated behind `viewItem == pipelineCheck.finding`
    // in package.json so the node is always a leaf when these fire.
    vscode.commands.registerCommand(
      "pipelineCheck.findings.copyRuleId",
      async (node: LeafLike | undefined) => {
        const id = node?.finding?.ruleId?.trim();
        if (!id) {
          void vscode.window.showInformationMessage(
            "Pipeline-Check: this finding has no rule ID.",
          );
          return;
        }
        await vscode.env.clipboard.writeText(id);
        // Status-bar message instead of a modal toast — the copy
        // succeeded silently 95% of the time anyway; this is a
        // ~2-second confirmation that doesn't steal focus.
        vscode.window.setStatusBarMessage(`Copied ${id}`, CONFIRM_TTL_MS);
      },
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.findings.openRuleDocs",
      async (node: LeafLike | undefined) => {
        const url = node?.finding?.docsUrl?.trim();
        if (!url) {
          void vscode.window.showInformationMessage(
            "Pipeline-Check: no documentation URL was published for this rule.",
          );
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
      },
    ),
    // Open a finding without using the editor's preview-tab slot.
    // Same target as the default click-to-reveal, but `preview: false`
    // pins each opened file as a permanent tab — useful when the user
    // is opening several findings side-by-side. Lives only in the
    // leaf context menu; the single-click path stays preview-style so
    // the common "click through findings to triage" flow doesn't
    // create tab clutter.
    vscode.commands.registerCommand(
      "pipelineCheck.findings.openNonPreview",
      async (node: LeafLike | undefined) => {
        const uri = node?.finding?.uri;
        const range = node?.finding?.diagnostic?.range;
        if (!uri) return;
        await vscode.commands.executeCommand("vscode.open", uri, {
          selection: range,
          preserveFocus: false,
          preview: false,
        });
      },
    ),
    // Filter the Findings tree by a substring. Matches against rule
    // ID, message body, and fsPath case-insensitively. Re-invoking
    // the command pre-fills the current filter so users can edit or
    // clear it (empty string clears).
    vscode.commands.registerCommand(
      "pipelineCheck.findings.filter",
      async () => {
        const current = findingsProvider.getFilter();
        const next = await vscode.window.showInputBox({
          title: "Filter Pipeline-Check findings",
          prompt:
            "Match rule ID, message text, or file path. Empty to clear.",
          value: current,
          placeHolder: "e.g. GHA-001 or release.yml",
        });
        if (next === undefined) return; // user cancelled
        findingsProvider.setFilter(next);
      },
    ),
    // Install commands. installInTerminal is the primary CTA from the
    // welcome panel — it opens a terminal with the pip command typed
    // but not executed, so the user reviews / activates their venv
    // first. copyInstallCommand stays registered as a fallback for
    // users in headless / non-terminal flows. Both bodies live in
    // install.ts so the welcome-panel CTAs and the LSP-failure toast
    // share one code path.
    vscode.commands.registerCommand(
      "pipelineCheck.installInTerminal",
      installInTerminal,
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.upgradeInTerminal",
      upgradeInTerminal,
    ),
    vscode.commands.registerCommand(
      "pipelineCheck.copyInstallCommand",
      copyInstallCommandToClipboard,
    ),
    vscode.commands.registerCommand("pipelineCheck.goToNextFinding", () =>
      goToFinding("next"),
    ),
    vscode.commands.registerCommand("pipelineCheck.goToPreviousFinding", () =>
      goToFinding("previous"),
    ),
    vscode.commands.registerCommand("pipelineCheck.restart", async () => {
      await stopClient();
      await startClient();
      // Only confirm success when startClient left a live client behind.
      // If start failed it surfaced its own error toast; we'd otherwise
      // show "failed to start" and "restarted" at the same time.
      if (client) {
        void vscode.window.showInformationMessage("Language server restarted.");
      }
    }),
    vscode.commands.registerCommand("pipelineCheck.showLog", () => {
      if (client?.outputChannel) {
        client.outputChannel.show();
      } else {
        void vscode.window.showInformationMessage(
          "The language server is not running yet. Open a supported file " +
            "or run 'Pipeline-Check: Restart language server'.",
        );
      }
    }),
  );

  await startClient();

  // Scan-on-save: when the user saves a CI/CD config file and has the
  // setting enabled, re-scan the whole workspace (quietly). The LSP
  // already re-publishes diagnostics for the saved file itself on
  // `didSave`, so this is purely about picking up cross-file effects in
  // *other* CI files (a Jenkinsfile that includes the just-edited
  // library, a GHA workflow that calls the just-edited composite
  // action). Busy-guard semantics + the gate logic live in
  // src/scanOnSave.ts so they're unit-testable without a real save
  // event source; this wiring just plumbs VS Code's dependencies in.
  const onSave = createScanOnSaveHandler({
    isEnabled: () =>
      vscode.workspace
        .getConfiguration("pipelineCheck")
        .get<boolean>("scanOnSave", false),
    // Trigger a scan only when the saved file is (a) something
    // Pipeline-Check actually scans and (b) belongs to a provider
    // the user has NOT silenced. Saving a Dockerfile in a workspace
    // that has `dockerfile` in `disabledProviders` should be a
    // no-op: re-scanning would just produce a publish the
    // middleware drops on arrival.
    shouldScanOnSave: (fsPath) => {
      const provider = providerForPath(fsPath);
      if (!provider) return false;
      const disabled = vscode.workspace
        .getConfiguration("pipelineCheck")
        .get<string[]>("disabledProviders", []);
      return !disabled.includes(provider);
    },
    scan: () => scanWorkspace({ quiet: true }),
    // Surface a scan failure to the log instead of letting it bubble
    // out as an unhandled rejection. onDidSaveTextDocument doesn't
    // await its listener, so without this hook the only trace would
    // be a generic extension-host error nobody connects back to a
    // save event — the log line names the symptom clearly.
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      clientLog.error(`scan-on-save: scan failed — ${msg}`);
    },
  });
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onSave));

  // Fire-and-forget the one-time "what's new" toast for users who
  // just upgraded. Detached so a not-yet-dismissed notification never
  // blocks activation (same lesson as the LSP-failure toast). The
  // function persists the seen-version before showing, so a missed
  // notification doesn't repeat next launch.
  void showWhatsNewIfUpgraded(context, context.extension.packageJSON.version);
}

export async function deactivate(): Promise<void> {
  await stopClient();
  extensionContext = undefined;
}
