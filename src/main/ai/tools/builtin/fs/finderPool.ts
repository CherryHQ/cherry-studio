/**
 * Per-basePath cache of `FileFinder` instances.
 *
 * `@ff-labs/fff-node` runs an initial filesystem scan + builds an in-memory
 * frecency / content index when a finder is created — first call to a given
 * basePath is slow; subsequent calls reuse the indexed state. Caching at the
 * module level lets repeated `find_path` / `find_grep` calls against the
 * same project hit a warm finder.
 *
 * Cherry is single-process; one module-level Map suffices. We don't evict
 * (finders are cheap to hold; memory cost is dominated by the file count
 * which the user controls). If a real eviction need surfaces, add an LRU
 * cap here.
 */

import { FileFinder } from '@ff-labs/fff-node'
import { loggerService } from '@logger'

const logger = loggerService.withContext('finderPool')

const cache = new Map<string, Promise<FileFinder>>()
const SCAN_TIMEOUT_MS = 10_000

/**
 * Get or lazy-create a FileFinder for `basePath`. The promise resolves
 * after the initial scan completes (or hits SCAN_TIMEOUT_MS). Subsequent
 * calls return the same cached promise — concurrent callers don't double-scan.
 */
export async function getFinder(basePath: string): Promise<FileFinder> {
  const cached = cache.get(basePath)
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
  // On rejection, evict so the next call can retry.
  cache.set(basePath, promise)
  promise.catch((err) => {
    logger.warn('finder init failed; evicting from cache', { basePath, error: String(err) })
    cache.delete(basePath)
  })
  return promise
}

/**
 * Drop a basePath's finder. Safe to call without verifying presence.
 * Mainly used by tests to reset state between cases.
 */
export async function destroyFinder(basePath: string): Promise<void> {
  const cached = cache.get(basePath)
  if (!cached) return
  cache.delete(basePath)
  try {
    const finder = await cached
    if (!finder.isDestroyed) finder.destroy()
  } catch {
    // create failed; nothing to destroy
  }
}

/** Clear all cached finders. Test-only. */
export async function destroyAllFinders(): Promise<void> {
  const paths = [...cache.keys()]
  await Promise.all(paths.map((p) => destroyFinder(p)))
}
