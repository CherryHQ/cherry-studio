import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { TopView } from '../TopView'

export const TOP_VIEW_CLOSE_ANIMATION_MS = 200

interface UseTopViewCloseOptions<T> {
  afterClose?: () => void
  resolve: (result: T) => void
  setOpen: Dispatch<SetStateAction<boolean>>
  topViewKey: string
}

export function useTopViewClose<T>({ afterClose, resolve, setOpen, topViewKey }: UseTopViewCloseOptions<T>) {
  const afterCloseRef = useRef(afterClose)
  const resultRef = useRef<T | null>(null)
  const resolvedRef = useRef(false)
  const settledRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    afterCloseRef.current = afterClose
  }, [afterClose])

  const settle = useCallback(
    (result: T) => {
      if (settledRef.current) return

      settledRef.current = true
      try {
        afterCloseRef.current?.()
      } finally {
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
    (result: T) => {
      if (resolvedRef.current) return

      resolvedRef.current = true
      resultRef.current = result
      setOpen(false)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        settle(result)
      }, TOP_VIEW_CLOSE_ANIMATION_MS)
    },
    [setOpen, settle]
  )
}
