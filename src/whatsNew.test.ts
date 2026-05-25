import { describe, it, expect, vi, beforeEach } from "vitest";

// whatsNew.ts touches vscode.window.showInformationMessage and
// vscode.env.openExternal at runtime. The unit-test stub captures
// calls so we can assert which button was offered and whether the
// release-notes URL was opened.
vi.mock("vscode", () => {
  const calls: {
    showInformationMessage: Array<{ message: string; actions: string[] }>;
    openExternal: string[];
  } = {
    showInformationMessage: [],
    openExternal: [],
  };
  // Resolves with the value tests stash on `globalThis.__nextChoice`.
  (
    globalThis as { __whatsNewCalls?: typeof calls }
  ).__whatsNewCalls = calls;

  class Uri {
    constructor(public readonly raw: string) {}
    static parse(s: string) {
      return new Uri(s);
    }
  }
  return {
    Uri,
    window: {
      showInformationMessage: (message: string, ...actions: string[]) => {
        calls.showInformationMessage.push({ message, actions });
        const next = (globalThis as { __nextChoice?: string }).__nextChoice;
        return Promise.resolve(next);
      },
    },
    env: {
      openExternal: (uri: { raw: string }) => {
        calls.openExternal.push(uri.raw);
        return Promise.resolve(true);
      },
    },
  };
});

import {
  composeMessage,
  isUpgrade,
  showWhatsNewIfUpgraded,
} from "./whatsNew";

function fakeContext(stored?: string) {
  const state: Record<string, unknown> = {};
  if (stored !== undefined) state["pipelineCheck.lastSeenVersion"] = stored;
  return {
    globalState: {
      get<T>(key: string): T | undefined {
        return state[key] as T | undefined;
      },
      async update(key: string, value: unknown): Promise<void> {
        state[key] = value;
      },
    },
  } as unknown as import("vscode").ExtensionContext;
}

function getCalls() {
  return (
    globalThis as {
      __whatsNewCalls?: {
        showInformationMessage: Array<{ message: string; actions: string[] }>;
        openExternal: string[];
      };
    }
  ).__whatsNewCalls!;
}

beforeEach(() => {
  const c = getCalls();
  c.showInformationMessage.length = 0;
  c.openExternal.length = 0;
  (globalThis as { __nextChoice?: string }).__nextChoice = undefined;
});

// ─── isUpgrade ─────────────────────────────────────────────────────

describe("isUpgrade", () => {
  it("returns true on first install (no stored version)", () => {
    expect(isUpgrade(undefined, "0.2.0")).toBe(true);
  });

  it("returns true when next > prev on major", () => {
    expect(isUpgrade("0.9.9", "1.0.0")).toBe(true);
  });

  it("returns true when next > prev on minor", () => {
    expect(isUpgrade("0.1.5", "0.2.0")).toBe(true);
  });

  it("returns true on a patch bump", () => {
    expect(isUpgrade("0.2.0", "0.2.1")).toBe(true);
  });

  it("returns false on equal versions", () => {
    expect(isUpgrade("0.2.0", "0.2.0")).toBe(false);
  });

  it("returns false on a downgrade", () => {
    expect(isUpgrade("0.2.0", "0.1.5")).toBe(false);
  });

  it("treats rc → ga as an upgrade so pre-release testers see the GA toast", () => {
    // semver §11: a pre-release version is LOWER precedence than the
    // corresponding release. The previous behaviour stripped the
    // suffix and treated them as equal, which silenced the toast at
    // the worst possible moment (the GA itself).
    expect(isUpgrade("0.2.0-rc.1", "0.2.0")).toBe(true);
    expect(isUpgrade("1.0.0-rc.2", "1.0.0")).toBe(true);
  });

  it("treats ga → rc as a downgrade — no toast on a release-then-prerelease sequence", () => {
    // The user installed 1.0.0 then somehow installed 1.0.0-rc.2
    // (manual vsix sideload, marketplace channel switch). The rc is
    // LOWER precedence; we don't fire the toast.
    expect(isUpgrade("0.2.0", "0.2.0-rc.2")).toBe(false);
    expect(isUpgrade("1.0.0", "1.0.0-rc.1")).toBe(false);
  });

  it("compares pre-release identifiers per semver §11.4 (numeric segments compare numerically)", () => {
    // Plain rc.N progressions.
    expect(isUpgrade("1.0.0-rc.1", "1.0.0-rc.2")).toBe(true);
    expect(isUpgrade("1.0.0-rc.2", "1.0.0-rc.1")).toBe(false);
    expect(isUpgrade("1.0.0-rc.1", "1.0.0-rc.1")).toBe(false);
    // Regression fence: a bare string-compare would say "rc.10" < "rc.2"
    // because '1' < '2' lexicographically, so rc.2 → rc.10 would NOT
    // fire the toast. Numeric-identifier compare per spec puts 10 > 2.
    expect(isUpgrade("1.0.0-rc.2", "1.0.0-rc.10")).toBe(true);
    expect(isUpgrade("1.0.0-rc.10", "1.0.0-rc.2")).toBe(false);
    // Numeric identifiers always rank below non-numeric ones (§11.4.3),
    // so `alpha.1` > `1`.
    expect(isUpgrade("1.0.0-1", "1.0.0-alpha.1")).toBe(true);
    // Longer pre-release set wins when all preceding identifiers match
    // (§11.4.4).
    expect(isUpgrade("1.0.0-rc.1", "1.0.0-rc.1.1")).toBe(true);
    expect(isUpgrade("1.0.0-rc.1.1", "1.0.0-rc.1")).toBe(false);
  });

  it("a higher core triple wins regardless of pre-release tags", () => {
    // Pre-release ranking only matters when the core triples match.
    // 1.0.0-rc.99 → 1.0.1 is an upgrade.
    expect(isUpgrade("1.0.0-rc.99", "1.0.1")).toBe(true);
    expect(isUpgrade("1.0.1", "1.0.0-rc.99")).toBe(false);
  });

  it("strips a leading 'v' if present", () => {
    expect(isUpgrade("v0.1.0", "0.2.0")).toBe(true);
  });

  it("treats malformed prev (empty / garbage) as 'older than anything'", () => {
    expect(isUpgrade("", "0.0.1")).toBe(true);
  });
});

// ─── composeMessage ────────────────────────────────────────────────

describe("composeMessage", () => {
  it("interpolates the version into the message", () => {
    expect(composeMessage("0.2.0")).toContain("0.2.0");
  });

  it("invites the user to read the release notes", () => {
    // The toast pairs this prose with a `See release notes` action
    // button — the action's destination is per-version, so the prose
    // stays generic and ages without per-release maintenance. Pin
    // the "see what changed" call-to-action so a future edit that
    // strips it (and the implicit pointer to the release notes) gets
    // a loud signal.
    const msg = composeMessage("1.1.0");
    expect(msg.toLowerCase()).toContain("see what changed");
  });
});

// ─── showWhatsNewIfUpgraded ─────────────────────────────────────────

describe("showWhatsNewIfUpgraded", () => {
  it("shows the toast on first install", async () => {
    const ctx = fakeContext(undefined);
    await showWhatsNewIfUpgraded(ctx, "0.2.0");
    expect(getCalls().showInformationMessage).toHaveLength(1);
    expect(getCalls().showInformationMessage[0].actions).toEqual([
      "See release notes",
      "Got it",
    ]);
  });

  it("does NOT show the toast when versions match", async () => {
    const ctx = fakeContext("0.2.0");
    await showWhatsNewIfUpgraded(ctx, "0.2.0");
    expect(getCalls().showInformationMessage).toHaveLength(0);
  });

  it("persists the new version before the toast resolves (so a missed click doesn't re-trigger next launch)", async () => {
    const ctx = fakeContext("0.1.5");
    // Don't pick anything; let the promise resolve with undefined.
    await showWhatsNewIfUpgraded(ctx, "0.2.0");
    expect(ctx.globalState.get("pipelineCheck.lastSeenVersion")).toBe(
      "0.2.0",
    );
  });

  it('opens the release-notes URL when the user picks "See release notes"', async () => {
    (globalThis as { __nextChoice?: string }).__nextChoice =
      "See release notes";
    const ctx = fakeContext("0.1.5");
    await showWhatsNewIfUpgraded(ctx, "0.2.0");
    expect(getCalls().openExternal).toEqual([
      "https://github.com/greylag-ci/pipeline-check-vscode/releases/tag/v0.2.0",
    ]);
  });

  it('does not open anything when the user picks "Got it"', async () => {
    (globalThis as { __nextChoice?: string }).__nextChoice = "Got it";
    const ctx = fakeContext("0.1.5");
    await showWhatsNewIfUpgraded(ctx, "0.2.0");
    expect(getCalls().openExternal).toEqual([]);
  });

  it("allows the caller to override the URL opener (for tests / telemetry)", async () => {
    (globalThis as { __nextChoice?: string }).__nextChoice =
      "See release notes";
    const ctx = fakeContext("0.1.5");
    const visited: string[] = [];
    await showWhatsNewIfUpgraded(ctx, "0.2.0", {
      openExternal: async (url) => {
        visited.push(url);
        return true;
      },
    });
    expect(visited).toEqual([
      "https://github.com/greylag-ci/pipeline-check-vscode/releases/tag/v0.2.0",
    ]);
    // And the default opener stayed unused.
    expect(getCalls().openExternal).toEqual([]);
  });
});
