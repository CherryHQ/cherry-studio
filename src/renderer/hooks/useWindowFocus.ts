import { useEffect, useState } from 'react'

/**
 * True window key state, relayed from the main process — unlike DOM
 * focus/blur, unaffected by a <webview> stealing page focus.
 */
function useWindowFocus() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus())

  useEffect(() => window.api.windowManager.onFocusChange(setIsFocused), [])

  return isFocused
}

export default useWindowFocus
