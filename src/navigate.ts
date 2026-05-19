// "Go to next / previous finding" navigation. Walks the workspace's
// pipeline-check diagnostics in a deterministic order (uri.fsPath
// ascending, then line ascending) and moves the cursor to the
// neighbouring one relative to wherever it sits now.
//
// The order matches the Findings tree's file-mode sort so jumping
// from the editor and clicking through the tree produce the same
// sequence — no surprise re-orderings between surfaces.

import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "pipeline-check";

interface Location {
  readonly uri: vscode.Uri;
  readonly range: vscode.Range;
}

/**
 * Enumerates every pipeline-check diagnostic in the workspace as a
 * flat list of `(uri, range)` pairs, sorted by file path then by
 * starting line. Exported for unit testing.
 */
export function collectFindingLocations(
  iter: Iterable<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>,
): Location[] {
  const out: Location[] = [];
  for (const [uri, diags] of iter) {
    for (const d of diags) {
      if (d.source !== DIAGNOSTIC_SOURCE) continue;
      out.push({ uri, range: d.range });
    }
  }
  out.sort((a, b) => {
    const lhs = a.uri.fsPath;
    const rhs = b.uri.fsPath;
    if (lhs !== rhs) return lhs.localeCompare(rhs);
    return a.range.start.line - b.range.start.line;
  });
  return out;
}

export type Direction = "next" | "previous";

/**
 * Given the sorted findings, the active editor's location, and a
 * direction, return the index of the finding to jump to (or -1 when
 * the workspace has no findings).
 *
 * Semantics:
 *   - `next` from a cursor sitting before any finding → 0
 *   - `next` from after the last finding → wraps to 0
 *   - `previous` from before all findings → wraps to last
 *   - `next` from EXACTLY on a finding → the one after
 *   - `previous` from EXACTLY on a finding → the one before
 *
 * Wrapping is the convention every navigation command in VS Code
 * (Go to Next Problem, search results, etc.) follows; the user
 * expects to keep walking the list, not hit an invisible wall.
 */
export function pickNextIndex(
  findings: readonly Location[],
  current: { uri: vscode.Uri; position: vscode.Position } | undefined,
  direction: Direction,
): number {
  if (findings.length === 0) return -1;
  if (!current) {
    return direction === "next" ? 0 : findings.length - 1;
  }

  const cursorFs = current.uri.fsPath;
  const cursorLine = current.position.line;
  const cursorChar = current.position.character;

  if (direction === "next") {
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      if (isStrictlyAfter(f, cursorFs, cursorLine, cursorChar)) return i;
    }
    return 0; // wrap
  } else {
    for (let i = findings.length - 1; i >= 0; i--) {
      const f = findings[i];
      if (isStrictlyBefore(f, cursorFs, cursorLine, cursorChar)) return i;
    }
    return findings.length - 1; // wrap
  }
}

function isStrictlyAfter(
  f: Location,
  cursorFs: string,
  line: number,
  ch: number,
): boolean {
  const fFs = f.uri.fsPath;
  if (fFs !== cursorFs) return fFs.localeCompare(cursorFs) > 0;
  if (f.range.start.line !== line) return f.range.start.line > line;
  return f.range.start.character > ch;
}

function isStrictlyBefore(
  f: Location,
  cursorFs: string,
  line: number,
  ch: number,
): boolean {
  const fFs = f.uri.fsPath;
  if (fFs !== cursorFs) return fFs.localeCompare(cursorFs) < 0;
  if (f.range.start.line !== line) return f.range.start.line < line;
  return f.range.start.character < ch;
}

/**
 * Move the active editor's cursor to the next or previous finding,
 * wrapping at the ends. Surfaces an information toast when the
 * workspace has no pipeline-check diagnostics — silent failure on
 * a deliberate keybinding press is confusing.
 */
export async function goToFinding(direction: Direction): Promise<void> {
  const findings = collectFindingLocations(vscode.languages.getDiagnostics());
  if (findings.length === 0) {
    void vscode.window.showInformationMessage(
      "Pipeline-Check: no findings to navigate.",
    );
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const current = editor
    ? { uri: editor.document.uri, position: editor.selection.active }
    : undefined;

  const idx = pickNextIndex(findings, current, direction);
  if (idx < 0) return;
  const target = findings[idx];

  await vscode.window.showTextDocument(target.uri, {
    selection: target.range,
    preserveFocus: false,
    preview: false,
  });
}
