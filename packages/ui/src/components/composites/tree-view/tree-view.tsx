import { cn } from '@cherrystudio/ui/lib/utils'
import { useCallback, useMemo } from 'react'

import {
  TreeActionsContext,
  type TreeActionsContextValue,
  TreeSelectionContext,
  type TreeSelectionContextValue
} from './contexts'
import { flattenTree } from './flatten-tree'
import { TreeRow } from './tree-row'
import type { FlatTreeItem, TreeViewProps } from './types'
import { useExpandedState } from './use-expanded-state'
import { useSelectionState } from './use-selection-state'
import { useTreeDragAndDrop } from './use-tree-drag-and-drop'

/**
 * Data-agnostic tree renderer.
 *
 * Caller supplies:
 * - `data`: root-level nodes.
 * - `adapter`: how to read id / children / canHaveChildren / isSticky from a node.
 * - `renderRow`: a render-prop that receives the node and its row state.
 *
 * Interactions are all opt-in:
 * - Selection enables when `selectedId` or `onSelectedChange` is provided.
 * - DnD enables only when `onMove` is provided. Without it, rows are not draggable.
 *
 * This is a headless renderer: callers own row markup, tree roles, roving
 * focus, keyboard navigation, and rejecting descendant drops in `onMove`.
 *
 * Virtualization is delegated to an optional `renderList` slot — TreeView produces
 * the flat list + sticky metadata but never imports a virtualizer itself.
 */
export function TreeView<T>(props: TreeViewProps<T>) {
  const {
    data,
    adapter,
    expandedIds: controlledExpanded,
    defaultExpandedIds,
    onExpandedChange,
    selectedId: controlledSelected,
    defaultSelectedId,
    onSelectedChange,
    renderRow,
    onMove,
    renderList,
    className,
    emptyState
  } = props

  const expanded = useExpandedState({
    expandedIds: controlledExpanded,
    defaultExpandedIds,
    onExpandedChange
  })

  const selection = useSelectionState({
    selectedId: controlledSelected,
    defaultSelectedId,
    onSelectedChange
  })

  const flat = useMemo<FlatTreeItem<T>[]>(
    () => flattenTree(data, adapter, expanded.expandedIds),
    [data, adapter, expanded.expandedIds]
  )

  const flatById = useMemo(() => {
    const map = new Map<string, FlatTreeItem<T>>()
    for (const item of flat) map.set(item.id, item)
    return map
  }, [flat])

  const canHaveChildrenById = useCallback(
    (id: string): boolean => {
      const found = flatById.get(id)
      if (!found) return false
      const fn = adapter.canHaveChildren
      return fn ? fn(found.node) : true
    },
    [adapter, flatById]
  )

  const drag = useTreeDragAndDrop({
    onMove,
    canHaveChildren: canHaveChildrenById
  })

  const actionsValue = useMemo<TreeActionsContextValue>(
    () => ({
      toggleExpanded: expanded.toggle,
      selectNode: selection.select,
      getDragHandleProps: drag.getDragHandleProps
    }),
    [expanded.toggle, selection.select, drag.getDragHandleProps]
  )

  const selectionValue = useMemo<TreeSelectionContextValue>(
    () => ({
      expandedIds: expanded.expandedIds,
      selectedId: selection.selectedId
    }),
    [expanded.expandedIds, selection.selectedId]
  )

  const renderItem = useCallback(
    (index: number) => {
      const item = flat[index]
      if (!item) return null
      const children = adapter.getChildren(item.node)
      const hasChildren = !!(children && children.length > 0)
      return (
        <TreeRow
          key={item.id}
          id={item.id}
          node={item.node}
          depth={item.depth}
          hasChildren={hasChildren}
          isDragging={drag.draggedId === item.id}
          isDragOver={drag.dragOverId === item.id}
          dragPosition={drag.dragOverId === item.id ? drag.dragPosition : null}
          renderRow={renderRow}
        />
      )
    },
    [flat, adapter, renderRow, drag.draggedId, drag.dragOverId, drag.dragPosition]
  )

  const isSticky = useCallback(
    (index: number): boolean => {
      const item = flat[index]
      if (!item) return false
      return adapter.isSticky ? adapter.isSticky(item.node) : false
    },
    [adapter, flat]
  )

  const getItemDepth = useCallback((index: number): number => flat[index]?.depth ?? 0, [flat])

  if (flat.length === 0 && emptyState !== undefined) {
    return <div className={cn('flex h-full w-full items-center justify-center', className)}>{emptyState}</div>
  }

  const body = renderList ? (
    renderList({ flat, isSticky, getItemDepth, renderItem })
  ) : (
    <div className={cn('flex flex-col', className)}>{flat.map((_item, index) => renderItem(index))}</div>
  )

  return (
    <TreeActionsContext value={actionsValue}>
      <TreeSelectionContext value={selectionValue}>{body}</TreeSelectionContext>
    </TreeActionsContext>
  )
}
