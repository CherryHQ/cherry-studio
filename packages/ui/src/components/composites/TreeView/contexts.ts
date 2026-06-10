import { createContext, use } from 'react'

import type { DragPosition, TreeDragHandleProps } from './types'

/**
 * Split into three contexts so high-frequency drag updates do not re-render rows
 * that only consume selection/expansion state. Mirrors the proven pattern in
 * NotesSidebar (5 contexts) but collapsed to the minimum needed for v1.
 */

export interface TreeActionsContextValue {
  toggleExpanded: (id: string) => void
  selectNode: (id: string) => void
  getDragHandleProps: (id: string) => TreeDragHandleProps
}

export interface TreeSelectionContextValue {
  expandedIds: ReadonlySet<string>
  selectedId: string | null
}

export interface TreeDragContextValue {
  draggedId: string | null
  dragOverId: string | null
  dragPosition: DragPosition | null
}

export const TreeActionsContext = createContext<TreeActionsContextValue | null>(null)
export const TreeSelectionContext = createContext<TreeSelectionContextValue | null>(null)
export const TreeDragContext = createContext<TreeDragContextValue | null>(null)

function ensure<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(`${name} must be used inside <TreeView />`)
  }
  return value
}

export function useTreeActions(): TreeActionsContextValue {
  return ensure(use(TreeActionsContext), 'useTreeActions')
}

export function useTreeSelection(): TreeSelectionContextValue {
  return ensure(use(TreeSelectionContext), 'useTreeSelection')
}

export function useTreeDrag(): TreeDragContextValue {
  return ensure(use(TreeDragContext), 'useTreeDrag')
}
