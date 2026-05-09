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
  const resolvedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    afterCloseRef.current = afterClose
  }, [afterClose])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return useCallback(
    (result: T) => {
      if (resolvedRef.current) return

      resolvedRef.current = true
      setOpen(false)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        try {
          afterCloseRef.current?.()
        } finally {
          resolve(result)
          TopView.hide(topViewKey)
        }
      }, TOP_VIEW_CLOSE_ANIMATION_MS)
    },
    [resolve, setOpen, topViewKey]
  )
}
