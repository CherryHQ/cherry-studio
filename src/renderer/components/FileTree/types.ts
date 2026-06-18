import type { DragPosition, TreeListSlotArgs } from '@cherrystudio/ui'
import type { CommandContextMenuExtraItem } from '@renderer/features/command'
import type React from 'react'

export type FileTreeNodeKind = 'file' | 'folder'

export interface FileTreeNode {
  id: string
  name: string
  kind: FileTreeNodeKind
  /** Canonical path consumed by @pierre/trees for model preparation. */
  path: string
  children?: FileTreeNode[]
}

export interface FileTreeRenameSlot {
  isRenaming: (node: FileTreeNode) => boolean
  /**
   * Props for the rename input - typically produced by `useInPlaceEdit`.
   * Spread on an `<input>` inside the renamed row.
   */
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
}

export interface FileTreeAnimationSlot {
  /** Whether the node is currently being auto-renamed (e.g. AI generation in progress). */
  isAnimating: (node: FileTreeNode) => boolean
  /** Whether the node was just auto-renamed (brief post-completion reveal window). */
  isNewlyRenamed: (node: FileTreeNode) => boolean
}

export interface FileTreeProps {
  nodes: FileTreeNode[]

  expandedIds?: ReadonlySet<string>
  defaultExpandedIds?: ReadonlySet<string>
  onExpandedChange?: (next: ReadonlySet<string>) => void

  selectedId?: string | null
  defaultSelectedId?: string | null
  onSelectedChange?: (id: string | null) => void

  /** When omitted, drag-and-drop is fully disabled (read-only tree). */
  onMove?: (sourceId: string, targetId: string, position: DragPosition) => void

  /** When omitted, inline rename is disabled. */
  renameSlot?: FileTreeRenameSlot

  /** When provided, applies shimmer/reveal animations to row names during auto-rename. */
  animationSlot?: FileTreeAnimationSlot

  /** Optional trailing slot per row - e.g. ContextMenu trigger, action buttons, badges. */
  renderRowExtras?: (node: FileTreeNode) => React.ReactNode
  /** Optional command-system context menu items for the whole row (Cherry/Native presentation). */
  getMenuItems?: (node: FileTreeNode) => readonly CommandContextMenuExtraItem[]

  /** Override default folder/file icons. */
  fileIcon?: (node: FileTreeNode) => React.ReactNode
  folderIcon?: (node: FileTreeNode, expanded: boolean) => React.ReactNode

  /** Override the virtualizer slot. Default uses DynamicVirtualList. */
  renderList?: (args: TreeListSlotArgs<FileTreeNode>) => React.ReactNode
  /** When true, folder rows are treated as sticky headers by the default virtualizer. Default: true. */
  stickyFolders?: boolean

  /** When true, renders a controlled search input above the tree. Filtering is the caller's responsibility - pass already-filtered `nodes`. */
  showSearch?: boolean
  /** Controlled search keyword. Required when `showSearch` is true. */
  searchKeyword?: string
  /** Fires on every keystroke in the search input. */
  onSearchKeywordChange?: (keyword: string) => void
  /** Placeholder for the search input. */
  searchPlaceholder?: string

  emptyState?: React.ReactNode
}
