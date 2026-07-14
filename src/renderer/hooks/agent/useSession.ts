/**
 * DataApi-backed session queries and mutations.
 *
 * Sessions are pure agent instances — only `id / agentId / name / description /
 * orderKey / timestamps` live here. For config (model / instructions /
 * configuration / ...) call {@link import('./useAgent').useAgent}
 * with `session.agentId`.
 */

import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import type { DataApiRefreshTarget } from '@renderer/data/hooks/useDataApi'
import {
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  useQuery
} from '@renderer/data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { usePinMutations } from '@renderer/hooks/usePins'
import { useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { UpdateAgentBaseOptions } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  AgentSessionSearchScope,
  AgentSessionSortBy,
  AgentSessionStatsQuery,
  AgentSessionWorkspaceScope,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  SetAgentSessionWorkspaceDto,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useSession')

const DEFAULT_SESSION_PAGE_SIZE = 20

/** Cursor-chain reset for the session list — include it in every membership/order-changing write. */
const SESSION_LIST_RESET = { path: '/agent-sessions', strategy: 'reset-cursor' } as const
/** Canonical session-list write refresh: reset the cursor chain and refresh stats. */
const SESSION_LIST_REFRESH: DataApiRefreshTarget[] = [SESSION_LIST_RESET, '/agent-sessions/stats']
export type AgentSessionSource = 'query' | 'pending' | 'none'
type UseSessionsOptions = {
  pageSize?: number
  enabled?: boolean
  /** Flat sort profile. Required for q/searchScope and the 'unlinked' owner scope. */
  sortBy?: AgentSessionSortBy
  /** Literal substring search term (server-side, escaped LIKE). */
  q?: string
  /** 'name' (default) or 'full' (name OR description OR owning agent name). */
  searchScope?: AgentSessionSearchScope
  /** true selects the independent pin-owned stream; false filters the flat stream. */
  pinned?: boolean
  /** Concrete user workspace id, or the aggregate system/no-workdir scope. */
  workspaceId?: AgentSessionWorkspaceScope
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

/**
 * The globally most-recently-updated session, for first-entry restore.
 *
 * Backed by a dedicated `updatedAt DESC LIMIT 1` server query, so it resumes the
 * last-touched session without waiting for the full session history to paginate
 * in and without depending on the pinned-first `/agent-sessions` list order.
 *
 * `/agent-sessions/latest` is a global MAX(updatedAt) aggregate, so keeping its
 * cache coherent would mean every updatedAt-bumping write invalidating it (an
 * unbounded fan-out). It's read-on-demand instead: the first-entry effect reads
 * it once on mount, and folding `isRefreshing` into `isLoading` makes that read
 * wait for the on-mount revalidation to settle rather than trust a stale cache.
 * `latestSession` is `undefined` while loading and when there are no sessions.
 */
export function useLatestSession(opts?: { enabled?: boolean }) {
  const { data, isLoading, isRefreshing, refetch, mutate } = useQuery('/agent-sessions/latest', {
    enabled: opts?.enabled
  })

  return {
    latestSession: data?.session ?? undefined,
    isLoading: isLoading || isRefreshing,
    refetch,
    mutate
  }
}

/**
 * Factual session aggregation from `GET /agent-sessions/stats`: totals,
 * pinned counts, and a per-agent breakdown whose
 * `agentId: null` entry represents orphaned (unlinked) sessions. Local list
 * mutations that affect these facts list this path explicitly in their
 * refresh targets.
 */
export function useAgentSessionStats(opts?: { enabled?: boolean; query?: AgentSessionStatsQuery }) {
  const { data, isLoading, error, refetch } = useQuery('/agent-sessions/stats', {
    enabled: opts?.enabled,
    query: opts?.query
  })

  return { stats: data, isLoading, error, refetch }
}

export interface UseActiveSessionOptions {
  /** External source of truth for the active session id (e.g. URL search). */
  activeSessionId: string | null
  /** Write back when callers select a different session. */
  setActiveSessionId: (id: string | null) => void
  /** Optimistic session to paint before its by-id query resolves (e.g. first-entry restore). */
  initialSession?: AgentSessionEntity | null
}

/**
 * Resolves the active session (query-backed, with an optimistic fallback) and owns the pending
 * session itself — mirroring {@link import('@renderer/hooks/useTopic').useActiveTopic}. Callers pass
 * only `activeSessionId` + `setActiveSessionId` and drive selection through `setActiveSession` /
 * `selectSession` / `clearActiveSession`; the hook keeps pending in `useState` so a stale optimistic
 * session is ignored via the id match rather than eagerly nulled at every call site.
 */
export const useActiveSession = ({ activeSessionId, setActiveSessionId, initialSession }: UseActiveSessionOptions) => {
  const result = useSession(activeSessionId)
  const [pendingSession, setPendingSession] = useState<AgentSessionEntity | null>(() => initialSession ?? null)

  const querySession = activeSessionId && result.session?.id === activeSessionId ? result.session : undefined
  // Only a pending session whose id matches the active id resolves; a leftover one is inert (never
  // returned, never counted as the source), so no path has to null it out to stay correct.
  const resolvedPendingSession = activeSessionId && pendingSession?.id === activeSessionId ? pendingSession : undefined
  const session = querySession ?? resolvedPendingSession
  const sessionSource: AgentSessionSource = querySession ? 'query' : resolvedPendingSession ? 'pending' : 'none'

  // Set the active id and its optimistic session together. `entity` may be null to move to an id
  // whose row is fetched by query (e.g. history/global-search reveal), or the id may be null to clear.
  const selectSession = useCallback(
    (sessionId: string | null, entity?: AgentSessionEntity | null) => {
      setPendingSession(entity ?? null)
      setActiveSessionId(sessionId)
    },
    [setActiveSessionId]
  )
  const setActiveSession = useCallback(
    (entity: AgentSessionEntity) => selectSession(entity.id, entity),
    [selectSession]
  )
  const clearActiveSession = useCallback(() => selectSession(null, null), [selectSession])

  return {
    ...result,
    session,
    sessionSource,
    isLoading: !session && result.isLoading,
    activeSessionId,
    setActiveSessionId,
    setActiveSession,
    selectSession,
    clearActiveSession,
    pendingSession,
    setPendingSession
  }
}

/**
 * Cursor-paginated session list. With `agentId` undefined / null the result
 * spans every agent (the global session view); pass an id to scope the
 * listing. Flat sort profiles include immutable creation order (`createdAt`),
 * activity order (`updatedAt`), and manual order (`orderKey`). Consumers page
 * explicitly with `loadMore()`; grouped sidebars own independent per-group
 * cursor windows.
 */
export const useSessions = (
  agentId?: string | null,
  options: number | UseSessionsOptions = DEFAULT_SESSION_PAGE_SIZE
) => {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
  const pageSize = typeof options === 'number' ? options : (options.pageSize ?? DEFAULT_SESSION_PAGE_SIZE)
  const enabled = typeof options === 'number' ? undefined : options.enabled
  const sortBy = typeof options === 'number' ? undefined : options.sortBy
  const q = typeof options === 'number' ? undefined : options.q?.trim() || undefined
  const searchScope = typeof options === 'number' ? undefined : options.searchScope
  const pinned = typeof options === 'number' ? undefined : options.pinned
  const workspaceId = typeof options === 'number' ? undefined : options.workspaceId
  const isPinnedStream = pinned === true
  const effectiveSortBy = isPinnedStream ? undefined : sortBy

  const query = useMemo(() => {
    const built: {
      agentId?: string
      sortBy?: AgentSessionSortBy
      q?: string
      searchScope?: AgentSessionSearchScope
      pinned?: boolean
      workspaceId?: AgentSessionWorkspaceScope
    } = {}
    if (agentId) built.agentId = agentId
    if (effectiveSortBy) built.sortBy = effectiveSortBy
    if (q) built.q = q
    if (q && searchScope) built.searchScope = searchScope
    if (pinned !== undefined) built.pinned = pinned
    if (workspaceId !== undefined) built.workspaceId = workspaceId
    return Object.keys(built).length > 0 ? built : undefined
  }, [agentId, effectiveSortBy, pinned, q, searchScope, workspaceId])

  const continuityKey = useMemo(
    () =>
      JSON.stringify({
        agentId,
        mode: isPinnedStream ? 'pinned' : 'flat',
        pinned,
        q,
        searchScope,
        workspaceId
      }),
    [agentId, isPinnedStream, pinned, q, searchScope, workspaceId]
  )
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    continuityKey,
    query,
    limit: pageSize,
    enabled,
    resetOnLocalWrite: '/agent-sessions'
  })
  // Cache key includes the query, so reorder operates on the same key.
  const { applyReorderedList } = useReorder('/agent-sessions', {
    refreshStrategy: 'reset-cursor'
  })

  const sessions = useInfiniteFlatItems(pages)
  const pinIdBySessionId = useMemo(
    () => new Map(sessions.flatMap((session) => (session.pinId ? [[session.id, session.pinId] as const] : []))),
    [sessions]
  )
  const total = sessions.length
  const hasMore = hasNext
  const isLoadingMore = isRefreshing && !isLoading && pages.length > 0

  const reload = useCallback(() => refresh(), [refresh])

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadNext()
    }
  }, [hasMore, isLoadingMore, loadNext])

  const { trigger: createTrigger } = useMutation('POST', '/agent-sessions', {
    refresh: [...SESSION_LIST_REFRESH, '/agent-workspaces']
  })
  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<AgentSessionEntity | null> => {
      if (!agentId) {
        toast.error(t('agent.session.create.error.failed'))
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
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }

      return result
    },
    [agentId, createTrigger, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agent-sessions/:sessionId', {
    refresh: SESSION_LIST_REFRESH
  })
  const { trigger: deleteManyTrigger } = useMutation('DELETE', '/agent-sessions', {
    refresh: [...SESSION_LIST_REFRESH, '/agent-workspaces', '/pins', '/agent-channels']
  })
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await deleteTrigger({ params: { sessionId: id } })
        closeConversationTabs('agents', [id])
        return true
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [closeConversationTabs, deleteTrigger, t]
  )

  const deleteSessions = useCallback(
    async (ids: string[]): Promise<DeleteAgentSessionsResult | null> => {
      try {
        const result = await deleteManyTrigger({ query: { ids: ids.join(',') } })
        closeConversationTabs('agents', result.deletedIds)
        return result
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return null
      }
    },
    [closeConversationTabs, deleteManyTrigger, t]
  )

  const reorderSessions = useCallback(
    async (reorderedList: AgentSessionEntity[]) => {
      try {
        await applyReorderedList(reorderedList as unknown as Array<Record<string, unknown>>)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
      }
    },
    [applyReorderedList, t]
  )

  const { trigger: reorderTrigger } = useMutation('PATCH', '/agent-sessions/:id/order', {
    refresh: [SESSION_LIST_RESET]
  })
  const reorderSession = useCallback(
    async (id: string, anchor: OrderRequest): Promise<boolean> => {
      try {
        await reorderTrigger({ params: { id }, body: anchor })
        return true
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
        return false
      }
    },
    [reorderTrigger, t]
  )

  const { pin: pinTrigger, unpin: unpinTrigger } = usePinMutations('session')
  const togglePin = useCallback(
    async (sessionId: string, projectedPinId?: string | null) => {
      const pinId = projectedPinId === undefined ? pinIdBySessionId.get(sessionId) : projectedPinId
      try {
        if (pinId) {
          await unpinTrigger(pinId)
        } else {
          await pinTrigger(sessionId)
        }
        return true
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.session.pin.error.failed')))
        return false
      }
    },
    [pinIdBySessionId, pinTrigger, unpinTrigger, t]
  )

  return {
    sessions,
    pages,
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
    togglePin
  }
}

/**
 * Raw session create/delete for surfaces that don't mount a session list
 * (e.g. AgentPage's create/reuse flows). Owns the cache-refresh contract so
 * callers never hand-roll invalidation; activation, toasts and error UX stay
 * with the caller.
 */
export function useSessionMutations() {
  const invalidate = useInvalidateCache()
  const closeConversationTabs = useCloseConversationTabs()

  // Refresh is fired without awaiting so callers can activate the created
  // session immediately; a failed refresh only delays list freshness.
  const createSession = useCallback(
    async (body: CreateAgentSessionDto): Promise<AgentSessionEntity> => {
      const session = await dataApiService.post('/agent-sessions', { body })
      void invalidate([...SESSION_LIST_REFRESH, '/agent-workspaces', `/agent-sessions/${session.id}`]).catch((err) => {
        logger.warn('Failed to refresh session caches after create', err as Error, { sessionId: session.id })
      })
      return session
    },
    [invalidate]
  )

  const deleteSessions = useCallback(
    async (sessionIds: string[]): Promise<void> => {
      if (sessionIds.length === 0) return
      await dataApiService.delete('/agent-sessions', { query: { ids: sessionIds.join(',') } })
      closeConversationTabs('agents', sessionIds)
      await invalidate([
        ...SESSION_LIST_REFRESH,
        '/agent-workspaces',
        ...sessionIds.map((sessionId) => `/agent-sessions/${sessionId}`)
      ])
    },
    [closeConversationTabs, invalidate]
  )

  return { createSession, deleteSessions }
}

/**
 * Patch session-level fields (`name`, `description`, `agentId`). Config fields
 * (model, instructions, configuration, ...) live on the parent agent — use
 * {@link import('./useAgent').useUpdateAgent} for those. The workspace binding
 * is changed separately via {@link setSessionWorkspace} (only while empty).
 */
export const useUpdateSession = () => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agent-sessions/:sessionId', {
    // `args.params.sessionId` is always supplied by `updateSession` below.
    // The non-null assertion mirrors useTopic.ts and crashes loud
    // if the contract is ever broken instead of silently producing
    // '/agent-sessions/undefined' (which would miss every cache entry).
    refresh: ({ args }) => [...SESSION_LIST_REFRESH, `/agent-sessions/${args!.params.sessionId}` as ConcreteApiPaths]
  })
  const { trigger: setWorkspaceTrigger } = useMutation('PUT', '/agent-sessions/:sessionId/workspace', {
    // Switching workspace creates/deletes a backing system workspace row, so
    // refresh the workspace list alongside the session caches.
    refresh: ({ args }) => [
      ...SESSION_LIST_REFRESH,
      `/agent-sessions/${args!.params.sessionId}` as ConcreteApiPaths,
      '/agent-workspaces'
    ]
  })

  const updateSession = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({ params: { sessionId: id }, body: patch })
        if (options?.showSuccessToast ?? true) {
          toast.success(t('common.update_success'))
        }
        return result
      } catch (error) {
        toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [updateTrigger, t]
  )

  /**
   * Replace a session's workspace. Backend rejects this once the session has
   * any message (only empty sessions may rebind), so callers should gate on an
   * untouched session.
   */
  const setSessionWorkspace = useCallback(
    async (id: string, workspace: SetAgentSessionWorkspaceDto): Promise<AgentSessionEntity | undefined> => {
      try {
        return await setWorkspaceTrigger({ params: { sessionId: id }, body: workspace })
      } catch (error) {
        toast.error({ title: t('agent.session.update.error.failed'), description: getErrorMessage(error) })
        return undefined
      }
    },
    [setWorkspaceTrigger, t]
  )

  return { updateSession, setSessionWorkspace }
}

/**
 * Listens for `ai.agent_session_auto_renamed` and invalidates the
 * renamed session's SWR cache so the new name appears without manual refetch.
 */
export function useAgentSessionAutoRenameSync() {
  const invalidate = useInvalidateCache()

  useIpcOn(
    'ai.agent_session_auto_renamed',
    ({ sessionId }) => void invalidate([...SESSION_LIST_REFRESH, `/agent-sessions/${sessionId}`])
  )
}
