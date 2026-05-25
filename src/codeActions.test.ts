import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", async () => {
  // Augment the shared stub with the CodeAction / CodeActionKind /
  // Selection / TextDocument shapes the provider returns. None of
  // them carry behaviour we test against — they're just data carriers.
  const { vscodeStub } = await import("./__testStubs__/vscode");
  const stub = vscodeStub();
  // CodeAction: thin data record. The provider only sets `command`,
  // `diagnostics`, and the `title`/`kind` it gets from the constructor.
  class CodeAction {
    command?: { command: string; title: string; arguments?: unknown[] };
    diagnostics?: unknown[];
    constructor(
      public readonly title: string,
      public readonly kind?: { value: string },
    ) {}
  }
  // CodeActionKind: only equality on `.value` matters for the test
  // assertions (we read it off the provider's static surface).
  const CodeActionKind = {
    QuickFix: { value: "quickfix" } as { value: string },
  };
  return {
    ...stub,
    CodeAction,
    CodeActionKind,
  };
});

import { resetStubState } from "./__testStubs__/vscode";
import { PipelineCheckCodeActionProvider } from "./codeActions";

beforeEach(() => {
  resetStubState();
});

// ContextLike: just enough shape to drive provideCodeActions in unit
// tests. We don't construct vscode.CodeActionContext (which would need
// CodeActionTriggerKind, only) — the provider only reads `diagnostics`.
type ContextLike = { diagnostics: unknown[] };

// DiagnosticLike: the fields the provider reads.
type DiagnosticLike = {
  source: string;
  code?: string | number | { value: string | number; target?: { toString(): string } };
};

function diag(opts: {
  source?: string;
  ruleId?: string;
  docsUrl?: string;
}): DiagnosticLike {
  const source = opts.source ?? "pipeline-check";
  if (opts.docsUrl) {
    return {
      source,
      code: {
        value: opts.ruleId ?? "",
        target: { toString: () => opts.docsUrl! },
      },
    };
  }
  if (opts.ruleId !== undefined) {
    return { source, code: { value: opts.ruleId } };
  }
  return { source };
}

function provide(context: ContextLike) {
  const provider = new PipelineCheckCodeActionProvider();
  // The doc / range args are unread; cast through unknown to the
  // expected TS types so the call site type-checks.
  return provider.provideCodeActions(
    {} as unknown as import("vscode").TextDocument,
    {} as unknown as import("vscode").Range,
    context as unknown as import("vscode").CodeActionContext,
  );
}

describe("PipelineCheckCodeActionProvider — source filter", () => {
  it("ignores diagnostics from other extensions", () => {
    const actions = provide({
      diagnostics: [diag({ source: "eslint", ruleId: "no-unused-vars" })],
    });
    expect(actions).toEqual([]);
  });

  it("processes only pipeline-check diagnostics when the context mixes sources", () => {
    const actions = provide({
      diagnostics: [
        diag({ source: "eslint", ruleId: "no-unused-vars" }),
        diag({ ruleId: "GHA-001" }),
      ],
    });
    // One pipeline-check diagnostic with ruleId only → copy + reveal = 2 actions.
    expect(actions).toHaveLength(2);
  });
});

describe("PipelineCheckCodeActionProvider — action set per diagnostic", () => {
  it("emits Open / Copy / Reveal when both ruleId and docsUrl are present", () => {
    const actions = provide({
      diagnostics: [
        diag({ ruleId: "GHA-001", docsUrl: "https://docs.example/gha-001" }),
      ],
    });
    expect(actions.map((a) => a.title)).toEqual([
      "Open GHA-001 documentation",
      "Copy rule ID (GHA-001)",
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("omits the Open action when no docsUrl is published", () => {
    const actions = provide({
      diagnostics: [diag({ ruleId: "GHA-001" })],
    });
    expect(actions.map((a) => a.title)).toEqual([
      "Copy rule ID (GHA-001)",
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("omits the Copy action when no ruleId is present", () => {
    const actions = provide({
      diagnostics: [diag({ docsUrl: "https://docs.example/x" })],
    });
    expect(actions.map((a) => a.title)).toEqual([
      "Open rule documentation",
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("always emits the Reveal action even when both ruleId and docsUrl are absent", () => {
    // A degenerate diagnostic still gets a lightbulb that routes the
    // user to the panel — at minimum they can browse what else is
    // going on in the workspace.
    const actions = provide({ diagnostics: [diag({})] });
    expect(actions.map((a) => a.title)).toEqual([
      "Show in Pipeline-Check Findings panel",
    ]);
  });
});

describe("PipelineCheckCodeActionProvider — command wiring", () => {
  it("Open action invokes vscode.open with the docs URL", () => {
    const actions = provide({
      diagnostics: [
        diag({ ruleId: "GHA-001", docsUrl: "https://docs.example/gha-001" }),
      ],
    });
    const open = actions.find((a) => a.title.startsWith("Open"))!;
    expect(open.command?.command).toBe("vscode.open");
    // The arg is a Uri-shaped object; the stub's Uri.parse returns
    // an object whose toString() echoes the input.
    const arg = open.command?.arguments?.[0] as { toString(): string };
    expect(arg.toString()).toBe("https://docs.example/gha-001");
  });

  it("Copy action routes through pipelineCheck.findings.copyRuleId with a synthetic leaf", () => {
    const actions = provide({
      diagnostics: [diag({ ruleId: "GHA-001" })],
    });
    const copy = actions.find((a) => a.title.startsWith("Copy"))!;
    expect(copy.command?.command).toBe("pipelineCheck.findings.copyRuleId");
    expect(copy.command?.arguments).toEqual([{ finding: { ruleId: "GHA-001" } }]);
  });

  it("Reveal action focuses the activity-bar container", () => {
    const actions = provide({ diagnostics: [diag({ ruleId: "GHA-001" })] });
    const reveal = actions.find((a) => a.title.startsWith("Show in"))!;
    expect(reveal.command?.command).toBe("workbench.view.extension.pipelineCheck");
  });
});

describe("PipelineCheckCodeActionProvider — diagnostic attachment", () => {
  it("attaches the source diagnostic to every emitted action", () => {
    const d = diag({ ruleId: "GHA-001", docsUrl: "https://docs.example/x" });
    const actions = provide({ diagnostics: [d] });
    expect(actions).toHaveLength(3);
    for (const a of actions) {
      expect(a.diagnostics).toEqual([d]);
    }
  });
});

describe("PipelineCheckCodeActionProvider — provided kinds", () => {
  it("declares QuickFix as the only provided kind", () => {
    // The kind is what makes the lightbulb appear; a wrong kind would
    // hide the actions from the gutter bulb. Pin it.
    expect(PipelineCheckCodeActionProvider.providedCodeActionKinds).toHaveLength(1);
    expect(
      PipelineCheckCodeActionProvider.providedCodeActionKinds[0].value,
    ).toBe("quickfix");
  });
});

describe("PipelineCheckCodeActionProvider — degenerate diagnostic shapes", () => {
  // The provider runs on every editor click — a malformed diagnostic
  // (server bug, partial publish, future field rename) must not crash
  // the lightbulb provider. These tests pin the "still emit the reveal
  // action, never throw" contract.

  function provideRaw(diagnostic: unknown) {
    const provider = new PipelineCheckCodeActionProvider();
    return provider.provideCodeActions(
      {} as unknown as import("vscode").TextDocument,
      {} as unknown as import("vscode").Range,
      { diagnostics: [diagnostic] } as unknown as import("vscode").CodeActionContext,
    );
  }

  it("treats diag.code === undefined as 'no rule ID, no docs URL'", () => {
    // Defaults all the way down: only the reveal action survives,
    // and the title falls back to 'Open rule documentation' is not
    // emitted because there's no URL.
    const actions = provideRaw({ source: "pipeline-check" });
    expect(actions.map((a) => a.title)).toEqual([
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("treats diag.code === 0 (numeric) as a valid rule ID", () => {
    // A numeric rule code is unusual (we publish strings), but the
    // provider's readRuleId already handles it via String(code). The
    // copy action's argument carries the stringified value so the
    // downstream command sees the same shape it would for a string.
    const actions = provideRaw({ source: "pipeline-check", code: 0 });
    const copy = actions.find((a) => a.title.startsWith("Copy"));
    expect(copy?.command?.arguments).toEqual([{ finding: { ruleId: "0" } }]);
  });

  it("treats diag.code === '' as 'no rule ID'", () => {
    // The empty-string path used to mask the rule ID falsey check —
    // an empty code means no Copy action, no titled Open action.
    const actions = provideRaw({ source: "pipeline-check", code: "" });
    expect(actions.map((a) => a.title)).toEqual([
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("treats diag.code = { value, target: null } as 'rule ID present, no docs URL'", () => {
    // A truthy code object whose target is null surfaces the ruleId
    // path (Copy + Reveal) but skips Open. Pin both branches together.
    const actions = provideRaw({
      source: "pipeline-check",
      code: { value: "GHA-001", target: null },
    });
    expect(actions.map((a) => a.title)).toEqual([
      "Copy rule ID (GHA-001)",
      "Show in Pipeline-Check Findings panel",
    ]);
  });

  it("treats diag.code = { value, target: { toString() throws } } as 'docs URL unusable'", () => {
    // If the target's toString implementation throws (e.g. a
    // proxy / accessor), the whole provideCodeActions call would
    // propagate the throw up into VS Code's lightbulb plumbing,
    // which would silently disable lightbulbs for the file. Catching
    // it costs one branch; the regression cost of a silent
    // disablement is high. This test pins that the provider doesn't
    // throw — the assertion is the absence of an exception.
    const target = {
      toString() {
        throw new Error("kaboom");
      },
    };
    expect(() =>
      provideRaw({
        source: "pipeline-check",
        code: { value: "GHA-001", target },
      }),
    ).not.toThrow();
  });

  it("processes a batch where one diagnostic is degenerate and others are well-formed", () => {
    // Real publishes can interleave good and bad diagnostics. The
    // provider must process each one independently — a degenerate
    // entry in the middle of the array shouldn't poison the actions
    // for the rest.
    const provider = new PipelineCheckCodeActionProvider();
    const actions = provider.provideCodeActions(
      {} as unknown as import("vscode").TextDocument,
      {} as unknown as import("vscode").Range,
      {
        diagnostics: [
          diag({ ruleId: "GHA-001", docsUrl: "https://docs.example/x" }),
          { source: "pipeline-check" },
          diag({ ruleId: "GHA-002" }),
        ],
      } as unknown as import("vscode").CodeActionContext,
    );
    // First diagnostic: Open + Copy + Reveal (3 actions).
    // Second diagnostic: Reveal only (1 action).
    // Third diagnostic: Copy + Reveal (2 actions).
    expect(actions).toHaveLength(6);
  });
});
