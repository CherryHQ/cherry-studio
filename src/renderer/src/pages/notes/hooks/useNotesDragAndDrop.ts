import type { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useRef, useState } from 'react'

interface UseNotesDragAndDropProps {
  onMoveNode: (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => void
}

export const useNotesDragAndDrop = ({ onMoveNode }: UseNotesDragAndDropProps) => {
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'before' | 'inside' | 'after'>('inside')
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, node: NotesTreeNode) => {
    setDraggedNodeId(node.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)

    dragNodeRef.current = e.currentTarget as HTMLDivElement

    // Create ghost element
    if (e.currentTarget.parentElement) {
      const rect = e.currentTarget.getBoundingClientRect()
      const ghostElement = e.currentTarget.cloneNode(true) as HTMLElement
      ghostElement.style.width = `${rect.width}px`
      ghostElement.style.opacity = '0.7'
      ghostElement.style.position = 'absolute'
      ghostElement.style.top = '-1000px'
      document.body.appendChild(ghostElement)
      e.dataTransfer.setDragImage(ghostElement, 10, 10)
      setTimeout(() => {
        document.body.removeChild(ghostElement)
      }, 0)
    }
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, node: NotesTreeNode) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      if (draggedNodeId === node.id) {
        return
      }

      setDragOverNodeId(node.id)

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mouseY = e.clientY
      const thresholdTop = rect.top + rect.height * 0.3
      const thresholdBottom = rect.bottom - rect.height * 0.3

      if (mouseY < thresholdTop) {
        setDragPosition('before')
      } else if (mouseY > thresholdBottom) {
        setDragPosition('after')
      } else {
        setDragPosition(node.type === 'folder' ? 'inside' : 'after')
      }
    },
    [draggedNodeId]
  )

  const handleDragLeave = useCallback(() => {
    setDragOverNodeId(null)
    setDragPosition('inside')
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetNode: NotesTreeNode) => {
      e.preventDefault()
      const draggedId = e.dataTransfer.getData('text/plain')

      if (draggedId && draggedId !== targetNode.id) {
        onMoveNode(draggedId, targetNode.id, dragPosition)
      }

      setDraggedNodeId(null)
      setDragOverNodeId(null)
      setDragPosition('inside')
    },
    [onMoveNode, dragPosition]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null)
    setDragOverNodeId(null)
    setDragPosition('inside')
  }, [])

  return {
    draggedNodeId,
    dragOverNodeId,
    dragPosition,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd
  }
}
