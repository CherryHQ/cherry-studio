import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { useState } from 'react'

/**
 * True window key state, relayed from the main process — unlike DOM
 * focus/blur, unaffected by a <webview> stealing page focus.
 */
function useWindowFocus() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())

  useIpcOn('window.focus_changed', setIsFocused)

  return isFocused
}

export default useWindowFocus
