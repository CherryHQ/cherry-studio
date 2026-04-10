import { DEFAULT_SESSION_PAGE_SIZE } from '@renderer/api/agent'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import type {
  AgentSessionEntity,
  CreateAgentSessionResponse,
  CreateSessionForm,
  GetAgentSessionResponse
} from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWRInfinite from 'swr/infinite'

import { useSessionChanged } from './useSessionChanged'

type SessionsPage = OffsetPaginationResponse<AgentSessionEntity>

export const useSessions = (agentId: string | null, pageSize = DEFAULT_SESSION_PAGE_SIZE) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const listPath = agentId ? `/agents/${agentId}/sessions` : null

  const getKey = (pageIndex: number, previousPageData: SessionsPage | null) => {
    if (!listPath) return null
    if (previousPageData && previousPageData.items.length < pageSize) return null
    return [listPath, pageIndex, pageSize] as const
  }

  const fetcher = async ([path, pageIndex, pageLimit]: readonly [`/agents/${string}/sessions`, number, number]) => {
    return (await dataApiService.get(path, {
      query: {
        page: pageIndex + 1,
        limit: pageLimit
      }
    })) as SessionsPage
  }

  const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite<SessionsPage>(getKey, fetcher)

  const sessions = useMemo(() => {
    if (!data) return []
    return data.flatMap((page) => page.items)
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
  }, [hasMore, isLoadingMore, setSize])

  const reload = useCallback(async () => {
    await mutate()
  }, [mutate])

  useSessionChanged(agentId ?? undefined, reload)

  const createSession = useCallback(
    async (form: CreateSessionForm): Promise<CreateAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = (await dataApiService.post(`/agents/${agentId}/sessions`, {
          body: form
        })) as CreateAgentSessionResponse
        void mutate(
          (prev) => {
            if (!prev || prev.length === 0) {
              return [{ items: [result], total: 1, page: 1 }]
            }

            const newTotal = prev[0].total + 1
            return prev.map((page, index) => ({
              ...page,
              items: index === 0 ? [result, ...page.items] : page.items,
              total: newTotal
            }))
          },
          { revalidate: false }
        )
        await invalidate(`/agents/${agentId}/sessions/${result.id}`)
        return result
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.create.error.failed')))
        return null
      }
    },
    [agentId, invalidate, mutate, t]
  )

  const getSession = useCallback(
    async (id: string): Promise<GetAgentSessionResponse | null> => {
      if (!agentId) return null
      try {
        const result = (await dataApiService.get(`/agents/${agentId}/sessions/${id}`)) as GetAgentSessionResponse
        void mutate(
          (prev) =>
            prev?.map((page) => ({
              ...page,
              items: page.items.map((session) => (session.id === result.id ? result : session))
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

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (!agentId) return false
      try {
        await dataApiService.delete(`/agents/${agentId}/sessions/${id}`)
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
    [agentId, mutate, t]
  )

  const reorderSessions = useCallback(
    async (reorderedList: AgentSessionEntity[]) => {
      if (!agentId || !listPath) return
      const orderedIds = reorderedList.map((s) => s.id)
      void mutate(
        (prev) => {
          const realTotal = prev && prev.length > 0 ? prev[prev.length - 1].total : reorderedList.length
          return [{ items: reorderedList, total: realTotal, page: 1 }]
        },
        { revalidate: false }
      )

      try {
        await dataApiService.patch(listPath as `/agents/${string}/sessions`, {
          body: { orderedIds }
        })
        await invalidate(listPath as `/agents/${string}/sessions`)
      } catch (error) {
        void mutate()
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.session.reorder.error.failed')))
      }
    },
    [agentId, invalidate, listPath, mutate, t]
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
