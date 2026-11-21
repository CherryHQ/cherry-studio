import { useEffect, useRef } from 'react'

import { useIsActiveTab } from './useCurrentTab'

/** Give the mounted input one chance to take focus per tab activation, once it is ready. */
export function useTabInputFocus(focus: (() => boolean) | undefined, enabled = true) {
  const active = useIsActiveTab()
  const initialFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!active) return
    initialFocusRef.current = document.activeElement
    return () => {
      initialFocusRef.current = null
    }
  }, [active])

  useEffect(() => {
    if (!enabled) {
      initialFocusRef.current = null
      return
    }
    const initialFocus = initialFocusRef.current
    if (!active || !initialFocus || !focus) return

    // Yield to another control if the user moved focus while this input was unavailable.
    const currentFocus = document.activeElement
    if (currentFocus !== initialFocus && currentFocus !== document.body) {
      initialFocusRef.current = null
      return
    }
    if (focus()) initialFocusRef.current = null
  }, [active, enabled, focus])
}
