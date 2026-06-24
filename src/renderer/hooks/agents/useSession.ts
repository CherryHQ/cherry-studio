/**
 * DataApi-backed session queries and mutations.
 *
 * Sessions are pure agent instances — only `id / agentId / name / description /
 * orderKey / timestamps` live here. For config (model / instructions /
 * configuration / ...) call {@link import('./useAgent').useAgent}
 * with `session.agentId`.
 */

import {
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  useQuery
} from '@renderer/data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import type { UpdateAgentBaseOptions } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_SESSION_PAGE_SIZE = 20
export type AgentSessionSource = 'query' | 'pending' | 'none'
type UseSessionsOptions = {
  pageSize?: number
  loadAll?: boolean
}

export type CreateSessionForm = Omit<CreateAgentSessionDto, 'agentId'>
export type UpdateSessionForm = UpdateAgentSessionDto & { id: string }

/**
 * Fetch a single session by id. Config (model / instructions / ...) lives on
 * the parent agent — fetch via `useAgent(session.agentId)` separately. For
 * mutations call `useUpdateSession()` directly.
 */
export const useSession = (sessionId: string | null) => {
  const {
    data: session,
    error,
    isLoading,
    mutate
  } = useQuery('/agent-sessions/:sessionId', {
    params: { sessionId: sessionId! },
    enabled: !!sessionId,
    swrOptions: { keepPreviousData: false }
  })

  return { session, error, isLoading, mutate }
}

export interface UseActiveSessionOptions {
  /** External source of truth for the active session id (e.g. URL search). */
  activeSessionId: string | null
  /** Write back when callers select a different session. */
  setActiveSessionId: (id: string | null) => void
  pendingSession?: AgentSessionEntity | null
}

export const useActiveSession = ({ activeSessionId, setActiveSessionId, pendingSession }: UseActiveSessionOptions) => {
  const result = useSession(activeSessionId)
  const querySession = activeSessionId && result.session?.id === activeSessionId ? result.session : undefined
  const resolvedPendingSession = activeSessionId && pendingSession?.id === activeSessionId ? pendingSession : undefined
  const session = querySession ?? resolvedPendingSession
  const sessionSource: AgentSessionSource = querySession ? 'query' : resolvedPendingSession ? 'pending' : 'none'

  return {
    ...result,
    session,
    sessionSource,
    isLoading: !session && result.isLoading,
    activeSessionId,
    setActiveSessionId
  }
}

/**
 * Cursor-paginated session list. With `agentId` undefined / null the result
 * spans every agent (the global session view); pass an id to scope the
 * listing. Consumers that genuinely need every session can pass
 * `{ loadAll: true }` to auto-page to completion; grouped sidebars use this
 * so drag order is based on the complete list. Reorder uses the same cache key
 * so applying a new order syncs the infinite-query view.
 */
export const useSessions = (
  agentId?: string | null,
  options: number | UseSessionsOptions = DEFAULT_SESSION_PAGE_SIZE
) => {
  const { t } = useTranslation()
  const pageSize = typeof options === 'number' ? options : (options.pageSize ?? DEFAULT_SESSION_PAGE_SIZE)
  const loadAll = typeof options === 'number' ? false : (options.loadAll ?? false)

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    query: agentId ? { agentId } : undefined,
    limit: pageSize
  })
  // Cache key includes the query, so reorder operates on the same key.
  const { applyReorderedList } = useReorder('/agent-sessions')

  // AgentSessionService returns the persisted session order (`orderKey`, `id`).
  // The `/pins` map is composed in the renderer for row indicators, toggle
  // handling, and display grouping/sorting that promotes pinned sessions.
  const sessions = useInfiniteFlatItems(pages)
  const { data: pinList, isLoading: isPinsLoading } = useQuery('/pins', { query: { entityType: 'session' } })
  const pinIdBySessionId = useMemo(
    () => new Map(Array.isArray(pinList) ? pinList.map((p) => [p.entityId, p.id] as const) : []),
    [pinList]
  )
  const total = sessions.length
  const hasMore = hasNext
  const isFullyLoaded = !loadAll || (!isLoading && !hasMore)
  const isLoadingAll = isLoading || (loadAll && hasMore)
  const isLoadingMore = isRefreshing && pages.length > 1

  useEffect(() => {
    if (loadAll && hasMore && !isLoading && !isRefreshing) {
      loadNext()
    }
  }, [loadAll, hasMore, isLoading, isRefreshing, loadNext])

  const reload = useCallback(() => refresh(), [refresh])

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadNext()
    }
  }, [hasMore, isLoadingMore, loadNext])

  const { trigger: createTrigger } = useMutation('POST', '/agent-sessions', {
    refresh: ['/agent-sessions', '/agent-workspaces']
  })
  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<AgentSessionEntity | null> => {
      if (!agentId) {
        window.toast.error(t('agent.session.create.error.failed'))
        return null
      }
      let result: AgentSessionEntity
      try {
        result = await createTrigger({
          body: {
            agentId,
            name: form.name,
            description: form.description,
            workspace: form.workspace
          }
        })
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }

      await refresh().catch((error) => {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.get.error.failed')))
      })

      return result
    },
    [agentId, createTrigger, refresh, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agent-sessions/:sessionId', {
    refresh: ['/agent-sessions']
  })
  const { trigger: deleteManyTrigger } = useMutation('DELETE', '/agent-sessions', {
    refresh: ['/agent-sessions', '/agent-workspaces', '/pins', '/agent-channels']
  })
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await deleteTrigger({ params: { sessionId: id } })
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [deleteTrigger, t]
  )

  const deleteSessions = useCallback(
    async (ids: string[]): Promise<DeleteAgentSessionsResult | null> => {
      try {
        return await deleteManyTrigger({ query: { ids: ids.join(',') } })
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return null
      }
    },
    [deleteManyTrigger, t]
  )

  const reorderSessions = useCallback(
    async (reorderedList: AgentSessionEntity[]) => {
      try {
        await applyReorderedList(reorderedList as unknown as Array<Record<string, unknown>>)
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
      }
    },
    [applyReorderedList, t]
  )

  const { trigger: reorderTrigger } = useMutation('PATCH', '/agent-sessions/:id/order', {
    refresh: ['/agent-sessions']
  })
  const reorderSession = useCallback(
    async (id: string, anchor: OrderRequest): Promise<boolean> => {
      try {
        await reorderTrigger({ params: { id }, body: anchor })
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
        return false
      }
    },
    [reorderTrigger, t]
  )

  // Server returns pinned-first via the two-section cursor in
  // `AgentSessionService.listByCursor`, so pin-state changes affect `/agent-sessions`
  // page ordering, not just `/pins` membership. Refresh both keys so the
  // row visibly relocates after pin/unpin.
  const { trigger: pinTrigger } = useMutation('POST', '/pins', { refresh: ['/pins', '/agent-sessions'] })
  const { trigger: unpinTrigger } = useMutation('DELETE', '/pins/:id', { refresh: ['/pins', '/agent-sessions'] })
  const togglePin = useCallback(
    async (sessionId: string) => {
      const pinId = pinIdBySessionId.get(sessionId)
      try {
        if (pinId) {
          await unpinTrigger({ params: { id: pinId } })
        } else {
          await pinTrigger({ body: { entityType: 'session', entityId: sessionId } })
        }
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.pin.error.failed')))
        return false
      }
    },
    [pinIdBySessionId, pinTrigger, unpinTrigger, t]
  )

  return {
    sessions,
    pinIdBySessionId,
    total,
    hasMore,
    error,
    isLoading,
    isLoadingMore,
    isValidating: isRefreshing,
    reload,
    loadMore,
    createSession,
    deleteSession,
    deleteSessions,
    reorderSession,
    reorderSessions,
    togglePin,
    isFullyLoaded,
    isLoadingAll,
    isPinsLoading
  }
}

/**
 * Patch session-level fields (`name`, `description`, `agentId`). Config fields
 * (model, instructions, configuration, ...) live on the parent agent — use
 * {@link import('./useAgent').useUpdateAgent} for those.
 */
export const useUpdateSession = () => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agent-sessions/:sessionId', {
    // `args.params.sessionId` is always supplied by `updateSession` below.
    // The non-null assertion mirrors useTopic.ts and crashes loud
    // if the contract is ever broken instead of silently producing
    // '/agent-sessions/undefined' (which would miss every cache entry).
    refresh: ({ args }) => ['/agent-sessions', `/agent-sessions/${args!.params.sessionId}`]
  })

  const updateSession = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({ params: { sessionId: id }, body: patch })
        if (options?.showSuccessToast ?? true) {
          window.toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        window.toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [updateTrigger, t]
  )

  return { updateSession }
}

/**
 * Listens for `IpcChannel.AgentSession_AutoRenamed` and invalidates the
 * renamed session's SWR cache so the new name appears without manual refetch.
 */
export function useAgentSessionAutoRenameSync() {
  const invalidate = useInvalidateCache()

  useEffect(() => {
    const onAutoRenamed = window.api?.agentSession?.onAutoRenamed
    if (!onAutoRenamed) return
    const unsubscribe = onAutoRenamed(({ sessionId }) => {
      void invalidate(['/agent-sessions', `/agent-sessions/${sessionId}`])
    })
    return () => {
      unsubscribe()
    }
  }, [invalidate])
}
