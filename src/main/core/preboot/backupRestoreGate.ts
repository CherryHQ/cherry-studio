import fs from 'node:fs'

import { application } from '@application'
import { readRestoreJournalFormatVersion } from '@data/db/restore/restoreJournalV2'
import {
  isLiveDbStrandedV2,
  isRestoreRecoveryPendingV2,
  markRestoreFailedAfterCrashV2,
  runRestorePromotionV2
} from '@data/db/restore/restorePromotionV2'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BackupRestoreGate')

/** Suffix that takes a v1 journal out of every reader's way while keeping its bytes. */
const PARKED_V1_SUFFIX = '.parked-v1'

/** Bound on the numbered fallbacks below; a real user never reaches two. */
const MAX_PARKED_V1_JOURNALS = 100

/**
 * Preboot shell around the restore promotion logic (which lives in
 * data/db/restore/restorePromotionV2.ts — same layering as
 * v2MigrationGate → MigrationEngine).
 *
 * Runs in startApp() before runV2MigrationGate() reads the DB. Hard ordering
 * constraints: after requireSingleInstance() (the promotion does destructive
 * renames and must hold the single-instance lock) and after the path registry
 * is frozen (all journal paths resolve against the final userData).
 *
 * No return value on a coherent outcome: promotion success means the new DB is
 * live, and a safely reverted failure means the old DB is. An
 * unexpected crash of the promotion logic is logged and handed to
 * markRestoreFailedAfterCrashV2, which restores the live DB from the aside if
 * needed and freezes the journal to failed (or leaves a committed promotion
 * resumable) so the next boot does not retry a promotion that just proved
 * itself poisonous.
 *
 * This shell normally does not throw — a preboot exception falls into
 * startApp's fail-fast catch (forceExit). It refuses to boot whenever recovery
 * cannot prove a coherent live state: a corrupt/future journal, a stranded DB,
 * or any forward/reverse direction that has not converged. The journal and its
 * staging evidence are preserved rather than guessed away.
 */
export async function runBackupRestoreGate(): Promise<void> {
  if (readRestoreJournalFormatVersion() === 1) {
    parkRestoreJournalV1()
    return
  }

  try {
    await runRestorePromotionV2()
  } catch (error) {
    logger.error('Restore promotion crashed unexpectedly — attempting last-resort recovery', error as Error)
    try {
      markRestoreFailedAfterCrashV2()
    } catch (journalError) {
      logger.error('Failed to mark the restore journal as failed', journalError as Error)
    }
    if (isLiveDbStrandedV2()) {
      throw new Error(
        'Restore recovery failed: the live database is missing while the previous database is still parked aside — refusing to boot into an empty database'
      )
    }
    if (isRestoreRecoveryPendingV2()) {
      throw new Error('Restore recovery is incomplete — refusing to boot into a mixed restore state')
    }
  }
}

/**
 * Take a journal written by the abandoned v1 restore protocol permanently out
 * of play, without destroying anything — including the journal itself.
 *
 * That format never shipped in stable v1; it existed only in the v2.0.0
 * pre-releases, so the requested restore is dropped rather than executed by a
 * compatibility state machine kept alive for it (a documented breaking change).
 * Renaming rather than deleting is the entire mechanism, and it pays in both
 * directions:
 *
 * - Left in place, the journal would be found again by a pre-release build the
 *   user later reinstalls, which would then carry out a whole-database
 *   replacement the user asked for long ago and has forgotten about.
 * - Renamed, that path stays open but only deliberately: renaming the parked
 *   file back and reinstalling the build that wrote it still completes the
 *   original restore.
 *
 * Nothing else on disk is touched. The v1 staging tree, and any database v1
 * already parked aside, stay exactly where they are — orphaned disk space is
 * the price of never guessing at half-moved data. The journal's contents are
 * never parsed either: whatever it claims, it is parked, because reading its
 * state machine is precisely the compatibility burden being removed here.
 */
function parkRestoreJournalV1(): void {
  // v1 wrote its journal into the same sidecar slot v2 uses; inlined rather
  // than kept behind a v1 module so nothing of v1 survives but this key.
  const journalPath = application.getPath('feature.backup.restore.file')

  // Probed BEFORE the rename, not after: a crash in the window between parking
  // the journal and putting it back would leave a missing database whose only
  // recovery marker had just been renamed away, and the next boot would create
  // a fresh empty one on top of it.
  if (!isRegularFile(application.getPath('app.database.file'))) {
    throw new Error(
      'An unfinished restore from a 2.0 pre-release was found while the database is not where it belongs — refusing to boot into an empty database. Reinstall the pre-release build that started that restore to let it finish.'
    )
  }

  const parkedPath = freeParkedJournalPath(journalPath)
  fs.renameSync(journalPath, parkedPath)
  logger.warn('Parked a pre-release v1 restore journal — the restore it requested will not be carried out', {
    parkedPath
  })
}

/**
 * A free name beside the journal. An existing parked file is never overwritten:
 * a user can produce a second v1 journal by reinstalling a pre-release, and
 * clobbering the first would destroy exactly the evidence this gate preserves.
 */
function freeParkedJournalPath(journalPath: string): string {
  const preferred = `${journalPath}${PARKED_V1_SUFFIX}`
  if (!fs.existsSync(preferred)) return preferred
  for (let attempt = 2; attempt <= MAX_PARKED_V1_JOURNALS; attempt++) {
    const candidate = `${preferred}.${attempt}`
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    'An unfinished restore from a 2.0 pre-release could not be set aside — too many previously parked restore journals are already being kept'
  )
}

function isRegularFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}
