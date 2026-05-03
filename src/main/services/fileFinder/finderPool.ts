/**
 * Per-basePath cache of `FileFinder` instances.
 *
 * `@ff-labs/fff-node` runs an initial filesystem scan + builds an
 * in-memory frecency / content index when a finder is created — first
 * call to a given basePath is slow; subsequent calls reuse the indexed
 * state. We back the cache with `CacheService` (main-process internal
 * tier) so the lifecycle container owns the storage; on app stop,
 * `CacheService.onStop` drops the entries and process exit reclaims
 * the native bindings.
 */

import { application } from '@application'
import { FileFinder } from '@ff-labs/fff-node'
import { loggerService } from '@logger'

const logger = loggerService.withContext('finderPool')
const SCAN_TIMEOUT_MS = 10_000
const KEY_PREFIX = 'fileFinder.instance.'

/**
 * Get or lazy-create a FileFinder for `basePath`. The promise resolves
 * after the initial scan completes (or hits SCAN_TIMEOUT_MS). Concurrent
 * callers share the same in-flight promise — no double-scan.
 */
export async function getFinder(basePath: string): Promise<FileFinder> {
  const cache = application.get('CacheService')
  const key = `${KEY_PREFIX}${basePath}`

  const cached = cache.get<Promise<FileFinder>>(key)
  if (cached) return cached

  const promise = (async () => {
    const result = FileFinder.create({ basePath, aiMode: true })
    if (!result.ok) {
      throw new Error(`FileFinder.create failed for ${basePath}: ${result.error}`)
    }
    const scan = await result.value.waitForScan(SCAN_TIMEOUT_MS)
    if (!scan.ok) {
      result.value.destroy()
      throw new Error(`Initial scan failed for ${basePath}: ${scan.error}`)
    }
    return result.value
  })()

  // Cache the promise even before it resolves so concurrent callers share.
  // On rejection, evict so the next call can retry from a clean slot.
  cache.set(key, promise)
  promise.catch((err) => {
    logger.warn('finder init failed; evicting from cache', { basePath, error: String(err) })
    cache.delete(key)
  })
  return promise
}
