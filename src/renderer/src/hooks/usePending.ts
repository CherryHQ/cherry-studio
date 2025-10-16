import { useAppDispatch } from '@renderer/store'
import { setPendingAction } from '@renderer/store/runtime'
import { useCallback } from 'react'

import { useRuntime } from './useRuntime'

export const usePending = () => {
  const { pendingMap } = useRuntime()
  const dispatch = useAppDispatch()
  const setPending = useCallback(
    (id: string, value: boolean | undefined) => {
      dispatch(setPendingAction({ id, value }))
    },
    [dispatch]
  )
  return { pendingMap, setPending }
}
