# Marketplace screenshots

Three PNGs go in this directory; the main `README.md` already has
references to them, commented out. Once the files exist, uncomment
the block and the marketplace listing picks them up automatically
(vsce rewrites relative paths to the GitHub raw blob URL).

| Filename | What it shows |
|---|---|
| `01-inline.png` | Editor view of `test-fixtures/sample-workflow/release.yml` with all four GHA squiggles in the gutter. |
| `02-problems-panel.png` | The Problems panel with the four diagnostics. Each rule ID is a hyperlink now that `codeDescription.href` is wired. Capture one ID under hover state so the underline is visible. |
| `03-hover.png` | Hover tooltip on one diagnostic showing title, description, and the `Fix:` recommendation. |

## How to capture

1. From the vscode repo root: `npm run compile`.
2. Press <kbd>F5</kbd>, pick the **Run Extension (sample workflow)** debug profile.
3. In the extension-host window, open `release.yml` (the fixture auto-opens with that profile).
4. Wait for the four diagnostics to publish (~half a second).
5. Take the three screenshots described above and save them in this directory with the filenames in the table.
6. Open the main `README.md` and uncomment the `<!-- screenshot block -->` to surface them on the listing.

## Capture settings

- **Theme**: Dark+ (default dark) so the gutter colors are recognizable on white-background marketplace pages.
- **Font**: VS Code default (Consolas / Monaco / Menlo) at 14px.
- **Window width**: ~1200px so the marketplace doesn't downscale aggressively. The marketplace renders at ~960px max-width, so anything wider than that gets fit-scaled.
- **Avoid**: personal sidebar (Explorer panel collapsed), open terminal pane (closed), notifications visible. The listing should look like the user's editor will, not like a debug session.

## Why this directory is `.vscodeignore`d

The marketplace listing is rendered from GitHub's `README.md`, with relative image paths rewritten to `https://github.com/greylag-ci/pipeline-check-vscode/blob/HEAD/docs/screenshots/<file>?raw=true`. The PNGs do not need to ship inside the `.vsix` bundle, so we exclude them to keep the package small. The same path-rewrite logic applies to Open VSX.
