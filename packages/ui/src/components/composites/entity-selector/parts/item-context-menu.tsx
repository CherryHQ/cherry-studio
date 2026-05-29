import { cn } from '@cherrystudio/ui/lib/utils'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  children: ReactNode
  position: { x: number; y: number }
  onClose: () => void
  className?: string
  /** Distance (px) the menu keeps from viewport edges when clamping. Default: 8. */
  viewportMargin?: number
}

const DEFAULT_VIEWPORT_MARGIN = 8

/**
 * Portal container for a row's context menu.
 *
 * Owns positioning, viewport clamping, outside-click / Escape / scroll dismissal.
 * The visual content is fully consumer-supplied via `children`.
 */
export function ItemContextMenu({
  children,
  position,
  onClose,
  className,
  viewportMargin = DEFAULT_VIEWPORT_MARGIN
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState(position)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let { x, y } = position
    if (x + rect.width + viewportMargin > window.innerWidth) {
      x = Math.max(viewportMargin, window.innerWidth - rect.width - viewportMargin)
    }
    if (y + rect.height + viewportMargin > window.innerHeight) {
      y = Math.max(viewportMargin, window.innerHeight - rect.height - viewportMargin)
    }
    if (x !== position.x || y !== position.y) setAdjusted({ x, y })
  }, [position, viewportMargin])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Marker so the owning Popover can recognize clicks inside this portal and skip its
      // outside-click dismissal — otherwise right-click menu interactions close the parent popover.
      data-entity-context-menu-root=""
      style={{ position: 'fixed', left: adjusted.x, top: adjusted.y }}
      className={cn('z-50 outline-none', className)}>
      {children}
    </div>,
    document.body
  )
}

export function useItemContextMenu() {
  const [position, setPosition] = useState<{ x: number; y: number; itemId: string } | null>(null)
  const open = useCallback((e: ReactMouseEvent, itemId: string) => {
    e.preventDefault()
    setPosition({ x: e.clientX, y: e.clientY, itemId })
  }, [])
  const close = useCallback(() => setPosition(null), [])
  return { position, open, close }
}
