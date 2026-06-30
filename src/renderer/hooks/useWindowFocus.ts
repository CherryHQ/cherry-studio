import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useEffect, useState } from 'react'

/**
 * True window key state, relayed from the main process — unlike DOM
 * focus/blur, unaffected by a <webview> stealing page focus.
 */
function useWindowFocus() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())

  // Seed authoritative state on mount: focus_changed only covers transitions
  // after subscription, so a focus that landed before this hook mounted (or the
  // unreliable document.hasFocus seed) would otherwise stick until the next
  // toggle — mirrors useFullscreen's is_full_screen fetch.
  useEffect(() => {
    void ipcApi.request('window.is_focused').then(setIsFocused)
  }, [])

  // Boolean coerce — consumers fan out into `cn(isFocused && '...')` and
  // `... ? 'a' : 'b'` patterns where a stray non-boolean would silently flip
  // the branch. The IPC schema types this as `boolean`, but the runtime
  // payload is preload-trusted; one extra coerce keeps the contract.
  useIpcOn('window.focus_changed', (focused) => setIsFocused(Boolean(focused)))

  return isFocused
}

export default useWindowFocus
