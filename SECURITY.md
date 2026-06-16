# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
**[Private vulnerability reporting](https://github.com/greylag-ci/pipeline-check-vscode/security/advisories/new)**
form. Do not open a public issue or PR for a suspected vulnerability.

We aim to:

- Acknowledge the report within **3 business days**.
- Provide an initial assessment (in-scope / out-of-scope, working
  reproduction, severity estimate) within **7 business days**.
- Coordinate a fix and a disclosure window with the reporter before any
  public write-up.

Credit will be attributed in the release notes and in the CVE record
(if assigned) unless the reporter prefers anonymity.

## Data collection

**The extension does not collect telemetry.** No usage, error, or
identity data is sent anywhere. The network requests the extension
itself initiates are:

1. **`vscode.env.openExternal(<rule-docs-url>)`** when a user clicks
   the *Open Rule Documentation* link on a finding. That opens the URL
   the upstream `pipeline-check` server published as
   `Diagnostic.code.target` — typically a docs page hosted by the
   rule's vendor. The link is user-initiated; nothing fires
   automatically.
2. **`vscode.env.openExternal(<github-release-url>)`** when a user
   clicks *See release notes* on the one-time post-upgrade
   notification. Also user-initiated.
3. **HTTPS GET to `https://pypi.org/pypi/pipeline-check/json`** —
   the daily engine-update poll added in v1.5.0. Fires at most once
   per 24 h after a successful LSP preflight (per-session latch +
   `globalState` timestamp); the only response field consumed is
   `info.version`. If the installed engine is older, a non-blocking
   notification offers an Upgrade action that runs the existing
   `python -m pip install --upgrade "pipeline-check[lsp]"` flow in a
   terminal (typed but not auto-executed). No identifier — anonymous
   or otherwise — is sent with the request; it's a vanilla request
   for a public PyPI package metadata document. The poll is fully
   disabled by setting `pipelineCheck.engineUpdates.checkEnabled`
   to `false`.

Everything else — diagnostic publishing, scan progress, tree state —
stays between your editor and the locally-spawned LSP child process.
No `fetch` to an analytics endpoint, no anonymous-id header, no
opt-in pixel.

## Supported versions

Only the latest published version on the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=greylag-ci.pipeline-check)
and [Open VSX](https://open-vsx.org/extension/greylag-ci/pipeline-check)
receives security fixes. Users on older versions should update first;
back-ports are considered case-by-case for severe issues.

## Threat model

The extension is a thin LSP client that spawns
`python -m pipeline_check.lsp` over stdio. Two categories of issue are
in scope:

1. **Code execution from a workspace** — the language server is a child
   process whose command and arguments are configurable. Workspace
   settings can override these, so a malicious repository could try to
   coerce arbitrary process spawn at activation time. We mitigate this
   with VS Code's workspace-trust model (`capabilities.untrustedWorkspaces:
   "limited"`) and by marking the relevant settings as
   `machine-overridable` so workspace overrides require an explicit
   prompt. Reports demonstrating a bypass are in scope.
2. **Supply-chain integrity of the published `.vsix`** — anything that
   would let an attacker insert code into a marketplace build (e.g. a
   leaked publisher PAT, an unpinned tool that ships malicious code,
   a tag pointing at an off-`main` commit). Reports about the release
   workflow are in scope.

## Out of scope

- False-positive or false-negative findings from the upstream
  `pipeline-check` rule engine. Report those at
  [dmartinochoa/pipeline-check](https://github.com/dmartinochoa/pipeline-check/issues).
- Vulnerabilities in dependencies that have a published advisory and an
  available fix — those are handled by Dependabot and the weekly
  `npm audit` CI run, not by ad-hoc reports.
- Issues that require the user to first install a malicious build of
  Python or of the `pipeline-check` package itself. We assume the
  developer's own toolchain is uncompromised.
