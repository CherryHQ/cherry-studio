import { memo, useCallback } from 'react'

import { useTreeActions, useTreeSelection } from './contexts'
import type { DragPosition, RenderRowFn } from './types'

interface TreeRowProps<T> {
  id: string
  node: T
  depth: number
  hasChildren: boolean
  isDragging: boolean
  isDragOver: boolean
  dragPosition: DragPosition | null
  renderRow: RenderRowFn<T>
}

function TreeRowInner<T>(props: TreeRowProps<T>) {
  const { id, node, depth, hasChildren, isDragging, isDragOver, dragPosition, renderRow } = props
  const { toggleExpanded, selectNode, getDragHandleProps } = useTreeActions()
  const { expandedIds, selectedId } = useTreeSelection()

  const isExpanded = expandedIds.has(id)
  const isSelected = selectedId === id

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
        dragPosition,
        toggleExpanded: toggle,
        selectNode: select,
        dragHandleProps: getDragHandleProps(id)
      })}
    </>
  )
}

export const TreeRow = memo(TreeRowInner) as <T>(props: TreeRowProps<T>) => React.ReactElement
