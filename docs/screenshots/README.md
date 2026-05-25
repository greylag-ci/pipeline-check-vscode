# Marketplace screenshots

Four PNGs ship today; the main `README.md` references them directly.
The marketplace listing renders relative image paths through GitHub's
raw blob URL, so the PNGs don't need to ship inside the `.vsix` —
[.vscodeignore](../../.vscodeignore) excludes `docs/**` for that
reason.

## Currently shipping (v1.1.0)

| Filename | What it shows |
|---|---|
| `01-inline-findings.png` | Full editor window with the Findings panel grouped by severity, gutter squiggles on the open workflow, activity-bar badge showing the live count, and a hover tooltip on one diagnostic. The "hero" shot — proves the whole-product story in one frame. |
| `02-hover-detail.png` | Zoomed hover on a single diagnostic — title, `--explain` prose, `Fix:` recommendation, and the `pipeline-check(GHA-XXX)` documentation link. |
| `03-change-grouping.png` | The **Change Grouping** Quick Pick showing Severity / File / Rule. |
| `04-severity-filter.png` | The new **Show / Hide Severities** Quick Pick — landed in v1.1.0. Multi-select with one-line descriptions per severity. |

## Slots still open

Two v1.1.0 surfaces aren't yet shown. Capture and drop in when
convenient; the README block will need a matching `![alt](path)` line
added underneath the existing four:

| Filename | What it shows |
|---|---|
| `05-status-bar.png` | Status-bar shield with the per-severity tally (e.g. `🛡 3C 1H`) AND the tooltip open, including the trailing `Engine v0.X.Y` line. Proves the engine-version surface. |
| `06-quickfix-lightbulb.png` | The CodeAction lightbulb dropdown on a finding, showing **Open `<RULE-ID>` documentation / Copy rule ID / Show in Pipeline-Check Findings panel**. The triage-ergonomics shot. |

## How to capture

1. From the vscode repo root: `npm run compile`.
2. Press <kbd>F5</kbd>, pick the **Run Extension (sample workflow)** debug profile.
3. In the extension-host window, `release.yml` auto-opens. Wait ~1s for the diagnostics to publish.
4. Take each screenshot per the table above and save into this directory with the matching filename.
5. Open the main `README.md` and add an `![alt](docs/screenshots/<filename>.png)` line into the screenshot block for any new captures.

## Capture settings

- **Theme**: Dark+ (default dark) so the gutter colors are recognizable on white-background marketplace pages.
- **Font**: VS Code default (Consolas / Monaco / Menlo) at 14px.
- **Window width**: ~1200px so the marketplace doesn't downscale aggressively. The marketplace renders at ~960px max-width, so anything wider than that gets fit-scaled.
- **Avoid**: personal sidebar (Explorer panel collapsed), open terminal pane (closed), notifications visible. The listing should look like the user's editor will, not like a debug session.

## Why this directory is `.vscodeignore`d

The marketplace listing is rendered from GitHub's `README.md`, with relative image paths rewritten to `https://github.com/greylag-ci/pipeline-check-vscode/blob/HEAD/docs/screenshots/<file>?raw=true`. The PNGs do not need to ship inside the `.vsix` bundle, so we exclude them to keep the package small. The same path-rewrite logic applies to Open VSX.
