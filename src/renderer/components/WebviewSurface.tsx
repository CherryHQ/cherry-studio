import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchor: HTMLElement | null
  children: ReactNode
}

/**
 * Mount beside the page's Activity boundary. The anchor supplies presentation
 * only; removing it preserves the guest, its effects and its last viewport.
 * Opacity hides presentation without suppressing the guest's compositor surface.
 */
export function WebviewSurface({ anchor, children }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    surface.style.opacity = '0'
    surface.style.pointerEvents = 'none'
    surface.inert = true
    if (!anchor) return

    let frame: number | undefined
    const update = () => {
      frame = undefined
      const rect = anchor.getBoundingClientRect()
      const visible = anchor.isConnected && rect.width > 0 && rect.height > 0
      surface.style.opacity = visible ? '1' : '0'
      surface.style.pointerEvents = visible ? 'auto' : 'none'
      surface.inert = !visible
      if (!visible) return
      Object.assign(surface.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      })
    }
    const schedule = () => {
      frame ??= requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const mutation = new MutationObserver(schedule)
    for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
      resize.observe(node)
      mutation.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    update()
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      surface.style.opacity = '0'
      surface.style.pointerEvents = 'none'
      surface.inert = true
    }
  }, [anchor])

  return createPortal(
    <div
      ref={surfaceRef}
      data-webview-surface=""
      className="fixed z-10 overflow-hidden"
      style={{ left: 0, top: 0, width: 960, height: 720, opacity: 0, pointerEvents: 'none' }}>
      {children}
    </div>,
    document.body
  )
}
