import { useQuery } from '@data/hooks/useDataApi'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import type { JobProgress, JobSnapshot } from '@shared/data/api/schemas/jobs'

/**
 * Subscribe to a job's live state in the renderer.
 *
 * Primary source: shared cache key `jobs.state.${jobId}`. JobManager publishes
 * a fresh snapshot on every state transition (pending → running → completed /
 * failed / cancelled) and on progress reports; cross-window sync is provided
 * by CacheService.
 *
 * Fallback: DataApi GET `/jobs/:id`. Activates when the cache mirror is
 * physically empty (cold load on mount, or after Main's deletion tombstone
 * evicts the expired entry post-terminal — on Main's next read of the key or
 * its GC sweep, so up to TTL + 10 min, not at the TTL instant). Once the
 * cache populates, useQuery's `enabled` flips off and the cache takes over as
 * the realtime source again.
 *
 * Phase 1 behavior:
 *   - First render with cold cache: `data` undefined until DataApi resolves,
 *     `isLoading` true.
 *   - During execution: `data` updates on each cache push from main.
 *   - Post-terminal + mirror tombstoned: DataApi refetches from DB so the
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
  // Read-only observer: main owns this key. A cache miss stays undefined
  // (no schema-default write-back), which is exactly what enables the
  // DataApi fallback below.
  const cacheSnapshot = useSharedCacheValue(`jobs.state.${jobId}` as const)
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

/**
 * Subscribe to a job's live progress in the renderer.
 *
 * Source: shared cache key `jobs.progress.${jobId}`. JobManager publishes a
 * fresh JobProgress on every `ctx.reportProgress(...)` call from a handler
 * (TTL 60s). Cross-window sync is provided by CacheService.
 *
 * Cold-start: falls back to the local `EMPTY_JOB_PROGRESS` on cache miss so
 * callers can render directly without null-guarding. The fallback stays local
 * to this observer — it is never written back into the cache.
 *
 * Pair with `useJob(jobId)` for full state + progress observation:
 *   const { data, isTerminal } = useJob(jobId)
 *   const { progress, detail } = useJobProgress(jobId)
 *
 * Why no DataApi fallback (unlike `useJob`): progress is NOT persisted —
 * JobManager.reportProgress writes only the shared cache (60s TTL). After
 * cache eviction the value resets to `{ progress: 0 }`. For terminal-state
 * progress observability use the snapshot's status / output instead.
 */
const EMPTY_JOB_PROGRESS: JobProgress = { progress: 0 }

export function useJobProgress(jobId: string): JobProgress {
  return useSharedCacheValue(`jobs.progress.${jobId}` as const) ?? EMPTY_JOB_PROGRESS
}
