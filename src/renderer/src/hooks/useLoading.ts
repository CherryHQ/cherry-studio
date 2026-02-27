import { useAppDispatch } from '@renderer/store'
import { setLoadingAction } from '@renderer/store/runtime'

import { useRuntime } from './useRuntime'

export function useLoading(): {
  loadingMap: Record<string, boolean>
  setLoading: (params: { id: string; value: boolean }) => void
}
export function useLoading(id: string): { isLoading: boolean; setLoading: (value: boolean) => void }
export function useLoading(id?: string) {
  const { loadingMap } = useRuntime()
  const dispatch = useAppDispatch()

  if (id) {
    return {
      isLoading: loadingMap[id] ?? false,
      setLoading: (value: boolean) => {
        dispatch(setLoadingAction({ id, value }))
      }
    }
  } else {
    return {
      loadingMap,
      setLoading: (params: { id: string; value: boolean }) => {
        dispatch(setLoadingAction(params))
      }
    }
  }
}
