# Research: Phase 02 Remove Knowledge & Files Features

**Generated**: 2026-03-04
**Branch**: `002-remove-knowledge-files`

---

## Critical Scope Correction

The original Phase 02 plan document listed `api.file.*`, `api.fileService.*`, `FileStorageService.ts`, and `FileManagerService.ts` (main process) as targets for removal. **This is incorrect.** Codebase analysis reveals these are core infrastructure used by the AI engine — not by the Files page alone.

### Decision: File Infrastructure Must Be Retained

**What we found**:
- `window.api.file.*` is called in 25+ locations across AI client files (`AnthropicAPIClient`, `GeminiAPIClient`, `OpenAIApiClient`, `fileProcessor.ts`, `messageConverter.ts`, `CodeBlockView`, `HtmlArtifactsCard`, etc.) for reading files, converting to base64, and creating temp files.
- `window.api.fileService.*` is called in `GeminiAPIClient` and `fileProcessor.ts` for uploading files to AI providers (Gemini native file API).
- `src/renderer/src/services/FileManager.ts` is used by AI clients, Inputbar, MessageAttachments, VideoPopup, etc.
- `src/main/services/FileStorage.ts` (the "FileStorageService") backs all file read/write operations needed by the AI.
- `src/main/services/FileSystemService.ts` (the "FileService") provides file reading used in IPC `Fs_Read` / `Fs_ReadText`.
- `src/main/services/remotefile/` backs `api.fileService.*` — required for Gemini's file upload flow.

**Decision**: Do NOT remove `api.file.*`, `api.fileService.*`, `FileStorage.ts`, `FileSystemService.ts`, `remotefile/`, `FileManager.ts`, or any `File_*` / `Fs_*` / `FileService_*` IPC handlers.

**Alternatives considered**:
- Remove file infrastructure anyway → REJECTED: would break AI chat image processing, file attachments, and code artifact preview.
- Remove file infrastructure and stub it out → REJECTED: over-engineering; out of scope.

---

## File Name Corrections

The Phase 02 plan doc uses incorrect file names for two main-process services:

| Plan Doc Name | Actual File |
|---|---|
| `FileManagerService.ts` | `src/main/services/FileStorage.ts` (imported as `fileStorage as fileManager`) |
| `FileStorageService.ts` | Doesn't exist as a separate file — see above |

Both refer to the same `FileStorage.ts` file, which must be **retained** per the scope correction above.

---

## Revised Deletion Scope

### Safe to Delete — Main Process

| Path | Reason Safe |
|---|---|
| `src/main/services/KnowledgeService.ts` | Only imported by `ipc.ts` (for KnowledgeBase handlers) |
| `src/main/knowledge/` (entire directory) | Only imported by `KnowledgeService.ts` |
| `src/main/services/ocr/` (entire directory) | Only imported by `ipc.ts` OCR handlers and OCR settings |
| `src/main/mcpServers/dify-knowledge.ts` | Only referenced from `factory.ts` `difyKnowledge` case |

### Safe to Delete — Renderer

| Path | Reason Safe |
|---|---|
| `src/renderer/src/pages/knowledge/` | Entire feature page, no external consumers |
| `src/renderer/src/pages/files/` | Entire feature page; underlying services retained |
| `src/renderer/src/pages/settings/DocProcessSettings/` | OCR/preprocessing settings page |
| `src/renderer/src/store/knowledge.ts` | Knowledge Redux slice |
| `src/renderer/src/store/ocr.ts` | OCR Redux slice |
| `src/renderer/src/store/preprocess.ts` | Preprocessing Redux slice |
| `src/renderer/src/services/KnowledgeService.ts` | Only used by pages/knowledge |
| `src/renderer/src/services/FileAction.ts` | Only used by pages/files (FileList, FilesPage) |

### Must Retain — Core Infrastructure

| Path | Reason Retained |
|---|---|
| `src/main/services/FileStorage.ts` | Backs all `File_*` IPC handlers used by AI core |
| `src/main/services/FileSystemService.ts` | Backs `Fs_Read` / `Fs_ReadText` used by AI core |
| `src/main/services/remotefile/` | Backs `FileService_*` IPC for Gemini file upload |
| `src/renderer/src/services/FileManager.ts` | Used by AI clients, Inputbar, MessageAttachments |
| All `File_*`, `Fs_*`, `FileService_*` IPC handlers | Used by AI core, not the Files page |
| `api.file.*` preload namespace | Used by AI core throughout |
| `api.fileService.*` preload namespace | Used by Gemini AI client |

---

## IPC Handlers to Remove from `src/main/ipc.ts`

Remove these 9 handlers and their 2 supporting imports:

**Imports to remove:**
- `import KnowledgeService from './services/KnowledgeService'`
- `import { ocrService } from './services/ocr/OcrService'`

**Also remove the type imports used only by these handlers:**
- `OcrProvider` (line 29)
- `SupportedOcrFile` (line 33)
- `KnowledgeBaseParams`, `KnowledgeItem`, `KnowledgeSearchResult`, `KnowledgeSearchParams`, `KnowledgeBaseItems` (from the destructured import block — verify which are only used by these handlers)

**KnowledgeBase handlers to remove (lines ~700–706):**
```
ipcMain.handle(IpcChannel.KnowledgeBase_Create, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Reset, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Delete, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Add, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Remove, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Search, ...)
ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, ...)
```

**OCR handlers to remove (lines ~992–995):**
```
ipcMain.handle(IpcChannel.OCR_ocr, ...)
ipcMain.handle(IpcChannel.OCR_ListProviders, ...)
```

---

## Preload Namespaces to Remove from `src/preload/index.ts`

Only these two namespaces are safe to remove:

| Namespace | Line Range | Safe to Remove |
|---|---|---|
| `knowledgeBase:` | ~282–305 | ✅ Yes — only used by Knowledge Base page |
| `ocr:` | ~545–548 | ✅ Yes — only used by DocProcess settings |
| `fileService:` | ~330–337 | ❌ No — used by Gemini AI client |
| `file:` | ~197–... | ❌ No — used by AI core throughout |

---

## Redux Store Migration Version

Phase 01 used migration step `'201'` and bumped store version to `201`. Phase 02 must:
- Add migration step `'202'` to strip `knowledge`, `ocr`, `preprocess` slice keys
- Bump store version from `201` to `202`

**Migration pattern** (from Phase 01):
```typescript
'202': (state: RootState) => {
  try {
    if (state.settings?.sidebarIcons) {
      const removedIcons = ['knowledge', 'files']
      state.settings.sidebarIcons.visible = state.settings.sidebarIcons.visible.filter(
        (icon: string) => !removedIcons.includes(icon)
      )
      state.settings.sidebarIcons.disabled = state.settings.sidebarIcons.disabled.filter(
        (icon: string) => !removedIcons.includes(icon)
      )
    }
    // Strip removed slice keys from persisted state
    delete (state as any).knowledge
    delete (state as any).ocr
    delete (state as any).preprocess
    return state
  } catch (error) {
    logger.error('migrate 202 error', error as Error)
    return state
  }
}
```

---

## MCP Factory Scope

`src/main/mcpServers/factory.ts` must:
- Remove `import DifyKnowledgeServer from './dify-knowledge'`
- Remove the `case BuiltinMCPServerNames.difyKnowledge:` block

`src/main/mcpServers/memory.ts` stays — it is a general-purpose memory MCP server tied to Phase 03 (Notes & Memory), not Phase 02.

---

## Sidebar Icon Type Update

`src/renderer/src/types/index.ts` — remove `'knowledge'` and `'files'` from the `SidebarIcon` union type. Follow Phase 01 pattern exactly.

`src/renderer/src/pages/settings/DisplaySettings/SidebarIconsManager.tsx` — remove `knowledge` and `files` entries from `iconMap`.

`src/renderer/src/i18n/label.ts` — `getSidebarIconLabel` map references `knowledge` and `files`. Remove both entries.
