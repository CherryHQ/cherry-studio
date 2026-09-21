# Tasks — rebrand-005-visual-assets

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## What changed

Ported from `references/baseline/cherry-studio` (v1.9.11):

**`build/`** — `icon.png`, `icon.icns`, `icon.ico`, `logo.png`, `tray_icon.png`,
`tray_icon_dark.png`, `tray_icon_light.png`, plus `icons/` (9 sizes, 16→1024).
`logo-lockup.png` is **new** — it had no counterpart in this fork.

**`src/renderer/assets/images/logo.png`** — added beyond the change's literal scope.
It is the in-app logo shown in the main window, onboarding, help menu, selection
toolbar, and migration window (6 consumers). Leaving it would have shipped an app
with Boss packaging and a Cherry logo on its own start screen. The reference uses
distinct artwork here — a dark-background variant for in-app display, versus the
orange-background app icon.

## Verification

Artwork confirmed visually, not assumed: the app icon is the orange/navy node-graph
mark, `logo-lockup.png` reads "THE BOSS / AGENT STUDIO", and both tray variants are
legible on their respective backgrounds. The previous `build/icon.png` was the red
Cherry "CS" mark.

All 9 icon sizes checked with `sips`: **every file's actual dimensions match its
filename**, none empty. Binary formats validated with `file`:

- `icon.icns` → Mac OS X icon, `ic12` type, 1024px
- `icon.ico` → MS Windows icon resource, **7 embedded sizes**
- PNGs → correct dimensions, 8-bit RGBA

**Bundled output hashes match the Boss sources**, which is the proof that matters:

| Bundled artifact | Hash | Source |
|---|---|---|
| `out/main/chunks/icon-Ds7dgkHY.png` | `d2b254e02c` | Boss app icon |
| `out/main/chunks/tray_icon-CTN_rJ7V.png` | `4a915b516e` | Boss tray |
| `out/renderer/assets/logo-DgQyB1we.png` | `5ce31566c0` | Boss in-app logo |

- Full `electron-vite build` → exit 0
- `pnpm lint` → exit 0

## Outstanding — needs new artwork, not a port

`src/renderer/assets/images/cherry-text-logo.svg` is a **wordmark SVG spelling
"Cherry"**, rendered in MCP settings (`McpSettings/NpxSearch.tsx:7`). It is
byte-identical in the reference fork, so that rebrand never replaced it and there is
no Boss version to port. Creating replacement artwork is design work outside this
change. Flagged for `rebrand-006` or a dedicated follow-up — it is visible Cherry
branding that survives this change.

## Not done here

Confirming the icon renders correctly in the macOS dock, Windows taskbar, and Linux
launcher needs a packaged build (`pnpm build:unpack`) and a manual look.
