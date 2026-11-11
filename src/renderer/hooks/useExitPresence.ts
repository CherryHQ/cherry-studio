import { useLayoutEffect, useRef, useState } from 'react'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'

/** Retain the last open value until its exit animation has finished. */
export function useExitPresence<T>(value: T | null, durationMs = DIALOG_UNMOUNT_DELAY_MS) {
  const retainedValue = useRef(value)
  const [isPresent, setIsPresent] = useState(value !== null)

  useLayoutEffect(() => {
    if (value !== null) {
      retainedValue.current = value
      setIsPresent(true)
      return
    }
    if (retainedValue.current === null) return

    const timer = setTimeout(() => {
      retainedValue.current = null
      setIsPresent(false)
    }, durationMs)
    return () => clearTimeout(timer)
  }, [durationMs, value])

  return {
    value: value ?? (isPresent ? retainedValue.current : null),
    isPresent: value !== null || isPresent
  }
}
