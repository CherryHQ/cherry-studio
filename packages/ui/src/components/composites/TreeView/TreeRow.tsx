import { memo, useCallback } from 'react'

import { useTreeActions, useTreeDrag, useTreeSelection } from './contexts'
import type { RenderRowFn } from './types'

interface TreeRowProps<T> {
  id: string
  node: T
  depth: number
  hasChildren: boolean
  renderRow: RenderRowFn<T>
}

function TreeRowInner<T>(props: TreeRowProps<T>) {
  const { id, node, depth, hasChildren, renderRow } = props
  const { toggleExpanded, selectNode, getDragHandleProps } = useTreeActions()
  const { expandedIds, selectedId } = useTreeSelection()
  const { draggedId, dragOverId, dragPosition } = useTreeDrag()

  const isExpanded = expandedIds.has(id)
  const isSelected = selectedId === id
  const isDragging = draggedId === id
  const isDragOver = dragOverId === id
  const effectiveDragPosition = isDragOver ? dragPosition : null

  const toggle = useCallback(() => {
    if (hasChildren) toggleExpanded(id)
  }, [hasChildren, id, toggleExpanded])

  const select = useCallback(() => {
    selectNode(id)
  }, [id, selectNode])

  return (
    <>
      {renderRow({
        node,
        depth,
        isExpanded,
        isSelected,
        isDragging,
        isDragOver,
        dragPosition: effectiveDragPosition,
        toggleExpanded: toggle,
        selectNode: select,
        dragHandleProps: getDragHandleProps(id)
      })}
    </>
  )
}

export const TreeRow = memo(TreeRowInner) as <T>(props: TreeRowProps<T>) => React.ReactElement
