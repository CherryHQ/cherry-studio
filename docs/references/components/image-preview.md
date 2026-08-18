---
description: Current Mermaid, PlantUML, SVG, and Graphviz preview pipeline with sanitized Shadow DOM rendering and shared controls
sources:
  - src/renderer/components/Preview
---

# Image Preview Components

`src/renderer/components/Preview/` provides the special-language previews used
by `CodeBlockView`. The current language mapping is:

| Code language | Component | Renderer |
|---|---|---|
| `mermaid` | `MermaidPreview` | Mermaid library loaded by `useMermaid` |
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
DOM with local base styles.

Shadow DOM provides style isolation; DOMPurify is the content-safety boundary.
Do not replace this path with direct `innerHTML` in a preview component.

## Shared layout and controls

`ImagePreviewLayout` uses `useImageTools` for pan, zoom, copy, download, and
expanded-dialog behavior. When `enableToolbar` is true, `ImageToolbar` exposes:

- four-direction pan in 20 px steps;
- zoom in/out in 0.1 steps;
- reset to absolute pan `(0, 0)` and zoom `1`;
- expanded dialog.

The layout exposes pan, zoom, copy, and download through its preview ref so
`CodeBlockView` tools can operate on the same SVG.

## Format-specific behavior

### Mermaid

`MermaidPreview` validates with `mermaid.parse`, renders in an off-screen
measurement element, repairs the known `translate(undefined, NaN)` output, and
then mounts the SVG. A `MutationObserver` tracks visibility through folded
message containers; hidden diagrams wait until their container has dimensions.

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

## Verification

```bash
pnpm test src/renderer/components/Preview
pnpm test src/renderer/components/CodeBlockView
```
