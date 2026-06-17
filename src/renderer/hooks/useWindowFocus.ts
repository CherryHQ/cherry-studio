import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useState } from 'react'

/**
 * True window key state, relayed from the main process — unlike DOM
 * focus/blur, unaffected by a <webview> stealing page focus.
 */
function useWindowFocus() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())

  // Boolean coerce — consumers fan out into `cn(isFocused && '...')` and
  // `... ? 'a' : 'b'` patterns where a stray non-boolean would silently flip
  // the branch. The IPC schema types this as `boolean`, but the runtime
  // payload is preload-trusted; one extra coerce keeps the contract.
  useIpcOn('window.focus_changed', (focused) => setIsFocused(Boolean(focused)))

  return isFocused
}

export default useWindowFocus
