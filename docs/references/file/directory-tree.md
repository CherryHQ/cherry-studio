---
description: Live directory-tree snapshots, watcher mutations, IpcApi ownership, and renderer mirror lifecycle
sources:
  - src/main/services/file/tree
  - src/main/services/file/watcher.ts
  - src/shared/utils/file/tree.ts
  - src/shared/ipc/schemas/file.ts
  - src/renderer/hooks/useDirectoryTree.ts
---

# Directory Tree Architecture

The directory-tree primitive builds a snapshot of an arbitrary directory and keeps a renderer-side
mirror current with filesystem events. It is runtime state: no tree node is stored in SQLite and no
`FileEntry` is created.

Current consumers include Notes, note import/reference views, agent system-workspace state, and the
artifact file tree.

## 1. Positioning

`DirectoryTreeBuilder` owns one in-memory tree, its absolute-path index, initial scan, and watcher.
`DirectoryTreeManager` owns builder sharing and renderer consumers. `useDirectoryTree` owns a
renderer mirror and the snapshot-to-stream handshake.

The primitive is separate from FileManager because its identity and lifecycle differ:

- a node is identified by its current path, not a persistent entry ID;
- the complete tree is rebuilt from disk;
- a watcher exists only while a consumer needs the tree;
- filesystem changes update the tree but do not register managed entries.

### 1.1 Relationship to DirectoryWatcher

The builder is the only production caller of `createDirectoryWatcher()` today. The watcher lives
at `src/main/services/file/watcher.ts` and returns synchronously; the builder then subscribes with
`onEvent()` and awaits the `ready` event before exposing the initial snapshot.

Chokidar reports a filesystem rename as `unlink` plus `add`. The generic watcher does not provide
rename detection. Identity-preserving `renamed` mutations only come from the explicit
`file.tree.rename` request described below.

## 2. Module Layout

```text
src/main/services/file/
├── watcher.ts
└── tree/
    ├── builder.ts                 # scan, tree/index mutation, watcher lifecycle
    ├── DirectoryTreeManager.ts    # shared builders and per-window consumers
    ├── gitignore.ts               # shared ignore predicate/default ripgrep globs
    └── search.ts                  # directory listing and fuzzy search

src/shared/utils/file/tree.ts      # options, DTOs, mutation types, TreeNode classes
src/shared/ipc/schemas/file.ts     # file.tree.* request/event contracts
src/renderer/hooks/useDirectoryTree.ts
```

### 2.1 Shared Contract

The shared tree module contains only serializable shapes and pure path/tree operations, so main and
renderer use the same `TreeNode`, `TreeFile`, `TreeDir`, and `TreeDirRoot` behavior.

### 2.2 Dependency Boundary

The builder and manager do not import `@main/data`. The tree is reconstructed from filesystem state
and communicates through shared DTOs; persistent Notes metadata and other domain state are joined
by their owning consumers.

## 3. Building a Tree

`createDirectoryTree(rootPath, options)` is asynchronous. It resolves only after both the initial
scan and watcher setup complete. After that, `root`, `snapshot()`, and `getNode(path)` are ready.

The builder starts the watcher before the scan finishes and serializes early watcher events behind
the scan. This closes the gap where a path could change after scan enumeration but before watcher
attachment.

### 3.1 Options

| Option | Default | Behavior |
|---|---|---|
| `extensions` | all files | Case-insensitive allowlist; values with or without a leading dot are accepted |
| `respectGitignore` | `true` | Loads the root `.gitignore` for the builder's post-scan and watcher predicates |
| `includeHidden` | `false` | Includes dotfiles/directories when enabled |
| `withStats` | `false` | Adds `mtime` and `birthtime` to scanned/watched child nodes; file `change` then emits `updated` |
| `maxDepth` | unlimited | Limits initial scan and watcher recursion |
| `watchMissingRoot` | `false` | Represents an absent root as empty and watches its nearest existing ancestor for creation |

Notes passes `.md`, `respectGitignore: false`, and `withStats: true`. Agent workspace consumers use
`watchMissingRoot` where their app-owned directory may be created lazily.

### 3.2 Dispose Grace Window

When a shared builder loses its last consumer, `DirectoryTreeManager` waits 500 ms before closing
it. A replacement mounted in the same React commit can acquire the still-warm builder and cancel
the timer instead of paying for another scan and watcher.

### 3.3 Ignore Coordination

`gitignore.ts` owns the default exclusions used by both ripgrep arguments and the chokidar
predicate. They include common dependency/build/editor directories and OS metadata; `.git` is
force-excluded. When `respectGitignore` is enabled, user rules are added after defaults for the
builder predicate, then `.git` is re-applied so it cannot be unignored.

The two scanners do not have perfectly symmetric opt-out semantics. `search.ts` lets ripgrep apply
its normal ignore discovery and always supplies the default negative globs. Therefore
`respectGitignore: false` skips the builder/chokidar `.gitignore` predicate but does not pass
`--no-ignore` to the initial ripgrep scan. Do not document that option as a guarantee that ignored
files appear in the initial snapshot.

The builder checks the predicate again after the initial scan and on every watcher event. Extension
filtering remains a builder rule because directories must stay present even when their files are
filtered.

### 3.4 Node Ordering and Identity

The initial tree is sorted folders-first, then by numeric-aware basename. Later mutations update
the child record in event order; consumers that require a sorted presentation re-sort their
projection when `version` changes.

`TreeDir` stores children by basename and the builder also keeps an absolute-path map. An explicit
rename mutates the same node object, repoints its parent key, cascades directory descendant paths,
and rekeys the map. This is why the shared classes, rather than plain nested DTOs, back both mirrors.

## 4. IpcApi Contract

| Route/event | Purpose |
|---|---|
| `file.tree.create` | Acquire a tree consumer and return `{ treeId, revision, snapshot }` |
| `file.tree.activate` | Confirm the renderer listener is installed and flush buffered mutations |
| `file.tree.dispose` | Release one consumer |
| `file.tree.rename` | Apply an already-completed same-parent filesystem rename to the mirror |
| `file.tree.mutation` | Directed main-to-renderer mutation stream |

### 4.1 Snapshot-to-Stream Handshake

A new consumer starts in a pending phase. Main captures the snapshot revision and buffers mutations
until the renderer:

1. receives the snapshot;
2. reconstructs and indexes its mirror;
3. subscribes to `file.tree.mutation`;
4. calls `file.tree.activate` with the snapshot revision.

Activation sends buffered mutations before it returns. The pending queue is capped at 1,000
events; overflow disposes that consumer. `useDirectoryTree` retries a refused activation with a
fresh snapshot up to three times.

Each push carries a monotonic revision. The renderer ignores duplicates, but a gap is terminal for
that mirror: it releases the tree and reports an error rather than displaying a silently stale
snapshot.

### 4.2 Mutation Shapes

The shared `TreeMutationEvent` union is:

- `added`: path, kind, basename, parent path, and optional stats;
- `removed`: path;
- `updated`: path and stats, only for a watched `change` when `withStats` is enabled;
- `renamed`: old path, new path, and basename, only from explicit rename coordination.

Events are not batched. Callers doing expensive derived work should manage that cost in their
presentation layer.

### 4.3 Ownership

The request handler resolves the caller's managed `WebContents`. Follow-up operations verify that
the calling window owns the `treeId`; the ID alone is not treated as authority. Mutation events are
sent only to the owning WebContents, not broadcast to all windows.

### 4.4 Explicit Rename

`file.tree.rename` does not rename anything on disk. Its caller must complete the filesystem rename
first, then pass `treeId`, `oldPath`, and a validated `newName`. The manager resolves the new path
inside the old parent, so cross-parent moves are not expressible.

When the old node still exists, the builder emits one identity-preserving `renamed` mutation and
suppresses the following chokidar `unlink`/`add` pair for one second. If chokidar won the race and
already removed the node, the request returns `false`; the ordinary remove/add events keep the
tree correct but node identity is lost.

## 5. Builder Sharing

Each create request receives its own `treeId`, but the manager shares one builder for equal
normalized `(rootPath, options)`. Option keys and extension-array order are canonicalized for the
dedupe key, and concurrent creates share the same in-flight build.

## 6. Resource Lifecycle

Destroying a WebContents releases all of its tree IDs. Service shutdown disposes every consumer and
awaits watcher closure. The last-consumer grace window is described in §3.2.

## 7. Failure Behavior

- An unreadable root, missing ripgrep binary, or watcher setup failure rejects tree creation.
- With `watchMissingRoot`, `ENOENT` for the root is an empty valid state; other errors still fail.
- A watcher error after activation logs and disposes the main-side builder. The current protocol
  has no terminal push telling an already-mounted renderer that its last snapshot is stale.
- Shutdown during an in-flight create maps `DirectoryTreeStoppedError` to a domain IpcError so the
  renderer can stop quietly.

## 8. Renderer Hook

`useDirectoryTree(rootPath, options?, onMutation?)` returns:

- `root`, `isLoading`, and `error`;
- `version`, incremented when a mutation changes the mirror;
- `treeId` after successful activation;
- `getNode(path)` backed by the mirror's path map.

The root object mutates in place, so derived React values must depend on `version`. A side consumer
that must observe every mutation uses the hook's `onMutation` callback; subscribing later with the
published `treeId` can miss mutations flushed during activation.

Options are sampled when a root mounts. Changing the options object while `rootPath` is unchanged
does not rebuild the tree.

## 9. Boundaries

The tree is a filesystem mirror, not the owner of business metadata. Notes, for example, projects
the tree into its renderer model and overlays sparse note-table state such as starred/expanded
metadata there. Other consumers likewise own selection, sorting, lazy projection, and domain rules.

Do not add SQLite access to the builder, persist tree nodes, or infer `FileEntry` ownership from a
path appearing in a tree.

## 10. Verification Map

| Concern | Tests |
|---|---|
| Tree classes and serialization | `src/main/services/file/tree/__tests__/TreeNode.test.ts` |
| Initial scan and watcher mutation | `src/main/services/file/tree/__tests__/builder.test.ts` |
| Sharing, ownership, activation, teardown | `src/main/services/file/tree/__tests__/DirectoryTreeManager.test.ts`, `DirectoryTreeManager.protocol.test.ts` |
| Renderer handshake and mirror updates | `src/renderer/hooks/__tests__/useDirectoryTree.test.tsx` |
| IpcApi routing | `src/main/ipc/handlers/__tests__/file.test.ts` |
