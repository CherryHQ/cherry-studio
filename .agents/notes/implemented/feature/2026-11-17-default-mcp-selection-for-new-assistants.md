# Agent Note: Default MCP selection for new assistants

Status: implemented

English | [中文](2026-11-17-default-mcp-selection-for-new-assistants.zh.md)

## Problem

Every new assistant starts with `mcpMode` set to `manual` (`DEFAULT_MCP_MODE` in `src/shared/data/types/assistant.ts`) and an empty `mcpServerIds` list (`src/main/data/services/AssistantService.ts`, `dto.mcpServerIds ?? []`). Users who always attach the same MCP servers must reselect them for each assistant. Issue CherryHQ/cherry-studio#19772 asks for a safe default for new assistants.

## Decision

Add one user preference, `assistant.default_mcp_server_ids` (`string[]`, default `[]`), that stores the MCP servers a new assistant inherits. It is read when the assistant creation wizard reviews its selection and when API creation omits an explicit selection.

- The preference is declared in `scripts/data-classify/data/target-key-definitions.json` and generated into `src/shared/data/preference/preferenceSchemas.ts`; the generated file is not edited by hand.
- The preference is edited in General Settings, as a multi-select of MCP servers. The control shows an empty state when no servers are configured.
- Creating an assistant initializes `mcpServerIds` from the preference, filtered to servers that still exist and are active (`mcpServer.isActive`). `mcpMode` stays at its existing default, so inherited servers are used only when the mode is `manual`, as today.
- The create dialog shows the inherited servers before the assistant is saved, and the user can change or clear them for that assistant.
- Editing an assistant never writes to the preference. Changing the preference never changes existing assistants. No migration runs.

## Alternatives considered

- Remember the last created assistant's selection. Rejected for this Spec: it copies a selection the user may not have meant to keep and makes the default depend on creation history.
- Enable all MCP servers for new assistants. Rejected: it would expose tools users never opted into.
- Add a per-server "default for new assistants" flag on the MCP server record. Rejected: it spreads one preference across the MCP server schema and makes the default harder to see in one place.
- Store the default in Cache. Rejected: Cache is losable temporary data; user settings belong in Preference (`AGENTS.md` data table).

## Contract

- AC1 — A new assistant created with a non-empty `assistant.default_mcp_server_ids` has exactly those servers in `mcpServerIds`, filtered to existing active servers (verification: unit)
- AC2 — A new assistant created with the default empty has `mcpServerIds` equal to `[]` and an unchanged `mcpMode` (verification: unit)
- AC3 — The create dialog displays the inherited servers before save, and removing one there affects only that assistant (verification: renderer)
- AC4 — Editing an existing assistant's MCP servers does not change the preference, and changing the preference does not change any existing assistant (verification: unit)
- AC5 — Deleted or inactive servers in the preference are skipped at create time without error and without being removed from the preference (verification: unit)
- AC6 — The new preference key is present in the generated preference schema, with a default of `[]` and a type of `string[]` (verification: docs gate)
- AC7 — All new user-visible strings have translations in every renderer locale and pass `pnpm i18n:check` (verification: docs gate)

## Consequences

A server removed from the MCP list stays in the preference until the user edits it; AC5 makes this a silent skip, which may confuse users who expect the list to self-clean. The create dialog adds one visible step per new assistant. Existing assistants and imported assistants are unaffected, which means the feature offers no retroactive fix.

## Verification

- AC1 — `AssistantService.test.ts` uses real SQLite relations to verify inheritance, explicit empty overrides, active-server filtering, independent edits, import/copy isolation and rollback. Browser-only MCP servers are excluded.
- AC3 — `McpStep.test.tsx` and the wizard/selector consumer suites verify the reviewed selection, explicit clearing, failed reads, retry and submission guards. The create-only `reviewedMcpServerIds` snapshot is filtered again inside the insert transaction; a later preference change never silently replaces the reviewed set. Existing explicit API selections retain their prior behavior.
- AC6 — the source key definition generates the typed preference with default `[]`. No schema/data migration changes existing assistants.
- AC7 — all 18 renderer locales include the new labels.
- Regression — `DefaultMcpServersSettings.test.tsx` checks opt-in persistence, cross-window updates, failed-save rollback and failed-load recovery.
- Regression — Browser component fixtures inspect the actual wizard shell, MCP step, default settings and catalog controls in English/light and Chinese/dark, including loading and clearing. Data/IPC and unrelated wizard steps are fixtures, not native Electron acceptance. No provider request is required by these acceptance criteria.

- AC2 — `AssistantService.test.ts` verifies empty defaults preserve the existing manual MCP mode.
- AC4 — `AssistantService.test.ts` verifies edits and later default changes remain independent.
- AC5 — `AssistantService.test.ts` verifies missing and inactive default IDs are skipped without rewriting the preference.

- Regression — Library and first-time Home preset shortcuts review the same inherited selection and can clear or cancel it before creation. Conversation imports send an explicit empty selection. The MCP step displays its successful seed catalog even if the independent picker query is cold or failed; its catalog stays mounted across wizard navigation.
