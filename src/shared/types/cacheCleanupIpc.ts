import type { OutputFor } from '../ipc/types'

export type CacheCleanupInspection = OutputFor<'app.cache_cleanup.inspect'>
export type CacheCleanupGroupInspection = CacheCleanupInspection['results'][number]
export type CacheCleanupSizeSnapshot = CacheCleanupGroupInspection['size']
export type CacheCleanupRunResult = OutputFor<'app.cache_cleanup.run'>
export type CacheCleanupGroupResult = CacheCleanupRunResult['results'][number]
