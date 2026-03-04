# Research: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04

## Summary

This document resolves all unknowns identified during Technical Context analysis and documents key findings from codebase exploration that affect Phase 04 implementation scope.

---

## Finding 1: Spec Assumption #2 is Incorrect (CRITICAL)

### Decision
The Phase 04 implementation must include cleanup of TypeScript references in the Chat/AI pipeline, in addition to the deletions specified in the Phase 04 documentation.

### Rationale
The feature spec assumed "No other features outside of Settings reference or depend on the MCP, Web Search, or API Server systems being removed." Codebase investigation proves this false.

The following files outside of Settings import from the three deleted store slices (`store/mcp`, `store/websearch`, `store/toolPermissions`):

**Exclusively about deleted features (safe to DELETE outright):**
- `src/renderer/src/hooks/useMCPServers.ts` — imports `addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer` from `store/mcp`
- `src/renderer/src/hooks/useWebSearchProviders.ts` — imports from `store/websearch`

**Shared files needing targeted import removal:**
- `src/renderer/src/hooks/useAppInit.ts` — imports from `store/toolPermissions`
- `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts` — imports `CherryWebSearchConfig` from `store/websearch`
- `src/renderer/src/aiCore/utils/websearch.ts` — imports `CherryWebSearchConfig` from `store/websearch`
- `src/renderer/src/aiCore/utils/options.ts` — imports `getWebSearchParams` from `aiCore/utils/websearch`
- `src/renderer/src/pages/home/...` — multiple Chat-page components import from `store/toolPermissions` and MCP utilities

**AI Core MCP utilities (Chat pipeline — safe to leave for Phase 07, OR delete if they exclusively serve MCP):**
- `src/renderer/src/aiCore/utils/mcp.ts`
- `src/renderer/src/aiCore/tools/WebSearchTool.ts` (Phase 04 doc: DELETE)
- `src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts` (Phase 04 doc: DELETE)

**Impact on acceptance criteria SC-001:** Without cleaning up these cross-references, `pnpm build:check` will fail with TypeScript "cannot find module" errors for each deleted store slice. The Q1 clarification ("future-removal features may degrade") permits these Chat-page features to break functionally, but SC-001 requires the *build* to pass. TypeScript errors are a build failure, not a runtime degradation.

### Resolution Strategy
After deleting the Phase 04 files, run `pnpm build:check` to collect the exact TypeScript errors. For each error:
1. If the erroring file is exclusively about the removed feature → DELETE it
2. If the erroring file is shared → REMOVE only the specific import/usage of the deleted module (replace with a no-op or remove the code block)
3. If deleting shared code causes cascading errors in other shared files → fix those too

### Alternatives Considered
- **Stub deleted modules with empty exports**: Creates fake `store/mcp.ts` re-exports. Rejected — leaves dead code and confuses future phases.
- **Ignore TypeScript errors with `@ts-ignore`**: Rejected — violates the "no TypeScript errors" acceptance criterion.
- **Defer TypeScript cleanup to Phase 07**: Rejected — SC-001 requires build to pass after Phase 04.

---

## Finding 2: Settings Page Divider Analysis

### Decision
Remove the `<Divider />` between the `mcp`/`websearch`/`api-server` group and the `quickphrase` item. Keep the divider above the `quickphrase` item since it separates the tools group from the remaining items.

### Rationale
Examining `SettingsPage.tsx` (lines 80–111), the MCP, Web Search, and API Server items sit between two `<Divider />` components:
- Line 80: `<Divider />` (above the MCP/WebSearch/API group)
- Line 111: `<Divider />` (below the API Server item, above Quick Phrase)

After removing the three items, there would be two consecutive `<Divider />` components with nothing between them. The upper divider must be removed; the lower one (before Quick Phrase) must remain.

---

## Finding 3: McpLogo Icon Import

### Decision
Remove the `McpLogo` import from `SettingsPage.tsx` as it is only used for the MCP menu item being deleted.

### Rationale
`import { McpLogo } from '@renderer/components/Icons'` appears at line 2 of `SettingsPage.tsx`. The only usage is `<McpLogo width={18} height={18} style={{ opacity: 0.8 }} />` in the MCP menu item. After that item is removed, the import becomes unused and will cause a lint error.

The `Search` and `Server` icons from lucide-react (used for WebSearch and API Server items) may also become orphaned if not used elsewhere in the file. Investigation shows `Search`, `Server` are imported in the lucide block at lines 8–18 — they must also be removed from the import destructure.

---

## Finding 4: MCPService and ApiServerService in main/index.ts

### Decision
Remove MCPService import, initialization, and cleanup. Remove ApiServerService start logic and cleanup.

### Rationale
`src/main/index.ts` contains:
- Line 24: `import mcpService from './services/MCPService'`
- Line 264: `await mcpService.cleanup()`
- Lines 20, 191–209: `apiServerService` — used for start logic with agent check

Note: `ApiServerService` itself is out of Phase 04 scope per the original Phase doc ("API Server Settings" settings page is removed, but the service itself may be used by the agent infrastructure). **Research finding**: The main/index.ts startup code conditionally starts the API server if agents exist. This is likely Chat-related (Phase 07). Since the settings page for API Server is removed, users can no longer configure it — but if the service itself is still needed by agents in Phase 07, its removal should be confirmed.

**Resolution**: The Phase 04 doc explicitly lists `MCPService` as deleted. `SearchService` (hidden browser window web scraper) is also deleted. `ApiServerService` initialization in `main/index.ts` should be removed per the Phase 04 doc which removes the API server settings — but the service file itself (`ApiServerService.ts`) is NOT in the Phase 04 deletion list. Phase 04 doc only removes the *settings UI* for API server, not the backend service. Clarify: the plan will remove the `api.apiServer.*` preload namespace and the settings page route, but keep the `ApiServerService` main-process service intact.

---

## Finding 5: i18n Key Scope

### Decision
Remove the `settings.mcp.*` top-level key group, `settings.tool.websearch.*` keys, and `apiServer.*` top-level key group from all three locale files (`en-us.json`, `zh-cn.json`, `zh-tw.json`).

### Rationale
Investigation of `en-us.json` confirms large `settings.mcp` key trees and `apiServer` key trees. After removal, run `pnpm i18n:sync` to re-synchronize the template and eliminate any sort/validation errors before `pnpm build:check`.

---

## Finding 6: Redux Persist Blacklist

### Decision
Remove `'toolPermissions'` from the `blacklist` array in `persistReducer` config in `src/renderer/src/store/index.ts`. Do not add a migration step.

### Rationale
The existing code at line 73: `blacklist: ['runtime', 'messages', 'messageBlocks', 'tabs', 'toolPermissions']`. Removing `'toolPermissions'` from this array is safe — the slice itself will be deleted, so it can no longer be accidentally persisted. No migration is needed because persisted data that includes a `toolPermissions` key will simply be ignored by redux-persist when the slice no longer exists in the root reducer.

---

## Artifact Generation Matrix (Final)

Post-research re-evaluation: **no changes from initial matrix**. The research confirmed the project is a desktop-app with no new services being added. All SKIP decisions hold.
