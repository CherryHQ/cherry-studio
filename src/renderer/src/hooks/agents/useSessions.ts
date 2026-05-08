import { dataApiService } from '@data/DataApiService'
import { useMutation, usePaginatedQuery } from '@renderer/data/hooks/useDataApi'
import { useReorder } from '@renderer/data/hooks/useReorder'
import type {
  AgentSessionEntity,
  CreateAgentSessionResponse,
  CreateSessionForm,
  GetAgentSessionResponse
} from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity as DataApiSessionEntity } from '@shared/data/api/schemas/agents'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_SESSION_PAGE_SIZE = 20

const toRendererSession = (session: DataApiSessionEntity): AgentSessionEntity =>
  session as unknown as AgentSessionEntity

export const useSessions = (agentId: string | null, pageSize = DEFAULT_SESSION_PAGE_SIZE) => {
  const { t } = useTranslation()
  const { applyReorderedList } = useReorder(`/agents/${agentId ?? ''}/sessions` as `/agents/${string}/sessions`)
  const [loadedSessions, setLoadedSessions] = useState<AgentSessionEntity[]>([])

  const { items, total, page, error, isLoading, isRefreshing, hasNext, nextPage, refresh, reset } = usePaginatedQuery(
    '/agents/:agentId/sessions',
    {
      params: { agentId: agentId ?? '' },
      limit: pageSize,
      enabled: !!agentId,
      swrOptions: { keepPreviousData: false }
    }
  )
  const resetRef = useRef(reset)
  resetRef.current = reset

  useEffect(() => {
    setLoadedSessions([])
    resetRef.current()
  }, [agentId, pageSize])

  useEffect(() => {
    if (!agentId) return

    const pageSessions = items.map(toRendererSession)
    setLoadedSessions((prev) => {
      if (page <= 1) return pageSessions

      const pageIds = new Set(pageSessions.map((session) => session.id))
      return [...prev.filter((session) => !pageIds.has(session.id)), ...pageSessions]
    })
  }, [agentId, items, page])

  const sessions = useMemo(() => loadedSessions, [loadedSessions])
  const hasMore = hasNext
  const isLoadingMore = isRefreshing && page > 1

  const reload = useCallback(async () => {
    setLoadedSessions([])
    resetRef.current()
    await refresh()
  }, [refresh])

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      nextPage()
    }
  }, [hasMore, isLoadingMore, nextPage])

  const { trigger: createTrigger } = useMutation('POST', '/agents/:agentId/sessions', {
    refresh: ({ args }) => [`/agents/${args?.params?.agentId}/sessions`]
  })
  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = await createTrigger({ params: { agentId }, body: form })
        const session = toRendererSession(result)
        setLoadedSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
        return result as unknown as CreateAgentSessionResponse
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, createTrigger, t]
  )

  const getSession = useCallback(
    async (id: string): Promise<GetAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = (await dataApiService.get(
          `/agents/${agentId}/sessions/${id}`
        )) as unknown as GetAgentSessionResponse
        setLoadedSessions((prev) =>
          prev.map((session) => (session.id === result.id ? (result as unknown as AgentSessionEntity) : session))
        )
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.get.error.failed')))
        return null
      }
    },
    [agentId, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agents/:agentId/sessions/:sessionId', {
    refresh: ({ args }) => [`/agents/${args?.params?.agentId}/sessions`]
  })
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (!agentId) return false
      try {
        await deleteTrigger({ params: { agentId, sessionId: id } })
        setLoadedSessions((prev) => prev.filter((session) => session.id !== id))
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [agentId, deleteTrigger, t]
  )

  const reorderSessions = useCallback(
    async (reorderedList: AgentSessionEntity[]) => {
      if (!agentId) return
      try {
        await applyReorderedList(reorderedList as unknown as Array<Record<string, unknown>>)
        // Sync the local cumulative buffer with the new order so the UI matches the cache.
        setLoadedSessions(reorderedList)
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
      }
    },
    [agentId, applyReorderedList, t]
  )

  return {
    sessions,
    total,
    hasMore,
    error,
    isLoading,
    isLoadingMore,
    isValidating: isRefreshing,
    reload,
    loadMore,
    createSession,
    getSession,
    deleteSession,
    reorderSessions
  }
}
