import { ipcApi, useIpcOn } from '@renderer/ipc'
import { useEffect, useRef, useState } from 'react'

/**
 * True window key state, relayed from the main process — unlike DOM
 * focus/blur, unaffected by a <webview> stealing page focus.
 */
function useWindowFocus() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())
  const receivedFocusEvent = useRef(false)

  useIpcOn('window.focus_changed', (focused) => {
    receivedFocusEvent.current = true
    setIsFocused(Boolean(focused))
  })

  // Seed authoritative state on mount: focus_changed only covers transitions
  // after subscription, so a focus that landed before this hook mounted (or the
  // unreliable document.hasFocus seed) would otherwise stick until the next
  // toggle. Never let a late query overwrite a newer pushed event.
  useEffect(() => {
    let cancelled = false
    void ipcApi
      .request('window.is_focused')
      .then((focused) => {
        if (!cancelled && !receivedFocusEvent.current) setIsFocused(focused)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  return isFocused
}

export default useWindowFocus
