import { isMac } from '@renderer/utils/platform'
import { useEffect } from 'react'

/**
 * Keeps macOS text input preview anchored to the composer after launch and window resize.
 * Chromium's IME candidate preview caches screen coordinates; without a focus-triggered
 * recompute it drifts when the window moves. Re-sync on resize and after initial paint
 * restores the invariant that the preview stays attached to the caret.
 */
export function useMacInputPreviewSync(anchorRef: { current: HTMLElement | null }, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isMac) return

    const anchor = anchorRef.current
    if (!anchor) return

    const sync = () => {
      const el = anchorRef.current
      if (!el) return
      // Force layout recalc: reading getBoundingClientRect invalidates the cached
      // screen position Chromium uses for the IME preview.
      el.getBoundingClientRect()
      // Nudge the selection so Electron re-emits the caret rect to the IME.
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0).cloneRange()
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }

    // After launch the window geometry settles one frame later; sync then.
    const raf = requestAnimationFrame(() => sync())
    window.addEventListener('resize', sync)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', sync)
    }
  }, [anchorRef, enabled])
}
