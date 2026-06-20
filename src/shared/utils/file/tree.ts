/**
 * Directory-tree primitive — wire types + shared class hierarchy.
 *
 * SoT: `docs/references/file/directory-tree.md`.
 *
 * Lives in shared because both the main-process `DirectoryTreeBuilder`
 * (`src/main/services/file/tree/`) and the renderer-side `useDirectoryTree`
 * hook (`src/renderer/hooks/useDirectoryTree.ts`) work against the
 * **same tree shape**. Splitting the classes into per-side mirrors made
 * us write the algorithms twice — there is no reason: every helper here
 * is pure string manipulation, no Node FS or Electron globals.
 *
 * Wire DTOs (`SerializedTreeNode`, `TreeMutationEvent`, …) and the class
 * hierarchy (`TreeNode` / `TreeFile` / `TreeDir` / `TreeDirRoot`) ship
 * from the same module so they can never drift.
 *
 * The tree is a **runtime / render-layer** concern — not coupled to
 * `file_entry` / `file_ref`. Notes joins its sparse-state `noteTable`
 * renderer-side after the tree mirror has been built — see directory-tree.md §9.
 */

import type { FilePath } from '@shared/types/file'
import * as z from 'zod'

// ─── Wire DTOs ──────────────────────────────────────────────────────────────

/** Stat fields carried inline when the tree was built with `withStats: true`. */
export interface TreeNodeStats {
  /** mtime in ms (epoch). */
  readonly mtime: number
  /** Best-effort birthtime in ms; falls back to mtime on filesystems without birth-time. */
  readonly birthtime: number
}

/** Serializable wire shape. Mirrors `TreeNode` minus the live `parent` pointer. */
export interface SerializedTreeNode {
  readonly kind: 'file' | 'directory'
  readonly path: string
  readonly basename: string
  /** Present iff `kind === 'directory'`. Empty `{}` for empty dirs. */
  readonly children?: Record<string, SerializedTreeNode>
  /** Present iff the tree was built with `withStats: true`. */
  readonly stats?: TreeNodeStats
}

/**
 * Schema is source-of-truth: the inferred type below stays in lockstep with
 * the runtime validation used at the `File_TreeCreate` IPC boundary. Both sides
 * (main parser + renderer producer) import this schema; drift is structurally
 * impossible.
 */
export const DirectoryTreeOptionsSchema = z.strictObject({
  /**
   * File-extension allowlist (case-insensitive). Empty / omitted means "all
   * files". Compared against the file basename's last `.`-separated segment.
   * Example: `['.md']` for the Notes tree.
   */
  extensions: z.array(z.string()).optional(),

  /** Honor `.gitignore` etc. Default `true`. Notes opt out (`false`). */
  respectGitignore: z.boolean().optional(),

  /** Include dotfiles / dot-dirs. Default `false`. */
  includeHidden: z.boolean().optional(),

  /**
   * When `true`, the builder stats every entry up front and exposes
   * `mtime`/`birthtime` on each node (and `SerializedTreeNode.stats`).
   * Costs `O(n)` stat calls; only enable when actually needed for sorting.
   */
  withStats: z.boolean().optional(),

  /** Max depth from root. Default unlimited. */
  maxDepth: z.int().nonnegative().optional()
})

export type DirectoryTreeOptions = z.infer<typeof DirectoryTreeOptionsSchema>

/**
 * Tree mutation pushed from main → renderer as the watcher observes changes.
 *
 * The watcher cannot synthesize `renamed` on its own (chokidar surfaces
 * renames as `unlink` + `add`), so that variant is only emitted via the
 * explicit `File_TreeRename` IPC — used by callers that already know they
 * just performed a rename (e.g. Notes after `file.rename`). When emitted,
 * the renderer applies it via the `TreeNode.path` setter, preserving node
 * identity through the rename. The chokidar `unlink`/`add` events that
 * arrive shortly after are suppressed by a per-builder dedup window so they
 * don't double-apply.
 */
export type TreeMutationEvent =
  | {
      readonly type: 'added'
      readonly path: string
      readonly kind: 'file' | 'directory'
      readonly basename: string
      readonly parentPath: string
      readonly stats?: TreeNodeStats
    }
  | {
      readonly type: 'removed'
      readonly path: string
    }
  | {
      readonly type: 'updated'
      readonly path: string
      readonly stats: TreeNodeStats
    }
  | {
      readonly type: 'renamed'
      readonly oldPath: string
      readonly newPath: string
      readonly basename: string
    }

/** Handle returned by the `File_TreeCreate` IPC. */
export interface CreateTreeIpcResult {
  readonly treeId: string
  readonly snapshot: SerializedTreeNode
}

/** Wire shape for the main→renderer `File_TreeMutation` push channel. */
export interface TreeMutationPushPayload {
  readonly treeId: string
  readonly event: TreeMutationEvent
}

export type TreeRootPath = FilePath | string

// ─── Class hierarchy (shared between main and renderer) ─────────────────────

function joinTreePath(parent: string, basename: string): string {
  if (!parent) return basename
  if (parent === '/') return `/${basename}`
  return `${parent}/${basename}`
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/')
  if (i < 0) return ''
  if (i === 0) return '/'
  return p.slice(0, i)
}

export interface TreeNodeInit {
  /** Absolute, forward-slash path. */
  readonly path: string
  /** Optional initial stats (set when the builder uses `withStats: true`). */
  readonly stats?: TreeNodeStats
}

export abstract class TreeNode {
  abstract readonly kind: 'file' | 'directory'

  protected _path: string
  protected _basename: string
  protected _dirname: string
  protected _stats: TreeNodeStats | undefined

  // WeakMap keeps `parent` reachable for navigation while staying invisible
  // to `JSON.stringify` / structured clone — avoids the cycle problem when
  // we serialize children-as-Record.
  protected static readonly parentMap = new WeakMap<TreeNode, TreeDir>()

  protected constructor(init: TreeNodeInit) {
    const normalized = init.path.replace(/\\/g, '/')
    this._path = normalized
    this._basename = basenameOf(normalized)
    this._dirname = dirnameOf(normalized)
    this._stats = init.stats
  }

  get path(): string {
    return this._path
  }
  set path(value: string) {
    const normalized = value.replace(/\\/g, '/')
    if (normalized === this._path) return
    const newBasename = basenameOf(normalized)
    const oldBasename = this._basename
    this._path = normalized
    this._basename = newBasename
    this._dirname = dirnameOf(normalized)
    // If the basename changed, repoint our entry in the parent's
    // _children map: the old key still points at us, the new key is
    // absent. Skipping this leaves parent.hasChild() / nodeFromPath()
    // silently desynced from the actual path graph.
    if (newBasename !== oldBasename) {
      TreeNode.parentMap.get(this)?.repointChild(oldBasename, this)
    }
    this.adjustChildrenPaths()
  }

  get basename(): string {
    return this._basename
  }
  set basename(value: string) {
    if (value === this._basename) return
    const oldBasename = this._basename
    this._basename = value
    this._path = joinTreePath(this._dirname, value)
    TreeNode.parentMap.get(this)?.repointChild(oldBasename, this)
    this.adjustChildrenPaths()
  }

  get dirname(): string {
    return this._dirname
  }

  get parent(): TreeDir | null {
    return TreeNode.parentMap.get(this) ?? null
  }

  /** Stats: present iff the tree was built with `withStats: true`. */
  get stats(): TreeNodeStats | undefined {
    return this._stats
  }
  set stats(value: TreeNodeStats | undefined) {
    this._stats = value
  }

  isTreeFile(): this is TreeFile {
    return this.kind === 'file'
  }
  isTreeDir(): this is TreeDir {
    return this.kind === 'directory'
  }

  /** Detach from parent's `children` record. Idempotent. */
  remove(): boolean {
    const parent = this.parent
    if (!parent) return false
    if (parent.detach(this._basename) !== this) return false
    TreeNode.parentMap.delete(this)
    return true
  }

  toJSON(): SerializedTreeNode {
    return this.serialize()
  }

  protected abstract serialize(): SerializedTreeNode

  protected adjustChildrenPaths(): void {
    /* default no-op — only TreeDir overrides */
  }

  /** Used by builders / parents to wire parent without going through public API. */
  static setParent(child: TreeNode, parent: TreeDir | null): void {
    if (parent) TreeNode.parentMap.set(child, parent)
    else TreeNode.parentMap.delete(child)
  }
}

export class TreeFile extends TreeNode {
  readonly kind = 'file' as const

  constructor(init: TreeNodeInit) {
    super(init)
  }

  protected serialize(): SerializedTreeNode {
    const out: SerializedTreeNode = {
      kind: 'file',
      path: this._path,
      basename: this._basename
    }
    if (this._stats) (out as { stats?: TreeNodeStats }).stats = this._stats
    return out
  }
}

export class TreeDir extends TreeNode {
  readonly kind = 'directory' as const

  private readonly _children: Record<string, TreeNode> = Object.create(null)

  constructor(init: TreeNodeInit) {
    super(init)
  }

  get children(): Readonly<Record<string, TreeNode>> {
    return this._children
  }

  get childCount(): number {
    return Object.keys(this._children).length
  }

  hasChild(basename: string): boolean {
    return basename in this._children
  }

  /** Insert (or replace) a child by its current basename. */
  attachChild(child: TreeNode): TreeNode {
    const existing = this._children[child.basename]
    if (existing && existing !== child) {
      TreeNode.setParent(existing, null)
    }
    this._children[child.basename] = child
    TreeNode.setParent(child, this)
    return child
  }

  /**
   * Move an existing child's record from `oldBasename` to its current
   * basename. Used by `TreeNode.set path` / `set basename` so a rename
   * keeps `_children` keyed by the live basename. No-op when the child
   * at `oldBasename` is not the given node (defensive — protects against
   * races where a sibling has already been swapped in).
   */
  repointChild(oldBasename: string, child: TreeNode): void {
    if (this._children[oldBasename] !== child) return
    delete this._children[oldBasename]
    this._children[child.basename] = child
  }

  /** Remove a child by basename. */
  detach(basename: string): TreeNode | null {
    const child = this._children[basename]
    if (!child) return null
    delete this._children[basename]
    TreeNode.setParent(child, null)
    return child
  }

  /**
   * Resolve a descendant by absolute or path-relative segment chain.
   * Returns `null` if any segment is missing.
   */
  nodeFromPath(target: string): TreeNode | null {
    const normalized = target.replace(/\\/g, '/')
    if (normalized === this._path) return this
    let rel: string
    if (normalized.startsWith(`${this._path}/`)) {
      rel = normalized.slice(this._path.length + 1)
    } else if (normalized.startsWith('/')) {
      return null
    } else {
      rel = normalized
    }

    const segments = rel.split('/').filter(Boolean)
    if (segments.length === 0) return this

    let current: TreeNode | undefined = this._children[segments[0]]
    for (let i = 1; i < segments.length && current; i++) {
      if (!current.isTreeDir()) return null
      current = current._children[segments[i]]
    }
    return current ?? null
  }

  /** Depth-first walk. `cb` may return `false` to halt traversal. */
  walk(cb: (node: TreeNode, depth: number) => boolean | void): void {
    const visit = (node: TreeNode, depth: number): boolean => {
      if (cb(node, depth) === false) return false
      if (node.isTreeDir()) {
        for (const child of Object.values(node._children)) {
          if (!visit(child, depth + 1)) return false
        }
      }
      return true
    }
    visit(this, 0)
  }

  /** Re-sort children: folders first, then `basename.localeCompare`. */
  sortChildren(): void {
    const entries = Object.entries(this._children)
    entries.sort(([, a], [, b]) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'accent' })
    })
    for (const key of Object.keys(this._children)) delete this._children[key]
    for (const [key, node] of entries) this._children[key] = node
  }

  protected override adjustChildrenPaths(): void {
    for (const child of Object.values(this._children)) {
      child.path = joinTreePath(this._path, child.basename)
    }
  }

  protected serialize(): SerializedTreeNode {
    const children: Record<string, SerializedTreeNode> = {}
    for (const [name, child] of Object.entries(this._children)) {
      children[name] = child.toJSON()
    }
    const out: SerializedTreeNode = {
      kind: 'directory',
      path: this._path,
      basename: this._basename,
      children
    }
    if (this._stats) (out as { stats?: TreeNodeStats }).stats = this._stats
    return out
  }
}

export class TreeDirRoot extends TreeDir {
  constructor(rootPath: string) {
    super({ path: rootPath })
  }
}

// ─── Construction helpers ───────────────────────────────────────────────────

export function fromSerialized(json: SerializedTreeNode): TreeNode {
  if (json.kind === 'file') {
    return new TreeFile({ path: json.path, stats: json.stats })
  }
  const dir = new TreeDir({ path: json.path, stats: json.stats })
  if (json.children) {
    for (const child of Object.values(json.children)) {
      dir.attachChild(fromSerialized(child))
    }
  }
  return dir
}

export function rootFromSerialized(json: SerializedTreeNode): TreeDirRoot {
  if (json.kind !== 'directory') {
    throw new Error('rootFromSerialized: expected directory at the top level')
  }
  const root = new TreeDirRoot(json.path)
  if (json.stats) root.stats = json.stats
  if (json.children) {
    for (const child of Object.values(json.children)) {
      root.attachChild(fromSerialized(child))
    }
  }
  return root
}
