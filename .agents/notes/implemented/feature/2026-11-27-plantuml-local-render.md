# Agent Note: Offline PlantUML preview

Status: implemented

English | [中文](2026-11-27-plantuml-local-render.zh.md)

## Problem

The previous Markdown PlantUML preview sent diagram source to `www.plantuml.com` after confirmation. Users could not draw private diagrams offline, and rendering depended on the availability of that server.

## Decision

- PlantUML code blocks render locally by default when streaming ends. The source and preview controls remain available.
- A Web Worker loads the PlantUML TeaVM headless engine on demand and uses Viz.js for Graphviz-based layouts. Preview changes cancel obsolete work, and a render that exceeds 10 seconds releases the worker.
- Preprocessing runs offline and supports inline macros. External URLs, local files and unbundled standard-library includes report a render error. The sanitized SVG uses the existing zoom, copy and download controls.

## Alternatives considered

- Keep a manual remote fallback. This preserves server-only features at the cost of continuing to transmit diagram source. The chosen experience ends that transfer.
- Call a local PlantUML Java process. This requires installing or shipping a JVM and managing a child process on every desktop platform.
- Use the official browser build on the renderer thread. Its string-rendering API uses DOM APIs, and synchronous layout can delay interaction. The headless build can run in a worker.

## Consequences

- Diagrams that depend on remote resources, unsupported standard-library imports, or full Java rendering can fail or look different.
- The production build includes a separate PlantUML worker asset of about 13.1 MB. The Markdown renderer loads it when a preview needs it.

## Verification

- AC1 — The macOS Electron chat rendered a Chinese sequence diagram and a Graphviz-backed class diagram with external requests blocked and switched between source and preview.
- AC2 — The macOS Electron chat displayed syntax and external-include errors without external requests. `PlantUmlPreview.test.tsx` verifies removal of SVG image and stylesheet elements.
- AC3 — `PlantUmlPreview.test.tsx` verifies discarded results on source change, clear and close, plus timeout recovery.
