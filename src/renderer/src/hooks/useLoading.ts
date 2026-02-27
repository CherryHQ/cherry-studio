import { useAppDispatch, useAppSelector } from '@renderer/store'
import { finishLoadingAction, startLoadingAction } from '@renderer/store/runtime'

/**
 * Hook for managing loading states across the application.
 *
 * This hook provides a centralized way to track loading states using a map-based approach,
 * allowing multiple independent loading operations to be tracked simultaneously.
 *
 * @example
 * // Usage without id - access all loading states
 * const { loadingMap, startLoading, finishLoading } = useLoading();
 * startLoading('fetchingUsers');
 *
 * @example
 * // Usage with id - track specific loading state
 * const { isLoading, startLoading, finishLoading } = useLoading('fetchingUsers');
 */
export function useLoading(): {
  loadingMap: Record<string, boolean>
  startLoading: (id: string) => void
  finishLoading: (id: string) => void
}
/**
 * Hook for managing loading state for a specific operation.
 *
 * @param id - Unique identifier for the loading operation (e.g., 'fetchingUsers', 'savingData')
 * @returns Object containing loading state and control functions for the specific id
 *
 * @example
 * const { isLoading, startLoading, finishLoading } = useLoading('fetchingUsers');
 * if (isLoading) return <Spinner />;
 */
export function useLoading(id: string): { isLoading: boolean; startLoading: () => void; finishLoading: () => void }
export function useLoading(id?: string) {
  const loadingMap = useAppSelector((state) => state.runtime.loadingMap)
  const dispatch = useAppDispatch()

  if (id) {
    return {
      isLoading: loadingMap[id] ?? false,
      startLoading: () => {
        dispatch(startLoadingAction({ id }))
      },
      finishLoading: () => {
        dispatch(finishLoadingAction({ id }))
      }
    }
  } else {
    return {
      loadingMap,
      startLoading: (id: string) => {
        dispatch(startLoadingAction({ id }))
      },
      finishLoading: (id: string) => {
        dispatch(finishLoadingAction({ id }))
      }
    }
  }
}
