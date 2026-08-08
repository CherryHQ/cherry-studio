export const CACHE_CLEANUP_GROUPS = ['normal_cache', 'site_data', 'orphaned_data', 'legacy_v1'] as const

export type CacheCleanupGroup = (typeof CACHE_CLEANUP_GROUPS)[number]

export const CACHE_CLEANUP_SIZE_ACCURACIES = ['exact', 'estimated', 'unavailable'] as const
export type CacheCleanupSizeAccuracy = (typeof CACHE_CLEANUP_SIZE_ACCURACIES)[number]

export const CACHE_CLEANUP_SIZE_COMPLETENESS = ['complete', 'partial'] as const

export const CACHE_CLEANUP_RESULT_STATUSES = ['cleared', 'not_found', 'partial', 'skipped', 'failed'] as const
