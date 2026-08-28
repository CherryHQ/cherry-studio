/**
 * Scan-based cleanup pass for delete_when_unreferenced file entries.
 * Spec: docs/references/file/file-entry-cleanup.md §5.
 *
 * No queue, no triggers: candidates are derived from current DB state, so the
 * pass is idempotent and crash-safe by construction. Discovery uses the
 * registry-driven anti-join (fileRelations.persistentRefAbsenceConditions);
 * each candidate is re-verified inside a serialized write tx before deletion;
 * FS cleanup happens after commit via lifecycle.cleanupDeletedEntry.
 *
 * The pass is fully silent (no user surface) and has no volume-based abort —
 * see spec §5.3 for why reclaiming a large legitimate candidate set is correct.
 */
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import { loggerService } from '@logger'
import type { FileEntry } from '@shared/data/types/file'
import type { EntryCleanupSummary } from '@shared/types/file'

import type { FileManagerDeps } from './deps'
import { cleanupDeletedEntry } from './entry/lifecycle'

const logger = loggerService.withContext('FileManager:entryCleanup')

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

export const ENTRY_CLEANUP_GRACE_MS = 60 * 60 * 1000
export const ENTRY_CLEANUP_BATCH_LIMIT = 100

export interface EntryCleanupReport {
  readonly outcome: 'completed' | 'skipped' | 'failed'
  /**
   * Candidates picked up by **this** pass, so it saturates at
   * `ENTRY_CLEANUP_BATCH_LIMIT` rather than reporting the full backlog. The pass
   * deliberately does not run a second COUNT over the same anti-join just to
   * widen this number: it reaches no UI (`runSweep` has no renderer caller), and
   * a saturated batch is itself the backlog signal — repeated
   * `candidates === ENTRY_CLEANUP_BATCH_LIMIT` lines mean more is queued.
   */
  readonly candidates: number
  readonly deleted: number
  readonly skippedRefsReappeared: number
  /** Candidates that vanished or were upgraded to `manual` (ensureExternal reuse) between query and tx re-read — benign no-ops. */
  readonly gonePinned: number
  /** Candidates whose per-item processing threw and was caught (retried next pass) — distinguishes a genuine no-op from a batch that all errored. */
  readonly failed: number
  readonly unlinkFailures: number
  readonly durationMs: number
  readonly errorMessage?: string
}

type CandidateOutcome = { kind: 'deleted'; entry: FileEntry } | { kind: 'refs-reappeared' } | { kind: 'gone-or-pinned' }

export async function runEntryCleanup(deps: FileManagerDeps): Promise<EntryCleanupReport> {
  const startedAt = Date.now()
  // A staged restore holds the DB in a protected window: mutating file_entry or
  // unlinking blobs now could invalidate the live DB fingerprint or race the
  // pending promotion. Both orphan-sweep passes gate on this (orphanSweep.ts); the
  // scan-based cleanup must too. Report a truthful `skipped`, not a fake completed.
  if (hasPendingRestore()) {
    return finish({
      outcome: 'skipped',
      candidates: 0,
      deleted: 0,
      skippedRefsReappeared: 0,
      gonePinned: 0,
      failed: 0,
      unlinkFailures: 0,
      durationMs: Date.now() - startedAt
    })
  }
  try {
    const batch = deps.fileEntryService.findCleanupCandidates({
      graceMs: ENTRY_CLEANUP_GRACE_MS,
      limit: ENTRY_CLEANUP_BATCH_LIMIT
    })
    const candidates = batch.length
    if (candidates === 0) {
      return finish({
        outcome: 'completed',
        candidates,
        deleted: 0,
        skippedRefsReappeared: 0,
        gonePinned: 0,
        failed: 0,
        unlinkFailures: 0,
        durationMs: Date.now() - startedAt
      })
    }

    let deleted = 0
    let skippedRefsReappeared = 0
    let gonePinned = 0
    let failed = 0
    let unlinkFailures = 0

    for (const candidate of batch) {
      try {
        const outcome = deps.fileEntryService.withWriteTx((tx): CandidateOutcome => {
          const row = deps.fileEntryService.findByIdTx(tx, candidate.id)
          if (row === null || row.cleanupPolicy !== 'delete_when_unreferenced') {
            return { kind: 'gone-or-pinned' }
          }
          if (deps.fileEntryService.isTransientlyRetained(candidate.id)) {
            return { kind: 'refs-reappeared' }
          }
          if (deps.fileRefService.countPersistentRefsByEntryIdTx(tx, candidate.id) > 0) {
            return { kind: 'refs-reappeared' }
          }
          deps.fileEntryService.deleteTx(tx, candidate.id)
          return { kind: 'deleted', entry: row }
        })

        switch (outcome.kind) {
          case 'deleted': {
            deleted++
            const { unlinkFailed } = await cleanupDeletedEntry(deps, outcome.entry)
            if (unlinkFailed) unlinkFailures++
            break
          }
          case 'refs-reappeared':
            skippedRefsReappeared++
            break
          case 'gone-or-pinned':
            gonePinned++
            break
          default:
            assertNever(outcome)
        }
      } catch (err) {
        // Stateless retry (spec §5.6): the next pass re-derives this candidate.
        failed++
        logger.warn('file-entry-cleanup: candidate failed, retried next pass', { id: candidate.id, err })
      }
    }

    return finish({
      outcome: 'completed',
      candidates,
      deleted,
      skippedRefsReappeared,
      gonePinned,
      failed,
      unlinkFailures,
      durationMs: Date.now() - startedAt
    })
  } catch (err) {
    return finish(
      {
        outcome: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        candidates: 0,
        deleted: 0,
        skippedRefsReappeared: 0,
        gonePinned: 0,
        failed: 0,
        unlinkFailures: 0,
        durationMs: Date.now() - startedAt
      },
      err
    )
  }
}

function finish(report: EntryCleanupReport, rawError?: unknown): EntryCleanupReport {
  const payload = { event: 'file-entry-cleanup', ...report }
  switch (report.outcome) {
    case 'completed':
    case 'skipped':
      logger.info('file-entry-cleanup', payload)
      break
    case 'failed': {
      // Pass the raw error first (the logger extracts its stack) alongside the
      // structured payload — the whole-batch-crash path is the one that most
      // needs the stack, which `errorMessage` alone drops.
      const errArg = rawError instanceof Error ? rawError : new Error(report.errorMessage ?? String(rawError))
      logger.error('file-entry-cleanup', errArg, payload)
      break
    }
    default:
      assertNever(report.outcome)
  }
  return report
}

/** Narrow the internal report to the wire summary — see `EntryCleanupSummary`. */
export function summariseEntryCleanup(report: EntryCleanupReport): EntryCleanupSummary {
  return { outcome: report.outcome, candidates: report.candidates, deleted: report.deleted }
}
