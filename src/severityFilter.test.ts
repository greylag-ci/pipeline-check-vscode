import { describe, it, expect } from "vitest";

import {
  SEVERITY_RANK,
  THRESHOLD_RANK,
  filterByThreshold,
  passesThreshold,
} from "./severityFilter";

// Pure-function suite. The filter is the editor's only client-side knob
// for muting findings, so the invariants below double as a regression
// fence: a future change that silently drops diagnostics will fail
// here before it reaches a user.

const D = (severity?: string) => ({ data: severity ? { severity } : undefined });

describe("passesThreshold", () => {
  it("admits a diagnostic whose severity meets the threshold", () => {
    expect(passesThreshold(D("HIGH"), "high")).toBe(true);
    expect(passesThreshold(D("CRITICAL"), "high")).toBe(true);
  });

  it("drops a diagnostic below the threshold", () => {
    expect(passesThreshold(D("LOW"), "high")).toBe(false);
    expect(passesThreshold(D("MEDIUM"), "high")).toBe(false);
    expect(passesThreshold(D("LOW"), "critical")).toBe(false);
  });

  it("passes a diagnostic with no severity metadata (older server or non-pipeline-check publish)", () => {
    expect(passesThreshold(D(), "critical")).toBe(true);
    expect(passesThreshold({}, "critical")).toBe(true);
    expect(passesThreshold({ data: {} }, "critical")).toBe(true);
  });

  it("passes a diagnostic whose severity name is unknown — never silently disappear", () => {
    expect(passesThreshold(D("UNKNOWN"), "critical")).toBe(true);
    expect(passesThreshold(D("warning"), "critical")).toBe(true);
  });

  it("falls back to LOW when the threshold name is unknown", () => {
    // Bogus threshold treated as `low`, so anything >= LOW survives.
    expect(passesThreshold(D("LOW"), "garbage")).toBe(true);
    expect(passesThreshold(D("INFO"), "garbage")).toBe(false);
  });

  it("respects the default LOW threshold via the empty string", () => {
    expect(passesThreshold(D("LOW"), "")).toBe(true);
    expect(passesThreshold(D("INFO"), "")).toBe(false);
  });

  it("INFO is always dropped at any concrete threshold", () => {
    for (const t of ["low", "medium", "high", "critical"]) {
      expect(passesThreshold(D("INFO"), t)).toBe(false);
    }
  });

  it("CRITICAL survives every concrete threshold", () => {
    for (const t of ["low", "medium", "high", "critical"]) {
      expect(passesThreshold(D("CRITICAL"), t)).toBe(true);
    }
  });
});

describe("filterByThreshold", () => {
  it("returns a new array containing only diagnostics that pass", () => {
    const input = [D("LOW"), D("HIGH"), D("MEDIUM"), D("CRITICAL")];
    expect(filterByThreshold(input, "high")).toEqual([D("HIGH"), D("CRITICAL")]);
  });

  it("preserves order", () => {
    const input = [D("CRITICAL"), D("LOW"), D("HIGH"), D("MEDIUM")];
    expect(filterByThreshold(input, "high").map((d) => d.data?.severity)).toEqual([
      "CRITICAL",
      "HIGH",
    ]);
  });

  it("returns an empty array, not undefined, when nothing passes", () => {
    expect(filterByThreshold([D("LOW")], "critical")).toEqual([]);
  });

  it("returns a different array reference (no in-place mutation)", () => {
    const input = [D("HIGH")];
    const out = filterByThreshold(input, "low");
    expect(out).not.toBe(input);
  });
});

describe("rank tables", () => {
  it("SEVERITY_RANK orders the upstream names ascending", () => {
    expect(SEVERITY_RANK.INFO).toBeLessThan(SEVERITY_RANK.LOW);
    expect(SEVERITY_RANK.LOW).toBeLessThan(SEVERITY_RANK.MEDIUM);
    expect(SEVERITY_RANK.MEDIUM).toBeLessThan(SEVERITY_RANK.HIGH);
    expect(SEVERITY_RANK.HIGH).toBeLessThan(SEVERITY_RANK.CRITICAL);
  });

  it("THRESHOLD_RANK matches SEVERITY_RANK for each named threshold", () => {
    expect(THRESHOLD_RANK.low).toBe(SEVERITY_RANK.LOW);
    expect(THRESHOLD_RANK.medium).toBe(SEVERITY_RANK.MEDIUM);
    expect(THRESHOLD_RANK.high).toBe(SEVERITY_RANK.HIGH);
    expect(THRESHOLD_RANK.critical).toBe(SEVERITY_RANK.CRITICAL);
  });
});
