---
description: Current Mermaid, PlantUML, SVG, and Graphviz preview pipeline with sanitized Shadow DOM rendering and shared controls
sources:
  - src/renderer/components/Preview
  - packages/ui/src/lib/mermaid
  - src/renderer/services/MermaidRenderService.ts
  - src/renderer/workers/mermaid.worker.ts
---

# Image Preview Components

`src/renderer/components/Preview/` provides the special-language previews used
by `CodeBlockView`. The current language mapping is:

| Code language | Component | Renderer |
|---|---|---|
| `mermaid` | `MermaidPreview` | Merman (Rust Mermaid compiled to WASM) through `@cherrystudio/ui/mermaid` |
| `plantuml` | `PlantUmlPreview` | Remote `www.plantuml.com` SVG endpoint |
| `svg` | `SvgPreview` | Supplied SVG string |
| `dot`, `graphviz` | `GraphvizPreview` | Lazily initialized `@viz-js/viz` instance |

The four components are lazy-loaded by
`CodeBlockView/constants.ts::SPECIAL_VIEW_COMPONENTS`.

## Shared rendering path

Each preview passes its renderer to `useDebouncedRender`, then renders the
result through `ImagePreviewLayout`:

```text
source change
  → useDebouncedRender (300 ms by current callers)
  → format-specific renderer
  → renderSvgInShadowHost
  → ImagePreviewLayout
    ├─ loading overlay or error
    ├─ sanitized SVG in Shadow DOM
    └─ optional ImageToolbar
```

`useDebouncedRender` owns the host ref, loading/error state, debounced trigger,
cancel, and an optional `shouldRender` predicate. Rendering runs inside
`React.startTransition`. Cancelling drops a pending debounce; it does not abort
an asynchronous render that has already started.

## SVG boundary

All four formats end at `renderSvgInShadowHost`. Before parsing, it sanitizes the
SVG with DOMPurify, allowing the additional SVG tags/attributes required by the
renderers. It then parses the result as SVG, falls back to an HTML parse only to
recover an SVG element, normalizes its sizing, and mounts it in an open Shadow
DOM with local base styles. Sizing defaults to `fit: 'width'`: the SVG scales to
the host's width up to its own width. `fit: 'contain'` also fits the host's
height, centres the SVG, and never enlarges it past its own height; it is meant
for hosts with a fixed height, such as the Mermaid file preview.

Shadow DOM provides style isolation; DOMPurify is the content-safety boundary.
Do not replace this path with direct `innerHTML` in a preview component.

## Shared layout and controls

`ImagePreviewLayout` uses `useImageTools` for pan, zoom, copy, download, and
expanded-dialog behavior. When `enableToolbar` is true, `ImageToolbar` exposes:

- four-direction pan in 20 px steps;
- zoom in/out in 0.1 steps;
- reset to absolute pan `(0, 0)` and zoom `1`;
- expanded dialog.

The layout exposes pan, zoom, copy, download, and the expanded dialog through
its preview ref so `CodeBlockView` tools and the RichEditor code block toolbar
can operate on the same SVG. The Notes editor keeps zoom and pan in the
expanded dialog, because an inline diagram scrolls with the note.

SVG, Graphviz, PlantUML, and Mermaid diagrams are centered in their host.

## Format-specific behavior

### Mermaid

`MermaidPreview` renders through `mermaidRenderService`, which runs
`renderMermaidSvg` from `@cherrystudio/ui/mermaid` in a dedicated Web Worker
(`workers/mermaid.worker.ts`), so layout never blocks the window. The service
keeps one render in flight; a newer request for a diagram still waiting in the
queue replaces it, and every caller of that diagram receives the newer SVG. A
render that runs longer than 10 s is stopped by terminating the worker, and a
crashed worker is replaced on the next request. Rendering does not depend on the
container's size, so folded or hidden diagrams render like visible ones.

Labels are measured with an `OffscreenCanvas` (`canvas-text-measurer.ts`), which
works in the worker and matches Merman's DOM-based browser measurer within half a
pixel. The worker loads the page's `@font-face` web fonts for the theme's font
list (`fonts.ts`), because a worker cannot see the page's fonts; without them it
would measure with a fallback font and labels would not fit.

The theme comes from `resolveMermaidTheme(container)`: Merman's semantic roles
map to design tokens (`--muted` node fill, `--foreground` text, `--border-strong`
borders, `--muted-foreground` lines, `--chart-1` to `--chart-5` for categorical
series). The canvas is the colour actually painted behind the preview, with every
translucent ancestor layer composited, and the SVG background stays transparent,
so a diagram sits directly on its surface. Labels use the document body font.
Node drop shadows are turned off. The preview re-renders when the app theme
changes.

Merman's `interactive` resource profile is used with only its layout-work limit
raised, because the default already rejects a 200-node flowchart. Time is bounded
by the worker deadline instead.
When a newer source fails to render, the previous diagram stays in place under
the error.

### PlantUML

`PlantUmlPreview` UTF-8 encodes and raw-deflates the diagram, applies PlantUML's
custom base64 alphabet, and fetches SVG from the fixed public PlantUML server.
It reports HTTP and network failures through the shared error state. There is no
automatic retry, server selection, or server-health monitor.

### SVG

`SvgPreview` sends the supplied string directly through the shared sanitizer,
parser, size normalization, and Shadow DOM renderer.

### Graphviz

`GraphvizPreview` initializes one shared `@viz-js/viz` instance on demand,
renders DOT to SVG locally, and sends the result through the shared SVG path.
Like Mermaid, it draws on a transparent background: border, line, and text
colours come from `resolveMermaidTheme(container)`, with Helvetica as the label
face because Graphviz has metrics for it. These defaults are prepended to the
graph body as `graph`/`node`/`edge` statements, because Viz ignores its default
attribute options for parsed nodes; colours the DOT source sets still win. The
preview re-renders when the app theme changes.

PlantUML keeps a white backing: its server output has fixed light colours.

## Verification

```bash
pnpm test:renderer src/renderer/components/Preview
pnpm test:renderer src/renderer/components/CodeBlockView
```
