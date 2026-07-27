import { readRestoreJournalV2, type RestoreJournalV2State } from './restoreJournalV2'

/**
 * The one question every storage-reclaiming path asks before it deletes
 * anything: is a restore currently holding the database + file surface?
 *
 * Protection covers more than "a promotion is running" (§6.5): a COMPLETED
 * restore still owns its recovery asides until the user acknowledges it, and
 * acknowledgement clears the journal LAST — so a `completed` journal on disk is
 * by definition unacknowledged and its asides must survive. Reclaiming against
 * the freshly restored database while those asides exist would delete files the
 * rollback path still needs.
 */

/** States during which a restore owns storage. Terminal `failed`/`expired` hold nothing. */
const PROTECTED_STATES: ReadonlySet<RestoreJournalV2State> = new Set<RestoreJournalV2State>([
  'prepared',
  'armed',
  'promoting',
  'completed'
])

export function hasPendingRestore(): boolean {
  const read = readRestoreJournalV2()
  if (read.kind === 'ok') {
    return PROTECTED_STATES.has(read.journal.state)
  }
  // An unparseable journal counts as pending: one skipped sweep is harmless,
  // whereas sweeping during a restore is not.
  return read.kind === 'corrupt'
}
