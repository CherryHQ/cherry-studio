# Phase 08: Clean Main Process Services & Preload Script

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Perform a comprehensive sweep of the main process backend and the preload IPC bridge to remove all services and API namespaces that belong to features deleted in Phases 01-07. This is a **safety-net phase** — some services may have already been deleted in earlier phases alongside their UI. This phase catches any remaining orphans and ensures the main process entry point (`index.ts`) and preload script (`preload/index.ts`) only initialize and expose what the selection assistant actually needs.

This consolidates PRD Phases 8 and 9 into a single deliverable.

## Scope

### Main Process Services to Remove (if still present)
- `MCPService`, `KnowledgeService`, `FileManagerService`, `NotesService`
- `ExportService`, `NutstoreService`, `WebDavService`, `MemoryService`
- `OllamaService`, `LMStudioService`, `CodeRunnerService`
- `UpdateService`, `MenuService` (simplify MenuService if not fully removable)
- `FileStorageService`, `UrlParserService`, `ScreenCaptureService`
- `BackupService`, `ProxyService`
- `AnalyticsService` — telemetry/usage tracking (`@cherrystudio/analytics-client`)
- `NodeTraceService` — OpenTelemetry tracing, monkey-patches `ipcMain.handle`
- `SpanCacheService` — span persistence for traces
- `PythonService` — Pyodide execution relay (main→renderer→main roundtrip)
- `CopilotService` — GitHub Copilot device-flow OAuth, token storage via `safeStorage`
- `SearchService` — hidden BrowserWindow web scraper (if not already removed in Phase 04)
- `OvmsManager` — OpenVINO model server (if not already removed in Phase 01)
- `LocalTransferService`, `lanTransfer/*` — LAN peer transfer (if not already removed in Phase 05)

### Main Process Entry Point (`src/main/index.ts`)
- Remove all `import` statements for deleted services
- Remove all initialization calls for deleted services
- Remove all `before-quit` / `will-quit` cleanup entries for deleted services

### IPC Handlers (`src/main/ipc.ts` or equivalent)
- Remove handlers for: `IpcChannel.MCP_*`, `IpcChannel.Knowledge_*`, `IpcChannel.Export_*`, `IpcChannel.Notes_*`, `IpcChannel.File_*`, `IpcChannel.Nutstore_*`, `IpcChannel.WebDav_*`, `IpcChannel.Memory_*`, `IpcChannel.CodeRunner_*`, `IpcChannel.Ollama_*`
- Remove handlers for: `IpcChannel.Analytics_*`, `IpcChannel.TRACE_*`, `IpcChannel.Python_*`, `IpcChannel.Copilot_*`, `IpcChannel.SearchWindow_*`, `IpcChannel.Ovms_*`, `IpcChannel.LocalTransfer_*`, `IpcChannel.MiniWindow_*`

### Preload Namespaces to Remove (if still present)
- `api.mcp.*`, `api.knowledgeBase.*`, `api.memory.*`
- `api.backup.*`, `api.export.*`, `api.nutstore.*`
- `api.file.*`, `api.fileService.*`, `api.proxy.*`
- `api.codeTools.*`, `api.openclaw.*`, `api.copilot.*`
- `api.searchService.*`, `api.agentTools.*`, `api.apiServer.*`
- `api.ocr.*`, `api.python.*`, `api.ollama.*`, `api.lmstudio.*`
- `api.screenCapture.*`, `api.urlParser.*`
- `api.obsidian.*`, `api.cherryin.*`, `api.cherryai.*`
- `api.localTransfer.*`, `api.claudeCodePlugin.*`
- `api.anthropic_oauth.*`, `api.trace.*`, `api.vertexAI.*`
- `api.ovms.*`, `api.webview.*`, `api.protocol.*`, `api.externalApps.*`
- `api.miniWindow.*`, `api.analytics.*`, `api.installOvmsBinary`
- `tracedInvoke` helper (if no remaining namespaces use it)

### Renderer-Side Services to Remove (if still present)
- `src/renderer/src/utils/analytics.ts` — renderer analytics utility
- `src/renderer/src/services/SpanManagerService.ts` — span management
- `src/renderer/src/services/WebTraceService.ts` — renderer trace service
- `src/renderer/src/services/PyodideService.ts` — Pyodide WASM worker wrapper
- `src/renderer/src/aiCore/plugins/telemetryPlugin.ts` — AI pipeline telemetry hook
- `src/renderer/src/aiCore/trace/AiSdkSpanAdapter.ts` — span adapter

### Trace Window to Remove
- `src/renderer/src/trace/` — entire trace viewer window (entry point + pages)

### Services to KEEP (do NOT touch)
- `SelectionService`, `WindowService`, `StoreSyncService`, `ShortcutService`
- `TrayService`, `ThemeService`, `StorageService`, `CryptoService`
- `ConfigService`, `ConfigManager`, `AppService`
- `Database init` (`src/main/databases/*`)

### Preload Namespaces to KEEP
- `api.selection.*`, `api.config.*`, `api.storage.*`
- `api.aes.*` / `api.crypto.*`, `api.window.*` / `api.windowControls.*`
- `api.storeSync.*`, `api.theme.*`, `api.shortcuts.*`
- `api.app.*`, `api.shell.*`, `api.fs.*`

## Out of Scope

- Redux store slice cleanup (Phase 09)
- Settings page simplification (Phase 09)
- Package.json dependency cleanup (Phase 10)
- Type definitions cleanup (Phase 10)

## Dependencies

### Previous Phases
- **Phases 01-07** (recommended but not required): Each feature removal phase deletes some services alongside the UI. This phase handles whatever remains. If no prior phases have been executed, this phase removes ALL listed services. If all prior phases completed, this phase verifies nothing is left.

### External Systems
- None.

## Deliverables

1. All listed main process service files deleted (if still present)
2. `src/main/index.ts` only initializes kept services
3. `src/main/ipc.ts` only registers IPC handlers for kept features
4. `src/preload/index.ts` only exposes kept API namespaces
5. `before-quit` / `will-quit` handlers only clean up kept services
6. App compiles and runs with `pnpm build:check`

## Technical Tasks

### 1. Audit main process services
For each service in the "remove" list, check if the file still exists. Delete any that remain.

### 2. Edit `src/main/index.ts`
- Remove all `import` statements for deleted services
- Remove all initialization calls (e.g., `initMCPService()`, `new TrayService()` for deleted services)
- Remove entries in `before-quit` and `will-quit` event handlers for deleted services
- Remove `localTransferService.startDiscovery()` if `localTransferService` is removed
- Remove `apiServerService`, `agentService` async initialization if these are removed
- Keep only initialization for: `SelectionService`, `WindowService`, `StoreSyncService`, `ShortcutService`, `TrayService`, `ThemeService`, `StorageService`, `CryptoService`, `ConfigService`, `ConfigManager`, `AppService`, database initialization

### 3. Edit `src/main/ipc.ts` (or equivalent IPC registration files)
Remove all IPC handler registrations for deleted features. Each `IpcChannel.*` constant that maps to a removed service should have its handler deleted.

### 4. Edit `src/preload/index.ts`
- Remove all API namespace objects for deleted features
- Remove the `tracedInvoke` helper if no remaining namespaces use it
- Verify the final `contextBridge.exposeInMainWorld('api', api)` call only exposes kept namespaces

### 5. Delete remaining service files
```bash
# Main process services
for f in MCPService KnowledgeService FileManagerService NotesService \
         ExportService NutstoreService WebDavService MemoryService \
         OllamaService LMStudioService CodeRunnerService UpdateService \
         FileStorageService UrlParserService ScreenCaptureService \
         BackupService ProxyService AnalyticsService NodeTraceService \
         SpanCacheService PythonService CopilotService SearchService \
         OvmsManager LocalTransferService; do
  rm -f "src/main/services/${f}.ts"
done
rm -rf src/main/services/lanTransfer/

# Renderer-side services and utilities
rm -f  src/renderer/src/utils/analytics.ts
rm -f  src/renderer/src/services/SpanManagerService.ts
rm -f  src/renderer/src/services/WebTraceService.ts
rm -f  src/renderer/src/services/PyodideService.ts
rm -f  src/renderer/src/aiCore/plugins/telemetryPlugin.ts
rm -f  src/renderer/src/aiCore/trace/AiSdkSpanAdapter.ts
rm -rf src/renderer/src/trace/
```

Note: `MenuService` should be **simplified** rather than deleted if it manages the Electron application menu (File, Edit, Window, Help). Evaluate whether a minimal menu is needed.

### 6. Verify
```bash
pnpm format && pnpm build:check
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches without errors
- [ ] `src/main/index.ts` contains no imports or init calls for removed services
- [ ] `src/main/ipc.ts` contains no handlers for removed IPC channels
- [ ] `src/preload/index.ts` contains no namespace objects for removed features
- [ ] Only the 12 "keep" services remain in `src/main/services/`
- [ ] `src/main/databases/*` is intact and untouched
- [ ] Selection Assistant functions correctly (toolbar, action window, AI streaming)
- [ ] System tray works, global hotkey works, theme switching works

## Clarifications Needed

- **`MenuService` disposition**: The PRD says "simplify significantly." The exact simplification depends on whether the Electron application menu (File/Edit/Window/Help) is needed. A minimal menu with just Window and Help may suffice. Clarify whether to keep a minimal menu or remove it entirely.
- **`OllamaService` vs Ollama provider adapter**: The PRD notes "keep model listing if Ollama provider adapter uses it." Verify whether the renderer-side Ollama provider adapter depends on `OllamaService` for model listing via IPC, or if it fetches directly from the Ollama HTTP API.
- **`UpdateService` disposition**: The PRD says "remove or simplify." If auto-update is desired for the trimmed app, a simplified version should be kept. Clarify whether auto-update is needed.
- **`NodeTraceService` monkey-patching**: This service patches `ipcMain.handle` at boot to inject trace contexts. Removing it changes IPC behavior back to native — verify no remaining code depends on trace context propagation.
- **`PythonService` dependency**: Code block execution (CodeBlockView) uses PyodideService for inline Python. If code blocks are removed with the chat page (Phase 07), PythonService has no consumers. Verify before removing.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, Data Settings, Agent Store/Presets.
- **Phase 06**: Removed Standalone Translate, Quick Phrase/Assistant, Agent Settings, Copilot.
- **Phase 07**: Extracted MessageContent to shared location, removed Home/Chat page, changed default route to `/selection`.

## Next Phase Preview

**Phase 09: Simplify Settings, Redux Store & Navigation** will polish the remaining UI — simplifying General Settings (remove proxy/notification sections), Display Settings, Shortcut Settings, About Settings, and Assistant Settings. It will also finalize the Redux store (remove any remaining orphan slices) and simplify the sidebar to a minimal two-item navigation.
