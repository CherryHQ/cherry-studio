import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

import { setPendingFocus, useSettingsSearchKeyboard } from './store'

// Retry cadence for the target row to mount after navigation (80ms→200ms backoff,
// ~1.6s total budget), then give up silently — conditional rows may legitimately
// never render and we never flip upstream settings to reveal them.
const RETRY_DELAYS = [80, 80, 200, 200, 200, 200, 200, 200, 200, 200]
const HIGHLIGHT_MS = 1600
const HIGHLIGHT_CLASS = 'search-hit-highlight'

/**
 * Mounted next to the settings Outlet: consumes the store's pendingFocusId
 * after a search-result jump, scrolls the target row into view and flashes it.
 */
const SettingsFocusScroll = () => {
  const { pendingFocusId } = useSettingsSearchKeyboard()
  const location = useLocation()

  useEffect(() => {
    if (!pendingFocusId) return

    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const attempt = (retryIndex: number) => {
      const el = document.getElementById(pendingFocusId)
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
  }, [pendingFocusId, location.pathname])

  return null
}

export default SettingsFocusScroll
