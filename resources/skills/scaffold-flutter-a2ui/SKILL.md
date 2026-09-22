---
name: scaffold-flutter-a2ui
description: Layer an A2UI rendering host onto a Flutter project, with a parity test asserting the same output as the web and MCP-UI hosts. Use for mobile agent UI, cross-platform A2UI rendering, or Flutter surfaces driven by agent output.
---

> ## UNAVAILABLE IN THIS PROJECT
>
> This skill drives a shell scaffolder that `prometheus-skills-mini` does not ship. The scaffolders are
> 2,879 lines of bash across 7 files that generate React/Vite/Tauri/Flutter starter projects; porting
> them is a separate change from the refiner core, and this project forbids executing a `.sh` at all
> (C1, C3) — so the commands below **will not run here**.
>
> The skill is carried rather than deleted so its interface and intent stay visible, and it says so
> loudly rather than appearing functional and failing on invocation. A loud absence beats a silent
> breakage.
>
> **Follow-up:** port the scaffolders to Node, or drop these skills. Tracked in
> `.prometheus/decisions.md` (2026-09-21, scope of the artifact-refiner port).

# Scaffold an A2UI host for Flutter

A2UI is the shared UI vocabulary across transports. This emits the **mobile**
surface, so an agent's UI is identical whether a client arrives over AG-UI
(web), MCP-UI (MCP clients), or Flutter.

```bash
bash scripts/scaffold-flutter-a2ui.sh --target <flutter-project>
```

## What it emits

| Path | Role |
|---|---|
| `lib/a2ui/a2ui_surface_controller.dart` | owns message intake; no `material` import |
| `lib/a2ui/a2ui_surface_widget.dart` | reads the store, renders `Surface` |
| `lib/a2ui/a2ui_translation.dart` | the v1.0 → v0.9 seam |
| `test/a2ui_parity_test.dart` | **the parity guarantee** |
| `assets/a2ui/source.a2ui.json` | the shared document, same one the web host renders |

**The scaffolder runs the parity test before reporting success.** It fails
loudly rather than emitting code it has not verified.

## Parity

The test drives the same A2UI document as the web host and asserts the same
observable facts — heading, body text, two labelled buttons. If it fails after a
dependency bump, the surfaces have drifted: fix the drift, do not relax the
assertion.

## Packages

`genui` is the renderer; `a2ui_core` supplies the message types.
**`a2ui_flutter` is not the SDK** — at `0.0.1-wip002` it is an unmodified
`dart create` template with no implementation.

## Reference

- Schema: `references/schemas/a2ui-component.schema.json`
- Adapter: `references/domain/a2ui.md`
- Web host: `scripts/scaffold-react-vite-a2ui.sh`
- MCP-UI host: `scripts/scaffold-react-vite-mcp-ui.sh`
