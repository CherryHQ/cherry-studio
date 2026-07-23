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
  expandedGroupIds: readonly string[]
  fetchPage: (groupId: string, cursor?: string) => Promise<CursorPaginationResponse<T>>
  getItemId: (item: T) => string
  groupIds: readonly string[]
  /**
   * Identity of the result family shared by every group window. Group ids do
   * not belong here: adding or removing one group must preserve its siblings.
   */
  queryKey: string
}

type GroupRequestMode = 'head' | 'more'

type PendingGroupRequest = {
  generation: number
  queryKey: string
  request: Promise<void>
}

const GROUP_LOAD_CONCURRENCY = 3
const GROUP_IDS_SEPARATOR = '\u0000'

function dedupeItems<T>(items: readonly T[], getItemId: (item: T) => string): T[] {
  const byId = new Map<string, T>()
  for (const item of items) {
    byId.set(getItemId(item), item)
  }
  return [...byId.values()]
}

async function runGroupLoadsWithConcurrency(
  groupIds: readonly string[],
  load: (groupId: string) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const workerCount = Math.min(GROUP_LOAD_CONCURRENCY, groupIds.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < groupIds.length) {
      const groupId = groupIds[nextIndex]
      nextIndex += 1
      try {
        await load(groupId)
      } catch {
        // Each window owns and renders its error independently.
      }
    }
  })
  await Promise.all(workers)
}

/**
 * Owns independent cursor windows for a grouped renderer collection.
 *
 * Query-family changes replace every window because their result semantics
 * changed. Group membership changes only prune removed keys, preserving loaded
 * sibling windows and their cursors.
 */
export function useCursorGroupWindows<T>({
  enabled,
  expandedGroupIds,
  fetchPage,
  getItemId,
  groupIds,
  queryKey
}: UseCursorGroupWindowsOptions<T>) {
  const [state, setState] = useState<CursorGroupWindowsState<T>>({ queryKey, windows: {} })
  const stateRef = useRef(state)
  const allowedGroupIdsRef = useRef<ReadonlySet<string>>(new Set(groupIds))
  const mountedRef = useRef(true)
  const generationByGroupRef = useRef(new Map<string, number>())
  const pendingByGroupRef = useRef(new Map<string, PendingGroupRequest>())
  const groupIdsKey = groupIds.join(GROUP_IDS_SEPARATOR)
  const expandedGroupIdsKey = expandedGroupIds.join(GROUP_IDS_SEPARATOR)
  const allowedGroupIds = useMemo(
    () => new Set(groupIds),
    // groupIdsKey is the content identity of groupIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupIdsKey]
  )
  const stableExpandedGroupIds = useMemo(
    () => [...expandedGroupIds],
    // expandedGroupIdsKey is the content identity of expandedGroupIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedGroupIdsKey]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const replaceState = useCallback((next: CursorGroupWindowsState<T>) => {
    stateRef.current = next
    setState(next)
  }, [])

  useLayoutEffect(() => {
    if (stateRef.current.queryKey === queryKey) return

    pendingByGroupRef.current.clear()
    generationByGroupRef.current.clear()
    replaceState({ queryKey, windows: {} })
  }, [queryKey, replaceState])

  useLayoutEffect(() => {
    allowedGroupIdsRef.current = allowedGroupIds

    if (stateRef.current.queryKey !== queryKey) return
    const removedGroupIds = Object.keys(stateRef.current.windows).filter((groupId) => !allowedGroupIds.has(groupId))
    if (removedGroupIds.length === 0) return

    const nextWindows = { ...stateRef.current.windows }
    for (const groupId of removedGroupIds) {
      delete nextWindows[groupId]
      generationByGroupRef.current.set(groupId, (generationByGroupRef.current.get(groupId) ?? 0) + 1)
      pendingByGroupRef.current.delete(groupId)
    }
    replaceState({ queryKey, windows: nextWindows })
  }, [allowedGroupIds, queryKey, replaceState])

  const setGroupWindow = useCallback(
    (requestQueryKey: string, groupId: string, generation: number, window: CursorGroupWindow<T>): boolean => {
      if (
        stateRef.current.queryKey !== requestQueryKey ||
        generationByGroupRef.current.get(groupId) !== generation ||
        !mountedRef.current ||
        !allowedGroupIdsRef.current.has(groupId)
      ) {
        return false
      }

      replaceState({
        queryKey: requestQueryKey,
        windows: { ...stateRef.current.windows, [groupId]: window }
      })
      return true
    },
    [replaceState]
  )

  const runGroupRequest = useCallback(
    (groupId: string, requestedMode: GroupRequestMode): Promise<void> => {
      if (!enabled || !allowedGroupIdsRef.current.has(groupId)) return Promise.resolve()

      const requestQueryKey = queryKey
      const current = stateRef.current.queryKey === queryKey ? stateRef.current.windows[groupId] : undefined
      const mode = requestedMode === 'more' && !current ? 'head' : requestedMode
      if (mode === 'more' && !current?.nextCursor) return Promise.resolve()

      const currentGeneration = generationByGroupRef.current.get(groupId) ?? 0
      const pending = pendingByGroupRef.current.get(groupId)
      if (pending && pending.queryKey === requestQueryKey && pending.generation === currentGeneration) {
        return pending.request
      }

      const generation = currentGeneration + 1
      generationByGroupRef.current.set(groupId, generation)
      setGroupWindow(requestQueryKey, groupId, generation, {
        items: current?.items ?? [],
        nextCursor: current?.nextCursor,
        status: 'loading'
      })

      const request = (async () => {
        try {
          const page = await fetchPage(groupId, mode === 'more' ? current?.nextCursor : undefined)
          if (
            stateRef.current.queryKey !== requestQueryKey ||
            generationByGroupRef.current.get(groupId) !== generation
          ) {
            return
          }
          const items =
            mode === 'more'
              ? dedupeItems([...(current?.items ?? []), ...page.items], getItemId)
              : dedupeItems(page.items, getItemId)

          setGroupWindow(requestQueryKey, groupId, generation, {
            items,
            nextCursor: page.nextCursor,
            status: items.length === 0 ? 'empty' : 'idle'
          })
        } catch (error) {
          setGroupWindow(requestQueryKey, groupId, generation, {
            items: current?.items ?? [],
            nextCursor: current?.nextCursor,
            status: 'error'
          })
          throw error
        }
      })()

      pendingByGroupRef.current.set(groupId, { generation, queryKey: requestQueryKey, request })
      const clearPending = () => {
        if (pendingByGroupRef.current.get(groupId)?.request === request) {
          pendingByGroupRef.current.delete(groupId)
        }
      }
      void request.then(clearPending, clearPending)
      return request
    },
    [enabled, fetchPage, getItemId, queryKey, setGroupWindow]
  )

  const ensureGroup = useCallback(
    (groupId: string) => {
      const current = stateRef.current.queryKey === queryKey ? stateRef.current.windows[groupId] : undefined
      if (current?.status === 'loading') {
        const pending = pendingByGroupRef.current.get(groupId)
        return pending?.queryKey === queryKey ? pending.request : Promise.resolve()
      }
      if (current?.status === 'error') {
        return runGroupRequest(groupId, current.items.length > 0 && current.nextCursor ? 'more' : 'head')
      }
      if (current) return Promise.resolve()
      return runGroupRequest(groupId, 'head')
    },
    [queryKey, runGroupRequest]
  )

  const loadMoreGroup = useCallback(
    async (groupId: string) => {
      await runGroupRequest(groupId, 'more')
    },
    [runGroupRequest]
  )

  const retryGroup = useCallback(
    async (groupId: string) => {
      const current = stateRef.current.queryKey === queryKey ? stateRef.current.windows[groupId] : undefined
      const mode: GroupRequestMode = current?.items.length && current.nextCursor ? 'more' : 'head'
      await runGroupRequest(groupId, mode)
    },
    [queryKey, runGroupRequest]
  )

  useEffect(() => {
    if (!enabled || stableExpandedGroupIds.length === 0) return
    void runGroupLoadsWithConcurrency(stableExpandedGroupIds, ensureGroup)
  }, [enabled, ensureGroup, stableExpandedGroupIds])

  const windows = useMemo<Record<string, CursorGroupWindow<T>>>(() => {
    if (state.queryKey !== queryKey) return {}
    return Object.fromEntries(Object.entries(state.windows).filter(([groupId]) => allowedGroupIds.has(groupId)))
  }, [allowedGroupIds, queryKey, state])
  const items = useMemo(() => Object.values(windows).flatMap((window) => window.items), [windows])

  return { ensureGroup, items, loadMoreGroup, retryGroup, windows }
}
