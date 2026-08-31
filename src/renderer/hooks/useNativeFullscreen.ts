import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'
import { useEffect, useState } from 'react'

/**
 * Native fullscreen state for the full-chrome windows (main + detached sub-window).
 * macOS hides the traffic lights in fullscreen, so consumers drop their traffic-light
 * reserve while `true`. Queries the initial state on mount and subscribes to
 * `window.fullscreen_changed`; no-op on non-macOS platforms.
 *
 * @returns Whether the current window is in native fullscreen.
 */
export function useNativeFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!isMac) return

    let cancelled = false
    void ipcApi
      .request('window.is_full_screen')
      .then((value) => {
        if (!cancelled) {
          setIsFullscreen(value)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useIpcOn('window.fullscreen_changed', (value) => {
    if (isMac) {
      setIsFullscreen(value)
    }
  })

  return isFullscreen
}
