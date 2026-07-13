import { useDataApiCursorRevision } from '@renderer/data/hooks/useDataApiCursorRevision'
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
  continuityKey: string
  requestKey: string
  revision: number
  windows: Record<string, CursorGroupWindow<T> & { resolvedRequestKey?: string }>
}

type UseCursorGroupWindowsOptions<T> = {
  continuityKey?: string
  enabled: boolean
  fetchPage: (groupId: string, cursor?: string) => Promise<CursorPaginationResponse<T>>
  getItemId: (item: T) => string
  groupIds?: readonly string[]
  initialGroupIds: readonly string[]
  queryKey: string
  resourcePath: '/topics' | '/agent-sessions'
}

const INITIAL_GROUP_LOAD_CONCURRENCY = 3

export function useCursorGroupWindows<T>({
  continuityKey,
  enabled,
  fetchPage,
  getItemId,
  groupIds,
  initialGroupIds,
  queryKey,
  resourcePath
}: UseCursorGroupWindowsOptions<T>) {
  const resourceRevision = useDataApiCursorRevision(resourcePath)
  const resourceRevisionToken = `${resourcePath}:${resourceRevision}`
  const resolvedContinuityKey = continuityKey ?? queryKey
  const requestKey = `${queryKey}\u0000${resourceRevisionToken}`
  const [state, setState] = useState<CursorGroupWindowsState<T>>({
    continuityKey: resolvedContinuityKey,
    requestKey,
    revision: 0,
    windows: {}
  })
  const stateRef = useRef(state)
  const requestKeyRef = useRef(requestKey)
  const generationRef = useRef(0)
  const pendingByGroupRef = useRef(new Map<string, Promise<string | null>>())
  const groupIdsKey = groupIds?.join('\u0000')
  const allowedGroupIds = useMemo(() => (groupIds ? new Set(groupIds) : undefined), [groupIds])

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  useLayoutEffect(() => {
    requestKeyRef.current = requestKey
  }, [requestKey])

  const reset = useCallback(() => {
    generationRef.current += 1
    pendingByGroupRef.current.clear()
    setState((current) => {
      const next = {
        continuityKey: resolvedContinuityKey,
        requestKey,
        revision: current.revision + 1,
        windows: {}
      }
      stateRef.current = next
      return next
    })
  }, [requestKey, resolvedContinuityKey])

  useLayoutEffect(() => {
    const current = stateRef.current
    if (current.requestKey === requestKey && current.continuityKey === resolvedContinuityKey) return

    generationRef.current += 1
    pendingByGroupRef.current.clear()
    setState((previous) => {
      const canRetain = continuityKey !== undefined && previous.continuityKey === resolvedContinuityKey
      const retainedWindows = canRetain
        ? Object.fromEntries(
            Object.entries(previous.windows)
              .filter(([groupId]) => !allowedGroupIds || allowedGroupIds.has(groupId))
              .map(([groupId, window]) => [groupId, { ...window, nextCursor: undefined }])
          )
        : {}
      const next = {
        continuityKey: resolvedContinuityKey,
        requestKey,
        revision: previous.revision + 1,
        windows: retainedWindows
      }
      stateRef.current = next
      return next
    })
  }, [allowedGroupIds, continuityKey, groupIdsKey, requestKey, resolvedContinuityKey])

  const loadPage = useCallback(
    (groupId: string, append: boolean): Promise<string | null> => {
      if (!enabled || (allowedGroupIds && !allowedGroupIds.has(groupId))) return Promise.resolve(null)
      const currentState = stateRef.current
      const current = currentState.continuityKey === resolvedContinuityKey ? currentState.windows[groupId] : undefined
      const currentIsResolved = current?.resolvedRequestKey === requestKey
      const pending = pendingByGroupRef.current.get(groupId)
      if (pending) return pending
      if (!append && currentIsResolved && current.status !== 'error') {
        return Promise.resolve(current.items[0] ? getItemId(current.items[0]) : null)
      }
      if (append && (!currentIsResolved || !current?.nextCursor)) {
        return Promise.resolve(current?.items[0] ? getItemId(current.items[0]) : null)
      }

      const generation = generationRef.current
      const request = (async () => {
        setState((previous) => ({
          continuityKey: resolvedContinuityKey,
          requestKey,
          revision: previous.revision,
          windows: {
            ...(previous.continuityKey === resolvedContinuityKey ? previous.windows : {}),
            [groupId]: {
              items: previous.continuityKey === resolvedContinuityKey ? (previous.windows[groupId]?.items ?? []) : [],
              nextCursor:
                append && previous.windows[groupId]?.resolvedRequestKey === requestKey
                  ? previous.windows[groupId]?.nextCursor
                  : undefined,
              resolvedRequestKey: previous.windows[groupId]?.resolvedRequestKey,
              status: 'loading'
            }
          }
        }))

        try {
          const page = await fetchPage(groupId, append && currentIsResolved ? current?.nextCursor : undefined)
          if (generationRef.current !== generation || requestKeyRef.current !== requestKey) return null

          const previousItems = append ? (current?.items ?? []) : []
          const byId = new Map(previousItems.map((item) => [getItemId(item), item]))
          for (const item of page.items) byId.set(getItemId(item), item)
          const items = [...byId.values()]
          setState((previous) => ({
            continuityKey: resolvedContinuityKey,
            requestKey,
            revision: previous.revision,
            windows: {
              ...(previous.continuityKey === resolvedContinuityKey ? previous.windows : {}),
              [groupId]: {
                items,
                nextCursor: page.nextCursor,
                resolvedRequestKey: requestKey,
                status: items.length === 0 ? 'empty' : 'idle'
              }
            }
          }))
          return items[0] ? getItemId(items[0]) : null
        } catch (error) {
          if (generationRef.current === generation && requestKeyRef.current === requestKey) {
            setState((previous) => ({
              continuityKey: resolvedContinuityKey,
              requestKey,
              revision: previous.revision,
              windows: {
                ...(previous.continuityKey === resolvedContinuityKey ? previous.windows : {}),
                [groupId]: {
                  items:
                    previous.continuityKey === resolvedContinuityKey ? (previous.windows[groupId]?.items ?? []) : [],
                  nextCursor:
                    append && previous.windows[groupId]?.resolvedRequestKey === requestKey
                      ? previous.windows[groupId]?.nextCursor
                      : undefined,
                  resolvedRequestKey: previous.windows[groupId]?.resolvedRequestKey,
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
    [allowedGroupIds, enabled, fetchPage, getItemId, requestKey, resolvedContinuityKey]
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
    if (!enabled || state.requestKey !== requestKey || initialGroupIds.length === 0) return
    void runResourceListLoadsWithConcurrency(initialGroupIds, INITIAL_GROUP_LOAD_CONCURRENCY, loadGroup)
  }, [enabled, initialGroupIds, initialGroupIdsKey, loadGroup, requestKey, state.requestKey, state.revision])

  const windows = useMemo<Record<string, CursorGroupWindow<T>>>(() => {
    const canShowCurrent = state.requestKey === requestKey
    const canShowRetained = continuityKey !== undefined && state.continuityKey === resolvedContinuityKey
    if (!canShowCurrent && !canShowRetained) return {}
    if (!allowedGroupIds) return state.windows
    return Object.fromEntries(Object.entries(state.windows).filter(([groupId]) => allowedGroupIds.has(groupId)))
  }, [allowedGroupIds, continuityKey, requestKey, resolvedContinuityKey, state])
  const items = useMemo(() => Object.values(windows).flatMap((window) => window.items), [windows])

  return { items, loadGroup, loadMoreGroup, reset, windows }
}
