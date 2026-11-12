# Agent Note: One built-in tool catalog per runtime

Status: implemented

English | [中文](2026-11-11-agent-builtin-tool-catalog.zh.md)

## Problem

The Agent "Builtin tools" list was a hand-written array per runtime, so Pi and Pi Durable never offered the Cherry MCP tools they can already execute (`src/shared/ai/agentRuntimeCapabilities.ts:26`, `:135`; `src/shared/ai/builtinMcpToolName.ts:5`). The same list expressed unavailability three different ways: a Claude-only id check hid the knowledge rows entirely, browser and computer rows appeared inactive with a badge, and Generate Image read "on" with no painting model configured (`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1156`, `:1175`, `:1231`, `:1256`).

Knowledge Search declares its list and document-read dependents in the registry (`src/shared/ai/claudecode/toolRegistry.ts:286`, `:297`, `:309`) and Claude Code expands that dependency, but Pi did not, so disabling Knowledge Search still left `kb_list` and `kb_read` callable.

## Decision

A runtime's catalog is its supported native descriptors plus every canonical definition that declares `exposure === 'user'` and an `mcpServer`. Visibility therefore follows the definition, not the approval registry: registering a policy does not make a tool public, and internal tools (session, doctor, assistant, `kb_list`, `kb_read`) never become rows.

Each row persists the identity its own runtime honours, so one switch reaches the mechanism that enforces it: `mcp__cherry-tools__*` for Claude Code (`disallowedTools`), `mcp__cherry_tools__*` for Pi and Pi Durable (`excludeTools`, `tools.remove`). The identity helper is shared and renderer-safe; no agent schema change, stored id map, or new preference is needed.

Prerequisites are declared once on the canonical definition — knowledge scope on the knowledge tools, the painting model on Generate Image — and the dialog consumes them generically. An unmet prerequisite renders the row visible, unchecked and inactive with the existing badge, and availability never writes `disabledTools`, so rebinding restores the user's saved choice. Browser and computer keep their own group availability controls.

Pi and Pi Durable expand the declared MCP dependency in their runtime-effective disabled set, at initial construction and at reconciliation, without rewriting the persisted opt-out: disabling Knowledge Search also blocks `kb_list` and `kb_read`, while Manage Knowledge stays independently controlled. The result adapter derives its native Pi set from the native descriptors rather than from the UI catalog, so cataloged MCP ids keep their MCP classification and image results still render as images.

## Alternatives considered

- Hand-listing ten MCP rows per runtime: duplicate lists drift, and the omission that caused this bug is exactly that drift.
- Deriving visibility from the approval policy registry: approval registration is not a visibility contract, and it carries 45 entries including internal tools.
- Widening `PI_BUILTIN_TOOLS` or `PiBuiltinToolCategory`: MCP rows are not native Pi tools, and that array also classifies native permission capabilities.
- Storing Claude ids and translating at call time: the stored id would no longer be the identity the runtime excludes, and Pi's own aliasing rules differ per server name.
- Hiding unavailable rows: the user cannot see that the capability exists or why it is unavailable, and the saved opt-out silently reappears on rebind.
- Deferring the knowledge dependency: shipping the Knowledge Search switch while document reads stayed callable would make the new control misleading.

## Consequences

Catalog rows now carry prerequisite metadata, so a runtime that adds a public MCP definition gets a row without touching the dialog — and a definition that forgets its prerequisite now reads as available. The persisted opt-out stays a single runtime-native id per tool; switching an agent between runtimes keeps each runtime's own ids and does not translate between them.

Pi's disabled set is wider than the stored array by design. A user who disabled only Knowledge Search has `kb_list` and `kb_read` blocked at discovery and at call time, and the expansion is recomputed on every reconcile rather than saved.

A session already connected keeps the painting model captured at connection time, so a model change is reflected in the row availability immediately but not in an existing connection. Pi MCP tools are exposed through codemode, so absence from the model's immediate tool declarations does not by itself prove exclusion.

## Verification

- AC1 — `src/shared/ai/__tests__/agentRuntimeCapabilities.test.ts` projects the ten public MCP rows for `claude-code`, `pi` and `pi-durable` beside each runtime's native tools, keeps `kb_read` and other internal tools out, and retains the Windows-only PowerShell and Durable `vcc_recall` filters.
- AC2 — `EditDialogs.test.tsx` disables Generate Image for Pi and Claude, saves, reopens from the saved state and re-enables it, asserting the literal runtime-native id and that an unrelated restriction survives in both directions.
- AC3 — `PiRuntimeConnection.test.ts` and `PiDurableRuntimeConnection.test.ts` drive real linked MCP fixtures: with Knowledge Search disabled, `kb_search`, `kb_list` and `kb_read` are unavailable and refused while the enabled `kb_manage` control still executes, and the persisted `disabledTools` array is unchanged; `piDisabledTools.test.ts` pins the dependency mapping against the production naming helper.
- AC4 — `EditDialogs.test.tsx` renders a deleted painting model and an unbound knowledge base as visible, unchecked and disabled rows that save nothing, and restores the saved knowledge choice after unbind and rebind.
- AC5 — `toolResponse.test.ts` classifies a literal sanitized MCP image id as `mcp` and preserves its image content, alongside the existing native-provider and meta-tool counter-examples.
- AC6 — `builtinToolPolicy.test.ts`, `settingsBuilder.test.ts` and `toolConditions.test.ts` continue to pass, covering the approval/policy surface, Claude MCP restrictions and the Claude dependency expansion this change leaves untouched.
- AC7 — `verify-agent-note-format`, `verify-translation-pairing`, `check-doc-links`, `verify-doc-structure`, `verify-doc-frontmatter`, `gen-doc-index --check` and `gen-doc-terminology --check` pass, and `docs/dev/references/ai/adding-a-runtime.md` describes the composition and identity rules.

Focused runs at this head: main 256 passed / 2 skipped (6 files), renderer 133 passed (3 files), shared 16 passed (2 files), plus `oxlint`, `eslint` and `oxfmt` clean on every changed file. Packaged-Electron verification and live provider generation are not established here; the tests above assert dialog state and runtime exclusion, not a real image generation round trip.
