import { readRestoreJournal } from './restoreJournal'
import { readRestoreJournalV2, type RestoreJournalV2State } from './restoreJournalV2'

/**
 * The one question every storage-reclaiming path asks before it deletes
 * anything: is a restore currently holding the database + file surface?
 *
 * This module exists so callers never learn that two journal versions exist.
 * v1 and v2 address the same sidecar file, so at most one of them parses it; the
 * guard asks v2 first (the format everything new writes) and falls back to v1
 * only when v2 cannot claim the file. When v1 promotion is removed, the fallback
 * goes with it and no caller changes.
 *
 * Protection covers more than "a promotion is running" (§6.5): a COMPLETED v2
 * restore still owns its recovery asides until the user acknowledges it, and
 * acknowledgement clears the journal LAST — so a `completed` journal on disk is
 * by definition unacknowledged and its asides must survive. Reclaiming against
 * the freshly restored database while those asides exist would delete files the
 * rollback path still needs.
 */

/** v2 states during which a restore owns storage. Terminal `failed`/`expired` hold nothing. */
const V2_PROTECTED_STATES: ReadonlySet<RestoreJournalV2State> = new Set<RestoreJournalV2State>([
  'prepared',
  'armed',
  'promoting',
  'completed'
])

export function hasPendingRestore(): boolean {
  const v2 = readRestoreJournalV2()
  if (v2.kind === 'ok') {
    return V2_PROTECTED_STATES.has(v2.journal.state)
  }
  if (v2.kind === 'none') {
    return false
  }

  // v2 says "not mine": either a live v1 journal or genuine garbage. v1 keeps
  // its own narrower rule (a v1 `completed` restore retains no aside), and a
  // journal neither version can parse counts as pending — one skipped sweep is
  // harmless, whereas sweeping during a restore is not.
  const v1 = readRestoreJournal()
  if (v1.kind === 'none') {
    return false
  }
  return v1.kind === 'corrupt' || v1.journal.state === 'staged' || v1.journal.state === 'promoting'
}
