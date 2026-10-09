import fs from 'node:fs'

import { app, dialog } from 'electron'

import { application } from '@application'
import { readRestoreJournal } from '@data/db/restore/restoreJournal'
import {
  cleanupTerminalRestoreArtifacts,
  isLiveDbStranded,
  markRestoreFailedAfterCrash,
  runRestorePromotion
} from '@data/db/restore/restorePromotion'
import { loggerService } from '@logger'
import { resolveSystemLanguage, t } from '@main/i18n'

const logger = loggerService.withContext('BackupRestoreGate')

/** Isolate Chromium before Sentry or asynchronous preboot work can open the live profile. */
export function prepareBackupRestoreSession(): boolean {
  const result = readRestoreJournal()
  const pending = result.kind === 'ok' && (result.journal.state === 'staged' || result.journal.state === 'promoting')
  if (pending && app.isReady()) {
    throw new Error('Restore session isolation must run before Electron is ready')
  }
  const sessionRoot = application.getPath('feature.backup.restore.session')
  try {
    fs.rmSync(sessionRoot, { recursive: true, force: true })
  } catch (error) {
    logger.warn('Could not clean up the previous restore session', { error })
  }
  if (!pending) {
    return false
  }
  fs.mkdirSync(sessionRoot, { recursive: true })
  const sessionDataPath = fs.mkdtempSync(application.getPath('feature.backup.restore.session', 'session-'))
  app.setPath('sessionData', sessionDataPath)
  logger.info('Prepared isolated sessionData for backup restore', { sessionDataPath })
  return true
}

/**
 * Preboot shell around the restore promotion logic (which lives in
 * data/db/restore/restorePromotion.ts — same layering as
 * v2MigrationGate → MigrationEngine).
 *
 * Runs in startApp() before runV2MigrationGate() reads the DB. Hard ordering
 * constraints: after requireSingleInstance() (the promotion does destructive
 * renames and must hold the single-instance lock) and after the path registry
 * is frozen (all journal paths resolve against the final userData).
 *
 * An isolated restore launch returns handled and relaunches without bootstrapping;
 * the next launch opens the restored profile. Otherwise boot continues. An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrash, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * Refuses to boot if recovery strands the live DB or an isolated launch cannot
 * consume its journal. This preserves repair artifacts and prevents either an
 * empty database boot or an automatic relaunch loop.
 */
export async function runBackupRestoreGate(isolatedSession = false): Promise<'handled' | 'skipped'> {
  try {
    await runRestorePromotion()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      markRestoreFailedAfterCrash()
    } catch (journalError) {
      logger.error('Failed to mark the restore journal as failed', journalError as Error)
    }
    if (isLiveDbStranded()) {
      throw new Error(
        'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
      )
    }
  }
  const result = readRestoreJournal()
  if (result.kind === 'ok' && (result.journal.state === 'failed' || result.journal.state === 'expired')) {
    await app.whenReady()
    const language = resolveSystemLanguage(app.getLocale())
    dialog.showErrorBox(t('backup.restore.failed', undefined, language), t('backup.restore.retry', undefined, language))
  }
  cleanupTerminalRestoreArtifacts()
  if (isolatedSession) {
    if (readRestoreJournal().kind !== 'none') {
      throw new Error('Restore journal remains unresolved — refusing to relaunch or bootstrap with an isolated session')
    }
    application.relaunch()
    return 'handled'
  }
  return 'skipped'
}
