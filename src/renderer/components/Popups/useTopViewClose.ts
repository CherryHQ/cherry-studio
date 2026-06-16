import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { TopView } from '../TopView'

export const TOP_VIEW_CLOSE_ANIMATION_MS = 200

interface UseTopViewCloseOptions<T = void> {
  afterClose?: () => void
  onClosingChange?: (closing: boolean) => void
  resolve: (result: T) => void
  setOpen: Dispatch<SetStateAction<boolean>>
  topViewKey: string
}

export function useTopViewClose<T>({
  afterClose,
  onClosingChange,
  resolve,
  setOpen,
  topViewKey
}: UseTopViewCloseOptions<T>) {
  const afterCloseRef = useRef(afterClose)
  const onClosingChangeRef = useRef(onClosingChange)
  const resultRef = useRef<T | undefined>(undefined)
  const resolvedRef = useRef(false)
  const settledRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    afterCloseRef.current = afterClose
  }, [afterClose])

  useEffect(() => {
    onClosingChangeRef.current = onClosingChange
  }, [onClosingChange])

  const settle = useCallback(
    (result: T) => {
      if (settledRef.current) return

      settledRef.current = true
      try {
        afterCloseRef.current?.()
      } finally {
        onClosingChangeRef.current?.(false)
        resolve(result)
        TopView.hide(topViewKey)
      }
    },
    [resolve, topViewKey]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }

      if (resolvedRef.current && !settledRef.current) {
        settle(resultRef.current as T)
      }
    }
  }, [settle])

  return useCallback(
    (result?: T) => {
      if (resolvedRef.current) return

      resolvedRef.current = true
      resultRef.current = result as T
      onClosingChangeRef.current?.(true)
      setOpen(false)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        settle(result as T)
      }, TOP_VIEW_CLOSE_ANIMATION_MS)
    },
    [setOpen, settle]
  )
}
