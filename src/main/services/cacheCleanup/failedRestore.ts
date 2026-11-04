import { unlinkSync } from 'node:fs'
import fs from 'node:fs/promises'

import { application } from '@application'
import { readRestoreJournal } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'

import {
  type CacheCleanupIssue,
  type CleanupStepResult,
  type CleanupTarget,
  collectOwnedTargets,
  inspectTarget,
  issue
} from './shared'

const logger = loggerService.withContext('CacheCleanup')
const FAILED_RESTORE_FILE = /^work-failed-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sqlite$/i

export async function collectFailedRestoreTargets(): Promise<{
  targets: CleanupTarget[]
  issues: CacheCleanupIssue[]
}> {
  const item = 'failed_restore_databases'
  // Even terminal journals can still be needed by the preboot recovery safety check.
  if (readRestoreJournal().kind !== 'none') {
    return { targets: [], issues: [issue(item, 'inspection_failed')] }
  }
  try {
    const names = await fs.readdir(application.getPath('app.userdata'))
    return await collectOwnedTargets(
      names
        .filter((name) => FAILED_RESTORE_FILE.test(name))
        .map((name) => ({
          item,
          path: application.getPath('app.userdata', name),
          kind: 'file' as const
        }))
    )
  } catch (error) {
    logger.warn('Failed to inspect failed restore databases', { error })
    return { targets: [], issues: [issue(item, 'inspection_failed')] }
  }
}

export async function removeFailedRestoreTarget(target: CleanupTarget): Promise<CleanupStepResult> {
  const status = await inspectTarget(target.path, target.item, 'file')
  if (status === 'missing') return { state: 'not_found' }
  if (status === 'invalid' || readRestoreJournal().kind !== 'none') return { state: 'skipped' }

  try {
    // Keep the final journal check and unlink in one turn so restore staging cannot interleave.
    unlinkSync(target.path)
    logger.info('Removed failed restore database', { path: target.path })
    return { state: 'cleared' }
  } catch (error) {
    logger.error('Failed to remove failed restore database', { path: target.path, error })
    return { state: 'failed' }
  }
}
