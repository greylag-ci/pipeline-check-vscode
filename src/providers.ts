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

export type ProviderId =
  | "github-actions"
  | "gitlab"
  | "azure"
  | "bitbucket"
  | "circleci"
  | "cloud-build"
  | "buildkite"
  | "drone"
  | "jenkins"
  | "dockerfile";

/**
 * Glob patterns indexed by provider id. A provider may map to more
 * than one pattern (Dockerfile and Containerfile share the same
 * syntax, so they live under "dockerfile"). The keys are what the
 * `pipelineCheck.disabledProviders` setting accepts; spelling them
 * out as a `Record<ProviderId, ...>` keeps the setting's enum in
 * lockstep with the patterns.
 */
export const PROVIDERS: Readonly<Record<ProviderId, readonly string[]>> = {
  "github-actions": ["**/.github/workflows/*.{yml,yaml}"],
  gitlab: ["**/.gitlab-ci.yml"],
  azure: ["**/azure-pipelines.yml"],
  bitbucket: ["**/bitbucket-pipelines.yml"],
  circleci: ["**/.circleci/config.yml"],
  "cloud-build": ["**/cloudbuild.yaml"],
  buildkite: ["**/.buildkite/pipeline.yml"],
  drone: ["**/.drone.{yml,yaml}"],
  jenkins: ["**/Jenkinsfile"],
  dockerfile: ["**/Dockerfile", "**/Containerfile"],
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as readonly ProviderId[];

/**
 * Glob patterns matching every file the upstream `pipeline_check`
 * rule registry knows how to analyse. Derived from `PROVIDERS` so the
 * two stay in sync automatically.
 */
export const TRIGGER_PATTERNS: readonly string[] = PROVIDER_IDS.flatMap(
  (id) => PROVIDERS[id],
);

/**
 * Document-selector form of `TRIGGER_PATTERNS`, suitable for the
 * `LanguageClientOptions.documentSelector`. Each entry restricts the
 * filter to the `file` scheme so untitled or memory-backed buffers
 * never reach the server.
 */
export const TRIGGER_DOCUMENT_SELECTOR: readonly TriggerSelector[] =
  TRIGGER_PATTERNS.map((pattern) => ({ scheme: "file" as const, pattern }));

/**
 * Maps a workspace-relative path to the provider that handles it, or
 * `undefined` if no provider matches. Used by the middleware to drop
 * diagnostics for files whose provider has been disabled in settings.
 *
 * Matching is the same minimatch dialect VS Code's `findFiles` and
 * `documentSelector` use. Implemented locally with a small glob
 * matcher so the function works in both the editor and the unit
 * test environment.
 */
export function providerForPath(path: string): ProviderId | undefined {
  // Normalise Windows backslashes — globs are POSIX-shaped.
  const normalised = path.replace(/\\/g, "/");
  for (const id of PROVIDER_IDS) {
    for (const pattern of PROVIDERS[id]) {
      if (globMatch(pattern, normalised)) {
        return id;
      }
    }
  }
  return undefined;
}

/**
 * Tiny glob matcher covering exactly the dialect our patterns use:
 * `**` (any number of path segments), `*` (anything but `/`), and
 * brace alternatives `{a,b}`. Sufficient for `**\/.github/workflows/*.{yml,yaml}`
 * and similar; not a general-purpose minimatch replacement.
 */
function globMatch(pattern: string, path: string): boolean {
  // Expand brace alternatives into a list of plain globs.
  const branches = expandBraces(pattern);
  for (const branch of branches) {
    if (toRegex(branch).test(path)) return true;
  }
  return false;
}

function expandBraces(pattern: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(pattern);
  if (!match) return [pattern];
  const [, head, body, tail] = match;
  return body
    .split(",")
    .flatMap((alt) => expandBraces(`${head}${alt}${tail}`));
}

function toRegex(pattern: string): RegExp {
  // Walk the pattern char by char to translate `**`, `*`, and
  // everything else (escaped). `**` matches zero-or-more path
  // segments; `*` matches anything but `/`.
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
      // Eat an immediately-following `/` so `**/x` matches `x` too.
      if (pattern[i + 1] === "/") i++;
    } else if (pattern[i] === "*") {
      re += "[^/]*";
    } else if (/[.+?^${}()|[\]\\]/.test(pattern[i])) {
      re += "\\" + pattern[i];
    } else {
      re += pattern[i];
    }
  }
  return new RegExp(`^${re}$`);
}
