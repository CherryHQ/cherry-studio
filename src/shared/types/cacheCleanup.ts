import type { OutputFor } from '../ipc/types'

export const CACHE_CLEANUP_GROUPS = [
  'normal_cache',
  'site_data',
  'orphaned_data',
  'legacy_v1',
  'restore_staging'
] as const

export type CacheCleanupGroup = (typeof CACHE_CLEANUP_GROUPS)[number]

export const CACHE_CLEANUP_SIZE_ACCURACIES = ['exact', 'estimated', 'unavailable'] as const
export type CacheCleanupSizeAccuracy = (typeof CACHE_CLEANUP_SIZE_ACCURACIES)[number]

export const CACHE_CLEANUP_SIZE_COMPLETENESS = ['complete', 'partial'] as const

export const CACHE_CLEANUP_RESULT_STATUSES = ['cleared', 'not_found', 'partial', 'skipped', 'failed'] as const

export type CacheCleanupInspection = OutputFor<'app.cache_cleanup.inspect'>
export type CacheCleanupGroupInspection = CacheCleanupInspection['results'][number]
export type CacheCleanupSizeSnapshot = CacheCleanupGroupInspection['size']
export type CacheCleanupRunResult = OutputFor<'app.cache_cleanup.run'>
export type CacheCleanupGroupResult = CacheCleanupRunResult['results'][number]
