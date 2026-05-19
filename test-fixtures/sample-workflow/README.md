# Sample workspace (vulnerable on purpose)

Used by the `Run Extension (sample workflow)` debug profile in this
repo. Press <kbd>F5</kbd> with the extension folder open, pick that
profile, and a fresh VS Code window opens with this folder as the
workspace. Open `.github/workflows/release.yml`; the extension should
publish several Pipeline-Check diagnostics:

- `GHA-001` — `actions/checkout@v4` is tag-pinned, not SHA-pinned.
- `GHA-004` — no top-level `permissions:` block.
- `GHA-015` — no `timeout-minutes` on the `release` job.
- `GHA-016` — `curl | bash` from a remote in the `Install deps` step.

The fixture exists only for the dev loop. Do not copy it into a real
repository.

Requires the upstream server to be installed:

```bash
python -m pip install "pipeline-check[lsp]"
```
