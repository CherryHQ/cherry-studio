import { readRestoreJournalFormatVersion } from '@data/db/restore/restoreJournal'
import { readRestoreJournal as readRestoreJournalV1Compat } from '@data/db/restore/restoreJournalV1Compat'
import {
  isLiveDbStranded,
  isRestoreRecoveryPending,
  markRestoreFailedAfterCrash,
  runRestorePromotion
} from '@data/db/restore/restorePromotion'
import {
  cleanupTerminalRestoreArtifacts as cleanupV1TerminalRestoreArtifacts,
  isLiveDbStranded as isV1LiveDbStranded,
  isRestoreRecoveryPending as isV1RestoreRecoveryPending,
  markRestoreFailedAfterCrash as markV1RestoreFailedAfterCrash,
  runRestorePromotion as runV1RestorePromotion
} from '@data/db/restore/restorePromotionV1Compat'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BackupRestoreGate')

type RestoreExecutor = {
  readonly run: () => Promise<void>
  readonly markFailedAfterCrash: () => void
  readonly isLiveDbStranded: () => boolean
  readonly isRecoveryPending: () => boolean
  readonly cleanupTerminal?: () => void
}

const finalLiteExecutor: RestoreExecutor = {
  run: runRestorePromotion,
  markFailedAfterCrash: markRestoreFailedAfterCrash,
  isLiveDbStranded,
  isRecoveryPending: isRestoreRecoveryPending
}

const v1CompatExecutor: RestoreExecutor = {
  run: runV1RestorePromotion,
  markFailedAfterCrash: markV1RestoreFailedAfterCrash,
  isLiveDbStranded: isV1LiveDbStranded,
  isRecoveryPending: isV1RestoreRecoveryPending,
  cleanupTerminal: cleanupV1TerminalRestoreArtifacts
}

/**
 * Select a complete executor before any destructive operation. Version 1 is
 * temporary RC compatibility; version 2 is the final Lite transaction. Any
 * malformed or future journal remains evidence and stops boot rather than
 * being guessed through or deleted.
 */
function selectRestoreExecutor(): RestoreExecutor {
  const version = readRestoreJournalFormatVersion()
  if (version === 'none' || version === 2) return finalLiteExecutor
  if (version === 1) {
    const v1Journal = readRestoreJournalV1Compat()
    if (v1Journal.kind === 'ok') return v1CompatExecutor
    if (v1Journal.kind === 'none') return finalLiteExecutor
  }
  throw new Error('Restore journal format is unsupported or corrupt — refusing to discard recovery evidence')
}

/**
 * Executes a restore transaction in the zero-connection preboot window.
 * Unknown journals never enter either executor. The v1 executor is allowed
 * only to converge journals written by RC1, then removes its own terminal
 * artifacts; Lite journals retain their aside for explicit user acknowledgement.
 */
export async function runBackupRestoreGate(): Promise<void> {
  const executor = selectRestoreExecutor()
  try {
    await executor.run()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      executor.markFailedAfterCrash()
    } catch (recoveryError) {
      logger.error('Failed to converge restore recovery', recoveryError as Error)
    }
  }
  if (executor.isLiveDbStranded()) {
    throw new Error(
      'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
    )
  }
  if (executor.isRecoveryPending()) {
    throw new Error('Restore recovery is incomplete — refusing to boot into a mixed restore state')
  }
  executor.cleanupTerminal?.()
}
