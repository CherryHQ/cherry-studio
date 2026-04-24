import { dataApiService } from '@data/DataApiService'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import type {
  AgentSessionEntity,
  CreateAgentSessionResponse,
  CreateSessionForm,
  GetAgentSessionResponse
} from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity as DataApiSessionEntity } from '@shared/data/api/schemas/agents'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { useSessionChanged } from './useSessionChanged'

const DEFAULT_SESSION_PAGE_SIZE = 20

// Internal page type using the DataAPI schema entity (configuration: Record<string, unknown>)
type SessionsPage = {
  items: DataApiSessionEntity[]
  total: number
  limit: number
  offset: number
}

export const useSessions = (agentId: string | null, pageSize = DEFAULT_SESSION_PAGE_SIZE) => {
  const { t } = useTranslation()

  const getKey = (pageIndex: number, previousPageData: SessionsPage | null) => {
    if (!agentId) return null
    if (previousPageData && previousPageData.items.length < pageSize) return null
    return [`/agents/${agentId}/sessions`, pageIndex, pageSize]
  }

  const fetcher = async ([path, pageIndex, pageLimit]: [string, number, number]) => {
    return dataApiService.get(path as never, {
      query: {
        limit: pageLimit,
        offset: pageIndex * pageLimit
      }
    }) as Promise<SessionsPage>
  }

  const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite(getKey, fetcher)

  const sessions = useMemo((): AgentSessionEntity[] => {
    if (!data) return []
    // Cast DataAPI session entity (configuration: Record<string, unknown>) to renderer
    // AgentSessionEntity — callers that need typed configuration use AgentConfigurationSchema.parse()
    return data.flatMap((page) => page.items) as unknown as AgentSessionEntity[]
  }, [data])

  const total = useMemo(() => {
    if (!data || data.length === 0) return 0
    return data[data.length - 1].total
  }, [data])

  const hasMore = sessions.length < total
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === 'undefined')

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      void setSize((currentSize) => currentSize + 1)
    }
  }, [isLoadingMore, hasMore, setSize])

  const reload = useCallback(async () => {
    await mutate()
  }, [mutate])

  // Auto-refresh when IM channel creates/updates sessions
  useSessionChanged(agentId ?? undefined, reload)

  const { trigger: createTrigger } = useMutation('POST', '/agents/:agentId/sessions', {
    refresh: ({ args }) => [`/agents/${args?.params?.agentId}/sessions`]
  })
  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = await createTrigger({ params: { agentId }, body: form })
        void mutate(
          (prev) => {
            if (!prev || prev.length === 0) {
              return [{ items: [result], total: 1, limit: pageSize, offset: 0 }]
            }
            const newTotal = prev[0].total + 1
            return prev.map((page, i) => ({
              ...page,
              items: i === 0 ? [result, ...page.items] : page.items,
              total: newTotal
            }))
          },
          { revalidate: false }
        )
        return result as unknown as CreateAgentSessionResponse
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, createTrigger, mutate, pageSize, t]
  )

  const getSession = useCallback(
    async (id: string): Promise<GetAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = (await dataApiService.get(
          `/agents/${agentId}/sessions/${id}`
        )) as unknown as GetAgentSessionResponse
        void mutate(
          (prev) =>
            prev?.map((page) => ({
              ...page,
              items: page.items.map((session) =>
                session.id === result.id ? (result as unknown as DataApiSessionEntity) : session
              )
            })),
          { revalidate: false }
        )
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.get.error.failed')))
        return null
      }
    },
    [agentId, mutate, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agents/:agentId/sessions/:sessionId', {
    refresh: ({ args }) => [`/agents/${args?.params?.agentId}/sessions`]
  })
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (!agentId) return false
      try {
        await deleteTrigger({ params: { agentId, sessionId: id } })
        void mutate(
          (prev) => {
            if (!prev || prev.length === 0) return prev
            const newTotal = prev[0].total - 1
            return prev.map((page) => ({
              ...page,
              items: page.items.filter((session) => session.id !== id),
              total: newTotal
            }))
          },
          { revalidate: false }
        )
        return true
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.delete.error.failed')))
        return false
      }
    },
    [agentId, deleteTrigger, mutate, t]
  )

  const reorderSessions = useCallback(
    async (reorderedList: AgentSessionEntity[]) => {
      if (!agentId) return
      const orderedIds = reorderedList.map((s) => s.id)
      // Optimistic update: replace all pages with single page containing reordered list
      void mutate(
        (prev) => {
          const realTotal = prev && prev.length > 0 ? prev[prev.length - 1].total : reorderedList.length
          return [
            { items: reorderedList as unknown as DataApiSessionEntity[], total: realTotal, limit: pageSize, offset: 0 }
          ]
        },
        { revalidate: false }
      )
      try {
        await window.api.agent.reorderSessions(agentId, orderedIds)
      } catch (error) {
        void mutate()
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
      }
    },
    [agentId, mutate, pageSize, t]
  )

  return {
    sessions,
    total,
    hasMore,
    error,
    isLoading,
    isLoadingMore,
    isValidating,
    reload,
    loadMore,
    createSession,
    getSession,
    deleteSession,
    reorderSessions
  }
}
