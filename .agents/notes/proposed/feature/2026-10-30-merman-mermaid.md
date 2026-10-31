# Agent Note: Mermaid diagrams on Merman, with a file preview

Status: proposed

English | [中文](2026-10-30-merman-mermaid.zh.md)

## Problem

Mermaid diagrams render through the `mermaid` JavaScript package in two places: `MermaidPreview` for code blocks (chat, quick assistant, selection, translation, Markdown file previews) and the `withMermaid()` Streamdown preset in `@cherrystudio/ui`. `MermaidPreview` works around `mermaid` bugs: it measures in an off-screen element, patches `translate(undefined, NaN)` output, and watches folded containers so hidden diagrams wait for a size. Diagrams use Mermaid's own `default`/`dark` palettes and fonts, so they do not match the design system, and nodes carry decorative drop shadows.

The Agent file pane opens `.mmd` and `.mermaid` files as plain text; there is no diagram preview.

## Proposal

### Renderer

- Replace `mermaid` and `@streamdown/mermaid` with [Merman](https://github.com/Latias94/merman) `@mermanjs/web-render` 0.9.2, pinned exactly. Merman is Mermaid reimplemented in Rust and compiled to WASM, targeting Mermaid 12.1 behaviour. The `mermaid` package stays installed only as a type dependency of `streamdown`; no app code imports it, so it is no longer bundled.
- A new `@cherrystudio/ui/mermaid` subpath owns the engine and runs in any realm. `loadMermaidRuntime()` loads and initializes the WASM once per realm on first use. `renderMermaidSvg(source, { theme, diagramId })` measures labels with an `OffscreenCanvas` measurer that matches Merman's DOM-based browser measurer within half a pixel on every operation real diagrams request, including CJK wrapping. Merman's structured errors become ordinary `Error`s with Merman's message.
- Rendering runs in a dedicated Web Worker (`src/renderer/workers/mermaid.worker.ts`) behind `mermaidRenderService`, following the code-highlight worker pattern. The service keeps one render in flight; a newer request for a diagram still waiting in the queue replaces it and all its callers receive the newer SVG; a render over 10 s is stopped by terminating the worker; a crashed worker is replaced on the next request.
- A worker cannot see the page's `@font-face` fonts, so the theme carries the page's font faces for its font list and the worker loads them before measuring. Without this, labels would be measured with a fallback font and overflow.
- `MermaidPreview` calls the service and mounts the result through the existing sanitized Shadow DOM path. The off-screen measurement, NaN patch, and visibility observer are removed: Merman does not depend on the container's size. `useMermaid` is deleted.
- `withMermaid()` returns a Streamdown diagram plugin backed by the same renderer.

### Theme: immersive

Diagrams follow the design system instead of a Mermaid palette:

- `resolveMermaidTheme(element)` maps Merman's semantic roles to design tokens: `--muted` node fill, `--secondary` alternate fill, `--foreground` text, `--muted-foreground` secondary text and lines, `--border-strong` borders, `--background-subtle`/`--border` clusters, `--warning-subtle`/`--warning-border` notes, `--success`, and `--chart-1` to `--chart-5` for categorical series.
- The canvas is the colour actually painted behind the preview: every translucent ancestor background is composited over the first opaque one. The SVG background is transparent, so the diagram sits directly on its surface (the file pane, a chat code block) in light and dark mode.
- Labels use the document body font, not a surrounding code block's monospace font.
- Mermaid's default node drop shadow is turned off (`site_config.themeVariables.dropShadow = 'none'`).
- Token values are `oklch`, so each one is resolved to opaque hex by painting it on a one-pixel canvas.
- The preview re-renders when the app theme changes.

### File preview

- A `mermaid` FilePreview plugin handles `.mmd` and `.mermaid`. It reads the file and renders it with `MermaidPreview` in `contain` fit: the diagram fills the preview, centred, scaled down to fit both width and height but never enlarged past its own size. Empty files show the empty state; unreadable files show the load error. The shared preview toolbar (pan, zoom, copy, download, expand) applies.
- Because the plugin is a rendered preview, the Agent file pane opens these files in preview with the existing Edit/Preview toggle; editing uses the live editor on the source.
- `renderSvgInShadowHost` gains `fit: 'width' | 'contain'`. `width` is the existing behaviour and stays the default for code blocks, PlantUML, Graphviz, and SVG.

### Limits

- Merman's `interactive` resource profile rejected a 200-node flowchart, and on the main thread a 400-message sequence diagram blocked the window for 260 ms. The worker uses the same profile with only the layout-work limit raised (400M units) and bounds time with its 10 s deadline instead. Measured in the app: a 300-node flowchart and a 400-message sequence diagram render with no main-thread long task.
- The WASM is about 11 MB (4.4 MB gzipped). Cold initialization measured 37 ms in development.
- The file editor's highlighter has no Mermaid grammar, so `.mmd` source is not syntax-highlighted. This is unchanged from before.

## Alternatives considered

- **Keep `mermaid` and only add the file preview:** rejected by the user on 2026-10-30. Two engines would render diagrams differently and both would ship.
- **File preview first, code blocks later:** offered and not chosen; switching every path at once keeps one renderer.
- **Map tokens through `site_config.themeVariables`:** rejected. Merman's `presentation.theme` takes semantic roles and a series palette directly, which matches the design tokens one to one.
- **Use the code block's surrounding font:** rejected after testing. Code blocks inherit a monospace font, which reads as code rather than a diagram.
- **Split source and live preview while editing:** not chosen; the pane keeps its existing Edit/Preview toggle.

## Acceptance criteria

- AC1 — Code-block Mermaid diagrams (chat Markdown and Markdown file previews) render through Merman, and no app code imports `mermaid` or `@streamdown/mermaid`. (verification: renderer and Electron; owner: implementer)
- AC2 — Diagrams take node, text, border, line, and categorical colours from the design tokens, use the body font, have no drop shadow, and sit on the background actually behind them, in both light and dark mode, including inside a translucent code block. (verification: Electron; owner: implementer)
- AC3 — Opening a `.mmd` or `.mermaid` file in the Agent file pane shows the diagram centred and fitted to the preview without enlarging it, with the Edit/Preview toggle; empty and unreadable files show their states. (verification: renderer and Electron; owner: implementer)
- AC4 — Invalid source shows Merman's parse error; when a newer source fails, the previous diagram stays in place. (verification: renderer and Electron; owner: implementer)
- AC5 — Rendering, including a 300-node flowchart, never blocks the main thread; a render that runs past the deadline is stopped and reported, and later diagrams still render. (verification: renderer and Electron; owner: implementer)

## Risks

- Merman does not promise pixel-identical output to browser Mermaid; text measurement, HTML labels, and some families can differ from what users saw before.
- Merman 0.9.2 is a young dependency (published 2026-10-22). Upgrades should be reviewed against rendered output, as its own upgrade guides advise.
- Canvas measurement is an approximation of the DOM measurer; a font or operation it does not cover falls back to Merman's deterministic measurement.
- The `.mmd` files the user edits in the pane are not syntax-highlighted.
