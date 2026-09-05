import { application } from '@application'
import type { CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'

import { measurePaths, toSizeSnapshot } from './shared'

function getDiagnosticPaths() {
  return {
    logs: application.getPath('app.logs'),
    crashDumps: application.getPath('app.crash_dumps'),
    trace: application.getPath('feature.trace')
  }
}

export async function inspectDiagnosticData(signal?: AbortSignal): Promise<CacheCleanupSizeSnapshot> {
  const paths = getDiagnosticPaths()
  const measurement = await measurePaths(
    [
      { item: 'logs', path: paths.logs },
      { item: 'crash_dumps', path: paths.crashDumps },
      { item: 'trace', path: paths.trace }
    ],
    signal
  )
  return toSizeSnapshot(measurement, 'exact')
}
