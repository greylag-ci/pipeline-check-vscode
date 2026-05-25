// Unit tests for the Findings-panel title-bar Quick Pick handlers.
// The functions are exported with an injectable `showQuickPick` so
// these tests don't need to touch the vscode-module mock at all —
// they pass a fake picker that records inputs and returns whatever
// the test cares about.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  const { vscodeStub } = await import("./__testStubs__/vscode");
  return vscodeStub();
});

import { resetStubState } from "./__testStubs__/vscode";
import { FindingsTreeProvider } from "./findingsView";
import {
  GROUPING_PICKS,
  SEVERITY_PICK_DESCRIPTION,
  changeGrouping,
  toggleSeverity,
  type ShowQuickPick,
} from "./quickPicks";

// Per-test in-memory workspaceState — mirrors the pattern in
// findingsView.test.ts so the provider's persistence layer stays
// isolated between cases.
function freshContext() {
  const state: Record<string, unknown> = {};
  const ctx = {
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: {
      get<T>(key: string, fallback?: T): T | undefined {
        return (key in state ? state[key] : fallback) as T | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        state[key] = value;
      },
      keys(): readonly string[] {
        return Object.keys(state);
      },
    },
  } as unknown as import("vscode").ExtensionContext;
  return { ctx, state };
}

// Record-and-return picker. Captures every showQuickPick invocation
// (items + options) on `calls`, then resolves with whatever the test
// stashed via `returnValue`. The two-step lets one test exercise the
// "user cancelled" path (returnValue=undefined) and another the
// "user picked X" path without redefining the picker.
function recordingPicker(): {
  picker: ShowQuickPick;
  calls: Array<{
    items: ReadonlyArray<unknown>;
    options: unknown;
  }>;
  resolveWith: (v: unknown) => void;
} {
  let returnValue: unknown = undefined;
  const calls: Array<{
    items: ReadonlyArray<unknown>;
    options: unknown;
  }> = [];
  const picker: ShowQuickPick = (items, options) => {
    // The `items` arg is `readonly T[] | Thenable<readonly T[]>` —
    // the production handler always passes an array, so we don't
    // need to await it.
    calls.push({ items: items as ReadonlyArray<unknown>, options });
    return Promise.resolve(returnValue) as ReturnType<ShowQuickPick>;
  };
  return {
    picker,
    calls,
    resolveWith: (v) => {
      returnValue = v;
    },
  };
}

beforeEach(() => {
  resetStubState();
});

describe("changeGrouping — Quick Pick contents", () => {
  it("offers all three group modes in the documented order", () => {
    // The order is muscle memory from the old radio-button era.
    // Pinning it here so a reshuffled GROUPING_PICKS would fail
    // before users notice on the marketplace.
    expect(GROUPING_PICKS.map((p) => p.mode)).toEqual([
      "severity",
      "file",
      "rule",
    ]);
  });

  it("each pick carries a one-line description", () => {
    for (const p of GROUPING_PICKS) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe("changeGrouping — handler behavior", () => {
  it("marks the current mode with $(check) and leaves the rest indented", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setGroupMode("file");
    const { picker, calls, resolveWith } = recordingPicker();
    resolveWith(undefined); // user cancels — we only assert on the items shape

    await changeGrouping(provider, picker);

    expect(calls).toHaveLength(1);
    const items = calls[0].items as Array<{ label: string; mode: string }>;
    const fileItem = items.find((i) => i.mode === "file")!;
    const severityItem = items.find((i) => i.mode === "severity")!;
    expect(fileItem.label.startsWith("$(check)")).toBe(true);
    // Non-active modes are indented with four spaces so the visual
    // gutter stays aligned with the checked row.
    expect(severityItem.label.startsWith("    ")).toBe(true);
    expect(severityItem.label).not.toContain("$(check)");
  });

  it("titles the picker with 'Group findings by'", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    const { picker, calls, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await changeGrouping(provider, picker);
    expect(
      (calls[0].options as { title?: string }).title,
    ).toBe("Group findings by");
  });

  it("user cancelling is a no-op (group mode stays put)", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setGroupMode("rule");
    const { picker, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await changeGrouping(provider, picker);
    expect(provider.getGroupMode()).toBe("rule");
  });

  it("picking a different mode flips the provider's group mode", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setGroupMode("severity");
    const { picker, resolveWith } = recordingPicker();
    // Resolve with a "file" pick — handler should call setGroupMode("file").
    resolveWith({ mode: "file" });
    await changeGrouping(provider, picker);
    expect(provider.getGroupMode()).toBe("file");
  });

  it("picking the current mode is a no-op refresh (setGroupMode short-circuits)", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setGroupMode("severity");
    let refreshes = 0;
    provider.onDidChangeTreeData(() => {
      refreshes += 1;
    });
    const { picker, resolveWith } = recordingPicker();
    resolveWith({ mode: "severity" });
    await changeGrouping(provider, picker);
    expect(provider.getGroupMode()).toBe("severity");
    expect(refreshes).toBe(0);
  });
});

describe("toggleSeverity — Quick Pick contents", () => {
  it("offers all five severities with one-line descriptions", () => {
    // The Quick Pick is the user's only entry point to the per-panel
    // severity filter — each severity must carry copy that explains
    // what hiding it means.
    for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
      expect(SEVERITY_PICK_DESCRIPTION[sev].length).toBeGreaterThan(0);
    }
  });
});

describe("toggleSeverity — handler behavior", () => {
  it("seeds picked=true for currently-visible severities and false for hidden ones", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setHiddenSeverities(new Set(["MEDIUM", "INFO"]));
    const { picker, calls, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await toggleSeverity(provider, picker);
    expect(calls).toHaveLength(1);
    const items = calls[0].items as Array<{ label: string; picked: boolean }>;
    const visibility = Object.fromEntries(
      items.map((i) => [i.label, i.picked]),
    );
    expect(visibility).toEqual({
      CRITICAL: true,
      HIGH: true,
      MEDIUM: false,
      LOW: true,
      INFO: false,
    });
  });

  it("requests canPickMany so the user can toggle multiple severities at once", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    const { picker, calls, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await toggleSeverity(provider, picker);
    expect(
      (calls[0].options as { canPickMany?: boolean }).canPickMany,
    ).toBe(true);
  });

  it("user cancelling is a no-op (hidden set unchanged)", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setHiddenSeverities(new Set(["LOW"]));
    const { picker, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await toggleSeverity(provider, picker);
    expect([...provider.getHiddenSeverities()]).toEqual(["LOW"]);
  });

  it("selecting a subset hides the unselected severities", async () => {
    // User checks CRITICAL + HIGH only — MEDIUM / LOW / INFO end up
    // hidden. The handler computes the hidden set as `SEVERITY_ORDER
    // minus selected`, so missing severities in the chosen array
    // mean "hide".
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    const { picker, resolveWith } = recordingPicker();
    resolveWith([
      { severity: "CRITICAL" },
      { severity: "HIGH" },
    ]);
    await toggleSeverity(provider, picker);
    expect([...provider.getHiddenSeverities()].sort()).toEqual([
      "INFO",
      "LOW",
      "MEDIUM",
    ]);
  });

  it("selecting all severities clears the hidden set entirely", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    provider.setHiddenSeverities(new Set(["MEDIUM", "LOW"]));
    const { picker, resolveWith } = recordingPicker();
    resolveWith([
      { severity: "CRITICAL" },
      { severity: "HIGH" },
      { severity: "MEDIUM" },
      { severity: "LOW" },
      { severity: "INFO" },
    ]);
    await toggleSeverity(provider, picker);
    expect(provider.getHiddenSeverities().size).toBe(0);
  });

  it("selecting nothing hides every severity (extreme but valid)", async () => {
    // Empty array is a deliberate, distinct outcome from "user
    // cancelled". The picker resolves with [] when the user clicked
    // OK with no items checked — the resulting tree is empty, and
    // the next toggle invocation lets the user restore.
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    const { picker, resolveWith } = recordingPicker();
    resolveWith([]);
    await toggleSeverity(provider, picker);
    expect(provider.getHiddenSeverities().size).toBe(5);
  });

  it("titles the picker with 'Show severities in the Findings panel'", async () => {
    const { ctx } = freshContext();
    const provider = new FindingsTreeProvider(ctx);
    const { picker, calls, resolveWith } = recordingPicker();
    resolveWith(undefined);
    await toggleSeverity(provider, picker);
    expect(
      (calls[0].options as { title?: string }).title,
    ).toBe("Show severities in the Findings panel");
  });
});
