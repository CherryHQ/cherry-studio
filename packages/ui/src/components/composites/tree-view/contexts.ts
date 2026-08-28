import { createContext, use } from 'react'

import type { TreeDragHandleProps } from './types'

/**
 * Split actions from selection so stable row handlers do not change when
 * selection changes. High-frequency drag row state is passed by props.
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

export const TreeActionsContext = createContext<TreeActionsContextValue | null>(null)
export const TreeSelectionContext = createContext<TreeSelectionContextValue | null>(null)

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
