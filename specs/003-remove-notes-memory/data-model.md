# Data Model: Remove Notes & Memory Features (Phase 03)

This document describes the entities being removed and the state changes required.

---

## Entities Being Removed

### 1. Note Store Slice (`state.note`)

**Location**: `src/renderer/src/store/note.ts`

**State shape**:
```typescript
{
  notes: Note[],          // Array of note objects
  notesPath: string,      // Directory path where notes are stored
  activeNoteId: string    // Currently selected note ID
}
```

**Consumers** (all being deleted or cleaned):
- `store/index.ts` — persistor callback reads `notesPath` on boot (CRITICAL: removed with the slice)
- `store/index.ts` — added as `note` reducer in `combineReducers`
- `store/index.ts` — `'note/'` in `storeSyncService` syncList
- `store/migrate.ts` — referenced in old migration entries
- `pages/notes/` — entire directory (deleted)
- `hooks/useNotesQuery.ts` — selector hook (deleted)
- `hooks/useNotesSettings.ts` — selector hook (deleted)
- `hooks/useShowWorkspace.ts` — selector hook (deleted)

**Post-removal state migration**: Migration 203 in `store/migrate.ts` deletes `state.note` and filters `'notes'` from `state.settings.sidebarIcons`.

---

### 2. Memory Store Slice (`state.memory`)

**Location**: `src/renderer/src/store/memory.ts`

**State shape**:
```typescript
{
  enabled: boolean,                 // Global memory feature toggle
  config: MemoryConfig,            // Memory service configuration
  syncEnabled: boolean             // Whether to sync memory across devices
}
```

**Consumers** (all being deleted or cleaned):
- `store/index.ts` — added as `memory` reducer in `combineReducers`
- `searchOrchestrationPlugin.ts` — reads `selectGlobalMemoryEnabled`, `selectMemoryConfig`
- `useAppInit.ts` — reads `selectMemoryConfig`
- `AssistantMemorySettings.tsx` — reads/writes memory config
- `pages/settings/MemorySettings/` — entire directory (deleted)

**Post-removal state migration**: Migration 203 in `store/migrate.ts` deletes `state.memory`.

---

### 3. Note Entity

**Represents**: A single note-taking document created by the user.

**Fields**:
- `id: string` — Unique identifier
- `title: string` — Note title
- `content: string` — Markdown content
- `createdAt: number` — Unix timestamp of creation
- `updatedAt: number` — Unix timestamp of last update

**Storage**: Files on disk at `notesPath` directory. Not deleted by this phase — data becomes unreachable but persists on disk.

---

### 4. Memory Record Entity

**Represents**: A persisted AI conversation memory item stored in the user's memory database.

**Fields**:
- `id: string` — Unique identifier
- `content: string` — The memory text
- `userId: string` — Associated user profile ID
- `createdAt: number` — Unix timestamp
- `updatedAt: number` — Unix timestamp

**Storage**: SQLite database in the user's app data directory. Not deleted by this phase — data persists on disk but becomes unreachable.

---

## State Migration Plan

### Migration 203

**Triggers when**: A user with persisted store version ≤ 202 launches the updated app.

**Actions**:
1. Delete `state.note` key from persisted state
2. Delete `state.memory` key from persisted state
3. Filter `'notes'` out of `state.settings.sidebarIcons` array (if present)

**Result**: Redux Persist rehydrates a clean store without the removed slices, with no crash and no orphaned state.

---

## Redux Store Version History (Relevant Entries)

| Version | Change |
|---------|--------|
| 202 | Current version (Phase 02 result) |
| 203 | **Phase 03**: Remove `state.note`, `state.memory`; filter `'notes'` from `sidebarIcons` |

---

## IPC Namespaces Being Removed

### `memory:*` (preload namespace)

**Location**: `src/preload/index.ts`

**Methods exposed**:
- `memory.add(content, userId)`
- `memory.search(query, userId)`
- `memory.list(userId)`
- `memory.delete(id)`
- `memory.update(id, content)`
- `memory.get(id)`
- `memory.setConfig(config)`
- `memory.deleteUser(userId)`
- `memory.deleteAllMemoriesForUser(userId)`
- `memory.getUsersList()`
- `memory.migrateMemoryDb()`

**Consumed by**: Renderer-side `MemoryService.ts` (deleted) and `MemorySettings/` pages (deleted).

### `file.validateNotesDirectory` (preload, single method)

**Location**: `src/preload/index.ts` within the `file:` namespace

**Consumed by**: `NotesSettings.tsx` inside `pages/notes/` (deleted).

---

## Sidebar Type Change

**File**: `src/renderer/src/types/index.ts`

**Before**:
```typescript
export type SidebarIcon =
  | 'chat'
  | 'notes'
  | 'paintings'
  // ... other values
```

**After**: Remove `'notes'` from the union. The sidebar configuration persisted in Redux will have `'notes'` stripped by migration 203.

---

## Assistant Type Change

**File**: `src/renderer/src/types/index.ts`

**Before**:
```typescript
export interface Assistant {
  // ...
  enableMemory?: boolean
  // ...
}
```

**After**: Remove `enableMemory` field. This field controlled per-assistant memory override behavior in the now-deleted memory pipeline.
