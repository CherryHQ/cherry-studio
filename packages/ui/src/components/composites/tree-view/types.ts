import type React from 'react'

export type DragPosition = 'before' | 'inside' | 'after'

export interface TreeNodeAdapter<T> {
  getId: (node: T) => string
  getChildren: (node: T) => T[] | undefined
  /** When false, the node cannot accept 'inside' drops (used for leaves). Default: true. */
  canHaveChildren?: (node: T) => boolean
  /** When true, the row is treated as a sticky header at its depth. */
  isSticky?: (node: T) => boolean
}

export interface FlatTreeItem<T> {
  id: string
  node: T
  depth: number
}

export interface TreeDragHandleProps {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}

export interface RenderRowArgs<T> {
  node: T
  depth: number
  isExpanded: boolean
  isSelected: boolean
  isDragging: boolean
  isDragOver: boolean
  dragPosition: DragPosition | null
  toggleExpanded: () => void
  selectNode: () => void
  /** Spread on the draggable element. Listeners are no-ops when DnD is disabled (no onMove prop). */
  dragHandleProps: TreeDragHandleProps
}

export type RenderRowFn<T> = (args: RenderRowArgs<T>) => React.ReactNode

export interface TreeListSlotArgs<T> {
  flat: ReadonlyArray<FlatTreeItem<T>>
  isSticky: (index: number) => boolean
  getItemDepth: (index: number) => number
  renderItem: (index: number) => React.ReactNode
}

export interface TreeViewProps<T> {
  data: T[]
  adapter: TreeNodeAdapter<T>

  expandedIds?: ReadonlySet<string>
  defaultExpandedIds?: ReadonlySet<string>
  onExpandedChange?: (next: ReadonlySet<string>) => void

  selectedId?: string | null
  defaultSelectedId?: string | null
  onSelectedChange?: (id: string | null) => void

  renderRow: RenderRowFn<T>

  /**
   * When omitted, DnD is fully disabled — no listeners attached, draggable=false.
   *
   * TreeView guards self-drops, external drops, and leaf `inside` fallback, but
   * callers still own structural move validation such as rejecting descendant
   * targets before mutating their tree data.
   */
  onMove?: (sourceId: string, targetId: string, position: DragPosition) => void

  /** Optional virtualizer slot. When omitted, rows render as a plain flat list. */
  renderList?: (args: TreeListSlotArgs<T>) => React.ReactNode

  className?: string
  emptyState?: React.ReactNode
}
