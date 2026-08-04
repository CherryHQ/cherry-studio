import { ipcApi, useIpcOn } from '@renderer/ipc'
import { useEffect, useRef, useState } from 'react'

/**
 * Returns the native BrowserWindow focus state. Unlike document.hasFocus(),
 * this remains true when an embedded webview owns DOM focus.
 */
export default function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())
  const receivedTransition = useRef(false)

  useEffect(() => {
    let cancelled = false

    void ipcApi
      .request('window.is_focused')
      .then((focused) => {
        if (!cancelled && !receivedTransition.current) {
          setIsFocused(focused)
        }
      })
      // The document seed remains a safe fallback if the window is already closing.
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useIpcOn('window.focus_changed', (focused) => {
    receivedTransition.current = true
    setIsFocused(focused)
  })

  return isFocused
}
