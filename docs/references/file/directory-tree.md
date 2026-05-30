# Directory Tree Architecture

> **SoT scope** — **this document** owns: the `DirectoryTreeBuilder` primitive, the `DirectoryTreeManager` lifecycle service that owns its IPC surface, the renderer-side `useDirectoryTree` hook, the `TreeNode` shape shipped to both processes, and the `.gitignore`-driven scan/watch coordination. The boundary between this primitive and FileManager is stated in [`architecture.md §1.2`](./architecture.md#12-filemanagers-position-within-the-module) — in case of conflict, that document decides positioning, this document decides implementation.
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
├── DirectoryTreeManager.ts  ← @Injectable, @ServicePhase(WhenReady)
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
├── gitignore.ts          ← loadGitignorePredicate: parses .gitignore into
│                           a predicate fed to chokidar (ignored option) +
│                           an in-builder post-scan filter. Ripgrep honors
│                           .gitignore on its own via its default behavior.
│
├── index.ts              ← barrel: exports createDirectoryTree +
│                           DirectoryTreeBuilder type only
│
└── __tests__/            ← builder.test.ts / registry.test.ts /
                            TreeNode.test.ts / search.test.ts

src/shared/file/types/tree.ts   ← shared with renderer
├── DirectoryTreeOptionsSchema (Zod) — IPC validation source of truth
├── DirectoryTreeOptions = z.infer<...> — derived type
├── SerializedTreeNode — wire DTO (parentless, plain object)
├── TreeNode / TreeFile / TreeDir / TreeDirRoot — class hierarchy
├── TreeMutationEvent — added | removed | updated
├── CreateTreeIpcResult — { treeId, snapshot }
└── TreeMutationPushPayload — { treeId, event }

src/renderer/hooks/useDirectoryTree.ts   ← renderer hook
├── On mount → File_TreeCreate → rehydrate TreeNode class hierarchy
├── On File_TreeMutation (filtered by treeId) → applyMutation in place
├── Returns { root, isLoading, error, version, treeId, getNode }
└── On unmount → File_TreeDispose
```

### 2.1 Why `search.ts` and `gitignore.ts` Live Here

Both files have exactly two callers each — `builder.ts` and `ipc.ts` (for the legacy `File_ListDirectory` channel that survives outside the tree primitive). They are tree implementation details: the chokidar `ignored` predicate and the in-builder post-scan filter both consult `loadGitignorePredicate`'s output, so the rules the watcher applies and the rules the tree post-scan applies cannot drift. Ripgrep honors `.gitignore` on its own; the explicit `--ignore-file` argument is **not** wired today (it could be a future optimisation). Living next to `builder.ts` keeps the predicate's surface area inspectable.

If a future caller needs `listDirectory` outside the tree primitive (and outside the existing IPC), it can be promoted to the file-module common layer at that point. Until then, an extra `utils/` directory between `services/file/tree/` and these files would only be a naming smell — there's already a `src/main/utils/file/` directory that owns FS primitives, and a second "utils" inside the tree module makes the distinction unreadable.

### 2.2 No `@main/data` Imports

`src/main/services/file/tree/**` does not import from `@main/data/**` and never will. The tree is a runtime concern; persistence is orthogonal (`noteTable` is a sparse state overlay on top of FS paths, not a tree mirror). Enforcement is the import-graph regex test in `builder.test.ts` ("the tree primitive does not import @main/data") — that test is the contract. (An `eslint no-restricted-imports` rule could be added later for a faster signal, but the test is what actually fails CI today.)

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
  throw new Error('DirectoryTreeManager stopped during in-flight builder creation')
}
```

Without this, the freshly-built builder would resolve after `disposeAll()` cleared the bookkeeping maps and would re-insert itself with no further cleanup path — an orphan watcher.

### 3.4 webContents-Destroyed Cascade

The registry tracks `webContentsId → Set<treeId>`. When `sender.once('destroyed')` fires (e.g. a window closes), all trees owned by that sender are disposed in one pass. Renderer-side cleanup via `File_TreeDispose` is preferred (it triggers the grace window), but this cascade is the safety net for crashed windows.

Note: the cascade routes each disposal through the regular `dispose(treeId)` path, which **still arms the 500 ms grace window** for each shared builder whose refcount drops to zero. The renderer is gone so no remount is coming, but waiting an extra 500 ms before tearing the watcher down has no observable cost. Test fixtures that need synchronous teardown call `disposeAll()` instead.

### 3.5 Children Ordering

Children inside a `TreeDir` are sorted **once, at the end of the initial scan**: folders-first, then `basename.localeCompare`. Watcher-driven `added` events `attachChild` to the end of the parent's `_children` record, so children added after the initial scan accumulate in arrival order rather than alphabetical order.

This is intentional — the alternative is re-sorting on every mutation, which on a large workspace under `git checkout` storms turns into hundreds of sorts. Consumers that care about ordering for display should re-sort at the UI layer keyed on the `version` counter exposed by `useDirectoryTree` (UI-layer `useMemo` over `Object.values(parent.children)` is the expected pattern).

---

## 4. IPC Contract

### 4.1 Channels

| Channel | Value | Direction | Payload | Returns |
|---|---|---|---|---|
| `File_TreeCreate` | `file:tree:create` | renderer → main | `{ rootPath, options? }` | `{ treeId, snapshot: SerializedTreeNode }` |
| `File_TreeDispose` | `file:tree:dispose` | renderer → main | `{ treeId }` | `void` |
| `File_TreeRename` | `file:tree:rename` | renderer → main | `{ treeId, oldPath, newPath }` | `boolean` (true if applied) |
| `File_TreeMutation` | `file:tree:mutation` | main → renderer (push) | `{ treeId, event: TreeMutationEvent }` | — |

The `file:tree:*` prefix places these alongside `File_Open` / `File_Read` / etc. — the tree primitive is part of the file module, so its IPC namespace is too.

### 4.2 Validation

Both `File_TreeCreate` and `File_TreeDispose` validate their payloads through Zod at the handler boundary. `rootPath` must satisfy `AbsolutePathSchema` (non-empty, no null bytes, starts with `/` or `[A-Z]:\`). `options` is validated against `DirectoryTreeOptionsSchema` — the same schema whose `z.infer` produces the `DirectoryTreeOptions` TypeScript type, so wire shape and static type cannot drift.

A malformed payload rejects with a `ZodError` Promise rejection at the IPC boundary; the renderer's `invoke()` rejects with the same error. There is no silent narrowing — handlers never see an unvalidated object.

### 4.3 Renderer Surface

The preload bridge exposes the channels behind `window.api.tree`:

```ts
window.api.tree.create(rootPath, options?)        → Promise<CreateTreeIpcResult>
window.api.tree.dispose(treeId)                   → Promise<void>
window.api.tree.rename(treeId, oldPath, newPath)  → Promise<boolean>
window.api.tree.onMutation(callback)              → () => void  // unsubscribe
```

Each `onMutation` call registers its own `ipcRenderer.on` listener. All listeners receive every `File_TreeMutation` push regardless of which tree it belongs to; consumers **must** filter by `payload.treeId`. The `useDirectoryTree` hook does this internally and exposes its `treeId` so downstream side-subscribers can do the same.

### 4.4 Explicit Rename

`File_TreeRename` is invoked by callers that just performed a file-system rename (e.g. Notes after `window.api.file.rename`). The flow:

1. Renderer performs the FS rename (already happens today).
2. Renderer calls `window.api.tree.rename(treeId, oldPath, newPath)`.
3. Main side `DirectoryTreeBuilder.rename(oldPath, newPath)`:
   - Mutates the existing `TreeNode` instance via the `path` setter, which cascades through `adjustChildrenPaths` and repoints the parent's `_children` map.
   - Re-keys the internal `Map<path, TreeNode>` so descendants are reachable under their new paths.
   - Marks `(oldPath, newPath)` in a per-builder dedup window (1 second).
   - Emits a `renamed` mutation event to every consumer of this builder.
4. Chokidar's subsequent `unlink(oldPath)` + `add(newPath)` events arrive within ~200 ms and are suppressed by the dedup window.
5. Renderer hook `applyMutation` handles `renamed` by re-running step 3's path mutation in the renderer's mirror — identity preserved across the rename.

Returns `false` when the node at `oldPath` is missing (race: chokidar's `unlink` already fired before the explicit call arrived). In that case the renderer already saw `removed` + `added`; identity is lost but state stays consistent.

---

## 5. `TreeNode` Class Hierarchy

### 5.1 Why Classes, Not Plain DTOs

The tree is the source of identity for two operations the renderer cares about:

- **Rename** — `treeNode.path` is mutated once at the subtree root, then `adjustChildrenPaths` recurses. Consumers holding a reference to the same `TreeNode` instance still have a valid handle.
- **Reverse lookup** — `O(1)` `Map<absPath, TreeNode>` index. The renderer hook keeps this in sync with mutations.

A plain DTO approach would force rebuilding the subtree on every rename, which destroys identity-based caches (React keys, hashmap lookups), and would force consumers to revalidate every reference after every mutation.

### 5.1.1 Why `TreeDirRoot` Is a Separate Class

`TreeDirRoot extends TreeDir` has no extra fields and no overridden behaviour today — only the constructor signature differs (`TreeDirRoot(rootPath)` vs. `new TreeDir({ path, stats? })`). It exists as a **type brand**:

- `useDirectoryTree` returns `TreeDirRoot | null`, so the type system tells the caller "this is a tree root, not an interior directory". Callers can't accidentally pass a leaf directory where a root is expected.
- It is the documented extension point for root-only state — a future `rootPath` history, watcher status, or `withStats`-summary field belongs on `TreeDirRoot`, not `TreeDir`, and the type brand keeps the migration mechanical.

If neither concern materialises, this class can be deleted and `useDirectoryTree` can return `TreeDir | null` — semantics are unchanged. Keep it until the call sites prove the brand is wasted.

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

Four event types, applied to the renderer mirror in `applyMutation`:

- `added` — `{ path, kind, basename, parentPath, stats? }`. Creates a new `TreeFile` or `TreeDir`, attaches under `parentPath`.
- `removed` — `{ path }`. Removes the node and (if directory) all descendants from the index.
- `updated` — `{ path, stats }`. Updates `node.stats` in place; only fires when the tree was built with `withStats: true`.
- `renamed` — `{ oldPath, newPath, basename }`. Mutates the existing `TreeNode` instance via the `path` setter (identity preserved); cascades to descendants when a directory is renamed. **Only** emitted via the explicit `File_TreeRename` IPC — chokidar cannot synthesize this on its own. See §4.4.

Renames observed by the watcher alone surface as `removed` + `added` (chokidar's native shape). When a caller wants identity preservation, it must invoke `File_TreeRename` after the FS-level rename — see §4.4.

### 5.4 External-Rename Identity Loss

A rename that originates **outside** Cherry — Finder, `mv`, an external editor — surfaces only through chokidar as `unlink(oldPath)` + `add(newPath)`. The builder applies these as `removed` + `added` mutations, so the `TreeNode` for the renamed file is destroyed and a new one is created. Identity is lost: React keys re-key, downstream `Map<path, TreeNode>` lookups invalidate, editor cursors / `useFileContent` SWR caches / `noteTable` overlays observe "the old file disappeared, an unrelated new file appeared".

We considered pairing chokidar's `unlink` + `add` into a synthetic `renamed` event via heuristics (basename equality + timestamp proximity), the way VS Code / Atom do. We chose not to:

- **chokidar's inode tracking is not cross-platform.** Windows `ReadDirectoryChangesW` does not expose inodes, so any pairing has to fall back to filename heuristics there — the implementation diverges per OS.
- **Filename + timestamp pairing has a measurable false-positive rate** on bursty FS operations (`git checkout` switching branches, editor batch-saves, build pipelines rewriting bundles in place). A **mis-paired identity** — claiming "file A renamed to file B" when really A was deleted and B was created independently — is strictly worse than identity loss, because downstream caches now follow the wrong file silently.
- **The heuristic adds API surface** every caller would have to reason about (pairing window, opt-out, false-positive handling).

Within-Cherry renames go through `File_TreeRename` (§4.4) and *do* preserve identity, because the caller knows it's a rename and the chokidar `unlink` + `add` are suppressed by the dedup window. The external-rename case sits outside that contract on purpose — Cherry can't claim "rename" on behalf of an event source that didn't tell us it was a rename.

Reconsider if external editor integration with the Notes workspace becomes a real pain point — most likely path is an opt-in builder option (e.g. `pairExternalRenames: true`) that enables heuristic pairing with documented false-positive risk, pushing the trade-off to the caller rather than forcing it on every consumer.

---

## 6. `.gitignore` Coordination

**Single source of truth, three consumers.** A constant `DEFAULT_IGNORE_PATTERNS` in `gitignore.ts` (gitignore-syntax: `.DS_Store`, `Thumbs.db`, `desktop.ini`, `node_modules/`, `dist/`, `build/`, `.next/`, `.nuxt/`, `coverage/`, `.cache/`, `.vscode/`, `.idea/`) seeds three places:

- **`chokidar.FSWatcher.ignored`** — `loadGitignorePredicate` builds an `ignore@7` predicate from the defaults + the user's `.gitignore`. chokidar consults the predicate so ignored directories never get a watch handle (the cure for the original `EMFILE` on `node_modules`-heavy repos).
- The **builder's post-scan filter** — the same predicate is re-checked inside the builder after `search.listDirectory` returns, plus once more on every watcher event as a belt-and-suspenders guard against chokidar race orderings.
- **ripgrep's `-g !pattern` arguments** — `defaultRipgrepGlobArgs()` converts the same `DEFAULT_IGNORE_PATTERNS` constant into ripgrep CLI flags. ripgrep also honors `.gitignore` natively for the rest.

These three layers used to drift: the ripgrep glob list was an independent `RIPGREP_EXCLUDE_GLOBS` constant in `search.ts`. A `.DS_Store` written **after** mount slipped past chokidar even though the initial scan filtered it. The shared `DEFAULT_IGNORE_PATTERNS` closes that gap.

User-side `.gitignore` rules apply **after** the defaults, so a deliberate `!node_modules` etc. can still un-ignore them. `.git/` is force-added **last** so a user `!.git` cannot un-ignore it (watching git internals is pointless and expensive).

The predicate is loaded asynchronously inside `builder.init()` (not in the constructor — `readFileSync` on a slow filesystem would block the main event loop).

A missing `.gitignore` is **not** the same as "no exclusion at all" — `loadGitignorePredicate` still returns a predicate with the defaults + `.git`, so the watcher / scan don't recurse into OS noise / build caches / git internals. The function returns `null` **only** when the `ignore` library itself fails to construct (effectively never in practice).

### 6.1 Extension Filter Lives in the Builder, Not Ripgrep

The `extensions` option (e.g. `['.md']` for Notes) is applied **inside the builder**: `passesExtensionFilter` strips non-matching paths after `search.listDirectory` returns, and the watcher's `add` handler re-checks before insertion. Ripgrep is **not** given an `--iglob` argument, so on a workspace with 100k files the IPC payload returned by `listDirectory` is the full file list before the filter shrinks it.

This is fine today (Notes' workspaces are typically a few hundred markdown files); the cost shows up only when a single tree's root contains both a huge unrelated subtree and an explicit `extensions: ['.md']` option. If that combination ever matters, push the filter down to ripgrep via `--iglob` — `search.listDirectory` already accepts the necessary arguments.

### 6.2 Mutation Events Are Not Server-Side Batched

Each watcher event becomes one `File_TreeMutation` IPC push. `chokidar` debounces within a single file (200ms `stabilityThreshold`) but does **not** batch across files, so a bursty FS operation — `git checkout` switching to a branch with hundreds of touched files — emits a corresponding burst of pushes. Each renderer hook runs `applyMutation` per push and ticks `version`, so a `useMemo(() => sort(tree), [version])` consumer will recompute repeatedly through the burst.

Consumers should debounce their downstream work (`useDeferredValue` / `useTransition` / a `version`-keyed `useMemo` whose body is fast enough to absorb the storm). A microtask-batched `TreeMutationBatchEvent` would solve this at the wire layer if usage justifies it; not implemented today.

---

## 7. Lifecycle

`DirectoryTreeManager` is registered in `serviceRegistry.ts` with `@ServicePhase(Phase.WhenReady)`. The lifecycle container instantiates it after `DbService` / `CacheService` / `PreferenceService` complete (no `@DependsOn` declaration needed — cross-phase ordering is automatic).

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
| Directory listing for non-tree callers | `search.listDirectory` (same module) | one IPC channel survives (`File_ListDirectory`) |

The tree primitive does not:

- Persist any of its state — every tree is rebuilt from disk on `File_TreeCreate`.
- Read or write the DB — no `@main/data/**` imports.
- Know about `FileEntry` — paths are paths; entries are managed orthogonally by FileManager.
- Implement its own FS event source — it consumes `createDirectoryWatcher`.

---

## 10. Testing

Three suites under `src/main/services/file/tree/__tests__/`:

- **`builder.test.ts`** — initial scan, `.gitignore` honoring, chokidar fan-out, dispose cleanup, JSON round-trip (no parent cycles), `@main/data` import isolation (greps the source for forbidden imports).
- **`DirectoryTreeManager.test.ts`** — builder dedupe (including order-insensitive option keys), grace-window reuse, multi-consumer mutation fan-out, explicit-rename dispatch by treeId, `webContents`-destroyed cascade cleanup, in-flight cancellation under `onStop`.
- **`TreeNode.test.ts`** — class invariants: rename cascade, identity preservation, JSON serialization shape.
- **`search.test.ts`** — `listDirectory` happy path + error branches (ripgrep unavailable, EACCES on root).

Renderer-side: `src/renderer/hooks/__tests__/useDirectoryTree.test.tsx` covers mount/unmount, mutation application, mid-flight cancel, StrictMode remount, post-unmount rejection, and treeId mismatch filtering.

---

## 11. Related Documents

- [`architecture.md`](./architecture.md) — module-level positioning (where this primitive sits relative to FileManager).
- [`file-manager-architecture.md`](./file-manager-architecture.md) — sister FileEntry / FileRef primitive. Specifically: §8 ("DirectoryWatcher") for the watcher contract this primitive consumes, including the `WatcherEvent` shape (`ready` / `add` / `addDir` / `unlink` / `unlinkDir` / `change` / `error`).
- `src/shared/file/types/tree.ts` — the wire types and class hierarchy this primitive emits.
