import { useQuery } from '@data/hooks/useDataApi'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

/**
 * Subscribe to a job's live state in the renderer.
 *
 * Primary source: shared cache key `jobs.state.${jobId}`. JobManager publishes
 * a fresh snapshot on every state transition (pending → running → completed /
 * failed / cancelled) and on progress reports; cross-window sync is provided
 * by CacheService.
 *
 * Fallback: DataApi GET `/jobs/:id`. Activates when the cache is empty (cold
 * load on mount, or after the 60s cache TTL elapses post-terminal). Once the
 * cache populates, useQuery's `enabled` flips off and the cache takes over as
 * the realtime source again.
 *
 * Phase 1 behavior:
 *   - First render with cold cache: `data` undefined until DataApi resolves,
 *     `isLoading` true.
 *   - During execution: `data` updates on each cache push from main.
 *   - Post-terminal + cache evicted (>60s): DataApi refetches from DB so the
 *     terminal snapshot stays observable until GC deletes the row.
 *   - Post-GC: 404 from DataApi → `error` set, `data` null.
 */
export interface UseJobResult {
  data: JobSnapshot | null
  isTerminal: boolean
  isLoading: boolean
  error: Error | undefined
}

const TERMINAL_STATUSES: ReadonlySet<JobSnapshot['status']> = new Set(['completed', 'failed', 'cancelled'])

export function useJob(jobId: string): UseJobResult {
  const [cacheSnapshot] = useSharedCache(`jobs.state.${jobId}` as const)
  const path = `/jobs/${jobId}` as const
  const {
    data: apiSnapshot,
    isLoading,
    error
  } = useQuery(path, {
    enabled: cacheSnapshot == null
  })

  const data = cacheSnapshot ?? apiSnapshot ?? null
  const isTerminal = data ? TERMINAL_STATUSES.has(data.status) : false
  return { data, isTerminal, isLoading, error }
}
