import { application } from '@application'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'

import { captureStep, measurePaths, removeCleanupDirectoryContents, resultFromSteps, toSizeSnapshot } from './shared'

function getDiagnosticPaths() {
  return {
    logs: application.getPath('app.logs'),
    crashDumps: application.getPath('app.crash_dumps'),
    trace: application.getPath('feature.trace')
  }
}

export async function inspectDiagnosticData(): Promise<CacheCleanupSizeSnapshot> {
  const paths = getDiagnosticPaths()
  const measurement = await measurePaths([
    { item: 'logs', path: paths.logs },
    { item: 'crash_dumps', path: paths.crashDumps },
    { item: 'trace', path: paths.trace }
  ])
  return toSizeSnapshot(measurement, 'exact')
}

export async function clearDiagnosticData(): Promise<CacheCleanupGroupResult> {
  const paths = getDiagnosticPaths()
  const [logSteps, crashDumpSteps, traceStep] = await Promise.all([
    removeCleanupDirectoryContents({ item: 'logs', path: paths.logs, kind: 'directory' }),
    removeCleanupDirectoryContents({ item: 'crash_dumps', path: paths.crashDumps, kind: 'directory' }),
    captureStep('trace', () => application.get('TraceStorageService').cleanLocalData())
  ])
  return resultFromSteps('logs', [...logSteps, ...crashDumpSteps, traceStep])
}
