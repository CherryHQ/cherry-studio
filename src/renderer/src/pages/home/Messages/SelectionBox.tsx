import { useEffect, useState } from 'react'
import styled from 'styled-components'

interface SelectionBoxProps {
  isMultiSelectMode: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  messageElements: Map<string, HTMLElement>
  handleSelectMessage: (messageId: string, selected: boolean) => void
}

const SelectionBox: React.FC<SelectionBoxProps> = ({
  isMultiSelectMode,
  scrollContainerRef,
  messageElements,
  handleSelectMessage
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragCurrent, setDragCurrent] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!isMultiSelectMode) return

    const updateDragPos = (e: MouseEvent) => {
      const container = scrollContainerRef.current!
      if (!container) return { x: 0, y: 0 }
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left + container.scrollLeft
      const y = e.clientY - rect.top + container.scrollTop
      return { x, y }
    }

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.ant-checkbox-wrapper')) return
      if ((e.target as HTMLElement).closest('.MessageFooter')) return
      setIsDragging(true)
      const pos = updateDragPos(e)
      setDragStart(pos)
      setDragCurrent(pos)
      document.body.classList.add('no-select')
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      setDragCurrent(updateDragPos(e))
      const container = scrollContainerRef.current!
      if (container) {
        const { top, bottom } = container.getBoundingClientRect()
        const scrollSpeed = 15
        if (e.clientY < top + 50) {
          container.scrollBy(0, -scrollSpeed)
        } else if (e.clientY > bottom - 50) {
          container.scrollBy(0, scrollSpeed)
        }
      }
    }

    const handleMouseUp = () => {
      if (!isDragging) return

      const left = Math.min(dragStart.x, dragCurrent.x)
      const right = Math.max(dragStart.x, dragCurrent.x)
      const top = Math.min(dragStart.y, dragCurrent.y)
      const bottom = Math.max(dragStart.y, dragCurrent.y)

      const MIN_SELECTION_SIZE = 5
      const isValidSelection =
        Math.abs(right - left) > MIN_SELECTION_SIZE && Math.abs(bottom - top) > MIN_SELECTION_SIZE

      if (isValidSelection) {
        messageElements.forEach((element, messageId) => {
          try {
            const rect = element.getBoundingClientRect()
            const container = scrollContainerRef.current!

            const elementTop = rect.top - container.getBoundingClientRect().top + container.scrollTop
            const elementLeft = rect.left - container.getBoundingClientRect().left + container.scrollLeft
            const elementBottom = elementTop + rect.height
            const elementRight = elementLeft + rect.width

            const isIntersecting = !(
              elementRight < left ||
              elementLeft > right ||
              elementBottom < top ||
              elementTop > bottom
            )

            if (isIntersecting) {
              handleSelectMessage(messageId, true)
              element.classList.add('selection-highlight')
              setTimeout(() => element.classList.remove('selection-highlight'), 300)
            }
          } catch (error) {
            console.error('Error calculating element intersection:', error)
          }
        })
      }
      setIsDragging(false)
      document.body.classList.remove('no-select')
    }

    const container = scrollContainerRef.current!
    if (container) {
      container.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      if (container) {
        container.removeEventListener('mousedown', handleMouseDown)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.classList.remove('no-select')
      }
    }
  }, [isMultiSelectMode, isDragging, dragStart, dragCurrent, handleSelectMessage, scrollContainerRef, messageElements])

  if (!isDragging || !isMultiSelectMode) return null

  return (
    <SelectionBoxContainer
      style={{
        left: Math.min(dragStart.x, dragCurrent.x),
        top: Math.min(dragStart.y, dragCurrent.y),
        width: Math.abs(dragCurrent.x - dragStart.x),
        height: Math.abs(dragCurrent.y - dragStart.y)
      }}
    />
  )
}

const SelectionBoxContainer = styled.div`
  position: absolute;
  border: 1px dashed var(--color-primary);
  background-color: rgba(0, 114, 245, 0.1);
  pointer-events: none;
  z-index: 100;
`

export default SelectionBox
