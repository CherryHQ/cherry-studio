# File IPC Wiring Spec

> **Scope**: Wire all remaining v2 File IPC methods — channel enums, Zod schemas,
> main-side handlers, and preload bridge — in a single PR.
>
> **Prerequisite**: The v1 `window.api.file` → `window.api.legacyFile` rename
> (including all ~142 renderer call-site updates) is done as a **separate commit
> before this work begins**. That commit is owned by @EurFelux.
>
> **References**:
>
> - [`ipc.ts`](../../../packages/shared/file/types/ipc.ts) — `FileIpcApi` contract
> - [`ipc-redesign.md`](./ipc-redesign.md) — early v1→v2 mapping (OUTDATED, context only)
> - [`phase2-consumer-migration.md`](./phase2-consumer-migration.md) — PREREQ-INFRA plan
> - [`FileManager.ts`](../../../src/main/services/file/FileManager.ts) — main-side implementations

---

## 1. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | v2 channels take clean names (`file:read`), v1 renamed to `file:legacy:*` | v1 is being deprecated; v2 deserves the ergonomic names |
| D2 | `window.api.file` is the v2 surface; v1 becomes `window.api.legacyFile` | `legacyFile` grep tracks migration progress; clean namespace for v2 |
| D3 | Dialog handlers (`openSelectDialog`/`openSaveDialog`) are inline in `registerIpcHandlers()`, not FileManager public methods | Dialogs are not entry-centric; FileManager public API only takes `FileEntryId` per architecture principle |
| D4 | `FileIpcApi` = IPC methods (main handler required); `FilePreloadApi extends FileIpcApi` adds preload-only utilities | Main-side handler completeness checking requires `FileIpcApi` to exclude preload-only methods like `getPathForFile` |
| D5 | Preload typed as `const fileV2: FilePreloadApi = { ... }`, implementations use `any` forwarding | Three-layer safety: renderer has type-safe overloads, preload forwards transparently, main validates with Zod |
| D6 | Three missing path utilities added to `FileIpcApi`: `canWrite`, `toAbsolutePath`, `isPathInside` | From ipc-redesign.md §G — renderer has no `node:path`/`os.homedir`, needs IPC for these |
| D7 | `getPathForFile(file: File): string` added to `FilePreloadApi` (not `FileIpcApi`) | Sync, preload-only (`webUtils`), `File` object not serializable across IPC |
| D8 | Single PR for all wiring (not split by INF-1/2/3/4) | Mechanical work with uniform pattern; v1 legacy rename must happen atomically; split PRs increase total review cost |

---

## 2. Type Architecture

```
┌─────────────────────────────────────────────────┐
│              FileIpcApi (interface)              │
│  All IPC methods — main handler required        │
│  read, write, openSelectDialog, openSaveDialog, trash, ...          │
│  canWrite, toAbsolutePath, isPathInside         │
│  (all return Promise<T>)                        │
├─────────────────────────────────────────────────┤
│         FilePreloadApi extends FileIpcApi        │
│  + getPathForFile(file: File): string           │
│  (preload-only, sync, no main handler)          │
└─────────────────────────────────────────────────┘

Usage:
  Main:     handler map satisfies derived-from FileIpcApi  → completeness check
  Preload:  const fileV2: FilePreloadApi = { ... }         → completeness + overload signatures
  Renderer: window.api.file: FilePreloadApi                → type-safe calls with overload narrowing
```

### Three-Layer Safety Model

```
Renderer                     Preload                        Main
─────────                    ───────                        ────
FilePreloadApi overloads     any-forwarding via             Zod schema.parse()
narrow return types          ipcRenderer.invoke             validates every param
at call site                                                before handler executes
```

The preload is a transparent pipe. It does not validate arguments — that responsibility
belongs to the Zod schemas at the main-process IPC boundary. The preload's `any`
forwarding is a deliberate design choice, not a gap. This MUST be documented in a
JSDoc comment on the `fileV2` declaration.

---

## 3. Channel Enumeration

### 3.1 v1 Channels to Rename

Only channels whose string value clashes with a v2 channel need renaming. `File_Select` and `File_Save` are NOT renamed because v2 uses `openSelectDialog` / `openSaveDialog` instead.

| Current Enum Member | Current String | New Enum Member | New String |
|---|---|---|---|
| `File_Open` | `file:open` | `File_LegacyOpen` | `file:legacy:open` |
| `File_Read` | `file:read` | `File_LegacyRead` | `file:legacy:read` |
| `File_Write` | `file:write` | `File_LegacyWrite` | `file:legacy:write` |
| `File_Rename` | `file:rename` | `File_LegacyRename` | `file:legacy:rename` |
| `File_Copy` | `file:copy` | `File_LegacyCopy` | `file:legacy:copy` |
| `File_ShowInFolder` | `file:showInFolder` | `File_LegacyShowInFolder` | `file:legacy:showInFolder` |
| `File_ListDirectory` | `file:listDirectory` | `File_LegacyListDirectory` | `file:legacy:listDirectory` |

**Files affected**: `IpcChannel.ts` (definition), `src/main/ipc.ts` (handler), `src/preload/index.ts` (bridge), `packages/shared/file/types/ipc.ts` (JSDoc comment).

### 3.2 New v2 Channel Enum Members

```typescript
// packages/shared/IpcChannel.ts — add to File v2 section

// ─── File v2: Read / Metadata ───
File_Read = 'file:read',
File_GetMetadata = 'file:getMetadata',
File_BatchGetMetadata = 'file:batchGetMetadata',
File_GetVersion = 'file:getVersion',
File_GetContentHash = 'file:getContentHash',

// ─── File v2: Write ───
File_Write = 'file:write',
File_WriteIfUnchanged = 'file:writeIfUnchanged',

// ─── File v2: Lifecycle ───
File_Trash = 'file:trash',
File_Restore = 'file:restore',
File_BatchTrash = 'file:batchTrash',
File_BatchRestore = 'file:batchRestore',
File_BatchPermanentDelete = 'file:batchPermanentDelete',

// ─── File v2: Mutation ───
File_Rename = 'file:rename',
File_Copy = 'file:copy',

// ─── File v2: System / Navigation ───
File_Open = 'file:open',
File_ShowInFolder = 'file:showInFolder',
File_OpenSelectDialog = 'file:openSelectDialog',
File_OpenSaveDialog = 'file:openSaveDialog',

// ─── File v2: Directory ───
File_ListDirectory = 'file:listDirectory',
File_IsNotEmptyDir = 'file:isNotEmptyDir',

// ─── File v2: Batch Entry Operations ───
File_BatchCreateInternalEntries = 'file:batchCreateInternalEntries',
File_BatchEnsureExternalEntries = 'file:batchEnsureExternalEntries',
File_BatchGetPhysicalPaths = 'file:batchGetPhysicalPaths',

// ─── File v2: Path Utilities ───
File_CanWrite = 'file:canWrite',
File_ToAbsolutePath = 'file:toAbsolutePath',
File_IsPathInside = 'file:isPathInside',
```

**Total**: 26 new enum members. Combined with 7 existing v2 channels = 33 v2 channels.

---

## 4. FileIpcApi Contract Additions

Add to `packages/shared/file/types/ipc.ts`:

### 4.1 New Section L: Path Utilities

```typescript
// ─── L. Path Utilities (renderer has no node:path / os.homedir) ───

/**
 * Check if a directory path is writable.
 * @phase 2 — not yet wired
 */
canWrite(dirPath: FilePath): Promise<boolean>

/**
 * Expand `~` prefix and resolve to an absolute filesystem path.
 * Renderer has no access to `node:path` or `os.homedir()`.
 * @phase 2 — not yet wired
 */
toAbsolutePath(filePath: string): Promise<FilePath>

/**
 * Check if `childPath` is inside `parentPath`. Pure path computation, no FS IO.
 * @phase 2 — not yet wired
 */
isPathInside(childPath: string, parentPath: string): Promise<boolean>
```

### 4.2 New: FilePreloadApi

```typescript
/**
 * Complete preload surface exposed as `window.api.file`.
 *
 * Extends `FileIpcApi` with preload-only utilities that cannot cross IPC
 * (e.g. `getPathForFile` requires a `File` object which is not structured-cloneable).
 */
export interface FilePreloadApi extends FileIpcApi {
  /**
   * Extract the filesystem path from a renderer-side `File` object (drag-drop / input).
   * Delegates to Electron's `webUtils.getPathForFile`. Sync, preload-only.
   */
  getPathForFile(file: File): string
}
```

---

## 5. Zod Schemas

All new schemas defined in `src/main/services/file/FileManager.ts`, alongside existing
schemas. Reuse existing building blocks (`FileEntryIdSchema`, `FileHandleSchema`,
`AbsolutePathSchema`, `SafeNameSchema`).

### Shared constants

```typescript
/** Max batch size for id-array IPC calls. Mirrors FILE_BATCH_DANGLING_MAX_IDS. */
export const FILE_BATCH_MAX_IDS = 500
```

### Schema inventory

| Schema | Validates | Used by |
|--------|-----------|---------|
| `ReadIpcSchema` | `[FileHandle, { encoding?, detectEncoding? }?]` | `File_Read` |
| `GetMetadataIpcSchema` | `FileHandle` | `File_GetMetadata` |
| `BatchGetMetadataIpcSchema` | `{ ids: FileEntryId[] }` (max 500) | `File_BatchGetMetadata` |
| `GetVersionIpcSchema` | `FileHandle` | `File_GetVersion` |
| `GetContentHashIpcSchema` | `FileHandle` | `File_GetContentHash` |
| `WriteIpcSchema` | `[FileHandle, string \| Uint8Array]` | `File_Write` |
| `WriteIfUnchangedIpcSchema` | `[FileHandle, data, FileVersion, contentHash?]` | `File_WriteIfUnchanged` |
| `TrashIpcSchema` | `{ id: FileEntryId }` | `File_Trash` |
| `RestoreIpcSchema` | `{ id: FileEntryId }` | `File_Restore` |
| `BatchIdsIpcSchema` | `{ ids: FileEntryId[] }` (max 500) | `File_BatchTrash`, `File_BatchRestore`, `File_BatchPermanentDelete` |
| `RenameIpcSchema` | `[FileHandle, string]` | `File_Rename` |
| `CopyIpcSchema` | `{ source: FileHandle, newName?: string }` | `File_Copy` |
| `OpenIpcSchema` | `FileHandle` | `File_Open` |
| `ShowInFolderIpcSchema` | `FileHandle` | `File_ShowInFolder` |
| `OpenSelectDialogIpcSchema` | `{ directory?, multiple?, filters?, title? }` | `File_OpenSelectDialog` |
| `OpenSaveDialogIpcSchema` | `{ content, defaultPath?, filters? }` | `File_OpenSaveDialog` |
| `ListDirectoryIpcSchema` | `[AbsolutePath, DirectoryListOptions?]` | `File_ListDirectory` |
| `IsNotEmptyDirIpcSchema` | `AbsolutePath` | `File_IsNotEmptyDir` |
| `BatchCreateInternalEntriesIpcSchema` | `CreateInternalEntryIpcParams[]` (max 500) | `File_BatchCreateInternalEntries` |
| `BatchEnsureExternalEntriesIpcSchema` | `EnsureExternalEntryIpcParams[]` (max 500) | `File_BatchEnsureExternalEntries` |
| `BatchGetPhysicalPathsIpcSchema` | `{ ids: FileEntryId[] }` (max 500) | `File_BatchGetPhysicalPaths` |
| `CanWriteIpcSchema` | `AbsolutePath` | `File_CanWrite` |
| `ToAbsolutePathIpcSchema` | `string` (min 1) | `File_ToAbsolutePath` |
| `IsPathInsideIpcSchema` | `[string, string]` | `File_IsPathInside` |

---

## 6. IPC Handler Registration

All handlers registered in `FileManager.registerIpcHandlers()`. Pattern per method type:

### 6.1 FileHandle methods — dispatchHandle

```typescript
this.ipcHandle(IpcChannel.File_Read, async (_e, ...args: unknown[]) => {
  const [handle, options] = ReadIpcSchema.parse(args)
  return dispatchHandle(handle as FileHandle,
    (id) => this.read(id, options),
    (path) => readByPath(this.deps, path, options),
  )
})
```

### 6.2 FileEntryId-only methods — direct delegation

```typescript
this.ipcHandle(IpcChannel.File_Trash, async (_e, params: unknown) =>
  this.trash(TrashIpcSchema.parse(params).id)
)
```

### 6.3 Dialog methods — inline implementation

```typescript
this.ipcHandle(IpcChannel.File_OpenSelectDialog, async (_e, options: unknown) => {
  const opts = OpenSelectDialogIpcSchema.parse(options)
  if (opts.directory) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: opts.title,
    })
    return canceled ? null : filePaths[0] ?? null
  }
  const properties: string[] = ['openFile']
  if (opts.multiple) properties.push('multiSelections')
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: properties as any,
    filters: opts.filters,
    title: opts.title,
  })
  if (canceled) return opts.multiple ? [] : null
  return opts.multiple ? filePaths : filePaths[0] ?? null
})
```

### 6.4 Path utility methods — delegate to @main/utils/file

```typescript
this.ipcHandle(IpcChannel.File_CanWrite, async (_e, params: unknown) =>
  canWrite(CanWriteIpcSchema.parse(params) as FilePath)
)
this.ipcHandle(IpcChannel.File_ToAbsolutePath, async (_e, params: unknown) => {
  const raw = ToAbsolutePathIpcSchema.parse(params)
  return path.resolve(untildify(raw)) as FilePath
})
this.ipcHandle(IpcChannel.File_IsPathInside, async (_e, ...args: unknown[]) => {
  const [child, parent] = IsPathInsideIpcSchema.parse(args)
  return isPathInside(child, parent)
})
```

### 6.5 Path-branch implementations to add

These are needed for `dispatchHandle`'s path branch where no `*ByPath` exists yet:

| Method | Path branch implementation | Location |
|--------|---------------------------|----------|
| `getMetadata` | `fs.stat(path)` → build `PhysicalFileMetadata` (mirror `FileManager.getMetadata` logic without entry lookup / DanglingCache) | inline in handler or `internal/content/metadata.ts` |
| `getVersion` | `fs.stat(path)` → `{ mtime: s.modifiedAt, size: s.size }` | inline in handler |
| `write` (path) | `atomicWriteFile(path, data)` then `fs.stat` → `FileVersion` (existing `writeByPath` returns `void`, needs stat for version) | adapt in handler |
| `rename` (path) | `fs.move(path, newTarget)` → `Promise<void>` (path-handle rename returns void, not FileEntry) | inline in handler |

### 6.6 Main-side handler completeness check

Compile-time assertion at the bottom of `registerIpcHandlers()` that all `FileIpcApi`
method keys have a corresponding handler. A dead-code type-level check (not runtime):

```typescript
// After all this.ipcHandle() calls, assert completeness.
// If a key is added to FileIpcApi but not listed here, TypeScript errors.
const _handledMethods = [
  'openSelectDialog', 'openSaveDialog', 'read', 'getMetadata', 'batchGetMetadata',
  // ... every FileIpcApi method name ...
] as const satisfies readonly (keyof FileIpcApi)[]

type _AssertComplete = keyof FileIpcApi extends (typeof _handledMethods)[number] ? true : never
const _check: _AssertComplete = true  // fails if a method is missing from the array
```

The `_handledMethods` array is dead code (never executed) — its sole purpose is to
produce a type error when `FileIpcApi` grows a method that isn't listed.

---

## 7. Preload Bridge

### Structure

```typescript
// src/preload/index.ts

/**
 * v2 File IPC bridge.
 *
 * ## Safety model
 *
 * This bridge is a transparent forwarding layer. Implementations use untyped
 * (`any`) argument forwarding via `ipcRenderer.invoke`. This is deliberate:
 *
 * - **Renderer**: `FilePreloadApi` provides type-safe overloaded signatures
 *   with narrowed return types at the call site.
 * - **Preload**: Forwards arguments as-is. No validation.
 * - **Main**: Zod schemas (`*IpcSchema.parse()`) validate every parameter
 *   before the handler executes.
 *
 * The preload does NOT validate arguments — that responsibility belongs to
 * the Zod schemas at the main-process IPC boundary.
 */
const fileV2: FilePreloadApi = {
  // A. Dialogs
  openSelectDialog: (options: any) => ipcRenderer.invoke(IpcChannel.File_OpenSelectDialog, options),
  openSaveDialog: (options: any) => ipcRenderer.invoke(IpcChannel.File_OpenSaveDialog, options),

  // B. Entry creation
  createInternalEntry: (params: any) => ipcRenderer.invoke(IpcChannel.File_CreateInternalEntry, params),
  ensureExternalEntry: (params: any) => ipcRenderer.invoke(IpcChannel.File_EnsureExternalEntry, params),
  batchCreateInternalEntries: (items: any) => ipcRenderer.invoke(IpcChannel.File_BatchCreateInternalEntries, items),
  batchEnsureExternalEntries: (items: any) => ipcRenderer.invoke(IpcChannel.File_BatchEnsureExternalEntries, items),

  // C. Read / Metadata
  read: (handle: any, options?: any) => ipcRenderer.invoke(IpcChannel.File_Read, handle, options),
  getMetadata: (handle: any) => ipcRenderer.invoke(IpcChannel.File_GetMetadata, handle),
  batchGetMetadata: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchGetMetadata, params),
  getVersion: (handle: any) => ipcRenderer.invoke(IpcChannel.File_GetVersion, handle),
  getContentHash: (handle: any) => ipcRenderer.invoke(IpcChannel.File_GetContentHash, handle),

  // D. Write
  write: (handle: any, data: any) => ipcRenderer.invoke(IpcChannel.File_Write, handle, data),
  writeIfUnchanged: (handle: any, data: any, version: any, hash?: any) =>
    ipcRenderer.invoke(IpcChannel.File_WriteIfUnchanged, handle, data, version, hash),

  // E. Lifecycle
  trash: (params: any) => ipcRenderer.invoke(IpcChannel.File_Trash, params),
  restore: (params: any) => ipcRenderer.invoke(IpcChannel.File_Restore, params),
  permanentDelete: (handle: any) => ipcRenderer.invoke(IpcChannel.File_PermanentDelete, handle),
  batchTrash: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchTrash, params),
  batchRestore: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchRestore, params),
  batchPermanentDelete: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchPermanentDelete, params),

  // F. Rename / Copy
  rename: (handle: any, newTarget: any) => ipcRenderer.invoke(IpcChannel.File_Rename, handle, newTarget),
  copy: (params: any) => ipcRenderer.invoke(IpcChannel.File_Copy, params),

  // H. System
  open: (handle: any) => ipcRenderer.invoke(IpcChannel.File_Open, handle),
  showInFolder: (handle: any) => ipcRenderer.invoke(IpcChannel.File_ShowInFolder, handle),

  // I. Directory
  listDirectory: (dirPath: any, options?: any) => ipcRenderer.invoke(IpcChannel.File_ListDirectory, dirPath, options),
  isNotEmptyDir: (dirPath: any) => ipcRenderer.invoke(IpcChannel.File_IsNotEmptyDir, dirPath),

  // J. Entry enrichment
  getDanglingState: (params: any) => ipcRenderer.invoke(IpcChannel.File_GetDanglingState, params),
  batchGetDanglingStates: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchGetDanglingStates, params),
  getPhysicalPath: (params: any) => ipcRenderer.invoke(IpcChannel.File_GetPhysicalPath, params),
  batchGetPhysicalPaths: (params: any) => ipcRenderer.invoke(IpcChannel.File_BatchGetPhysicalPaths, params),

  // K. Sweep
  runSweep: () => ipcRenderer.invoke(IpcChannel.File_RunSweep),

  // L. Path utilities
  canWrite: (dirPath: any) => ipcRenderer.invoke(IpcChannel.File_CanWrite, dirPath),
  toAbsolutePath: (filePath: any) => ipcRenderer.invoke(IpcChannel.File_ToAbsolutePath, filePath),
  isPathInside: (child: any, parent: any) => ipcRenderer.invoke(IpcChannel.File_IsPathInside, child, parent),

  // M. Preload-only
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
}

const api = {
  // ...
  legacyFile: { /* v1 — populated by @EurFelux's rename commit */ },
  file: fileV2,
  // ...
}
```

---

## 8. Testing

Extend `src/main/services/file/__tests__/FileManager.ipc-schemas.test.ts`:

- Every new schema: **valid input accepted** + **invalid input rejected** (wrong type, missing field, extra keys)
- Batch schemas: **max size cap** enforced (`FILE_BATCH_MAX_IDS + 1` → throw)
- `FileHandle`-accepting schemas: both `entry` and `path` variants accepted
- `OpenSelectDialogIpcSchema`: all three option shapes (single file, multiple files, directory)

No IPC round-trip integration tests in this PR — handler implementations delegate to
already-tested FileManager methods. The wiring itself is mechanical.

---

## 9. Files Modified

| File | Changes |
|------|---------|
| `packages/shared/IpcChannel.ts` | Rename 7 v1 channels; add 26 v2 channels |
| `packages/shared/file/types/ipc.ts` | Add §L path utilities to `FileIpcApi`; add `FilePreloadApi`; update `@phase` JSDoc tags |
| `src/main/ipc.ts` | Update 7 v1 channel enum references |
| `src/main/services/file/FileManager.ts` | Add ~23 Zod schemas; extend `registerIpcHandlers()` with ~26 new handlers; add handler completeness type check |
| `src/preload/index.ts` | Update 7 v1 channel enum references; add complete `fileV2: FilePreloadApi` bridge |
| `src/main/services/file/__tests__/FileManager.ipc-schemas.test.ts` | Add tests for all new schemas |

Minor / inline additions (path-branch implementations):

| File | Changes |
|------|---------|
| `src/main/services/file/internal/content/read.ts` | (existing `readByPath` — no change needed) |
| `src/main/services/file/internal/content/hash.ts` | (existing `hashByPath` — no change needed) |
| `src/main/services/file/internal/content/write.ts` | (existing `writeByPath` — may adapt return value) |
| `src/main/services/file/internal/system/shell.ts` | (existing `open`/`showInFolder` — no change needed) |

New path-branch helpers (inline in handler or in internal modules):

- `getMetadataByPath`: stat → `PhysicalFileMetadata`
- `getVersionByPath`: stat → `FileVersion`
- `renameByPath`: `fs.move(path, newTarget)`
- `writeByPath` return adaptation: add stat → `FileVersion` after atomic write
