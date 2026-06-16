import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useEffect, useState } from 'react'

/**
 * Unified entry point for any managed window to consume its init data.
 *
 * Two delivery paths, handled transparently for the caller:
 *
 * - **Cold start** — when a window first mounts (singleton first open, pooled
 *   fresh, default creation, or any `create()` path), the main process has
 *   synchronously written the init data into its store BEFORE the window was
 *   returned. The hook calls `window.get_init_data` once on mount to pull
 *   that stored value.
 *
 * - **Reuse** — when the same window is re-used (pool recycle or singleton
 *   re-open) and the caller provides new init data, the main process pushes
 *   it as the payload of the `window.reused` IpcApi event. The hook updates
 *   state in-place, so the DOM stays continuous through the transition (no
 *   empty-DOM frame, no flash of bare window chrome).
 *
 * Main only fires `window.reused` for reuse paths AND only when init data is
 * provided — there is no "empty reused" event, so the hook never has to fall
 * back to a second request.
 *
 * Usage:
 *
 *   const action = useWindowInitData<SelectionActionItem>()
 *   if (!action) return null
 *   return <Content action={action} />
 *
 * DO NOT `key={…}` the consumer of this hook on state changes — the whole
 * point is to avoid unmounting the subtree across re-use. Use
 * `useEffect([data.stableId], …)` for per-session resets instead.
 */
export function useWindowInitData<T>(): T | null {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    let cancelled = false

    void ipcApi.request('window.get_init_data').then((initial) => {
      if (!cancelled && initial !== null && initial !== undefined) {
        setData(initial as T)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useIpcOn('window.reused', (payload) => {
    if (payload !== undefined && payload !== null) {
      setData(payload as T)
    }
  })

  return data
}
