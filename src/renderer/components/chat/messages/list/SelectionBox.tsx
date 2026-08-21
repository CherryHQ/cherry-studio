import { useEffect, useRef, useState } from 'react'

interface SelectionBoxProps {
  isMultiSelectMode: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  messageElements: Map<string, HTMLElement>
  handleSelectMessage: (messageId: string, selected: boolean) => void
}

interface Position {
  x: number
  y: number
}

interface DragBox {
  start: Position
  current: Position
}

const INTERACTIVE_CHECKBOX_SELECTOR = 'input[type="checkbox"], [data-slot=checkbox], [role="checkbox"]'
const MESSAGE_SELECT_CHECKBOX_SELECTOR = '[data-message-select-checkbox]'
const DRAG_THRESHOLD = 5

function getMessageCheckbox(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(MESSAGE_SELECT_CHECKBOX_SELECTOR)
}

function isCheckboxSelected(checkbox: HTMLElement): boolean {
  if (checkbox instanceof HTMLInputElement) {
    return checkbox.checked
  }

  return checkbox.getAttribute('aria-checked') === 'true' || checkbox.getAttribute('data-state') === 'checked'
}

const SelectionBox: React.FC<SelectionBoxProps> = ({
  isMultiSelectMode,
  scrollContainerRef,
  messageElements,
  handleSelectMessage
}) => {
  const [dragBox, setDragBox] = useState<DragBox | null>(null)
  const isMouseDown = useRef(false)
  const isDragging = useRef(false)
  const dragStart = useRef<Position | null>(null)
  const pendingPointer = useRef<Position | null>(null)
  const animationFrame = useRef<number | null>(null)
  const dragSelectedIds = useRef<Set<string>>(new Set())
  const highlightTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    if (!isMultiSelectMode) {
      setDragBox(null)
    }
  }, [isMultiSelectMode])

  useEffect(() => {
    if (!isMultiSelectMode) return
    const timers = highlightTimers.current

    const updateDragPos = (pointer: Position, container: HTMLDivElement, containerRect: DOMRect): Position => {
      return {
        x: pointer.x - containerRect.left + container.scrollLeft,
        y: pointer.y - containerRect.top + container.scrollTop
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(INTERACTIVE_CHECKBOX_SELECTOR)) return
      if ((e.target as HTMLElement).closest('.MessageFooter')) return

      e.preventDefault()

      const container = scrollContainerRef.current
      if (!container) return

      isMouseDown.current = true
      dragStart.current = updateDragPos({ x: e.clientX, y: e.clientY }, container, container.getBoundingClientRect())
      pendingPointer.current = null
      dragSelectedIds.current.clear()
    }

    const processMouseMove = () => {
      animationFrame.current = null

      const pointer = pendingPointer.current
      const start = dragStart.current
      const container = scrollContainerRef.current
      pendingPointer.current = null
      if (!pointer || !start || !container || !isMouseDown.current) return

      const containerRect = container.getBoundingClientRect()
      const pos = updateDragPos(pointer, container, containerRect)

      const deltaX = Math.abs(pos.x - start.x)
      const deltaY = Math.abs(pos.y - start.y)
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

      if (!isDragging.current && distance > DRAG_THRESHOLD) {
        isDragging.current = true
        document.body.classList.add('no-select')
      }

      if (!isDragging.current) return

      setDragBox({ start, current: pos })

      const left = Math.min(start.x, pos.x)
      const right = Math.max(start.x, pos.x)
      const top = Math.min(start.y, pos.y)
      const bottom = Math.max(start.y, pos.y)

      messageElements.forEach((el, id) => {
        const checkbox = getMessageCheckbox(el)
        const isAlreadySelected = checkbox ? isCheckboxSelected(checkbox) : false

        if (!checkbox) return

        const rect = el.getBoundingClientRect()
        const eTop = rect.top - containerRect.top + container.scrollTop
        const eLeft = rect.left - containerRect.left + container.scrollLeft
        const eBottom = eTop + rect.height
        const eRight = eLeft + rect.width

        const isInSelectionBox = !(eRight < left || eLeft > right || eBottom < top || eTop > bottom)

        if (!isInSelectionBox) {
          if (dragSelectedIds.current.delete(id)) {
            handleSelectMessage(id, false)
          }
          return
        }

        if (!dragSelectedIds.current.has(id) && !isAlreadySelected) {
          handleSelectMessage(id, true)
          dragSelectedIds.current.add(id)
          el.classList.add('selection-highlight')
          const timer = setTimeout(() => {
            el.classList.remove('selection-highlight')
            timers.delete(timer)
          }, 300)
          timers.add(timer)
        }
      })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDown.current) return

      if (isDragging.current) {
        e.preventDefault()
      }

      pendingPointer.current = { x: e.clientX, y: e.clientY }
      if (animationFrame.current === null) {
        animationFrame.current = requestAnimationFrame(processMouseMove)
      }
    }

    const handleMouseUp = () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current)
        processMouseMove()
      }

      isMouseDown.current = false
      dragStart.current = null
      pendingPointer.current = null
      if (isDragging.current) {
        isDragging.current = false
        setDragBox(null)
        document.body.classList.remove('no-select')
      }
    }

    const container = scrollContainerRef.current
    container?.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container?.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove('no-select')
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current)
      }
      timers.forEach(clearTimeout)
      timers.clear()
      animationFrame.current = null
      pendingPointer.current = null
      dragStart.current = null
      isMouseDown.current = false
      isDragging.current = false
    }
  }, [isMultiSelectMode, scrollContainerRef, messageElements, handleSelectMessage])

  if (!dragBox || !isMultiSelectMode) return null

  return (
    <div
      className="pointer-events-none absolute z-100 border border-primary border-dashed bg-[rgba(0,114,245,0.1)]"
      style={{
        left: Math.min(dragBox.start.x, dragBox.current.x),
        top: Math.min(dragBox.start.y, dragBox.current.y),
        width: Math.abs(dragBox.current.x - dragBox.start.x),
        height: Math.abs(dragBox.current.y - dragBox.start.y)
      }}
    />
  )
}

export default SelectionBox
