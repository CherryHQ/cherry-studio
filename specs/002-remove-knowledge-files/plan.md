# Implementation Plan: Remove Knowledge & Files Features (Phase 02)

**Branch**: `002-remove-knowledge-files` | **Date**: 2026-03-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-remove-knowledge-files/spec.md`

---

## Summary

Remove the Knowledge Bases system, File Manager page, and Doc Processing settings from the Electron desktop app. This is a pure deletion phase — no new functionality is introduced. The critical constraint discovered during research is that the underlying file infrastructure (`api.file.*`, `api.fileService.*`, `FileStorage.ts`, `remotefile/`, `FileManager.ts`) must be **retained** because it is consumed throughout the AI core engine; only the Knowledge/OCR layer and the page-level UI are removed.

---

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20 (Electron main process), React 18 (renderer)
**Primary Dependencies**: Electron, Redux Toolkit, React Router, electron-vite, Vitest
**Storage**: Redux persist (versioned migration); `electron-store` for main-process config
**Testing**: Vitest (renderer + main); `pnpm build:check` = lint + typecheck + test
**Target Platform**: Electron 33 desktop app (Windows/macOS/Linux)
**Project Type**: Desktop app — Electron multi-process (main + preload + renderer)
**Performance Goals**: N/A — removal task; no performance targets introduced
**Constraints**: `pnpm build:check` must pass with zero new errors; Selection Assistant feature must remain fully functional
**Scale/Scope**: ~45 source files deleted or edited across main process, renderer, preload, and store

---

## Constitution Check

*GATE: Must pass before proceeding to tasks.*

| Gate | Status | Notes |
|------|--------|-------|
| Keep it clear — no dead code after removal | ✅ PASS | All imports and registrations for deleted modules are removed in the same task batch |
| Match house style — follow Phase 01 pattern | ✅ PASS | Migration `'202'` follows same pattern as `'201'`; sidebar icon removal matches Phase 01 |
| Lint, test, format before completion | ✅ PASS | `pnpm format && pnpm build:check` required after all edits |
| Write conventional commits | ✅ PASS | Planned as `refactor:` commit per conventional commit spec |
| Propose before executing | ✅ PASS | This plan is the proposal; user approves before `/speckit.tasks` runs |
| No console.log — use loggerService | ✅ PASS | No new code added; existing logging unaffected |

No constitution violations. Complexity tracking table is not required.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-remove-knowledge-files/
├── plan.md              ← This file
├── research.md          ← Phase 0 output (scope corrections, retain/delete analysis)
├── data-model.md        ← Phase 1 output (N/A — see data-model.md)
├── checklists/
│   └── requirements.md  ← Spec quality checklist (all pass)
└── tasks.md             ← Phase 2 output (/speckit.tasks)
```

### Source Code — Files to **Edit** (15 files)

```text
src/renderer/src/
├── Router.tsx                                           # Remove /knowledge and /files routes + imports
├── config/sidebar.ts                                    # Remove 'knowledge' and 'files' from DEFAULT_SIDEBAR_ICONS
├── store/index.ts                                       # Remove knowledge/ocr/preprocess reducers + migration → v202
├── types/index.ts                                       # Remove 'knowledge' and 'files' from SidebarIcon union type
├── i18n/label.ts                                        # Remove 'knowledge' and 'files' from getSidebarIconLabel map
└── pages/settings/
    ├── SettingsPage.tsx                                 # Remove DocProcessSettings import, menu item, and route
    └── DisplaySettings/
        └── SidebarIconsManager.tsx                     # Remove knowledge and files entries from iconMap

src/main/
├── index.ts                                             # Remove KnowledgeService init/cleanup calls (if present)
├── ipc.ts                                               # Remove 9 IPC handlers (7 KnowledgeBase_* + 2 OCR_*) + 2 imports
└── mcpServers/
    └── factory.ts                                       # Remove DifyKnowledgeServer import + difyKnowledge case

src/preload/
└── index.ts                                             # Remove knowledgeBase: namespace (~282–305) and ocr: namespace (~545–548)
```

### Source Code — Files/Directories to **Delete** (30+ items)

```text
# Renderer pages
src/renderer/src/pages/knowledge/                        # Entire directory (KnowledgeBasePage, all sub-components)
src/renderer/src/pages/files/                            # Entire directory (FilesPage, FileList, etc.)
src/renderer/src/pages/settings/DocProcessSettings/      # Entire directory (OCR provider config, preprocessing settings)

# Renderer store slices
src/renderer/src/store/knowledge.ts
src/renderer/src/store/ocr.ts
src/renderer/src/store/preprocess.ts

# Renderer services
src/renderer/src/services/KnowledgeService.ts
src/renderer/src/services/FileAction.ts                  # Only used by pages/files — safe to delete

# Main process services
src/main/services/KnowledgeService.ts                   # Only imported by ipc.ts KnowledgeBase handlers

# Main process supporting directories
src/main/knowledge/                                      # Entire directory (embeddings, preprocessing, reranking)
src/main/services/ocr/                                   # Entire directory (OcrService, provider adapters)

# MCP server
src/main/mcpServers/dify-knowledge.ts                   # Knowledge-only MCP server
```

### Source Code — Files to **Retain** (do NOT touch)

```text
# Core file infrastructure — used by AI engine, not the Files page
src/main/services/FileStorage.ts                         # Backs all File_* IPC handlers used by AI core
src/main/services/FileSystemService.ts                   # Backs Fs_Read / Fs_ReadText used by AI core
src/main/services/remotefile/                            # Backs FileService_* IPC for Gemini file upload
src/renderer/src/services/FileManager.ts                 # Used by AI clients, Inputbar, MessageAttachments
src/main/mcpServers/memory.ts                            # General-purpose memory MCP (Phase 03 scope)

# IPC handlers to retain in ipc.ts
# All File_* handlers (~44), Fs_* handlers (2), FileService_* handlers (4)

# Preload namespaces to retain in preload/index.ts
# api.file.* and api.fileService.* namespaces
```

---

## Implementation Notes

### IPC Cleanup Detail (`src/main/ipc.ts`)

**Remove imports:**
```typescript
import KnowledgeService from './services/KnowledgeService'
import { ocrService } from './services/ocr/OcrService'
```

**Remove type imports** (only if unused after handler removal):
- `OcrProvider`, `SupportedOcrFile`
- `KnowledgeBaseParams`, `KnowledgeItem`, `KnowledgeSearchResult`, `KnowledgeSearchParams`, `KnowledgeBaseItems`

**Remove 7 KnowledgeBase handlers:**
- `KnowledgeBase_Create`, `KnowledgeBase_Reset`, `KnowledgeBase_Delete`
- `KnowledgeBase_Add`, `KnowledgeBase_Remove`, `KnowledgeBase_Search`, `KnowledgeBase_Rerank`

**Remove 2 OCR handlers:**
- `OCR_ocr`, `OCR_ListProviders`

**Do NOT remove** any `File_*`, `Fs_*`, or `FileService_*` handlers.

### Redux Migration (`src/renderer/src/store/index.ts`)

Add migration step `'202'` before bumping store version from `201` to `202`:

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

### Preload Cleanup (`src/preload/index.ts`)

Remove **only** these two namespace blocks:
- `knowledgeBase:` (~lines 282–305) — used only by Knowledge Base page
- `ocr:` (~lines 545–548) — used only by DocProcess settings

**Keep:**
- `file:` namespace (~line 197) — used by AI core throughout
- `fileService:` namespace (~lines 330–337) — used by Gemini AI client

---

## Verification Sequence

```bash
# 1. Format (fixes any style issues from deletions)
pnpm format

# 2. Full build check (lint + typecheck + test)
pnpm build:check

# Expected: zero new errors, same 8 pre-existing Vitest failures as before this phase
```

Manual smoke tests after build:
1. App launches without console errors
2. Sidebar has no Knowledge or Files icons
3. Settings has no Doc Processing menu item
4. Navigating to `/knowledge` or `/files` shows blank/404 state without crash
5. Selection Assistant: select text → trigger action → AI responds correctly
