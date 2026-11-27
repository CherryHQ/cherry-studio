# Agent Note: Offline PlantUML preview

Status: proposed

English | [中文](2026-11-27-plantuml-local-render.zh.md)

## Problem

The Markdown PlantUML preview sends diagram source to `www.plantuml.com` after confirmation. Users cannot draw private diagrams offline, and rendering depends on the availability of that server.

## Proposal

- Render PlantUML code blocks locally by default, with the existing source and preview controls. Start rendering when a block finishes streaming. Remove the public server request, confirmation screen, and remote fallback.
- Bundle the official PlantUML TeaVM headless engine and reuse Viz.js for Graphviz-based layouts. Load the engine on demand in a Web Worker. Bound render time and discard work when the source or preview changes.
- Keep preprocessing offline. Diagrams can define macros inline. External URLs, local files and unbundled standard-library includes report a render error. Keep SVG sanitization and the existing zoom, copy and download actions.

## Alternatives considered

- Keep a manual remote fallback. This preserves server-only features at the cost of continuing to transmit diagram source. The chosen experience ends that transfer.
- Call a local PlantUML Java process. This requires installing or shipping a JVM and managing a child process on every desktop platform.
- Use the official browser build on the renderer thread. Its string-rendering API uses DOM APIs, and synchronous layout can delay interaction. The headless build can run in a worker.

## Acceptance criteria

- AC1 — A completed Markdown PlantUML block shows a diagram by default with external network access blocked, and the source toggle remains available. Verify a Chinese sequence diagram and a Graphviz-backed class diagram. (verification: Electron; owner: implementer)
- AC2 — Invalid source and unavailable external includes show a local render error. No PlantUML preview path sends diagram source over the network, and generated SVG cannot load external resources automatically. (verification: renderer and Electron; owner: implementer)
- AC3 — Editing, clearing or closing an in-flight preview discards its obsolete result. A timeout releases the worker and later diagrams still render. (verification: renderer; owner: implementer)

## Risks

- Some diagrams that use public-server resources, custom fonts or full Java rendering features will render differently or fail in the headless build.
- The engine increases the packaged renderer asset size. Lazy loading keeps that work out of startup and out of Markdown without PlantUML blocks.
