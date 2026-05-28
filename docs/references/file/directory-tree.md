# Directory Tree Architecture

> **SoT scope** — **this document** owns: the `DirectoryTreeBuilder` primitive, the `TreeRegistry` lifecycle service that owns its IPC surface, the renderer-side `useDirectoryTree` hook, the `TreeNode` shape shipped to both processes, and the `.gitignore`-driven scan/watch coordination. The boundary between this primitive and FileManager is stated in [`architecture.md §1.2`](./architecture.md#12-filemanagers-position-within-the-module) — in case of conflict, that document decides positioning, this document decides implementation.
>
> **Contract stability**: the IPC contract, the `TreeNode` wire shape, and the resource model (one builder per `(rootPath, options)` pair, refcounted across `treeId`s with a dispose grace window) are binding commitments. When implementation reveals a contract that cannot be honored, revise this document first, then implement.

---

## 1. Positioning

### 1.1 Why a Separate Primitive

`DirectoryTreeBuilder` is the **second top-level primitive** inside the file module, parallel to `FileManager`. The two manage **orthogonal resource concerns**:

| Primitive | Resource | State | Backing | Lifecycle |
|---|---|---|---|---|
| FileManager | `FileEntry` rows (internal + external) + content bytes | DB + filesystem | `file_entry` / `file_ref` SQLite tables | always-on `WhenReady` service |
| DirectoryTreeBuilder | In-memory `TreeDirRoot` mirror + chokidar watcher | Pure runtime | None — FS is the source of truth | per-`(rootPath, options)`; refcounted |

Neither subsumes the other:

- A user can have a workspace folder that is **watched but unmanaged** (Notes opens any directory on disk without registering its files as `FileEntry`s) — that needs a tree, not entries.
- A user can have files that are **entered but unwatched** (every internal-origin file under `{userData}/Data/Files/`) — that needs entries, not a tree.
- A user can have **both** — a workspace whose contents are also referenced as external `FileEntry`s. The two primitives observe the same file path independently; neither has authority over the other's view.

Forcing the tree into FileManager (or vice versa) would put a DB-backed lifecycle in front of a pure-runtime scanning primitive, or vice versa — both incur cost the other doesn't need.

### 1.2 Why It's Not Just `chokidar` Inline

Three things sit on top of `chokidar` that any real caller would re-invent:

1. **Initial scan via `ripgrep --files`**, not chokidar's own walker. Chokidar opens an FSEvents / inotify handle per directory; on a workspace with `node_modules` the install hits `ulimit -n` and surfaces as `EMFILE`. Ripgrep streams a flat list of files, then a single `chokidar.FSWatcher` is attached with a `.gitignore`-derived `ignored` predicate so the recursive watch never enters the excluded subtrees in the first place.
2. **`(rootPath, options)` dedupe** — every `File_TreeCreate` IPC call returns a unique `treeId` (the renderer needs one to route mutation pushes), but identical roots share one underlying builder. The expensive resource (FS scan + watcher install) lives main-side; dedupe must too.
3. **`TreeNode` class hierarchy with identity preservation** — renames mutate `path` once at the subtree root and cascade via `adjustChildrenPaths`, so identity-based consumer caches (React keys, lookup maps) survive a rename. Rebuilding the subtree throws those caches away.

### 1.3 Relationship to DirectoryWatcher

`createDirectoryWatcher` (in `src/main/services/file/watcher/`) is the **transport-level FS event source**. DirectoryTreeBuilder is one of its consumers; `DanglingCache` is another. The watcher does not know about trees or entries; the builder does not implement its own FS-event protocol. This separation keeps the watcher reusable for non-tree consumers (DanglingCache, future external-file presence tracking) and keeps the builder testable against a synthetic watcher.

---

## 2. Module Layout

```
src/main/services/file/tree/   ← parallel to internal/ and watcher/
│
├── builder.ts            ← DirectoryTreeBuilder implementation
│     ├── createDirectoryTree(rootPath, options) — async factory
│     ├── initial scan via search.listDirectory → tree population
│     ├── chokidar attachment with .gitignore ignored predicate
│     ├── watcher event → tree mutation translation
│     └── dispose() — drop watcher subscription, idempotent
│
├── registry.ts           ← TreeRegistry: @Injectable, @ServicePhase(WhenReady)
│     ├── builderKey(rootPath, options) — dedupe key (normalized)
│     ├── create(sender, rootPath, options) — attach or share a builder
│     ├── dispose(treeId) — drop a consumer; tear down builder if last
│     ├── disposeAllForWebContents(id) — on `destroyed` cascade
│     ├── disposed flag — short-circuits in-flight builders on onStop
│     └── registerIpcHandlers() — File_TreeCreate / File_TreeDispose
│
├── search.ts             ← listDirectory: ripgrep + optional fuzzy match
│                           consumed only by builder.ts and ipc.ts
│
├── gitignore.ts          ← loadGitignorePredicate: parses .gitignore
│                           returns a function used by both ripgrep
│                           (--ignore-file) and chokidar (ignored)
│
├── index.ts              ← barrel: exports createDirectoryTree +
│                           DirectoryTreeBuilder type only
│
└── __tests__/            ← builder.test.ts / registry.test.ts /
                            TreeNode.test.ts / search.test.ts

packages/shared/file/types/tree.ts   ← shared with renderer
├── DirectoryTreeOptionsSchema (Zod) — IPC validation source of truth
├── DirectoryTreeOptions = z.infer<...> — derived type
├── SerializedTreeNode — wire DTO (parentless, plain object)
├── TreeNode / TreeFile / TreeDir / TreeDirRoot — class hierarchy
├── TreeMutationEvent — added | removed | updated
├── CreateTreeIpcResult — { treeId, snapshot }
└── TreeMutationPushPayload — { treeId, event }

src/renderer/src/hooks/useDirectoryTree.ts   ← renderer hook
├── On mount → File_TreeCreate → rehydrate TreeNode class hierarchy
├── On File_TreeMutation (filtered by treeId) → applyMutation in place
├── Returns { root, isLoading, error, version, treeId, getNode }
└── On unmount → File_TreeDispose
```

### 2.1 Why `search.ts` and `gitignore.ts` Live Here

Both files have exactly two callers each — `builder.ts` and `ipc.ts` (for the legacy `App_ListDirectory` channel that survives outside the tree primitive). They are tree implementation details: `.gitignore` parsing **must** match between the ripgrep argument and the chokidar predicate, or the tree will see directories chokidar already skipped (or vice versa). Living next to `builder.ts` makes that invariant inspectable.

If a future caller needs `listDirectory` outside the tree primitive (and outside the existing IPC), it can be promoted to the file-module common layer at that point. Until then, an extra `utils/` directory between `services/file/tree/` and these files would only be a naming smell — there's already a `src/main/utils/file/` directory that owns FS primitives, and a second "utils" inside the tree module makes the distinction unreadable.

### 2.2 No `@main/data` Imports

`src/main/services/file/tree/**` does not import from `@main/data/**` and never will. The tree is a runtime concern; persistence is orthogonal (`noteTable` is a sparse state overlay on top of FS paths, not a tree mirror). Enforced by ESLint config + a test in `builder.test.ts` that greps the source files for forbidden imports.

---

## 3. Resource Model

### 3.1 Identity: `treeId` vs `(rootPath, options)`

Every `File_TreeCreate` IPC call returns a unique `treeId`. The renderer uses this to filter mutation pushes (the `File_TreeMutation` channel is shared across all live trees in a window). Distinct treeIds may share a builder:

```
File_TreeCreate('/work/notes', {...})  → treeId=t-1
File_TreeCreate('/work/notes', {...})  → treeId=t-2  ← same builder
File_TreeCreate('/work/code',  {...})  → treeId=t-3  ← new builder

Tear down t-1 → refcount on (/work/notes) builder = 1
Tear down t-2 → refcount = 0, grace timer queued
  T+500ms: timer fires → builder.dispose() → watcher FDs released
```

`builderKey` normalizes the path (backslash → forward slash) so Windows variants of the same directory collapse to one builder, then concatenates `JSON.stringify(options ?? {})` separated by a NUL byte. Identical options produce identical keys; different `extensions` or `withStats` settings produce distinct keys (and distinct watchers).

### 3.2 Dispose Grace Window

`DISPOSE_GRACE_MS = 500`. When the last consumer of a builder leaves, the actual teardown is deferred by this window. The motivation is React's commit ordering inside a single render: "deletion effects → insertion effects". When `ArtifactPane` swaps between `Shell.Host` and `Shell.MaximizedOverlay`, the unmount fires `File_TreeDispose(old)` and the mount fires `File_TreeCreate(new)` back-to-back. Without the grace window, the unmount would tear down the watcher and the mount would pay a full rescan microseconds later.

500ms is long enough to span any realistic React commit (sub-millisecond in practice) and short enough that a genuine workspace close doesn't keep the watcher FDs alive noticeably.

### 3.3 In-Flight Cancellation

`createDirectoryTree` is async (ripgrep scan + chokidar attach). If `onStop` fires while a build is mid-flight, the registry sets `this.disposed = true` and the awaiting `acquireBuilder` checks this flag after the await:

```ts
const builder = await createDirectoryTree(rootPath, options)
if (this.disposed) {
  await builder.dispose()
  throw new Error('TreeRegistry stopped during in-flight builder creation')
}
```

Without this, the freshly-built builder would resolve after `disposeAll()` cleared the bookkeeping maps and would re-insert itself with no further cleanup path — an orphan watcher.

### 3.4 webContents-Destroyed Cascade

The registry tracks `webContentsId → Set<treeId>`. When `sender.once('destroyed')` fires (e.g. a window closes), all trees owned by that sender are disposed in one pass. Renderer-side cleanup via `File_TreeDispose` is preferred (it triggers the grace window), but this cascade is the safety net for crashed windows.

---

## 4. IPC Contract

### 4.1 Channels

| Channel | Value | Direction | Payload | Returns |
|---|---|---|---|---|
| `File_TreeCreate` | `file:tree:create` | renderer → main | `{ rootPath, options? }` | `{ treeId, snapshot }` |
| `File_TreeDispose` | `file:tree:dispose` | renderer → main | `{ treeId }` | `void` |
| `File_TreeMutation` | `file:tree:mutation` | main → renderer (push) | `{ treeId, event: TreeMutationEvent }` | — |

The `file:tree:*` prefix places these alongside `File_Open` / `File_Read` / etc. — the tree primitive is part of the file module, so its IPC namespace is too.

### 4.2 Validation

Both `File_TreeCreate` and `File_TreeDispose` validate their payloads through Zod at the handler boundary. `rootPath` must satisfy `AbsolutePathSchema` (non-empty, no null bytes, starts with `/` or `[A-Z]:\`). `options` is validated against `DirectoryTreeOptionsSchema` — the same schema whose `z.infer` produces the `DirectoryTreeOptions` TypeScript type, so wire shape and static type cannot drift.

A malformed payload rejects with a `ZodError` Promise rejection at the IPC boundary; the renderer's `invoke()` rejects with the same error. There is no silent narrowing — handlers never see an unvalidated object.

### 4.3 Renderer Surface

The preload bridge exposes the channels behind `window.api.tree`:

```ts
window.api.tree.create(rootPath, options?) → Promise<CreateTreeIpcResult>
window.api.tree.dispose(treeId)            → Promise<void>
window.api.tree.onMutation(callback)       → () => void  // unsubscribe
```

The `onMutation` subscription is shared (one `ipcRenderer.on` per call). Consumers that observe the channel directly **must** filter by `payload.treeId` — the `useDirectoryTree` hook does this internally and exposes its `treeId` for downstream side-subscribers to do the same.

---

## 5. `TreeNode` Class Hierarchy

### 5.1 Why Classes, Not Plain DTOs

The tree is small and read-mostly, so the choice between classes and a discriminated-union DTO is not a performance question. The class hierarchy earns its keep on **two ergonomics concerns** that plain DTOs would force callers to reimplement:

- **Navigation methods that take a `TreeDir` and stay typed** — `dir.nodeFromPath(...)`, `dir.walk(...)`, `dir.hasChild(...)`, `dir.attachChild(...)`, `dir.detach(...)`, `node.remove()`. With a DTO, these would all be free functions taking a tagged-union argument, and every call site that already narrowed via `node.kind === 'directory'` would still need to re-pass that narrowed value into the helper.
- **Parent pointer without serialization cycles** — `WeakMap`-backed `node.parent` lets `applyMutation` reach the parent during `remove()` without storing the pointer on the object (so `JSON.stringify` doesn't cycle, and the wire shape stays a plain tree). A DTO would either embed the parent (cycle) or push that lookup onto every caller.

Mutations on the wire are `added` / `removed` / `updated` — there is no `renamed` event and consumers do not mutate the tree in place. Identity preservation across renames is **not** a property of this primitive; a rename is observed as `removed` + `added`, and the renderer's `applyMutation` discards the old subtree's identity. Callers that need stable identity across renames must either pair the events at the consumer or wait for a future watcher-level rename detection — neither is part of the contract today.

### 5.2 Wire Shape: `SerializedTreeNode`

For IPC transit, the class hierarchy serializes to a plain object via `toJSON()`. The `parent` pointer is omitted (JSON has no cycles). The renderer reconstructs the class hierarchy via `rootFromSerialized(snapshot)`; parent pointers are re-established by walking the tree and using a `WeakMap` to track parents during reconstruction.

```
SerializedTreeNode = {
  kind: 'file' | 'directory'
  path: string
  basename: string
  children?: Record<string, SerializedTreeNode>   // only on directories
  stats?: { mtime, birthtime }                    // only when withStats: true
}
```

### 5.3 Mutation Events

Three event types, applied to the renderer mirror in `applyMutation`:

- `added` — `{ path, kind, basename, parentPath, stats? }`. Creates a new `TreeFile` or `TreeDir`, attaches under `parentPath`.
- `removed` — `{ path }`. Removes the node and (if directory) all descendants from the index.
- `updated` — `{ path, stats }`. Updates `node.stats` in place; only fires when the tree was built with `withStats: true`.

Renames are surfaced as a `removed` + `added` pair at the wire level; the renderer can pair them via `useDirectoryTree`'s mutation stream if it cares about rename identity.

---

## 6. `.gitignore` Coordination

A single parsed `Ignore` predicate (`ignore@7`) drives both:

- **`ripgrep --ignore-file`** during the initial scan, so ignored files never enter the tree.
- **`chokidar.FSWatcher.ignored`**, so ignored directories never have a watch handle attached (the cure for the original `EMFILE` on `node_modules`-heavy repos).

The predicate is loaded asynchronously inside `builder.init()` (not in the constructor — `readFileSync` on a slow filesystem would block the main event loop). `.git` is always excluded even when `.gitignore` doesn't list it.

A missing `.gitignore` is not an error — `loadGitignorePredicate` returns `null` and the builder skips the predicate entirely (everything is scanned and watched, modulo `includeHidden` and `extensions`).

---

## 7. Lifecycle

`TreeRegistry` is registered in `serviceRegistry.ts` with `@ServicePhase(Phase.WhenReady)`. The lifecycle container instantiates it after `DbService` / `CacheService` / `PreferenceService` complete (no `@DependsOn` declaration needed — cross-phase ordering is automatic).

| Phase | Action |
|---|---|
| `onInit` | `registerIpcHandlers()` — wires `File_TreeCreate` / `File_TreeDispose` |
| `onStop` | `disposeAll()` — clears consumers, force-tears all shared builders, drops in-flight promises |

IPC handlers are registered via `this.ipcHandle()` (from `BaseService`), so they are auto-cleaned on stop. No manual `ipcMain.removeHandler` calls.

---

## 8. Renderer Hook

`useDirectoryTree(rootPath, options?)` on the renderer mirrors the builder. Contract:

```ts
const { root, isLoading, error, version, treeId, getNode } = useDirectoryTree(rootPath, options)
```

- `root: TreeDirRoot | null` — the live tree. Mutated in place; `version` ticks each time.
- `isLoading: boolean` — `true` between mount and first `File_TreeCreate` resolution.
- `error: Error | null` — populated on rejected `File_TreeCreate`; cleared on next mount.
- `version: number` — monotonic counter. Increment on each applied mutation; use as a `useMemo` dependency for derived state (sorting, filtering, projecting).
- `treeId: string | null` — for downstream side-subscribers to filter `File_TreeMutation` payloads.
- `getNode(absPath)` — O(1) lookup in the local index. Stable identity across re-renders.

Re-creates only on `rootPath` change. Options are sampled at mount; changing them later does not trigger a rebuild — pass a different `rootPath` if you need a different scan.

### 8.1 Cancellation Discipline

The hook handles four overlapping concerns:

1. **Mid-flight `rootPath` change** — the previous effect's cleanup sets `cancelled = true`; the resolved snapshot calls `disposeTree(createdTreeId)` instead of swapping into state.
2. **Unmount during in-flight create** — same cancellation path; if `createdTreeId` was assigned before cleanup, the cleanup also calls `disposeTree`.
3. **Post-unmount rejection** — the catch block guards on `cancelled` before calling `setError`.
4. **StrictMode mount-unmount-mount** — the first mount's effect cleanup disposes its treeId; the second mount creates a fresh one. No leaked builders.

---

## 9. Boundaries

| Concern | Owner | Cross-reference |
|---|---|---|
| Filesystem watching | `createDirectoryWatcher` (transport) | [`watcher/`](../../../src/main/services/file/watcher) |
| `FileEntry` rows + atomic writes | FileManager | [`file-manager-architecture.md`](./file-manager-architecture.md) |
| `noteTable` sparse-state metadata | Notes domain (renderer + DataApi) | not part of tree concerns |
| `.gitignore` parsing | `gitignore.ts` (this module) | private to the tree primitive |
| Directory listing for non-tree callers | `search.listDirectory` (same module) | one IPC channel survives (`App_ListDirectory`) |

The tree primitive does not:

- Persist any of its state — every tree is rebuilt from disk on `File_TreeCreate`.
- Read or write the DB — no `@main/data/**` imports.
- Know about `FileEntry` — paths are paths; entries are managed orthogonally by FileManager.
- Implement its own FS event source — it consumes `createDirectoryWatcher`.

---

## 10. Testing

Three suites under `src/main/services/file/tree/__tests__/`:

- **`builder.test.ts`** — initial scan, `.gitignore` honoring, chokidar fan-out, dispose cleanup, JSON round-trip (no parent cycles), `@main/data` import isolation (greps the source for forbidden imports).
- **`registry.test.ts`** — builder dedupe, grace-window reuse, multi-consumer mutation fan-out, `webContents`-destroyed cascade cleanup, in-flight cancellation under `onStop`.
- **`TreeNode.test.ts`** — class invariants: rename cascade, identity preservation, JSON serialization shape.
- **`search.test.ts`** — `listDirectory` happy path + error branches (ripgrep unavailable, EACCES on root).

Renderer-side: `src/renderer/src/hooks/__tests__/useDirectoryTree.test.tsx` covers mount/unmount, mutation application, mid-flight cancel, StrictMode remount, post-unmount rejection, and treeId mismatch filtering.

---

## 11. Related Documents

- [`architecture.md`](./architecture.md) — module-level positioning (where this primitive sits relative to FileManager).
- [`file-manager-architecture.md`](./file-manager-architecture.md) — sister primitive; defines the FileEntry / FileRef contract and DirectoryWatcher internals.
- `packages/shared/file/types/tree.ts` — the wire types and class hierarchy this primitive emits.
