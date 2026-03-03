# Phase 11: Remove Agents, Claude Code & DxtService

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the entire Agent subsystem — the largest remaining backend feature. This includes the agent service directory with its own Drizzle ORM database, session/message management, Claude Code integration, plugin system (PluginService, PluginInstaller, PluginCacheStore), DXT file handling, and API server routes for agents.

Most renderer-side agent code lives inside `pages/home/` and is already deleted in Phase 07 (Remove Home/Chat). This phase focuses on the **main process backend**, **API server routes**, **agent database**, and any **remaining renderer artifacts** (hooks, types, config, services) that survived Phase 07.

## Scope

### Main Process — Agent Services (`src/main/services/agents/`)
- `AgentService.ts` — CRUD for agent entities
- `SessionService.ts` — Agent session lifecycle management
- `SessionMessageService.ts` — Message persistence for agent sessions
- `database/` — Drizzle ORM schemas, migrations, and database connection for agents
- `plugins/PluginService.ts` — Plugin discovery and management
- `plugins/PluginInstaller.ts` — Plugin installation logic
- `plugins/PluginCacheStore.ts` — Plugin metadata caching

### Main Process — Claude Code Integration (`src/main/services/agents/services/claudecode/`)
- Claude Code commands, tools, tool-permissions, transform, stream state
- Full integration with the Claude Code CLI plugin system

### Main Process — DxtService
- `src/main/services/DxtService.ts` — `.dxt` plugin file extraction and installation (called from MCP `Mcp_UploadDxt` handler)

### API Server Routes
- `src/main/apiServer/routes/agents/` — REST API endpoints for agent CRUD and sessions

### Renderer Artifacts (surviving Phase 07)
- `src/renderer/src/hooks/agents/` — `useAgent`, `useAgents`, `useActiveAgent`, `useAgentClient`, `useUpdateAgent`, `useAgentSessionInitializer`
- `src/renderer/src/services/db/AgentMessageDataSource.ts`
- `src/renderer/src/types/agent.ts`
- `src/renderer/src/config/agent.ts`
- `src/renderer/src/utils/agentSession.ts`

### Preload Namespaces (if not already removed)
- `api.agentTools.*` — `respondToPermission` (may be removed in Phase 04)
- `api.claudeCodePlugin.*` — `install`, `uninstall`, `uninstallPackage`, `listInstalled`, `writeContent`, `installFromZip`, `installFromDirectory`

### IPC Channels
- `AgentMessage_PersistExchange`, `AgentMessage_GetHistory`
- `AgentToolPermission_Request`, `AgentToolPermission_Response`, `AgentToolPermission_Result`
- `ClaudeCodePlugin_Install`, `ClaudeCodePlugin_Uninstall`, `ClaudeCodePlugin_UninstallPackage`, `ClaudeCodePlugin_ListInstalled`, `ClaudeCodePlugin_WriteContent`, `ClaudeCodePlugin_InstallFromZip`, `ClaudeCodePlugin_InstallFromDirectory`
- `Mcp_UploadDxt` handler (DxtService consumer — the MCP handler itself is already removed in Phase 04)

## Out of Scope

- Renderer agent UI in `pages/home/` (already deleted in Phase 07)
- `toolPermissions` store slice (already removed in Phase 04)
- `api.agentTools.*` preload namespace (already removed in Phase 04)
- Package.json cleanup of agent-related deps like `drizzle-orm`, `better-sqlite3` (Phase 10 handles all dependency cleanup)

## Dependencies

### Previous Phases
- **Phase 07** (strongly recommended): Phase 07 removes the Home/Chat page which contains most renderer-side agent UI components (AgentSessionMessages, AgentSessionInputbar, AgentItem, AgentContent, AgentSettingsTab, MessageAgentTools).
- **Phase 04** (recommended): Phase 04 removes `toolPermissions` store slice and `api.agentTools.*` preload.

### External Systems
- None.

## Deliverables

1. Entire `src/main/services/agents/` directory deleted (~15+ files including database schemas)
2. `src/main/services/DxtService.ts` deleted
3. `src/main/apiServer/routes/agents/` directory deleted
4. Renderer hooks, services, types, config, and utils for agents deleted
5. `api.claudeCodePlugin.*` preload namespace removed (if still present)
6. All agent-related IPC handlers removed from `src/main/ipc.ts`
7. Main process entry point cleaned of agent service initialization
8. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Edit `src/main/index.ts`
Remove initialization and cleanup calls for:
- `AgentService` (or agent service composite initialization)
- `DxtService` (if initialized separately)
- Any agent-related async startup tasks

### 2. Edit `src/main/ipc.ts` (or equivalent)
Remove IPC handler registrations for:
- `IpcChannel.AgentMessage_*`
- `IpcChannel.AgentToolPermission_*`
- `IpcChannel.ClaudeCodePlugin_*`
- `IpcChannel.Mcp_UploadDxt` (if the handler still exists after Phase 04)

### 3. Edit `src/preload/index.ts`
Remove API namespace (if still present):
- `api.claudeCodePlugin.*`
- `api.agentTools.*` (verify — should be removed in Phase 04)

### 4. Delete API server agent routes
```bash
rm -rf src/main/apiServer/routes/agents/
```
If the `apiServer/` directory is now empty (other routes removed in earlier phases), delete the entire directory.

### 5. Delete main process agent services
```bash
rm -rf src/main/services/agents/
rm -f  src/main/services/DxtService.ts
```

### 6. Delete renderer artifacts
```bash
rm -rf src/renderer/src/hooks/agents/
rm -f  src/renderer/src/services/db/AgentMessageDataSource.ts
rm -f  src/renderer/src/types/agent.ts
rm -f  src/renderer/src/config/agent.ts
rm -f  src/renderer/src/utils/agentSession.ts
```

### 7. Clean agent database
If the agent subsystem uses a separate SQLite database file (distinct from the main app database), identify and handle it:
- Check if `src/main/services/agents/database/` defines a separate database connection
- If yes, remove the database initialization from the main entry point
- Document that existing agent database files on disk can be manually deleted by users

### 8. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] No TypeScript errors referencing agent, claudeCode, dxt, or plugin modules
- [ ] `src/main/services/agents/` directory no longer exists
- [ ] `src/main/services/DxtService.ts` no longer exists
- [ ] No IPC handlers remain for `AgentMessage_*`, `AgentToolPermission_*`, `ClaudeCodePlugin_*`
- [ ] API server has no agent routes
- [ ] Selection Assistant functions correctly end-to-end

## Clarifications Needed

- **Agent database isolation**: Verify whether the agent subsystem uses a separate SQLite database or shares the main app database. If shared, the agent tables need to be dropped or left as harmless orphans (no migration needed). If separate, the database connection init must be removed.
- **`apiServer` directory disposition**: After removing agent routes, check if any other API routes remain. If the entire API server feature was removed in Phase 04 (API Server Settings), the `apiServer/` directory may already be gone. If not, evaluate whether any remaining routes are needed.
- **Drizzle ORM dependency**: The `drizzle-orm` and `better-sqlite3` packages may be used by the main app database too. Only remove these deps in Phase 10 if no other code uses them.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad, OVMS.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, SearchService, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, LAN Transfer, Data Settings, Agent Store/Presets.
- **Phase 06**: Removed Standalone Translate, Quick Phrase/Assistant, Mini Window, Agent Settings, Copilot.
- **Phase 07**: Extracted MessageContent, removed Home/Chat, changed default route to `/selection`.
- **Phase 08**: Cleaned remaining main process services (Analytics, NodeTrace, Python, etc.) and preload API namespaces.
- **Phase 09**: Simplified settings, Provider OAuth, finalized Redux store, simplified sidebar.
- **Phase 10**: Cleaned dependencies, types, i18n, assets, build config.

## Next Phase Preview

**This is the final phase.** After Phase 11, the trimming is complete. The Quick Selection Assistant should be a fully functional, lightweight Electron app with:
- ~150-200 source files (down from ~1545)
- ~100-130 npm dependencies (down from ~346)
- Only the Selection Assistant UI, AI streaming pipeline, provider/model configuration, and minimal settings
- No agent, plugin, Claude Code, or DXT subsystem overhead
