/**
 * DataApi-backed session queries and mutations.
 *
 * Sessions are pure agent instances — only `id / agentId / name / description /
 * orderKey / timestamps` live here. For config (model / instructions /
 * configuration / ...) call {@link import('./useAgentDataApi').useAgent}
 * with `session.agentId`.
 *
 * Companion hooks for derived/lifecycle state (not CRUD):
 *  - {@link import('./useActiveSession').useActiveSession}
 *  - {@link import('./useCreateDefaultSession').useCreateDefaultSession}
 *  - {@link import('./useAgentSessionInitializer').useAgentSessionInitializer}
 *  - {@link import('./useAgentSessionSync').useAgentSessionSync}
 */

import { useInfiniteFlatItems, useInfiniteQuery, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import type { CreateSessionForm, UpdateSessionForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentSessionFunction } from '@renderer/types/agent'
import { getErrorMessage } from '@renderer/utils/error'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_SESSION_PAGE_SIZE = 20

/**
 * Fetch a single session by id. Config (model / instructions / ...) lives on
 * the parent agent — fetch via `useAgent(session.agentId)` separately.
 */
export const useSession = (agentId: string | null, sessionId: string | null) => {
  const {
    data: session,
    error,
    isLoading,
    mutate
  } = useQuery('/sessions/:sessionId', {
    params: { sessionId: sessionId! },
    enabled: !!sessionId,
    swrOptions: { keepPreviousData: false }
  })
  const { updateSession } = useUpdateSession(agentId)

  return { session, error, isLoading, updateSession, mutate }
}

/**
 * Cursor-paginated session list. With `agentId` undefined / null the result
 * spans every agent (the global session view); pass an id to scope the
 * listing. Reorder uses the same cache key so applying a new order syncs the
 * infinite-query view.
 */
export const useSessions = (agentId?: string | null, pageSize = DEFAULT_SESSION_PAGE_SIZE) => {
  const { t } = useTranslation()

  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/sessions', {
    query: agentId ? { agentId } : undefined,
    limit: pageSize
  })
  // Cache key includes the query, so reorder operates on the same key.
  const { applyReorderedList } = useReorder('/sessions')

  const flatSessions = useInfiniteFlatItems(pages)
  const { data: pinList } = useQuery('/pins', { query: { entityType: 'session' } })
  const pinIdBySessionId = useMemo(
    () => new Map(Array.isArray(pinList) ? pinList.map((p) => [p.entityId, p.id] as const) : []),
    [pinList]
  )
  // Pinned-first sort; preserves orderKey order within each section. Sessions
  // already arrive ordered by `(orderKey, id)` from the server, so a stable
  // partition is enough — no need to re-sort within a section.
  const sessions = useMemo(() => {
    const pinned: AgentSessionEntity[] = []
    const unpinned: AgentSessionEntity[] = []
    for (const s of flatSessions) {
      ;(pinIdBySessionId.has(s.id) ? pinned : unpinned).push(s)
    }
    return [...pinned, ...unpinned]
  }, [flatSessions, pinIdBySessionId])
  const total = sessions.length
  const hasMore = hasNext
  const isLoadingMore = isRefreshing && pages.length > 1

  const reload = useCallback(() => refresh(), [refresh])

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      loadNext()
    }
  }, [hasMore, isLoadingMore, loadNext])

  const { trigger: createTrigger } = useMutation('POST', '/sessions', { refresh: ['/sessions'] })
  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<AgentSessionEntity | null> => {
      if (!agentId) return null
      try {
        const result = await createTrigger({ body: { agentId, name: form.name, description: form.description } })
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, createTrigger, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/sessions/:sessionId', { refresh: ['/sessions'] })
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

  const { trigger: pinTrigger } = useMutation('POST', '/pins', { refresh: ['/pins'] })
  const { trigger: unpinTrigger } = useMutation('DELETE', '/pins/:id', { refresh: ['/pins'] })
  const togglePin = useCallback(
    async (sessionId: string) => {
      const pinId = pinIdBySessionId.get(sessionId)
      try {
        if (pinId) {
          await unpinTrigger({ params: { id: pinId } })
        } else {
          await pinTrigger({ body: { entityType: 'session', entityId: sessionId } })
        }
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.pin.error.failed')))
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
    reorderSessions,
    togglePin
  }
}

/**
 * Patch session-level fields (only `name`, `description`). Config fields
 * (model, instructions, configuration, ...) live on the parent agent — use
 * {@link import('./useAgentDataApi').useUpdateAgent} for those.
 */
export const useUpdateSession = (agentId: string | null) => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/sessions/:sessionId', {
    refresh: ({ args }) => ['/sessions', `/sessions/${args?.params?.sessionId}`]
  })

  const updateSession: UpdateAgentSessionFunction = useCallback(
    async (form: UpdateSessionForm, options?: UpdateAgentBaseOptions): Promise<AgentSessionEntity | undefined> => {
      if (!agentId) return
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
    [agentId, updateTrigger, t]
  )

  return { updateSession }
}
