import { useEffect, useState } from 'react'

import { isLinux } from '@renderer/utils/platform'

// Chromium's Window Controls Overlay API; not in TypeScript's DOM lib yet.
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean
  getTitlebarAreaRect(): DOMRect
}

function getOverlay(): WindowControlsOverlay | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay
}

function readIsLeading(): boolean {
  const overlay = getOverlay()
  return !!overlay?.visible && overlay.getTitlebarAreaRect().x > 0
}

/**
 * Whether Linux's Electron-drawn window controls (WCO) sit at the leading edge, e.g. a GNOME
 * `button-layout` with buttons on the left. Callers then reserve that corner the way macOS
 * reserves its traffic lights. Tracks layout changes live via `geometrychange`.
 *
 * @returns `true` only on Linux while the overlay is visible with controls on the left.
 */
export function useLeadingWindowControlsOverlay(): boolean {
  const [isLeading, setIsLeading] = useState(() => isLinux && readIsLeading())

  useEffect(() => {
    const overlay = getOverlay()
    if (!isLinux || !overlay) return

    const update = () => setIsLeading(readIsLeading())
    overlay.addEventListener('geometrychange', update)
    return () => overlay.removeEventListener('geometrychange', update)
  }, [])

  return isLeading
}
