import { useEffect, useMemo, useState } from 'react'

import { loggerService } from '@logger'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { debounce } from '@shared/utils/async'

const logger = loggerService.withContext('useTaskDashboard')

export function useTaskDashboard(enabled: boolean) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
  const query = useQuery('/agent-task-dashboard', {
    query: { group: 'running', cursor: cursors.at(-1) },
    enabled,
    swrOptions: { keepPreviousData: false }
  })
  const { refetch } = query
  const refresh = useMemo(
    () =>
      debounce(
        () => {
          if (enabled) void refetch().catch((error) => logger.warn('Failed to refresh dashboard', error))
        },
        250,
        { maxWait: 1000 }
      ),
    [enabled, refetch]
  )
  useDataChange('/agent-task-dashboard', () => refresh())
  useEffect(() => () => refresh.cancel(), [refresh])
  return {
    ...query,
    items: query.data?.items ?? [],
    total: query.data?.totals.running ?? 0,
    page: cursors.length,
    hasPrev: cursors.length > 1,
    hasNext: !!query.data?.nextCursor,
    prev: () => setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    next: () => {
      if (query.data?.nextCursor) setCursors((current) => [...current, query.data!.nextCursor])
    }
  }
}
