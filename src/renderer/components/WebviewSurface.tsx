import type { ReactNode } from 'react'
import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchor: HTMLElement | null
  guest: ReactNode
  overlay?: ReactNode
}

/**
 * Mount body-level guest and overlay planes beside the page's Activity boundary.
 * The anchor supplies presentation only; removing it preserves both planes.
 */
export function WebviewSurface({ anchor, guest, overlay }: Props) {
  const guestPlaneRef = useRef<HTMLDivElement>(null)
  const overlayPlaneRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const guestPlane = guestPlaneRef.current
    const overlayPlane = overlayPlaneRef.current
    if (!guestPlane || !overlayPlane) return
    const planes = [guestPlane, overlayPlane]
    for (const plane of planes) {
      plane.style.opacity = '0'
      plane.style.pointerEvents = 'none'
      plane.inert = true
    }
    if (!anchor) return

    let frame: number | undefined
    const update = () => {
      frame = undefined
      observeAncestors()
      const rect = anchor.getBoundingClientRect()
      const visible = anchor.isConnected && rect.width > 0 && rect.height > 0
      const resizing = ancestors.some((node) => node.dataset.resizing === 'true')
      for (const plane of planes) {
        plane.style.opacity = visible ? '1' : '0'
        plane.inert = !visible || resizing
      }
      guestPlane.style.pointerEvents = visible && !resizing ? 'auto' : 'none'
      if (!visible) return
      const geometry = {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      }
      for (const plane of planes) Object.assign(plane.style, geometry)
    }
    const schedule = () => {
      frame ??= requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const mutation = new MutationObserver((records) => {
      // Yield input before the next event; waiting for rAF can lose mouseup inside the guest.
      if (records.some((record) => record.attributeName === 'data-resizing')) {
        if (frame !== undefined) cancelAnimationFrame(frame)
        update()
      } else schedule()
    })
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
        mutation.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'data-resizing'] })
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
      for (const plane of planes) {
        plane.style.opacity = '0'
        plane.style.pointerEvents = 'none'
        plane.inert = true
      }
    }
  }, [anchor])

  return createPortal(
    <>
      {/* Keep the guest above the z-40 pane while overlays remain above it at z-50. */}
      <div
        ref={guestPlaneRef}
        className="fixed z-[45] overflow-hidden"
        style={{ left: 0, top: 0, width: 960, height: 720, opacity: 0, pointerEvents: 'none' }}>
        {guest}
      </div>
      <div
        ref={overlayPlaneRef}
        className="pointer-events-none fixed z-50 overflow-hidden"
        style={{ left: 0, top: 0, width: 960, height: 720, opacity: 0, pointerEvents: 'none' }}>
        {overlay}
      </div>
    </>,
    document.body
  )
}
