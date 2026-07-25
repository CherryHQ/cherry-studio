export const CACHE_CLEANUP_GROUPS = ['normal_cache', 'site_data', 'legacy_v1', 'restore_staging'] as const

export type CacheCleanupGroup = (typeof CACHE_CLEANUP_GROUPS)[number]

export const CACHE_CLEANUP_SIZE_ACCURACIES = ['exact', 'estimated', 'unavailable'] as const
export type CacheCleanupSizeAccuracy = (typeof CACHE_CLEANUP_SIZE_ACCURACIES)[number]

export const CACHE_CLEANUP_SIZE_COMPLETENESS = ['complete', 'partial'] as const
export type CacheCleanupSizeCompleteness = (typeof CACHE_CLEANUP_SIZE_COMPLETENESS)[number]

export const CACHE_CLEANUP_RESULT_STATUSES = ['cleared', 'not_found', 'partial', 'skipped', 'failed'] as const
export type CacheCleanupResultStatus = (typeof CACHE_CLEANUP_RESULT_STATUSES)[number]

export const CACHE_CLEANUP_MIGRATION_STATUSES = ['completed', 'incomplete'] as const
export type CacheCleanupMigrationStatus = (typeof CACHE_CLEANUP_MIGRATION_STATUSES)[number]

export const CACHE_CLEANUP_ISSUE_CODES = [
  'inspection_failed',
  'migration_incomplete',
  'unsafe_target',
  'invalid_data',
  'operation_failed',
  'indexeddb_blocked'
] as const

export type CacheCleanupIssueCode = (typeof CACHE_CLEANUP_ISSUE_CODES)[number]

export interface CacheCleanupIssue {
  item: string
  code: CacheCleanupIssueCode
}

export interface CacheCleanupSizeSnapshot {
  bytes: number | null
  accuracy: CacheCleanupSizeAccuracy
  completeness: CacheCleanupSizeCompleteness
  issues: CacheCleanupIssue[]
}

export interface CacheCleanupGroupInspection {
  group: CacheCleanupGroup
  size: CacheCleanupSizeSnapshot
  allowed: boolean
  blockedReason?: 'migration_incomplete'
}

export interface CacheCleanupInspection {
  migrationStatus: CacheCleanupMigrationStatus
  results: CacheCleanupGroupInspection[]
}

export interface CacheCleanupGroupResult {
  group: CacheCleanupGroup
  status: CacheCleanupResultStatus
  issues: CacheCleanupIssue[]
}

export interface CacheCleanupRunResult {
  results: CacheCleanupGroupResult[]
}
