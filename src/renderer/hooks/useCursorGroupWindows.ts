import { useDataApiCursorRevision } from '@renderer/data/hooks/useDataApiCursorRevision'
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
  revision: number
  windows: Record<string, CursorGroupWindow<T>>
}

type UseCursorGroupWindowsOptions<T> = {
  enabled: boolean
  fetchPage: (groupId: string, cursor?: string) => Promise<CursorPaginationResponse<T>>
  getItemId: (item: T) => string
  initialGroupIds: readonly string[]
  queryKey: string
  resourcePath: '/topics' | '/agent-sessions'
}

const INITIAL_GROUP_LOAD_CONCURRENCY = 3

async function runWithConcurrency(
  groupIds: readonly string[],
  concurrency: number,
  load: (groupId: string) => Promise<unknown>
): Promise<void> {
  const queue = [...groupIds]
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), queue.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const groupId = queue.shift()
        if (!groupId) continue
        try {
          await load(groupId)
        } catch {
          // Per-group error state is retained; the remaining queue still loads.
        }
      }
    })
  )
}

export function useCursorGroupWindows<T>({
  enabled,
  fetchPage,
  getItemId,
  initialGroupIds,
  queryKey,
  resourcePath
}: UseCursorGroupWindowsOptions<T>) {
  const [state, setState] = useState<CursorGroupWindowsState<T>>({ queryKey, revision: 0, windows: {} })
  const resourceRevision = useDataApiCursorRevision(resourcePath)
  const resourceRevisionToken = `${resourcePath}:${resourceRevision}`
  const stateRef = useRef(state)
  const queryKeyRef = useRef(queryKey)
  const resourceRevisionTokenRef = useRef(resourceRevisionToken)
  const generationRef = useRef(0)
  const pendingByGroupRef = useRef(new Map<string, Promise<string | null>>())

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  useLayoutEffect(() => {
    queryKeyRef.current = queryKey
  }, [queryKey])

  const reset = useCallback(() => {
    generationRef.current += 1
    pendingByGroupRef.current.clear()
    setState((current) => ({ queryKey, revision: current.revision + 1, windows: {} }))
  }, [queryKey])

  useEffect(() => {
    if (state.queryKey !== queryKey) reset()
  }, [queryKey, reset, state.queryKey])

  useLayoutEffect(() => {
    if (resourceRevisionTokenRef.current === resourceRevisionToken) return
    resourceRevisionTokenRef.current = resourceRevisionToken
    if (stateRef.current.queryKey === queryKey) reset()
  }, [queryKey, reset, resourceRevisionToken])

  const loadPage = useCallback(
    (groupId: string, append: boolean): Promise<string | null> => {
      if (!enabled) return Promise.resolve(null)
      const current = stateRef.current.queryKey === queryKey ? stateRef.current.windows[groupId] : undefined
      if (!append && current?.items.length) return Promise.resolve(getItemId(current.items[0]))
      if (append && !current?.nextCursor) {
        return Promise.resolve(current?.items[0] ? getItemId(current.items[0]) : null)
      }
      const pending = pendingByGroupRef.current.get(groupId)
      if (pending) return pending

      const generation = generationRef.current
      const request = (async () => {
        setState((previous) => ({
          queryKey,
          revision: previous.revision,
          windows: {
            ...(previous.queryKey === queryKey ? previous.windows : {}),
            [groupId]: {
              items: previous.queryKey === queryKey ? (previous.windows[groupId]?.items ?? []) : [],
              nextCursor: previous.queryKey === queryKey ? previous.windows[groupId]?.nextCursor : undefined,
              status: 'loading'
            }
          }
        }))

        try {
          const page = await fetchPage(groupId, append ? current?.nextCursor : undefined)
          if (generationRef.current !== generation || queryKeyRef.current !== queryKey) return null

          const previousItems = append ? (current?.items ?? []) : []
          const byId = new Map(previousItems.map((item) => [getItemId(item), item]))
          for (const item of page.items) byId.set(getItemId(item), item)
          const items = [...byId.values()]
          setState((previous) => ({
            queryKey,
            revision: previous.revision,
            windows: {
              ...(previous.queryKey === queryKey ? previous.windows : {}),
              [groupId]: {
                items,
                nextCursor: page.nextCursor,
                status: items.length === 0 ? 'empty' : 'idle'
              }
            }
          }))
          return items[0] ? getItemId(items[0]) : null
        } catch (error) {
          if (generationRef.current === generation && queryKeyRef.current === queryKey) {
            setState((previous) => ({
              queryKey,
              revision: previous.revision,
              windows: {
                ...(previous.queryKey === queryKey ? previous.windows : {}),
                [groupId]: {
                  items: previous.queryKey === queryKey ? (previous.windows[groupId]?.items ?? []) : [],
                  nextCursor: previous.queryKey === queryKey ? previous.windows[groupId]?.nextCursor : undefined,
                  status: 'error'
                }
              }
            }))
          }
          throw error
        }
      })()
      pendingByGroupRef.current.set(groupId, request)
      const clearPending = () => {
        if (pendingByGroupRef.current.get(groupId) === request) pendingByGroupRef.current.delete(groupId)
      }
      void request.then(clearPending, clearPending)
      return request
    },
    [enabled, fetchPage, getItemId, queryKey]
  )

  const loadGroup = useCallback((groupId: string) => loadPage(groupId, false), [loadPage])
  const loadMoreGroup = useCallback(
    async (groupId: string) => {
      await loadPage(groupId, true)
    },
    [loadPage]
  )
  const initialGroupIdsKey = initialGroupIds.join('\u0000')

  useEffect(() => {
    if (!enabled || state.queryKey !== queryKey || initialGroupIds.length === 0) return
    void runWithConcurrency(initialGroupIds, INITIAL_GROUP_LOAD_CONCURRENCY, loadGroup)
  }, [enabled, initialGroupIds, initialGroupIdsKey, loadGroup, queryKey, state.queryKey, state.revision])

  const windows = useMemo(
    () => (state.queryKey === queryKey ? state.windows : {}),
    [queryKey, state.queryKey, state.windows]
  )
  const items = useMemo(() => Object.values(windows).flatMap((window) => window.items), [windows])

  return { items, loadGroup, loadMoreGroup, reset, windows }
}
