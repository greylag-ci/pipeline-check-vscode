// Unit tests for the preflight gate and the probe-orchestration logic.
// The actual child_process.spawn shim is intentionally NOT covered here
// — exercising it would require a real Python interpreter, which we
// can't depend on in CI. The `spawner` injection point keeps the
// orchestration testable in isolation.

import { describe, it, expect } from "vitest";

import {
  formatPreflightFailure,
  isAtLeast,
  MIN_ENGINE_VERSION,
  parseVersion,
  PreflightError,
  runPreflight,
  shouldPreflight,
  type PreflightSpawner,
} from "./preflight";

describe("shouldPreflight", () => {
  // Gate is conservative on purpose: any deviation from the
  // out-of-the-box "python -m pipeline_check.lsp" shape skips the probe
  // and lets the existing 30s start-timeout do its job. Better to miss
  // a fast-fail opportunity than to falsely accuse a working setup.

  it("returns true for the default `python` + `-m pipeline_check.lsp` shape", () => {
    expect(shouldPreflight("python", ["-m", "pipeline_check.lsp"])).toBe(true);
  });

  it("matches python3 and python3.11 by basename", () => {
    expect(shouldPreflight("python3", ["-m", "pipeline_check.lsp"])).toBe(true);
    expect(shouldPreflight("python3.11", ["-m", "pipeline_check.lsp"])).toBe(
      true,
    );
  });

  it("matches the venv interpreter via absolute path", () => {
    expect(
      shouldPreflight("C:\\repo\\.venv\\Scripts\\python.exe", [
        "-m",
        "pipeline_check.lsp",
      ]),
    ).toBe(true);
    expect(
      shouldPreflight("/home/x/.venv/bin/python3.12", [
        "-m",
        "pipeline_check.lsp",
      ]),
    ).toBe(true);
  });

  it("matches any pipeline_check.* module (future sub-entrypoints)", () => {
    // A future pipeline_check.lsp.daemon entrypoint should still
    // preflight without a code change here — the marker is "the args
    // load pipeline_check", not "the args are exactly these".
    expect(
      shouldPreflight("python", ["-m", "pipeline_check.lsp.daemon"]),
    ).toBe(true);
  });

  it("returns false for a non-Python command basename", () => {
    // Wrapper scripts that load pipeline_check via some bootstrap
    // (mise shim, poetry shim, custom launcher) don't accept `-c`
    // semantics — we'd produce a false negative.
    expect(
      shouldPreflight("my-python-wrapper.sh", ["-m", "pipeline_check.lsp"]),
    ).toBe(false);
    expect(shouldPreflight("uv", ["-m", "pipeline_check.lsp"])).toBe(false);
  });

  it("returns false for non-default args", () => {
    expect(shouldPreflight("python", [])).toBe(false);
    expect(shouldPreflight("python", ["-c", "import other_module"])).toBe(
      false,
    );
    expect(shouldPreflight("python", ["-m", "some_other_module"])).toBe(false);
  });
});

describe("formatPreflightFailure", () => {
  // The message is shown verbatim in the LSP-failure toast and forms
  // the user's only diagnostic for "why didn't this work". Branch picks
  // are part of the user-facing contract.

  it("identifies a missing module from ModuleNotFoundError (Py3.6+)", () => {
    const msg = formatPreflightFailure(
      1,
      "Traceback (most recent call last):\n" +
        '  File "<string>", line 1, in <module>\n' +
        "ModuleNotFoundError: No module named 'pipeline_check'\n",
      "python",
    );
    expect(msg).toBe(
      'pipeline_check is not installed for the Python interpreter at "python"',
    );
  });

  it("identifies a missing module from the older ImportError text", () => {
    const msg = formatPreflightFailure(
      1,
      "ImportError: No module named pipeline_check\n",
      "python3",
    );
    expect(msg).toBe(
      'pipeline_check is not installed for the Python interpreter at "python3"',
    );
  });

  it("identifies a missing pip metadata install (PackageNotFoundError)", () => {
    const msg = formatPreflightFailure(
      1,
      "importlib.metadata.PackageNotFoundError: No package metadata was found for pipeline-check",
      "python",
    );
    expect(msg).toBe(
      'pipeline_check is installed but pip metadata is missing for "python"; please reinstall via pip',
    );
  });

  it("surfaces the last stderr line for unknown failures", () => {
    const msg = formatPreflightFailure(
      1,
      "Something exploded\nSyntaxError: invalid syntax",
      "python",
    );
    expect(msg).toBe(
      "pipeline_check import probe failed: SyntaxError: invalid syntax",
    );
  });

  it("falls back to exit code when stderr is empty", () => {
    expect(formatPreflightFailure(2, "", "python")).toBe(
      "pipeline_check import probe failed (exit 2)",
    );
  });

  it("renders a null exit code as '?'", () => {
    // null exit code happens when the child was killed by a signal —
    // mostly our own timeout-kill or a SIGSEGV.
    expect(formatPreflightFailure(null, "", "python")).toBe(
      "pipeline_check import probe failed (exit ?)",
    );
  });
});

describe("runPreflight", () => {
  // Drive the orchestration through a fake spawner so we can assert
  // every branch (success, ModuleNotFoundError, timeout, spawn error,
  // out-of-date) without involving a real interpreter.

  function probe(
    stdout: string,
    stderr: string = "",
    code: number | null = 0,
  ): PreflightSpawner {
    return () => ({
      done: Promise.resolve({ code, stdout, stderr }),
      kill: () => undefined,
    });
  }

  it("resolves with the captured version on success", async () => {
    const ok = await runPreflight("python", { spawner: probe("1.2.3\n") });
    expect(ok.version).toBe("1.2.3");
  });

  it("trims trailing whitespace from the captured version", async () => {
    const ok = await runPreflight("python", { spawner: probe("  1.2.3  \r\n") });
    expect(ok.version).toBe("1.2.3");
  });

  it("uses the LAST non-empty stdout line so deprecation warnings don't poison the version", async () => {
    // importlib.metadata can emit DeprecationWarning lines on some
    // Pythons; the version is the final print() output. Anchoring to
    // the last line keeps the parser robust against that noise.
    const ok = await runPreflight("python", {
      spawner: probe("DeprecationWarning: blah blah\n1.2.3\n"),
    });
    expect(ok.version).toBe("1.2.3");
  });

  it("rejects with PreflightError reason=missing on ModuleNotFoundError", async () => {
    const err = await runPreflight("python", {
      spawner: probe(
        "",
        "ModuleNotFoundError: No module named 'pipeline_check'",
        1,
      ),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).reason).toBe("missing");
  });

  it("rejects with PreflightError reason=out_of_date when version is below minVersion", async () => {
    const err = await runPreflight("python", {
      spawner: probe("0.5.0\n"),
      minVersion: "1.0.0",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).reason).toBe("out_of_date");
    // The captured version travels through the error so the toast
    // can show "you're on v0.5.0".
    expect((err as PreflightError).version).toBe("0.5.0");
    expect((err as Error).message).toContain("v0.5.0");
    expect((err as Error).message).toContain("v1.0.0");
  });

  it("rejects with PreflightError reason=other when zero exit yields empty stdout", async () => {
    // A package whose metadata returns an empty string — unlikely but
    // not impossible. We treat it as a corrupt install rather than
    // silently passing version "" through the rest of the pipeline.
    const err = await runPreflight("python", {
      spawner: probe(""),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).reason).toBe("other");
  });

  it("rejects with PreflightError reason=timeout when the probe hangs past timeoutMs", async () => {
    // The probe `done` only resolves when kill() races us — simulates
    // a hung interpreter. kill() is what the orchestration calls when
    // the timeoutMs timer fires; resolving the promise from inside
    // kill() lets the orchestration's await complete so the
    // `timedOut` branch surfaces.
    let resolveDone: (v: {
      code: number | null;
      stdout: string;
      stderr: string;
    }) => void = () => undefined;
    let killed = false;
    const spawner: PreflightSpawner = () => ({
      done: new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((r) => {
        resolveDone = r;
      }),
      kill: () => {
        killed = true;
        resolveDone({ code: null, stdout: "", stderr: "" });
      },
    });
    const err = await runPreflight("python", {
      spawner,
      timeoutMs: 20,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).reason).toBe("timeout");
    expect(killed).toBe(true);
  });

  it("rejects with PreflightError reason=other on ENOENT-shaped stderr (spawn failure)", async () => {
    const err = await runPreflight("python", {
      spawner: probe("", "ENOENT: spawn python ENOENT", null),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).reason).toBe("other");
  });
});

describe("parseVersion", () => {
  it("splits MAJOR.MINOR.PATCH into numeric segments", () => {
    expect(parseVersion("1.2.3")).toEqual({
      parts: [1, 2, 3],
      prerelease: false,
    });
  });

  it("handles two-segment versions (MAJOR.MINOR with implicit .0 patch)", () => {
    expect(parseVersion("1.2")).toEqual({ parts: [1, 2], prerelease: false });
  });

  it("flags pre-release suffixes (rc, dev, alpha, beta)", () => {
    expect(parseVersion("1.2.3rc1").prerelease).toBe(true);
    expect(parseVersion("1.2.3.dev0").prerelease).toBe(true);
    expect(parseVersion("1.2.3-alpha.1").prerelease).toBe(true);
    expect(parseVersion("1.2.3b2").prerelease).toBe(true);
  });

  it("returns zero parts for garbage input but does not throw", () => {
    expect(parseVersion("").parts).toEqual([]);
    expect(parseVersion("not-a-version")).toEqual({
      parts: [],
      prerelease: true,
    });
  });

  it("trims leading/trailing whitespace", () => {
    expect(parseVersion("  1.2.3  ")).toEqual({
      parts: [1, 2, 3],
      prerelease: false,
    });
  });
});

describe("isAtLeast", () => {
  // The version-comparison behavior pinned here is the contract every
  // call site relies on (preflight's min-version assertion today,
  // every future "this feature needs engine X.Y" check).

  it("returns true for equal numeric versions", () => {
    expect(isAtLeast("1.2.3", "1.2.3")).toBe(true);
  });

  it("returns true when actual is strictly greater", () => {
    expect(isAtLeast("1.2.4", "1.2.3")).toBe(true);
    expect(isAtLeast("1.3.0", "1.2.99")).toBe(true);
    expect(isAtLeast("2.0.0", "1.99.99")).toBe(true);
  });

  it("returns false when actual is strictly less", () => {
    expect(isAtLeast("1.2.2", "1.2.3")).toBe(false);
    expect(isAtLeast("0.9.9", "1.0.0")).toBe(false);
  });

  it("treats missing segments as zero on either side", () => {
    expect(isAtLeast("1.2", "1.2.0")).toBe(true);
    expect(isAtLeast("1.2.0", "1.2")).toBe(true);
    expect(isAtLeast("1.2", "1.2.3")).toBe(false);
    expect(isAtLeast("1.2.3", "1.2")).toBe(true);
  });

  it("ranks pre-release versions BELOW their corresponding release", () => {
    // The whole point of a min-version assertion is to refuse engines
    // that lack a feature; an RC of the target release may not have
    // shipped that feature yet, so we treat it as too old.
    expect(isAtLeast("1.2.3rc1", "1.2.3")).toBe(false);
    expect(isAtLeast("1.2.3.dev0", "1.2.3")).toBe(false);
  });

  it("still passes pre-releases of a higher version", () => {
    // 1.2.4rc1 has all of 1.2.3's features (the rc is for the NEXT
    // release), so it should pass a 1.2.3 min-version check.
    expect(isAtLeast("1.2.4rc1", "1.2.3")).toBe(true);
  });

  it("treats both-prerelease pairs as equal when numeric parts match", () => {
    // Reasonable default: we don't try to compare rc1 vs rc2.
    expect(isAtLeast("1.2.3rc2", "1.2.3rc1")).toBe(true);
    expect(isAtLeast("1.2.3rc1", "1.2.3rc2")).toBe(true);
  });
});

describe("MIN_ENGINE_VERSION constant", () => {
  it("is a well-formed numeric MAJOR.MINOR.PATCH version", () => {
    // Sanity check: a typo here would silently disable the check.
    expect(MIN_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("passes its own isAtLeast check (the floor is self-consistent)", () => {
    expect(isAtLeast(MIN_ENGINE_VERSION, MIN_ENGINE_VERSION)).toBe(true);
  });
});
