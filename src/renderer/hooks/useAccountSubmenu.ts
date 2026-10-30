import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

export function useAccountSubmenu() {
  const [open, setOpen] = useState(false)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepCurrentFocusRef = useRef(false)

  const cancelHoverClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  useEffect(() => cancelHoverClose, [])

  const onOpenChange = (nextOpen: boolean) => {
    cancelHoverClose()
    setOpen(nextOpen)
  }

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelHoverClose()
    if (!open) {
      keepCurrentFocusRef.current = true
      onOpenChange(true)
    }
  }

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelHoverClose()
    closeTimerRef.current = setTimeout(() => {
      keepCurrentFocusRef.current = true
      setOpen(false)
    }, 200)
  }

  const openFromTrigger = () => {
    keepCurrentFocusRef.current = false
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
      onEscapeKeyDown: () => {
        keepCurrentFocusRef.current = false
      },
      onOpenAutoFocus: (event: Event) => {
        event.preventDefault()
        if (!keepCurrentFocusRef.current) initialFocusRef.current?.focus()
      },
      onCloseAutoFocus: (event: Event) => {
        if (keepCurrentFocusRef.current) event.preventDefault()
      }
    }
  }
}
