import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

export function useAccountSubmenu() {
  const [open, setOpen] = useState(false)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedByHoverRef = useRef(false)
  const closedByHoverRef = useRef(false)

  const cancelHoverClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  useEffect(() => cancelHoverClose, [])

  const onOpenChange = (nextOpen: boolean) => {
    cancelHoverClose()
    closedByHoverRef.current = false
    setOpen(nextOpen)
  }

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelHoverClose()
    if (!open) {
      openedByHoverRef.current = true
      onOpenChange(true)
    }
  }

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelHoverClose()
    closeTimerRef.current = setTimeout(() => {
      closedByHoverRef.current = true
      setOpen(false)
    }, 200)
  }

  const openFromTrigger = () => {
    openedByHoverRef.current = false
    onOpenChange(true)
    initialFocusRef.current?.focus()
  }

  return {
    open,
    onOpenChange,
    initialFocusRef,
    triggerProps: {
      onPointerEnter,
      onPointerLeave,
      onClick: (event: MouseEvent) => {
        event.preventDefault()
        openFromTrigger()
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowRight') return
        event.preventDefault()
        openFromTrigger()
      }
    },
    contentProps: {
      onPointerEnter,
      onPointerLeave,
      onOpenAutoFocus: (event: Event) => {
        event.preventDefault()
        if (!openedByHoverRef.current) initialFocusRef.current?.focus()
      },
      onCloseAutoFocus: (event: Event) => {
        if (openedByHoverRef.current || closedByHoverRef.current) event.preventDefault()
      }
    }
  }
}
