import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { CacheCleanupGroupResult, CacheCleanupSizeSnapshot } from '@shared/types/cacheCleanupIpc'

import {
  type CacheCleanupIssue,
  type CleanupTarget,
  collectOwnedTargets,
  isNodeError,
  isPathWithin,
  issue,
  measurePaths,
  removeCleanupTarget,
  resultFromSteps,
  toSizeSnapshot
} from './shared'

const logger = loggerService.withContext('CacheCleanup')

// `.log.3` is a size-rolled shard of the same day: file-stream-rotator appends the
// counter after the name, because our `filename` carries the extension and its own is empty.
const LOG_FILE_PATTERN = /\.log(\.\d+)?(\.gz)?$/
const LOG_STAMP_PATTERN = /(\d{4})-(\d{2})-(\d{2})/
const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between a file's `YYYY-MM-DD` rotation stamp and today, both local. */
function ageInDays(name: string): number | null {
  const match = LOG_STAMP_PATTERN.exec(name)
  if (!match) return null

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const stamped = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  return Math.round((today - stamped) / DAY_MS)
}

function isRemovable(name: string, minAgeDays: number): boolean {
  if (!LOG_FILE_PATTERN.test(name)) return false

  const age = ageInDays(name)
  // Undated leftovers have no age to weigh against a retention window, so only the
  // manual sweep takes them. Today's files stay open in the rotating transports:
  // removing them would silently drop the rest of today's logs on POSIX and fail on Windows.
  return age === null ? minAgeDays === 0 : age > minAgeDays
}

async function collectLogTargets(minAgeDays: number): Promise<{
  targets: CleanupTarget[]
  issues: CacheCleanupIssue[]
}> {
  const logsDir = application.getPath('app.logs')
  // Mini apps keep their newest activity days however old those are — a monthly app must
  // still show its last session — so calendar retention stays off that tree. Only the
  // manual sweep, which the user asked for explicitly, takes those files.
  const miniAppLogsDir = minAgeDays === 0 ? null : application.getPath('feature.mini_app.logs')

  let entries
  try {
    entries = await fs.readdir(logsDir, { recursive: true, withFileTypes: true })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return { targets: [], issues: [] }
    logger.warn('Failed to enumerate log files', { path: logsDir, error })
    return { targets: [], issues: [issue('logs', 'inspection_failed')] }
  }

  return collectOwnedTargets(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          isRemovable(entry.name, minAgeDays) &&
          !(miniAppLogsDir && isPathWithin(entry.parentPath, miniAppLogsDir))
      )
      .map((entry): CleanupTarget => ({ item: 'logs', path: path.join(entry.parentPath, entry.name), kind: 'file' }))
  )
}

export async function inspectLogs(): Promise<CacheCleanupSizeSnapshot> {
  const { targets, issues } = await collectLogTargets(0)
  const measurement = await measurePaths(targets.map(({ item, path: targetPath }) => ({ item, path: targetPath })))
  measurement.issues.push(...issues)
  return toSizeSnapshot(measurement, 'exact')
}

export async function clearLogs(): Promise<CacheCleanupGroupResult> {
  const { targets, issues } = await collectLogTargets(0)
  const steps = await Promise.all(targets.map(removeCleanupTarget))
  steps.push(...issues.map(() => ({ state: 'skipped' as const })))
  return resultFromSteps('logs', steps)
}

/** Retention sweep: drops dated logs older than `retentionDays`. Returns how many went. */
export async function sweepAgedLogs(retentionDays: number): Promise<number> {
  const { targets } = await collectLogTargets(Math.max(1, Math.floor(retentionDays)))
  const steps = await Promise.all(targets.map(removeCleanupTarget))
  return steps.filter(({ state }) => state === 'cleared').length
}
