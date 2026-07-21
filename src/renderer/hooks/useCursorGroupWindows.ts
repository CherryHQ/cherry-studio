import { runResourceListLoadsWithConcurrency } from '@renderer/utils/chat/resourceListBase'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export type CursorGroupWindowStatus = 'idle' | 'loading' | 'empty' | 'error'

export type CursorGroupWindow<T> = {
  items: T[]
  nextCursor?: string
  status: CursorGroupWindowStatus
}

type CursorGroupWindowsState<T> = {
  queryKey: string
  windows: Record<string, CursorGroupWindow<T>>
}

type UseCursorGroupWindowsOptions<T> = {
  enabled: boolean
  fetchPage: (groupId: string, cursor?: string) => Promise<CursorPaginationResponse<T>>
  getItemId: (item: T) => string
  groupIds?: readonly string[]
  initialGroupIds: readonly string[]
  queryKey: string
}

type PendingGroupRequest = {
  queryKey: string
  request: Promise<string | null>
}

const INITIAL_GROUP_LOAD_CONCURRENCY = 3

export function useCursorGroupWindows<T>({
  enabled,
  fetchPage,
  getItemId,
  groupIds,
  initialGroupIds,
  queryKey
}: UseCursorGroupWindowsOptions<T>) {
  const [state, setState] = useState<CursorGroupWindowsState<T>>({ queryKey, windows: {} })
  const stateRef = useRef(state)
  const queryKeyRef = useRef(queryKey)
  const pendingByGroupRef = useRef(new Map<string, PendingGroupRequest>())
  const allowedGroupIds = useMemo(() => (groupIds ? new Set(groupIds) : undefined), [groupIds])

  useLayoutEffect(() => {
    queryKeyRef.current = queryKey
    if (stateRef.current.queryKey === queryKey) return

    pendingByGroupRef.current.clear()
    const next = { queryKey, windows: {} }
    stateRef.current = next
    setState(next)
  }, [queryKey])

  const setGroupWindow = useCallback((requestQueryKey: string, groupId: string, window: CursorGroupWindow<T>) => {
    if (stateRef.current.queryKey !== requestQueryKey) return
    const next = {
      ...stateRef.current,
      windows: { ...stateRef.current.windows, [groupId]: window }
    }
    stateRef.current = next
    setState(next)
  }, [])

  const loadPage = useCallback(
    (groupId: string, append: boolean): Promise<string | null> => {
      if (!enabled || (allowedGroupIds && !allowedGroupIds.has(groupId))) return Promise.resolve(null)

      const currentState = stateRef.current
      const current = currentState.queryKey === queryKey ? currentState.windows[groupId] : undefined
      const pending = pendingByGroupRef.current.get(groupId)
      if (pending?.queryKey === queryKey) return pending.request
      if (!append && current && current.status !== 'error') {
        return Promise.resolve(current.items[0] ? getItemId(current.items[0]) : null)
      }
      if (append && !current?.nextCursor) {
        return Promise.resolve(current?.items[0] ? getItemId(current.items[0]) : null)
      }

      const requestQueryKey = queryKey
      setGroupWindow(requestQueryKey, groupId, {
        items: current?.items ?? [],
        nextCursor: append ? current?.nextCursor : undefined,
        status: 'loading'
      })

      const request = (async () => {
        try {
          const page = await fetchPage(groupId, append ? current?.nextCursor : undefined)
          if (queryKeyRef.current !== requestQueryKey) return null

          const items = append ? [...(current?.items ?? []), ...page.items] : page.items
          setGroupWindow(requestQueryKey, groupId, {
            items,
            nextCursor: page.nextCursor,
            status: items.length === 0 ? 'empty' : 'idle'
          })
          return items[0] ? getItemId(items[0]) : null
        } catch (error) {
          if (queryKeyRef.current === requestQueryKey) {
            setGroupWindow(requestQueryKey, groupId, {
              items: current?.items ?? [],
              nextCursor: append ? current?.nextCursor : undefined,
              status: 'error'
            })
          }
          throw error
        }
      })()

      pendingByGroupRef.current.set(groupId, { queryKey: requestQueryKey, request })
      const clearPending = () => {
        if (pendingByGroupRef.current.get(groupId)?.request === request) pendingByGroupRef.current.delete(groupId)
      }
      void request.then(clearPending, clearPending)
      return request
    },
    [allowedGroupIds, enabled, fetchPage, getItemId, queryKey, setGroupWindow]
  )

  const loadGroup = useCallback((groupId: string) => loadPage(groupId, false), [loadPage])
  const loadMoreGroup = useCallback(
    async (groupId: string) => {
      await loadPage(groupId, true)
    },
    [loadPage]
  )
  const refillGroup = useCallback(
    async (groupId: string, loadedWindowSize: number): Promise<T[]> => {
      if (!enabled || (allowedGroupIds && !allowedGroupIds.has(groupId))) return []

      const pending = pendingByGroupRef.current.get(groupId)
      if (pending?.queryKey === queryKey) {
        try {
          await pending.request
        } catch {
          // The refill below retries from the collection head.
        }
      }
      if (queryKeyRef.current !== queryKey) return []

      const requestQueryKey = queryKey
      const currentItems = stateRef.current.windows[groupId]?.items ?? []
      setGroupWindow(requestQueryKey, groupId, { items: currentItems, status: 'loading' })

      try {
        const items: T[] = []
        let cursor: string | undefined
        let nextCursor: string | undefined
        const targetSize = Math.max(loadedWindowSize, 1)

        do {
          const page = await fetchPage(groupId, cursor)
          if (queryKeyRef.current !== requestQueryKey) return []
          items.push(...page.items)
          nextCursor = page.nextCursor
          cursor = page.nextCursor
        } while (items.length < targetSize && cursor)

        setGroupWindow(requestQueryKey, groupId, {
          items,
          nextCursor,
          status: items.length === 0 ? 'empty' : 'idle'
        })
        return items
      } catch (error) {
        if (queryKeyRef.current === requestQueryKey) {
          setGroupWindow(requestQueryKey, groupId, { items: currentItems, status: 'error' })
        }
        throw error
      }
    },
    [allowedGroupIds, enabled, fetchPage, queryKey, setGroupWindow]
  )
  const initialGroupIdsKey = initialGroupIds.join('\u0000')

  useEffect(() => {
    if (!enabled || state.queryKey !== queryKey || initialGroupIds.length === 0) return
    void runResourceListLoadsWithConcurrency(initialGroupIds, INITIAL_GROUP_LOAD_CONCURRENCY, loadGroup)
  }, [enabled, initialGroupIds, initialGroupIdsKey, loadGroup, queryKey, state.queryKey])

  const windows = useMemo<Record<string, CursorGroupWindow<T>>>(() => {
    if (state.queryKey !== queryKey) return {}
    if (!allowedGroupIds) return state.windows
    return Object.fromEntries(Object.entries(state.windows).filter(([groupId]) => allowedGroupIds.has(groupId)))
  }, [allowedGroupIds, queryKey, state])
  const items = useMemo(() => Object.values(windows).flatMap((window) => window.items), [windows])

  return { items, loadGroup, loadMoreGroup, refillGroup, windows }
}
