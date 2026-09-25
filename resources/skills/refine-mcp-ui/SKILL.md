---
name: refine-mcp-ui
description: Refine an MCP-UI resource — a ui:// resource carrying an A2UI surface, delivered over MCP tool results. Use for MCP server UI, agent tool output rendering, or cross-transport UI parity with AG-UI and Flutter hosts.
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

# Refine MCP-UI

MCP-UI is an **envelope for A2UI**, not an alternative to it.

An agent that exposes MCP, HTTP, A2A, and AG-UI endpoints serves the *same* A2UI
surface over each, so a client sees identical UI whichever transport it arrives
on. A `ui://` resource therefore carries an `a2ui` array, validated against the
same schema the AG-UI web host uses.

## Validate

```bash
boss-mini normalize-mcp-ui.mjs --input <resource.json>
```

Violations, in precedence order: `uri_scheme` · `unsupported_mime` ·
`missing_content` · `missing_a2ui_payload` · `unsupported_content_shape` ·
`invalid_a2ui_payload` · `schema_violation`.

## Scaffold a host

```bash
bash scripts/scaffold-react-vite-mcp-ui.sh --target <existing-vite-project>
```

Emits the resource store, hook, surface, sandbox proxy, a bundled A2UI guest,
trust-boundary tests, and a dev-only MCP mock. See the generated `MCP-UI.md`.

## Reference

- Schema: `references/schemas/mcp-ui-resource.schema.json`
- Adapter: `references/domain/mcp-ui.md`
- Corpus: `examples/mcp-ui-refinement/`
