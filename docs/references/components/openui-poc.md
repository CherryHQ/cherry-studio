---
description: Render-only OpenUI proof of concept using Cherry Studio components, with a sample prompt and manual verification steps
sources:
  - src/renderer/components/Preview/OpenUiPreview.tsx
  - src/renderer/components/Preview/openUiLibrary.tsx
  - src/renderer/components/CodeBlockView/constants.ts
  - src/renderer/components/RichEditor/extensions/codeBlockShiki/CodeBlockNodeView.tsx
---

# OpenUI POC

This POC renders `openui` Markdown code fences with `@openuidev/react-lang` 1.0.1.
It uses the existing code-block preview, source view, and split view. The runtime
loads only when an OpenUI preview is opened. Rich-text code blocks contain the
lazy preview in a local Suspense boundary so loading cannot unmount the editor.

## Integration

The existing chat stream and message storage keep OpenUI Lang as ordinary Markdown
text. `CodeBlockView` passes the fence content and streaming state to
`OpenUiPreview`. OpenUI parses that text against `openUiLibrary` and renders
components from `@cherrystudio/ui`.

The library contains four components:

- `Panel(title, children)`: the root container. Children can be `Text`, `Metric`, or `DataTable`.
- `Text(text)`: plain text.
- `Metric(label, value, description)`: a labeled string or numeric value. The label and description are strings.
- `DataTable(columns, rows)`: string column names and arrays of string or numeric cells.

The POC does not register actions, functions, or tool providers. It does not execute
model-supplied HTML or JavaScript. It does not send UI data to OpenUI Cloud.
`publishObservability` is disabled, and the `lang-core` installation script is
blocked through `allowBuilds` to disable installation telemetry. The SDK can mount its inspection widget in
**development** builds; the SDK excludes that widget from production builds.

Parse failures show the existing translated preview-error message when streaming
finishes. React render failures are contained by an error boundary. Use the code
block's source view to inspect invalid output.

## Try it with an existing model

Start Cherry Studio with `pnpm dev`. Create a test assistant and add this instruction
to its system prompt. The POC does not change the prompts of existing assistants.

```text
When a structured answer helps, return one Markdown code fence labeled openui.
Use OpenUI Lang with positional arguments and one root assignment.
Available components, with arguments in this exact order:
Panel(title: string, children: array of Text, Metric, or DataTable)
Text(text: string)
Metric(label: string, value: string | number, description: string)
DataTable(columns: string[], rows: (string | number)[][])
Quote all text. Numeric metric values and table cells can be unquoted.
Do not use HTML, JavaScript,
functions, queries, actions, or components outside this list.
Example:
root = Panel("Summary", [Text("The checks passed."), Metric("Checks", "12", "All passed"), DataTable(["Package", "Status"], [["OpenUI", "Ready"]])])
```

Ask: "Show a release summary with a status table and two metrics. Use sample data."
The assistant's response should appear as a native preview while it streams.
Switch to source view and split view to inspect the same response.

For a check without a model call, paste this content into a user message or a
Markdown note:

````markdown
```openui
root = Panel("Release summary", [Text("Sample data for the OpenUI POC."), Metric("Checks", "12", "All passed"), Metric("Packages", "3", "Ready for review"), DataTable(["Package", "Status"], [["OpenUI", "Ready"], ["Cherry Studio", "Review"]])])
```
````

The same library can generate a full OpenUI system prompt with
`openUiLibrary.prompt()`. When extending the library, generate the prompt from its
schemas to keep component signatures consistent. Keep the `openui` fence instruction
in the prompt, because Cherry Studio routes rendering by the fence language.

## Verification

Run the focused integration tests:

```bash
pnpm test:renderer src/renderer/components/Preview/__tests__/OpenUiPreview.test.tsx
```

These tests use the real OpenUI runtime and Cherry Studio UI components. They check
text and table rendering, completion of a partial stream, and recovery after an
unknown component. They also check that HTML-like input stays visible as text.

For a manual failure check, send `root = Unknown("content")` inside an `openui`
fence. The preview should show an error. The source view must remain available.
Check both light and dark themes.

## Limits

This is a renderer integration POC. It does not add automatic prompt injection, a
settings switch, form state, tool execution, or action-to-chat wiring. Model output
quality depends on the selected model and prompt. Automated tests do not verify a
live provider response or the Electron desktop window.

## References

- [OpenUI repository](https://github.com/thesysdev/openui)
- [React runtime and API](https://github.com/thesysdev/openui/tree/main/packages/react-lang)
- [Code Block Rendering](./code-block-view.md)
