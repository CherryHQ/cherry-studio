import { useEffect, useState } from 'react'

import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_TASK_DASHBOARD_CACHE_KEY, DASHBOARD_PAGE_SIZE } from '@shared/ai/agentTaskDashboard'

export function useTaskDashboard() {
  const entries = useSharedCacheValue(AGENT_TASK_DASHBOARD_CACHE_KEY)
  const [requestedPage, setPage] = useState(1)
  const total = entries?.length ?? 0
  const lastPage = Math.max(1, Math.ceil(total / DASHBOARD_PAGE_SIZE))
  const page = Math.min(requestedPage, lastPage)

  useEffect(() => setPage((current) => Math.min(current, lastPage)), [lastPage])

  return {
    items: entries?.slice((page - 1) * DASHBOARD_PAGE_SIZE, page * DASHBOARD_PAGE_SIZE) ?? [],
    total,
    isLoading: entries == null,
    page,
    hasPrev: page > 1,
    hasNext: page < lastPage,
    prev: () => setPage(Math.max(1, page - 1)),
    next: () => setPage(Math.min(lastPage, page + 1))
  }
}
