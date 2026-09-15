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
      observeAncestors()
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
    let ancestors: HTMLElement[] = []
    const observeAncestors = () => {
      const next: HTMLElement[] = []
      for (let node: HTMLElement | null = anchor; node; node = node.parentElement) next.push(node)
      if (next.length === ancestors.length && next.every((node, index) => node === ancestors[index])) return
      ancestors = next
      resize.disconnect()
      mutation.disconnect()
      for (const node of ancestors) {
        resize.observe(node)
        mutation.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
      }
    }
    const topology = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            ancestors.some((node) => node === record.target) ||
            [...record.addedNodes, ...record.removedNodes].some((node) => node.contains(anchor))
        )
      )
        schedule()
    })
    topology.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    update()
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      topology.disconnect()
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
