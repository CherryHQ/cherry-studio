import { useLocation } from '@tanstack/react-router'
import { type RefObject, useEffect } from 'react'

import { setPendingFocus, useSettingsSearchKeyboard } from './store'

// Retry cadence for the target row to mount after navigation (80ms→200ms backoff,
// 1.76s total budget), then give up silently — conditional rows may legitimately
// never render and we never flip upstream settings to reveal them.
const RETRY_DELAYS = [80, 80, 200, 200, 200, 200, 200, 200, 200, 200]
const HIGHLIGHT_MS = 1600
const HIGHLIGHT_CLASS = 'search-hit-highlight'

interface SettingsFocusScrollProps {
  /**
   * Query scope: the settings content column of the active tab. <Activity>
   * keeps hidden tabs' DOM alive, so a document-level lookup could hit a
   * hidden tab's row first and steal the scroll/highlight.
   */
  scopeRef: RefObject<HTMLDivElement | null>
}

/**
 * Mounted next to the settings Outlet: consumes the store's pendingFocusId
 * after a search-result jump, scrolls the target row into view and flashes it.
 */
const SettingsFocusScroll = ({ scopeRef }: SettingsFocusScrollProps) => {
  const { pendingFocusId } = useSettingsSearchKeyboard()
  const location = useLocation()

  useEffect(() => {
    if (!pendingFocusId) return

    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const attempt = (retryIndex: number) => {
      const el = scopeRef.current?.querySelector<HTMLElement>(`#${CSS.escape(pendingFocusId)}`)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.classList.add(HIGHLIGHT_CLASS)
        // Not cleared below: consuming the focus id re-runs this effect at once
        // and would kill the fresh timer; the settings DOM dies with this mount.
        setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS)
        setPendingFocus(undefined)
        return
      }
      const delay = RETRY_DELAYS[retryIndex]
      if (delay === undefined) {
        setPendingFocus(undefined)
        return
      }
      retryTimer = setTimeout(() => attempt(retryIndex + 1), delay)
    }
    attempt(0)

    return () => clearTimeout(retryTimer)
  }, [pendingFocusId, location.pathname, scopeRef])

  return null
}

export default SettingsFocusScroll
