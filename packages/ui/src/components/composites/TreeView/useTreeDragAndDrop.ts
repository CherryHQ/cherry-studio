import type React from 'react'
import { useCallback, useRef, useState } from 'react'

import type { DragPosition, TreeDragHandleProps } from './types'

export interface UseTreeDragAndDropOptions {
  /** Move callback. When undefined, all returned listeners are no-ops and draggable is false. */
  onMove?: (sourceId: string, targetId: string, position: DragPosition) => void
  /** Whether the target node accepts 'inside' drops. Default: true for everything. */
  canHaveChildren?: (nodeId: string) => boolean
}

export interface UseTreeDragAndDropReturn {
  draggedId: string | null
  dragOverId: string | null
  dragPosition: DragPosition | null
  /** Returns the listener bundle bound for a specific row. Listeners are no-ops when DnD is disabled. */
  getDragHandleProps: (nodeId: string) => TreeDragHandleProps
}

const NOOP = () => {}
const DISABLED_HANDLE: TreeDragHandleProps = {
  draggable: false,
  onDragStart: NOOP,
  onDragOver: NOOP,
  onDragLeave: NOOP,
  onDrop: NOOP,
  onDragEnd: NOOP
}

export function useTreeDragAndDrop(options: UseTreeDragAndDropOptions): UseTreeDragAndDropReturn {
  const { onMove, canHaveChildren } = options
  const enabled = typeof onMove === 'function'
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null)
  const positionRef = useRef<DragPosition | null>(null)

  const clear = useCallback(() => {
    setDraggedId(null)
    setDragOverId(null)
    setDragPosition(null)
    positionRef.current = null
  }, [])

  const handleDragStart = useCallback(
    (nodeId: string) => (e: React.DragEvent) => {
      setDraggedId(nodeId)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', nodeId)

      const el = e.currentTarget as HTMLElement
      if (el?.parentElement) {
        const rect = el.getBoundingClientRect()
        const ghost = el.cloneNode(true) as HTMLElement
        ghost.style.width = `${rect.width}px`
        ghost.style.opacity = '0.7'
        ghost.style.position = 'absolute'
        ghost.style.top = '-1000px'
        document.body.appendChild(ghost)
        e.dataTransfer.setDragImage(ghost, 10, 10)
        setTimeout(() => {
          if (ghost.parentNode) document.body.removeChild(ghost)
        }, 0)
      }
    },
    []
  )

  const handleDragOver = useCallback(
    (nodeId: string) => (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      if (draggedId === nodeId) return

      setDragOverId(nodeId)

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mouseY = e.clientY
      const thresholdTop = rect.top + rect.height * 0.3
      const thresholdBottom = rect.bottom - rect.height * 0.3

      const allowInside = canHaveChildren ? canHaveChildren(nodeId) : true

      let next: DragPosition
      if (mouseY < thresholdTop) next = 'before'
      else if (mouseY > thresholdBottom) next = 'after'
      else next = allowInside ? 'inside' : 'after'

      positionRef.current = next
      setDragPosition(next)
    },
    [canHaveChildren, draggedId]
  )

  const handleDragLeave = useCallback(() => {
    setDragOverId(null)
    setDragPosition(null)
    positionRef.current = null
  }, [])

  const handleDrop = useCallback(
    (nodeId: string) => (e: React.DragEvent) => {
      e.preventDefault()
      const sourceId = e.dataTransfer.getData('text/plain')
      const finalPosition = positionRef.current ?? 'inside'
      if (sourceId && sourceId !== nodeId && onMove) {
        onMove(sourceId, nodeId, finalPosition)
      }
      clear()
    },
    [onMove, clear]
  )

  const handleDragEnd = useCallback(() => {
    clear()
  }, [clear])

  const getDragHandleProps = useCallback(
    (nodeId: string): TreeDragHandleProps => {
      if (!enabled) return DISABLED_HANDLE
      return {
        draggable: true,
        onDragStart: handleDragStart(nodeId),
        onDragOver: handleDragOver(nodeId),
        onDragLeave: handleDragLeave,
        onDrop: handleDrop(nodeId),
        onDragEnd: handleDragEnd
      }
    },
    [enabled, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd]
  )

  return {
    draggedId: enabled ? draggedId : null,
    dragOverId: enabled ? dragOverId : null,
    dragPosition: enabled ? dragPosition : null,
    getDragHandleProps
  }
}
