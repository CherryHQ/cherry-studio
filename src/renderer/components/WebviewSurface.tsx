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
 */
export function WebviewSurface({ anchor, children }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    surface.style.visibility = 'hidden'
    surface.inert = true
    if (!anchor) return

    let frame: number | undefined
    const update = () => {
      frame = undefined
      const rect = anchor.getBoundingClientRect()
      const visible = anchor.isConnected && rect.width > 0 && rect.height > 0
      surface.style.visibility = visible ? 'visible' : 'hidden'
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
      surface.style.visibility = 'hidden'
      surface.inert = true
    }
  }, [anchor])

  return createPortal(
    <div
      ref={surfaceRef}
      data-webview-surface=""
      className="fixed z-10 overflow-hidden"
      style={{ width: 960, height: 720, visibility: 'hidden' }}>
      {children}
    </div>,
    document.body
  )
}
