import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { DragPosition, TreeDragHandleProps } from './types'

export interface UseTreeDragAndDropOptions {
  /**
   * Move callback. When undefined, all returned listeners are no-ops and draggable is false.
   *
   * The hook guards self-drops and external drops. Callers still own structural
   * validation before mutating tree data, including rejecting moves where
   * `targetId` is a descendant of `sourceId`; accepting those moves can create
   * cycles or orphan nodes in the caller's tree.
   */
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
  const draggedIdRef = useRef<string | null>(null)

  const clear = useCallback(() => {
    draggedIdRef.current = null
    setDraggedId(null)
    setDragOverId(null)
    setDragPosition(null)
    positionRef.current = null
  }, [])

  const handleDragStart = useCallback(
    (nodeId: string) => (e: React.DragEvent) => {
      draggedIdRef.current = nodeId
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

      if (draggedIdRef.current === nodeId) return

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
    [canHaveChildren]
  )

  const handleDragLeave = useCallback(() => {
    setDragOverId(null)
    setDragPosition(null)
    positionRef.current = null
  }, [])

  const handleDrop = useCallback(
    (nodeId: string) => (e: React.DragEvent) => {
      e.preventDefault()
      const sourceId = draggedIdRef.current
      const fallbackPosition: DragPosition = canHaveChildren?.(nodeId) === false ? 'after' : 'inside'
      const finalPosition = positionRef.current ?? fallbackPosition
      if (sourceId && sourceId !== nodeId && onMove) {
        onMove(sourceId, nodeId, finalPosition)
      }
      clear()
    },
    [canHaveChildren, onMove, clear]
  )

  const handleDragEnd = useCallback(() => {
    clear()
  }, [clear])

  const getDragHandleProps = useMemo(() => {
    const handleCache = new Map<string, TreeDragHandleProps>()

    return (nodeId: string): TreeDragHandleProps => {
      if (!enabled) return DISABLED_HANDLE

      const cached = handleCache.get(nodeId)
      if (cached) return cached

      const handleProps = {
        draggable: true,
        onDragStart: handleDragStart(nodeId),
        onDragOver: handleDragOver(nodeId),
        onDragLeave: handleDragLeave,
        onDrop: handleDrop(nodeId),
        onDragEnd: handleDragEnd
      }
      handleCache.set(nodeId, handleProps)
      return handleProps
    }
  }, [enabled, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd])

  return {
    draggedId: enabled ? draggedId : null,
    dragOverId: enabled ? dragOverId : null,
    dragPosition: enabled ? dragPosition : null,
    getDragHandleProps
  }
}
