---
description: Entry point for component references covering code block rendering, code execution, image previews, and data-ui
sources:
  - src/renderer/components/CodeBlockView
  - src/renderer/components/Preview
  - scripts/uiContract
---

# Components Reference

This is the entry point for shared renderer component references — the code-block
workbench and its Python execution path, the diagram preview family, and the
`data-ui` semantic selector contract that spans all app-owned DOM.

| Document | What it covers |
|---|---|
| [Code Block Rendering](./code-block-view.md) | How `CodeBlock` classifies Markdown content and `CodeBlockView` renders the fenced-code workbench across streaming states |
| [Code Execution](./code-execution.md) | In-browser Python execution via Pyodide in a Web Worker: UI, service, and worker layers |
| [Image Preview Components](./image-preview.md) | Shared Mermaid / PlantUML / SVG / Graphviz preview components, toolbar, and the `useDebouncedRender` hook |
| [UI Semantic Contract](./ui-semantic-contract.md) | The `data-ui` selector contract for themes, tests, and automation, and its build-time generation pipeline |
