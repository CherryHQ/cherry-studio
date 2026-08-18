/**
 * DataApi-backed session queries and mutations.
 *
 * Sessions are pure agent instances — only `id / agentId / name / description /
 * orderKey / timestamps` live here. For config (model / instructions /
 * configuration / ...) call {@link import('./useAgent').useAgent}
 * with `session.agentId`.
 */

import { createInfiniteQueryRetentionMiddleware } from '@renderer/data/hooks/createInfiniteQueryRetentionMiddleware'
import {
  useDataChange,
  useInfiniteFlatItems,
  useInfiniteQuery,
  useInvalidateCache,
  useMutation,
  useQuery
} from '@renderer/data/hooks/useDataApi'
import { useCloseConversationTabs } from '@renderer/hooks/tab'
import { useStructurallySharedItems } from '@renderer/hooks/useStructurallySharedItems'
import { useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { UpdateAgentBaseOptions } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix, getErrorMessage } from '@renderer/utils/error'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  AgentSessionSearchScope,
  AgentSessionSortBy,
  AgentSessionStatsQuery,
  AgentSessionWorkspaceScope,
  DeleteAgentSessionsResult,
  SetAgentSessionWorkspaceDto,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_SESSION_PAGE_SIZE = 20

/** Canonical session-list write refresh. */
const SESSION_LIST_REFRESH: ConcreteApiPaths[] = ['/agent-sessions', '/agent-sessions/stats']
export type AgentSessionSource = 'query' | 'pending' | 'none'
type UseSessionsOptions = {
  pageSize?: number
  enabled?: boolean
  /** Ordinary-stream sort profile; defaults to recent activity and is ignored for pinned rows. */
  sortBy?: AgentSessionSortBy
  /** Literal substring search term (server-side, escaped LIKE). */
  q?: string
  /** 'name' (default) or 'name-or-owner' (session name OR live owning agent name). */
  searchScope?: AgentSessionSearchScope
  /** true selects pinned rows; false selects ordinary rows. */
  pinned: boolean
  /** Concrete user workspace id, or the aggregate system/no-workdir scope. */
  workspaceId?: AgentSessionWorkspaceScope
  retainInactive?: boolean
}

const sessionGroupRetentionMiddleware = createInfiniteQueryRetentionMiddleware({
  idleTtlMs: 10 * 60_000,
  maxInactiveGroups: 8,
  maxInactivePages: 24,
  releaseDelayMs: 1_000
})

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

  useDataChange('/agent-sessions/:sessionId', (effects) => {
    if (sessionId && effects.some((effect) => !effect.entityIds || effect.entityIds.includes(sessionId))) {
      void mutate()
    }
  })

  return { session, error, isLoading }
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

  useDataChange('/agent-sessions/stats', () => {
    if (opts?.enabled !== false) void refetch()
  })

  return { stats: data, isLoading, error, refetch }
}

export interface UseActiveSessionOptions {
  /** External source of truth for the active session id (e.g. URL search). */
  activeSessionId: string | null
  /** Write back when callers select a different session. */
  setActiveSessionId: (id: string | null) => void
  /**
   * Optimistic session to paint before its by-id query resolves (e.g. a matching row from the
   * already-loaded session list). This value may arrive after mount; the by-id query remains
   * canonical and a not-found response disables this fallback.
   */
  initialSession?: AgentSessionEntity | null
}

/**
 * Resolves the active session (query-backed, with an optimistic fallback) and owns the pending
 * session itself — mirroring {@link import('@renderer/hooks/useTopic').useActiveTopic}. Callers pass
 * `activeSessionId` + `setActiveSessionId`, may provide a list-backed `initialSession`, and drive
 * selection through `setActiveSession` / `selectSession` / `clearActiveSession`; the hook keeps
 * explicitly selected pending entities in `useState` so stale optimistic state is ignored via the
 * id match rather than eagerly nulled at every call site.
 */
export const useActiveSession = ({ activeSessionId, setActiveSessionId, initialSession }: UseActiveSessionOptions) => {
  const result = useSession(activeSessionId)
  const [pendingSession, setPendingSession] = useState<AgentSessionEntity | null>(null)

  // NOT_FOUND is authoritative even if SWR still exposes cached data or the caller has an
  // optimistic entity. Otherwise a concurrently deleted session can be resurrected indefinitely.
  const isNotFound = isDataApiNotFoundError(result.error)
  const querySession =
    !isNotFound && activeSessionId && result.session?.id === activeSessionId ? result.session : undefined
  // Only a pending session whose id matches the active id resolves; a leftover one is inert (never
  // returned, never counted as the source), so no path has to null it out to stay correct.
  const resolvedPendingSession =
    !isNotFound && activeSessionId && pendingSession?.id === activeSessionId ? pendingSession : undefined
  // Unlike an explicitly selected pending entity, a list-backed fallback is caller-owned and may
  // arrive after this hook mounts. Resolve it directly instead of copying it into state. A
  // not-found response proves the list snapshot is stale; transient failures do not.
  const resolvedInitialSession =
    !isNotFound && activeSessionId && initialSession?.id === activeSessionId ? initialSession : undefined
  const fallbackSession = resolvedPendingSession ?? resolvedInitialSession
  const session = querySession ?? fallbackSession
  const sessionSource: AgentSessionSource = querySession ? 'query' : fallbackSession ? 'pending' : 'none'

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
    session,
    sessionSource,
    isLoading: !session && result.isLoading,
    error: result.error,
    setActiveSession,
    selectSession,
    clearActiveSession,
    setPendingSession
  }
}

/**
 * Cursor-paginated session list. With `agentId` undefined / null the result
 * spans every agent (the global session view); pass an id to scope the
 * listing. Flat sort profiles include immutable creation order (`createdAt`),
 * activity order (`lastActivityAt`), and manual order (`orderKey`). Consumers
 * page explicitly with `loadMore()`.
 */
export const useSessions = (agentId: string | null | undefined, options: UseSessionsOptions) => {
  const pageSize = options.pageSize ?? DEFAULT_SESSION_PAGE_SIZE
  const enabled = options.enabled
  const sortBy = options.sortBy
  const q = options.q?.trim() || undefined
  const searchScope = options.searchScope
  const pinned = options.pinned
  const workspaceId = options.workspaceId
  const effectiveSortBy = pinned ? undefined : sortBy

  const query = useMemo(() => {
    const built: {
      agentId?: string
      sortBy?: AgentSessionSortBy
      q?: string
      searchScope?: AgentSessionSearchScope
      pinned: boolean
      workspaceId?: AgentSessionWorkspaceScope
    } = { pinned }
    if (agentId) built.agentId = agentId
    if (effectiveSortBy) built.sortBy = effectiveSortBy
    if (q) built.q = q
    if (q && searchScope) built.searchScope = searchScope
    if (workspaceId !== undefined) built.workspaceId = workspaceId
    return built
  }, [agentId, effectiveSortBy, pinned, q, searchScope, workspaceId])

  const { pages, isLoading, isLoadingMore, isRefreshing, error, hasNext, loadNext, refresh, reset } = useInfiniteQuery(
    '/agent-sessions',
    {
      query,
      limit: pageSize,
      enabled,
      swrOptions: {
        revalidateAll: false,
        revalidateFirstPage: true,
        ...(options.retainInactive ? { use: [sessionGroupRetentionMiddleware] } : {})
      }
    }
  )
  useDataChange('/agent-sessions', () => {
    if (enabled !== false) void refresh()
  })

  const flatSessions = useInfiniteFlatItems(pages)
  const sessions = useStructurallySharedItems(flatSessions)
  const hasMore = hasNext

  const reload = useCallback(() => refresh(), [refresh])

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadNext()
    }
  }, [hasMore, isLoadingMore, loadNext])

  return {
    sessions,
    hasMore,
    error,
    isLoading,
    isLoadingMore,
    isValidating: isRefreshing,
    reload,
    loadMore,
    reset
  }
}

/** Session-list writes, mounted only by surfaces that expose these actions. */
export function useSessionMutations() {
  const { t } = useTranslation()
  const closeConversationTabs = useCloseConversationTabs()
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

  const { trigger: reorderTrigger } = useMutation('PATCH', '/agent-sessions/:id/order', {
    refresh: ['/agent-sessions']
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

  return { deleteSession, deleteSessions, reorderSession }
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
 * Listens for `ai.agent.session.auto_renamed` and invalidates the
 * renamed session's SWR cache so the new name appears without manual refetch.
 */
export function useAgentSessionAutoRenameSync() {
  const invalidate = useInvalidateCache()

  useIpcOn(
    'ai.agent.session.auto_renamed',
    ({ sessionId }) => void invalidate([...SESSION_LIST_REFRESH, `/agent-sessions/${sessionId}`])
  )
}
