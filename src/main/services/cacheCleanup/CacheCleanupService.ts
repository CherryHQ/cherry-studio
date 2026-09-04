import { loggerService } from '@logger'
import type { CacheCleanupGroup } from '@shared/types/cacheCleanup'
import type {
  CacheCleanupGroupInspection,
  CacheCleanupGroupResult,
  CacheCleanupInspection,
  CacheCleanupRunResult
} from '@shared/types/cacheCleanupIpc'
import { Mutex } from 'async-mutex'

import { clearDiagnosticData, inspectDiagnosticData } from './diagnosticData'
import { clearLegacyV1, inspectLegacyV1 } from './legacyV1'
import { clearOrphanedData, inspectOrphanedData } from './orphanedData'
import { clearNormalCache, clearSiteData, inspectNormalCache, inspectSiteData } from './sessionData'
import { issue, resultFromSteps, toSizeSnapshot } from './shared'

const logger = loggerService.withContext('CacheCleanup')

async function inspectGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupInspection> {
  try {
    const size =
      group === 'normal_cache'
        ? await inspectNormalCache()
        : group === 'site_data'
          ? await inspectSiteData()
          : group === 'orphaned_data'
            ? await inspectOrphanedData()
            : group === 'logs'
              ? await inspectDiagnosticData()
              : await inspectLegacyV1()
    return { group, size }
  } catch (error) {
    logger.error('Unexpected cache cleanup inspection failure', { group, error })
    return {
      group,
      size: toSizeSnapshot({ bytes: 0, issues: [issue(group, 'inspection_failed')] }, 'exact')
    }
  }
}

async function inspectCacheCleanup(groups: CacheCleanupGroup[]): Promise<CacheCleanupInspection> {
  return {
    results: await Promise.all(groups.map(inspectGroup))
  }
}

async function runGroup(group: CacheCleanupGroup): Promise<CacheCleanupGroupResult> {
  try {
    if (group === 'normal_cache') return await clearNormalCache()
    if (group === 'site_data') return await clearSiteData()
    if (group === 'orphaned_data') return await clearOrphanedData()
    if (group === 'logs') return await clearDiagnosticData()
    return await clearLegacyV1()
  } catch (error) {
    logger.error('Unexpected cache cleanup group failure', { group, error })
    return resultFromSteps(group, [{ state: 'failed' }])
  }
}

async function runCacheCleanupNow(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
  const results: CacheCleanupGroupResult[] = []
  for (const group of groups) {
    results.push(await runGroup(group))
  }
  return { results }
}

class CacheCleanupService {
  private readonly cleanupMutex = new Mutex()

  public inspect(groups: CacheCleanupGroup[]): Promise<CacheCleanupInspection> {
    return inspectCacheCleanup(groups)
  }

  public run(groups: CacheCleanupGroup[]): Promise<CacheCleanupRunResult> {
    const requestedGroups = [...groups]
    return this.cleanupMutex.runExclusive(() => runCacheCleanupNow(requestedGroups))
  }
}

export const cacheCleanupService = new CacheCleanupService()
