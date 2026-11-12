# Agent Note: Agent built-in tool catalog

Status: proposed

English | [中文](2026-11-11-agent-builtin-tool-catalog.zh.md)

## Problem

The per-runtime hand-written catalog omitted Cherry MCP tools from Pi and Pi Durable although they can execute them. The current projection combines native and public MCP definitions (`src/shared/ai/agentRuntimeCapabilities.ts:26`, `:135`; `src/shared/ai/builtinMcpToolName.ts:5`). A Claude-only ID check hid knowledge rows, browser and computer rows appeared inactive with a badge, and Generate Image read on without a painting model; current availability and group controls are in `src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx:1156`, `:1175`, `:1231`, `:1256`.

Knowledge Search declares list and document-read dependents (`src/shared/ai/claudecode/toolRegistry.ts:286`, `:297`, `:309`), but Pi did not expand the dependency, leaving reads callable after search was disabled. Pi and Durable now expand effective restrictions (`src/main/ai/runtime/pi/piDisabledTools.ts:4`; `src/main/ai/runtime/pi/PiRuntimeConnection.ts:979`; `src/main/ai/runtime/piDurable/durableDesktop.ts:53`).

## Proposal

Project public MCP rows from canonical definitions with `exposure === 'user' && mcpServer !== undefined`, alongside supported native tools. The runtime-neutral approval policy registry remains the approval source, not a visibility source. Persist runtime-native IDs in `disabledTools`: `mcp__cherry-tools__*` for Claude Code, `mcp__cherry_tools__*` for Pi and Pi Durable. No agent schema change, stored ID map or new preference is needed.

Declare knowledge and painting prerequisites once on the canonical definition and consume them in the dialog. Without a bound knowledge base or resolved painting model, the row remains visible, unchecked and inactive without changing the saved choice. Browser and computer retain their group controls. Expand runtime-effective disabled tools from declarations without rewriting persisted choices: disabling Knowledge Search blocks list and read; Manage Knowledge remains independent. Approval remains separate from opt-out.

This proposed Spec accompanies implementation because this automation cannot create a separate Spec stack. Human approval of the exact Spec head remains required; no approval is claimed. This does not satisfy the usual approval-before-implementation sequence.

## Alternatives considered

- Hand-list ten MCP rows per runtime: duplicate lists drift.
- Derive visibility from the policy registry: approval registration does not make a tool public.
- Widen `PI_BUILTIN_TOOLS` or `PiBuiltinToolCategory`: MCP rows are not Pi native tools and mixing them affects result classification.
- Store Claude IDs and translate at runtime: native IDs align persistence and policy without a stored map.
- Hide unavailable rows: users cannot see capabilities or their inactive state.
- Fix the knowledge dependency later: the search switch would leave document reads available.

## Acceptance criteria

- AC1 — Every supported runtime exposes the declared public MCP tools alongside its supported native tools, while internal tools stay hidden (verification: unit)
- AC2 — Disabling a row persists that runtime's native ID, and reopening and reenabling preserves unrelated restrictions (verification: renderer)
- AC3 — A disabled MCP tool is excluded or refused at runtime, including Knowledge Search's list and read dependents, while the persisted choice stays unchanged (verification: unit)
- AC4 — A missing knowledge binding or unresolved painting model renders a visible, unchecked, inactive row without mutating the saved choice (verification: renderer)
- AC5 — Catalog expansion preserves native, MCP and meta-tool classification and image results (verification: renderer)
- AC6 — Empty opt-out defaults, approval behaviour, codemode exposure, Windows-only PowerShell and Durable's `vcc_recall` omission are unchanged (verification: unit)
- AC7 — The note, its Chinese counterpart and affected developer docs describe the shipped contract and pass the docs gates (verification: docs gate)

## Risks

No live Electron or provider verification is established in this PR. A connected session keeps the painting model captured at connection time. Pi catalog tools are deferred through codemode, so absence from the model's immediate declarations does not establish exclusion. This note is proposed and human approval of the exact head remains outstanding.
