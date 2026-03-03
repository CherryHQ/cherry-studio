# Quick Assistant - App Trimming Plan

> **Design Principle**: Every phase is a **self-contained vertical slice**. Each phase removes ALL layers of its features (pages, store slices, main services, preload namespaces, settings routes, IPC handlers). The app **compiles and runs** after every single phase. Phases can be executed in **any order**.

---

## Goal

Transform the full Cherry Studio Electron app (~1545 source files, ~346 npm deps) into a lightweight **Quick Selection Assistant** — a fast utility for AI-powered text actions (summarize, translate, explain, refine, custom prompts).

**What stays**: Selection toolbar, action window, AI streaming pipeline, provider/model configuration, settings UI, local database.

**Target**: ~150-200 source files, ~100-130 npm deps.

---

## Architecture (Final State)

```
Quick Assistant (Trimmed)
├── Main Process (Backend)
│   ├── SelectionService      — Native selection hook, toolbar, action windows
│   ├── WindowService         — Main settings window management
│   ├── StoreSyncService      — Redux state sync across all renderer windows
│   ├── ShortcutService       — Global hotkey registration
│   ├── TrayService           — System tray icon & menu
│   ├── ThemeService          — Theme management
│   ├── StorageService        — SQLite database (API keys, prefs)
│   ├── Database init         — Schema definitions & startup scripts
│   ├── CryptoService         — Encrypt/decrypt API keys
│   ├── ConfigService         — App configuration
│   ├── ConfigManager         — Persistent config (launchToTray, etc.)
│   └── AppService            — App lifecycle (launch on boot, relaunch)
│
├── Renderer Process (Frontend)
│   ├── Selection Windows     — Toolbar + Action window (floating)
│   ├── Settings Pages        — Provider, model, action, appearance config
│   ├── Shared Markdown       — Extracted MessageContent renderer
│   ├── AI Core               — Provider adapters, streaming pipeline
│   └── Store (Redux)         — State management
│
└── Preload Scripts           — Secure IPC bridge
```

---

## How to Read Each Phase

Every phase follows this structure:

1. **Scope** — What features are removed
2. **Hub File Edits** — Targeted edits to shared files (Router.tsx, store/index.ts, SettingsPage.tsx, sidebar.ts, main/index.ts, preload/index.ts)
3. **Files/Directories to Delete** — Complete list of deletable paths
4. **Verify** — Run `pnpm build:check` (or `pnpm format && pnpm build:check`) to confirm the app still compiles

**Critical rule**: No two phases edit the same lines in hub files. Each phase only touches its own feature's entries. This is what makes them order-independent.

---

## Phase 1: Remove Creative & Utility Pages

**Scope**: Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad

These features have **zero cross-dependencies** with any other feature. Purely standalone pages.

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove these routes and their imports:
```
import PaintingsRoutePage ...    →  DELETE
import CodeToolsPage ...         →  DELETE
import OpenClawPage ...          →  DELETE
import MinAppPage ...            →  DELETE
import MinAppsPage ...           →  DELETE
import LaunchpadPage ...         →  DELETE

<Route path="/paintings/*" ...   →  DELETE
<Route path="/code" ...          →  DELETE
<Route path="/openclaw" ...      →  DELETE
<Route path="/apps/:appId" ...   →  DELETE
<Route path="/apps" ...          →  DELETE
<Route path="/launchpad" ...     →  DELETE
```

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'paintings', 'code_tools', 'openclaw', 'minapp'
```

**`src/renderer/src/store/index.ts`** — Remove these slices:
```
import codeTools from './codeTools'     →  DELETE import + combineReducers entry
import openclaw from './openclaw'       →  DELETE import + combineReducers entry
import paintings from './paintings'     →  DELETE import + combineReducers entry
import minapps from './minapps'         →  DELETE import + combineReducers entry
```

**`src/main/index.ts`** — Remove initialization/cleanup for:
- OpenClaw service (if initialized here)
- Any Mini App related init

**`src/preload/index.ts`** — Remove namespaces:
- `api.openclaw.*`
- `api.codeTools.*`

### Files/Directories to Delete

```
src/renderer/src/pages/paintings/
src/renderer/src/pages/code/
src/renderer/src/pages/openclaw/
src/renderer/src/pages/minapps/
src/renderer/src/pages/launchpad/
src/renderer/src/store/paintings.ts
src/renderer/src/store/codeTools.ts
src/renderer/src/store/openclaw.ts
src/renderer/src/store/minapps.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 2: Remove Knowledge & Files Features

**Scope**: Knowledge Bases, File Manager, Doc Processing Settings

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove:
```
import KnowledgePage ...         →  DELETE
import FilesPage ...             →  DELETE

<Route path="/knowledge" ...     →  DELETE
<Route path="/files" ...         →  DELETE
```

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'knowledge', 'files'
```

**`src/renderer/src/store/index.ts`** — Remove:
```
import knowledge from './knowledge'   →  DELETE import + combineReducers entry
import ocr from './ocr'               →  DELETE import + combineReducers entry
import preprocess from './preprocess'  →  DELETE import + combineReducers entry
```

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — Remove:
- Import: `DocProcessSettings`
- Menu item: `/settings/docprocess` (lines 109-114)
- Route: `<Route path="docprocess" ...>` (line 148)

**`src/main/index.ts`** — Remove init/cleanup for:
- `KnowledgeService`
- `FileManagerService`
- `FileStorageService`

**`src/preload/index.ts`** — Remove namespaces:
- `api.knowledgeBase.*`
- `api.fileService.*`
- `api.file.*`
- `api.ocr.*`

### Files/Directories to Delete

```
src/renderer/src/pages/knowledge/
src/renderer/src/pages/files/
src/renderer/src/pages/settings/DocProcessSettings/
src/renderer/src/store/knowledge.ts
src/renderer/src/store/ocr.ts
src/renderer/src/store/preprocess.ts
src/renderer/src/services/KnowledgeService.ts
src/renderer/src/services/FileService.ts
src/main/services/KnowledgeService.ts
src/main/services/FileManagerService.ts
src/main/services/FileStorageService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 3: Remove Notes & Memory Features

**Scope**: Notes, Conversation Memory, Memory Settings

**Special care**: The `note` slice has a cross-dependency in the `persistor` callback in `store/index.ts`. This MUST be removed alongside the slice, or the app crashes on boot.

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove:
```
import NotesPage ...             →  DELETE

<Route path="/notes" ...         →  DELETE
```

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'notes'
```

**`src/renderer/src/store/index.ts`** — Remove:
```
import { setNotesPath } from './note'  →  DELETE
import note from './note'              →  DELETE import + combineReducers entry
import memory from './memory'          →  DELETE import + combineReducers entry
```
Also remove `'note/'` from `storeSyncService.setOptions({ syncList: [...] })` (line 108).

**CRITICAL** — Remove the `setNotesPath` block in the `persistor` callback (lines 128-141):
```typescript
// DELETE THIS ENTIRE BLOCK:
if (!state.note.notesPath) {
  setTimeout(async () => {
    try {
      const info = await window.api.getAppInfo()
      store.dispatch(setNotesPath(info.notesPath))
      ...
    } catch ...
  }, 0)
}
```

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — Remove:
- Import: `MemorySettings`
- Menu item: `/settings/memory` (lines 97-102)
- Route: `<Route path="memory" ...>` (line 151)

**`src/main/index.ts`** — Remove init/cleanup for:
- `NotesService`
- `MemoryService`

**`src/preload/index.ts`** — Remove namespaces:
- `api.memory.*`

### Files/Directories to Delete

```
src/renderer/src/pages/notes/
src/renderer/src/pages/settings/MemorySettings/
src/renderer/src/store/note.ts
src/renderer/src/store/memory.ts
src/renderer/src/services/MemoryService.ts
src/main/services/NotesService.ts
src/main/services/MemoryService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 4: Remove MCP & Web Search Features

**Scope**: MCP Server Management, Web Search (AI-powered), API Server Settings

Selection's "search" action is a simple browser URL open (`google.com/search?q=...`) — completely independent from WebSearchSettings (Tavily, Exa, etc.).

### Hub File Edits

**`src/renderer/src/store/index.ts`** — Remove:
```
import mcp from './mcp'               →  DELETE import + combineReducers entry
import websearch from './websearch'    →  DELETE import + combineReducers entry
import toolPermissions from './toolPermissions'  →  DELETE import + combineReducers entry
```
Also remove `'toolPermissions'` from the `blacklist` array in `persistReducer` config (line 90).

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — Remove:
- Imports: `MCPSettings`, `WebSearchSettings`, `ApiServerSettings`, `McpLogo`
- Menu items: `/settings/mcp` (lines 85-90), `/settings/websearch` (lines 91-96), `/settings/api-server` (lines 103-108)
- Routes: `<Route path="mcp/*" ...>`, `<Route path="websearch/*" ...>`, `<Route path="api-server" ...>`
- Remove the `<Divider />` between web search and MCP if it becomes orphaned

**`src/main/index.ts`** — Remove init/cleanup for:
- `MCPService`

**`src/preload/index.ts`** — Remove namespaces:
- `api.mcp.*`
- `api.searchService.*`
- `api.agentTools.*`
- `api.apiServer.*`

### Files/Directories to Delete

```
src/renderer/src/pages/settings/MCPSettings/
src/renderer/src/pages/settings/WebSearchSettings/
src/renderer/src/pages/settings/ToolSettings/
src/renderer/src/store/mcp.ts
src/renderer/src/store/websearch.ts
src/renderer/src/store/toolPermissions.ts
src/renderer/src/services/MCPClientService.ts
src/renderer/src/services/WebSearchService.ts
src/main/services/MCPService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 5: Remove Sync, Backup & Proxy Features

**Scope**: Nutstore, WebDAV, Backup/Restore, Proxy, Data Settings, Agent Store/Presets

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove:
```
import AssistantPresetsPage ...  →  DELETE

<Route path="/store" ...         →  DELETE
```

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'store'
```

**`src/renderer/src/store/index.ts`** — Remove:
```
import backup from './backup'       →  DELETE import + combineReducers entry
import nutstore from './nutstore'   →  DELETE import + combineReducers entry
```

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — Remove:
- Import: `DataSettings`
- Menu item: `/settings/data` (lines 78-83)
- Route: `<Route path="data" ...>` (line 156)

**`src/main/index.ts`** — Remove init/cleanup for:
- `BackupService`
- `NutstoreService`
- `WebDavService`
- `ProxyService`
- `ExportService`

**`src/preload/index.ts`** — Remove namespaces:
- `api.backup.*`
- `api.export.*`
- `api.nutstore.*`
- `api.proxy.*` (if not already in another phase)

### Files/Directories to Delete

```
src/renderer/src/pages/store/
src/renderer/src/pages/settings/DataSettings/
src/renderer/src/store/backup.ts
src/renderer/src/store/nutstore.ts
src/renderer/src/services/NutstoreService.ts
src/main/services/BackupService.ts
src/main/services/NutstoreService.ts
src/main/services/WebDavService.ts
src/main/services/ProxyService.ts
src/main/services/ExportService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 6: Remove Standalone Translate & Remaining Settings Features

**Scope**: Standalone Translate page, Quick Phrase, Quick Assistant settings, Agent Settings, Copilot

The selection translate **action** (in the action window) stays. Only the standalone `/translate` page is removed.

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove:
```
import TranslatePage ...         →  DELETE

<Route path="/translate" ...     →  DELETE
```

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'translate'
```

**`src/renderer/src/store/index.ts`** — Remove:
```
import translate from './translate'    →  DELETE import + combineReducers entry
import copilot from './copilot'        →  DELETE import + combineReducers entry
import inputToolsReducer from './inputTools'  →  DELETE import + combineReducers entry
import shortcuts from './shortcuts'    →  DELETE import + combineReducers entry (if only used by removed features)
```

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — Remove:
- Imports: `QuickPhraseSettings`, `QuickAssistantSettings`
- Menu items: `/settings/quickphrase` (lines 115-120), `/settings/quickAssistant` (lines 128-133)
- Routes: `<Route path="quickphrase" ...>`, `<Route path="quickAssistant" ...>`
- Remove the `<Divider />` before Quick Assistant (line 127) and the one before it (line 134)

**`src/preload/index.ts`** — Remove namespaces:
- `api.copilot.*`

### Files/Directories to Delete

```
src/renderer/src/pages/translate/
src/renderer/src/pages/settings/QuickPhraseSettings.tsx
src/renderer/src/pages/settings/QuickAssistantSettings.tsx
src/renderer/src/pages/settings/AgentSettings/
src/renderer/src/store/translate.ts
src/renderer/src/store/copilot.ts
src/renderer/src/store/inputTools.ts
src/renderer/src/services/PluginService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 7: Extract MessageContent & Remove Home/Chat Page

**Scope**: The entire chat system — Home page, chat UI, conversation management

**This is the highest-risk phase.** The `MessageContent` component is deeply nested inside `pages/home/Messages/` but is imported by the selection action windows. It MUST be extracted to a shared location before the home page can be deleted.

### Step-by-Step Procedure

**Step 7.1 — Extract MessageContent** (do this FIRST within this phase):

1. Create directory: `src/renderer/src/components/Markdown/`
2. Copy these files into it:
   - `src/renderer/src/pages/home/Messages/MessageContent.tsx`
   - `src/renderer/src/pages/home/Messages/Markdown/` (entire directory)
   - Any helpers these files import from within `pages/home/Messages/`
3. Update all import paths in the copied files to use the new location
4. Update consumers to import from the new location:
   - `src/renderer/src/windows/selection/action/components/ActionGeneral.tsx`
   - `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx`
5. Strip heavy package imports from the extracted markdown components: `katex`, `mermaid`
6. Run `pnpm build:check` — **STOP if this fails. Fix before continuing.**

**Step 7.2 — Remove Home page and chat infrastructure** (only after 7.1 succeeds):

### Hub File Edits

**`src/renderer/src/Router.tsx`** — Remove:
```
import HomePage ...              →  DELETE

<Route path="/" element={<HomePage />} />  →  CHANGE to redirect to /selection:
<Route path="/" element={<Navigate to="/selection" replace />} />
```
Add: `import { Navigate } from 'react-router-dom'`

**`src/renderer/src/config/sidebar.ts`** — Remove from `DEFAULT_SIDEBAR_ICONS`:
```
'assistants'
```
Also remove from `REQUIRED_SIDEBAR_ICONS`:
```
'assistants'
```

**`src/renderer/src/store/index.ts`** — Remove:
```
import assistants from './assistants'  →  DELETE import + combineReducers entry
import tabs from './tabs'              →  DELETE import + combineReducers entry
```
Also remove `'tabs'` from the `blacklist` array in `persistReducer` config (line 90).
Update `storeSyncService.setOptions({ syncList })` — remove `'assistants/'`.

### Additional Consumers to Fix

Before deleting `pages/home/`, check and fix these files that import from it:
- `src/renderer/src/components/ContentSearch.tsx` — imports `NarrowLayout` from `pages/home/Messages/`
- `src/renderer/src/components/Tab/TabContainer.tsx` — imports `UpdateAppButton` from `pages/home/components/`

These imports must be either inlined, stubbed, or the importing code removed.

### Files/Directories to Delete

```
src/renderer/src/pages/home/          (entire directory — ONLY after MessageContent is extracted)
src/renderer/src/pages/agents/        (if not already removed)
src/renderer/src/pages/topics/        (if exists)
src/renderer/src/store/assistants.ts
src/renderer/src/store/tabs.ts
src/renderer/src/services/TopicService.ts
```

### Verify
```bash
pnpm format && pnpm build:check
pnpm dev   # Manual test: select text → trigger action → verify AI streaming still works
```

---

## Phase 8: Clean Remaining Main Process Services

**Scope**: Remove all backend services that were not already deleted by prior phases (or that weren't deleted yet because no prior phase was executed).

This phase is designed to be safe regardless of which other phases have been done. For each service: if the file still exists, delete it. If it was already deleted by another phase, skip it.

### Services to Remove (if still present)

| Service | File Path | Reason |
|---------|-----------|--------|
| MCPService | `src/main/services/MCPService.ts` | MCP — not needed |
| KnowledgeService | `src/main/services/KnowledgeService.ts` | Knowledge bases — not needed |
| FileManagerService | `src/main/services/FileManagerService.ts` | File management — not needed |
| NotesService | `src/main/services/NotesService.ts` | Notes — not needed |
| ExportService | `src/main/services/ExportService.ts` | Chat export — not needed |
| NutstoreService | `src/main/services/NutstoreService.ts` | Nutstore sync — not needed |
| WebDavService | `src/main/services/WebDavService.ts` | WebDAV sync — not needed |
| MemoryService | `src/main/services/MemoryService.ts` | Memory — not needed |
| OllamaService | `src/main/services/OllamaService.ts` | Ollama process management — not needed |
| LMStudioService | `src/main/services/LMStudioService.ts` | LMStudio process — not needed |
| CodeRunnerService | `src/main/services/CodeRunnerService.ts` | Code execution — not needed |
| UpdateService | `src/main/services/UpdateService.ts` | Auto-updater — remove or simplify |
| MenuService | `src/main/services/MenuService.ts` | Application menu — simplify significantly |
| FileStorageService | `src/main/services/FileStorageService.ts` | File storage — not needed |
| UrlParserService | `src/main/services/UrlParserService.ts` | URL parsing — not needed |
| ScreenCaptureService | `src/main/services/ScreenCaptureService.ts` | Screen capture — not needed |
| BackupService | `src/main/services/BackupService.ts` | Backup — not needed |
| ProxyService | `src/main/services/ProxyService.ts` | Proxy — not needed |

### Services to KEEP

| Service | File Path | Reason |
|---------|-----------|--------|
| SelectionService | `src/main/services/SelectionService.ts` | Core selection hook |
| WindowService | `src/main/services/WindowService.ts` | Main window |
| StoreSyncService | `src/main/services/StoreSyncService.ts` | **CRITICAL** — Redux sync across windows |
| ShortcutService | `src/main/services/ShortcutService.ts` | Global hotkeys |
| TrayService | `src/main/services/TrayService.ts` | System tray |
| ThemeService | `src/main/services/ThemeService.ts` | Theme switching |
| StorageService | `src/main/services/StorageService.ts` | SQLite operations |
| CryptoService | `src/main/services/CryptoService.ts` | API key encryption |
| ConfigService | `src/main/services/ConfigService.ts` | App configuration |
| ConfigManager | `src/main/services/ConfigManager.ts` | Persistent config (launchToTray) |
| AppService | `src/main/services/AppService.ts` | Launch on boot, relaunch |
| Database init | `src/main/databases/*` | **CRITICAL** — Schema definitions |

### Hub File Edits

**`src/main/index.ts`** — Remove all `import` statements and initialization calls for removed services. Remove their entries from `before-quit` / `will-quit` handlers. Keep only the services listed in "Services to KEEP".

**`src/main/ipc.ts`** (or wherever IPC handlers are registered) — Remove handlers for:
- `IpcChannel.MCP_*`, `IpcChannel.Knowledge_*`, `IpcChannel.Export_*`
- `IpcChannel.Notes_*`, `IpcChannel.File_*`, `IpcChannel.Nutstore_*`
- `IpcChannel.WebDav_*`, `IpcChannel.Memory_*`, `IpcChannel.CodeRunner_*`
- `IpcChannel.Ollama_*` (keep model listing if Ollama provider adapter uses it)

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 9: Clean Preload Script & IPC Bridge

**Scope**: Remove all unused API namespaces from the preload script.

Like Phase 8, this is safe regardless of which other phases have been done. For each namespace: if its service/feature was removed, remove the namespace. If the feature still exists, keep it.

### Namespaces to KEEP

- `api.selection.*` — Selection IPC methods
- `api.config.*` — Configuration management
- `api.storage.*` — Database operations
- `api.aes.*` / `api.crypto.*` — Encryption
- `api.window.*` / `api.windowControls.*` — Window management
- `api.storeSync.*` — Store synchronization
- `api.theme.*` — Theme switching
- `api.shortcuts.*` — Shortcut management
- `api.app.*` — App lifecycle (quit, version, launch on boot, relaunch)
- `api.shell.*` — Shell operations (if needed)
- `api.fs.*` — Filesystem operations (if needed by settings)

### Namespaces to REMOVE (if still present)

- `api.mcp.*`, `api.knowledgeBase.*`, `api.memory.*`
- `api.backup.*`, `api.export.*`, `api.nutstore.*`
- `api.file.*`, `api.fileService.*`, `api.proxy.*`
- `api.codeTools.*`, `api.openclaw.*`, `api.copilot.*`
- `api.searchService.*`, `api.agentTools.*`, `api.apiServer.*`
- `api.ocr.*`, `api.python.*`, `api.ollama.*` (keep if Ollama provider needs it)
- `api.lmstudio.*`, `api.screenCapture.*`, `api.urlParser.*`
- `api.obsidian.*`, `api.cherryin.*`, `api.cherryai.*`
- `api.localTransfer.*`, `api.claudeCodePlugin.*`
- `api.anthropic_oauth.*`, `api.trace.*`, `api.vertexAI.*`
- `api.ovms.*`, `api.webview.*`, `api.protocol.*`, `api.externalApps.*`
- `api.miniWindow.*` (if mini chat window is removed)

Also remove the `tracedInvoke` helper if no remaining namespaces use it.

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 10: Simplify Remaining Settings Pages

**Scope**: Polish the settings pages that survived the trim. Remove sections that configure removed features.

This phase only modifies the *content* of kept settings files. It does NOT delete any routes.

### 10.1 General Settings (`GeneralSettings.tsx`)

**Keep**: Language selection, spell check, hardware acceleration, Launch group (start on boot, minimize to tray), Tray group (show tray, close to tray), Developer mode toggle.

**Remove**:
- Proxy configuration section (entire `proxyMode` UI, `proxyUrl`, `proxyBypassRules` — ProxyService removed)
- Notification settings for `backup` and `knowledge` (removed features — keep `assistant` notification only)
- Privacy/data collection section

**Imports to remove**: `setProxyMode`, `setProxyUrl`, `setProxyBypassRules`, `isValidProxyUrl`, `setEnableDataCollection`

### 10.2 Display Settings (`DisplaySettings/`)

**Keep**: Theme selection (light/dark/auto), theme color presets.

**Remove**: Sidebar icon manager (`SidebarIconsManager.tsx`), topic display options, navbar position selector, assistant icon type — these configure removed features.

### 10.3 Shortcut Settings (`ShortcutSettings.tsx`)

**Keep**: Global selection shortcut configuration.

**Remove**: Shortcuts for removed features (chat, agents, knowledge, etc.). Keep selection-related shortcuts only.

### 10.4 About Settings (`AboutSettings.tsx`)

**Keep**: Version display, app info.

**Remove**: Auto-update checks (UpdateService removed), update channel selection, sponsor links.

### 10.5 Assistant Settings (`AssistantSettings/`)

**Keep**: `AssistantModelSettings.tsx` (model/temperature for default assistant), `AssistantPromptSettings.tsx` (if selection actions use system prompts).

**Remove**: `AssistantMCPSettings.tsx`, `AssistantKnowledgeBaseSettings.tsx`, `AssistantMemorySettings.tsx` — all configure removed features.

### 10.6 Navigation Cleanup

**`src/renderer/src/pages/settings/SettingsPage.tsx`** — After all removed routes are gone, clean up orphaned `<Divider />` components. The settings menu should flow cleanly:
```
Provider → Model → [divider] → General → Display → Shortcut → [divider] → About → Selection Assistant
```

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 11: Clean Redux Store & Migrations

**Scope**: Final store cleanup — remove any remaining unused slices, update `storeSyncService` sync list, update migration logic.

This phase is a **safety net**. If you executed Phases 1-7 in order, most slices are already gone. This phase catches anything left and fixes the migration system.

### Hub File Edits

**`src/renderer/src/store/index.ts`**:

Slices that MUST remain:
- `settings` — App settings, provider config
- `llm` — Provider and model state
- `selectionStore` — Selection-specific state
- `messages` (`newMessagesReducer`) — Used by action window streaming
- `messageBlocks` (`messageBlocksReducer`) — Used by action window streaming
- `runtime` — Runtime state (blacklisted from persistence)
- `assistants` — **Evaluate**: may be needed for default assistant resolution. If selection code uses `getDefaultAssistant()`, keep this slice.

Remove any slice not in the list above.

**`storeSyncService.setOptions({ syncList })`** — Should contain only:
```typescript
syncList: ['settings/', 'llm/', 'selectionStore/']
```
(Add `'assistants/'` back if keeping that slice.)

**`persistReducer` blacklist** — Should contain only:
```typescript
blacklist: ['runtime', 'messages', 'messageBlocks']
```

**`src/renderer/src/store/migrate.ts`**:
- Simplify migration logic to only handle kept slices
- Bump migration version if store shape changed

### Verify
```bash
pnpm format && pnpm build:check
```

---

## Phase 12: Simplify Sidebar & Default Route

**Scope**: Replace the full sidebar with a minimal navigation. Set the default landing page to `/selection`.

### Hub File Edits

**`src/renderer/src/Router.tsx`**:
- Change default route: `<Route path="/" element={<Navigate to="/selection" replace />} />`
- Only remaining routes: `/selection`, `/settings/*`

**`src/renderer/src/config/sidebar.ts`**:
- `DEFAULT_SIDEBAR_ICONS` should only contain: `'selection_assistant'`
- `REQUIRED_SIDEBAR_ICONS` should only contain: `'selection_assistant'`

**`src/renderer/src/components/app/Sidebar.tsx`**:
- Remove all sidebar items for deleted features
- Keep: Selection Assistant, Settings
- Consider replacing the full sidebar with a simpler two-item navigation

### Verify
```bash
pnpm format && pnpm build:check
pnpm dev   # Verify: app opens to /selection page, sidebar only shows selection + settings
```

---

## Phase 13: Clean Package.json & Dependencies

**Scope**: Remove unused npm dependencies to reduce install size and build time.

### Dependencies to KEEP

**AI SDK**: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, and other `@ai-sdk/*` packages for supported providers.

**Electron**: `electron`, `electron-builder`, `electron-vite`, `@electron-toolkit/*`

**UI**: `react`, `react-dom`, `react-router-dom`, `antd`, `@ant-design/icons`, `styled-components`, `lucide-react`, `react-hotkeys-hook`, `react-i18next`, `i18next`

**State**: `@reduxjs/toolkit`, `react-redux`, `redux-persist`

**Database**: `better-sqlite3`, `drizzle-orm` (if used)

**Markdown** (for action window): `react-markdown`, `remark-gfm`, `rehype-raw`, `highlight.js` (basic rendering only)

**Utilities**: `lodash`, `dayjs`, `uuid`, `nanoid`

**Native**: `node-addon-api` (for selection hook)

### Dependencies to REMOVE

| Category | Packages |
|----------|----------|
| **Heavy Markdown** | `katex`, `react-katex`, `mermaid` — unnecessary for small floating window |
| **MCP/Knowledge** | `@modelcontextprotocol/*`, RAG/embedding libraries, vector DB libraries |
| **File Processing** | `pdf-parse`, `pdfjs-dist`, `mammoth`, `xlsx`, `papaparse`, `cheerio`, `sharp` |
| **Rich Text** | `@tiptap/*`, Markdown editor libraries |
| **Proxy** | `https-proxy-agent` |
| **Sync/Cloud** | `webdav`, Nutstore SDK |
| **Code Execution** | `vm2`, WASM runtimes |
| **Web Search** | `duckduckgo-search`, scraping libraries |
| **Export** | `html-to-image`, `dom-to-image`, PDF generation |
| **Screen Capture** | `node-screenshots` |

**Process**: For each dependency, run `pnpm why <package>` to verify it's truly unused before removing. Then `pnpm install` to verify.

### DevDependencies to Keep

`typescript`, `vite`, `vitest`, `eslint`, `@biomejs/biome`, `@types/*` for kept packages.

### Verify
```bash
pnpm install
pnpm format && pnpm build:check
```

---

## Phase 14: Clean Types, Assets, i18n & Build Config

**Scope**: Final polish — remove dead types, unused icons/assets, orphaned translation keys, and simplify build configuration.

### 14.1 Types

**`src/renderer/src/types/index.ts`** — Remove type definitions for removed features (Agent, Topic complex types, Knowledge, MCP, Painting, etc.). Keep: Provider, Model, Assistant (simplified), Message types, Selection types, Settings types.

**Keep entirely**: `selectionTypes.ts`, `newMessage.ts`

### 14.2 i18n

Remove translation keys for all removed features from:
- `src/renderer/src/i18n/locales/en-us.json`
- `src/renderer/src/i18n/locales/zh-cn.json`
- `src/renderer/src/i18n/locales/zh-tw.json`
- `src/renderer/src/i18n/translate/*.json`

Keep keys with prefixes: `selection.*`, `settings.*`, `common.*`, `provider.*`, `model.*`

### 14.3 Assets

**`src/renderer/src/assets/`** — Remove icons/images only used by removed features. Keep: app icon, selection-related icons, theme assets.

### 14.4 Build Config

**`electron.vite.config.ts`** — Remove entry points for removed windows/pages. Keep: main window, selection toolbar, selection action window. Ensure Web Worker entries (if any from AI Core) are preserved.

**`electron-builder.yml`** — Remove file associations for removed features, simplify build targets.

### 14.5 Test Files

Remove tests for removed features. Keep tests for: AI Core, Selection components, Settings, kept services.

### 14.6 Shared Packages

Delete unused workspace packages (if they exist):
- `packages/knowledge/`
- `packages/mcp/`
- `packages/code-runner/`

### Verify
```bash
pnpm install
pnpm format
pnpm lint
pnpm build:check
pnpm dev   # Full manual test: selection toolbar → action → AI streaming → copy result
```

---

## Risk Mitigation

1. **MessageContent extraction (Phase 7)**: This is the highest-risk operation. The component has deep dependencies on Markdown renderers and code highlighters. Extract and verify compilation BEFORE deleting `pages/home/`.

2. **Note slice persistor callback (Phase 3)**: The `persistor` callback in `store/index.ts` directly accesses `state.note.notesPath`. If the `note` slice is removed without deleting this callback, the app crashes on boot.

3. **StoreSyncService sync list**: When removing slices that appear in `syncList` (`assistants/`, `note/`, `selectionStore/`), also remove them from the sync list or the middleware will error.

4. **Deep import chains**: Files import from barrel exports (`index.ts`). Removing a feature may break unrelated imports. Always run `pnpm build:check` after each phase. Pay special attention to `src/renderer/src/pages/settings/index.tsx` (shared styled-components).

5. **Database initialization**: Keep `src/main/databases/*` — without schema definitions, `StorageService` crashes on boot.

6. **Redux store shape**: Removing slices changes the persisted store shape. Need a migration or store reset for users upgrading from the full app.

7. **Native modules**: The selection hook is a native addon. Ensure its build dependencies survive `package.json` cleanup.

8. **Provider adapters**: Some AI providers (Ollama, LMStudio) have both a renderer adapter AND a main service. Keep the adapter; only remove the service if the adapter doesn't depend on it.

9. **Web Workers**: If AI Core uses Web Workers for stream parsing, their Vite entry points must be preserved.

10. **`tabs` + `toolPermissions` in blacklist**: These slices are in the `persistReducer` blacklist. When removing them from `combineReducers`, also remove them from the blacklist to avoid warnings.

---

## Settings Feature Reference

Quick reference for which settings pages to keep, simplify, or remove.

| # | Settings Route | Decision | Phase |
|---|---------------|----------|-------|
| 1 | Provider Settings | **KEEP** | — |
| 2 | Model Settings | **KEEP** | — |
| 3 | General Settings | **SIMPLIFY** | Phase 10 |
| 4 | Display Settings | **SIMPLIFY** | Phase 10 |
| 5 | Data Settings | **REMOVE** | Phase 5 |
| 6 | MCP Settings | **REMOVE** | Phase 4 |
| 7 | Web Search Settings | **REMOVE** | Phase 4 |
| 8 | Memory Settings | **REMOVE** | Phase 3 |
| 9 | API Server Settings | **REMOVE** | Phase 4 |
| 10 | Doc Processing | **REMOVE** | Phase 2 |
| 11 | Quick Phrase | **REMOVE** | Phase 6 |
| 12 | Shortcut Settings | **SIMPLIFY** | Phase 10 |
| 13 | Quick Assistant | **REMOVE** | Phase 6 |
| 14 | About Settings | **SIMPLIFY** | Phase 10 |
| 15 | Selection Assistant | **KEEP** | — |
| 16 | Agent Settings | **REMOVE** | Phase 6 |
| 17 | Assistant Settings | **SIMPLIFY** | Phase 10 |
| 18 | Translate Settings | **KEEP** | — |
| 19 | Shared Components | **KEEP** | — |

---

## File Count Estimates

| Category | Before | After (Estimate) |
|----------|--------|-------------------|
| Main process files | ~80 | ~20-25 |
| Renderer pages | ~200 | ~30-40 |
| Renderer services | ~40 | ~10-15 |
| AI Core | ~60 | ~60 (keep all) |
| Components | ~150 | ~40-50 |
| Hooks | ~30 | ~10-15 |
| Store slices | ~25 | ~8-10 |
| Types | ~30 | ~10-15 |
| Tests | ~80 | ~20-30 |
| i18n files | ~20 | ~20 (same files, less content) |
| Config/Build | ~30 | ~20 |
| **Total** | **~1545** | **~150-200** |

| npm dependencies | Before | After (Estimate) |
|------------------|--------|-------------------|
| Production | ~200 | ~60-80 |
| DevDependencies | ~146 | ~40-50 |
| **Total** | **~346** | **~100-130** |
