// Single source of truth for which files Pipeline-Check cares about.
// The same list is referenced from three surfaces that used to keep
// their own copies and drift apart:
//
//   1. `documentSelector` in extension.ts — tells the LSP which
//      documents to scan when they open in the editor.
//   2. `activationEvents` in package.json — tells VS Code which
//      workspace files should activate the extension.
//   3. (post-merge of scan-workspace) `SCAN_PATTERNS` for the
//      workspace-wide scan command.
//
// Keeping them in lockstep is mechanical, so this module exports both
// the underlying pattern strings and the VS Code-shaped `DocumentFilter`
// records derived from them. A new provider goes here once; callers
// stay in sync automatically. The package.json `activationEvents`
// remains the only duplication — manifest contributions cannot be
// generated at runtime, so a comment in this file points at the
// strings that must be updated there too.

// A structural shape rather than `vscode.DocumentFilter` —
// `vscode-languageclient` redeclares `DocumentFilter` and the two
// types don't unify. Plain objects flow into both APIs unchanged.
export interface TriggerSelector {
  readonly scheme: "file";
  readonly pattern: string;
}

/**
 * Glob patterns matching every file the upstream `pipeline_check`
 * rule registry knows how to analyse. Order is not load-bearing.
 */
export const TRIGGER_PATTERNS: readonly string[] = [
  "**/.github/workflows/*.{yml,yaml}",
  "**/.gitlab-ci.yml",
  "**/azure-pipelines.yml",
  "**/bitbucket-pipelines.yml",
  "**/.circleci/config.yml",
  "**/cloudbuild.yaml",
  "**/.buildkite/pipeline.yml",
  "**/.drone.{yml,yaml}",
  "**/Jenkinsfile",
  "**/Dockerfile",
  "**/Containerfile",
];

/**
 * Document-selector form of `TRIGGER_PATTERNS`, suitable for the
 * `LanguageClientOptions.documentSelector`. Each entry restricts the
 * filter to the `file` scheme so untitled or memory-backed buffers
 * never reach the server.
 */
export const TRIGGER_DOCUMENT_SELECTOR: readonly TriggerSelector[] =
  TRIGGER_PATTERNS.map((pattern) => ({ scheme: "file" as const, pattern }));
