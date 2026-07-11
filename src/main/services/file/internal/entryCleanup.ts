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
  readonly outcome: 'completed' | 'failed'
  readonly candidates: number
  readonly deleted: number
  readonly skippedTempRefs: number
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
  try {
    const candidates = deps.fileEntryService.countCleanupCandidates(ENTRY_CLEANUP_GRACE_MS)
    if (candidates === 0) {
      return finish({
        outcome: 'completed',
        candidates,
        deleted: 0,
        skippedTempRefs: 0,
        skippedRefsReappeared: 0,
        gonePinned: 0,
        failed: 0,
        unlinkFailures: 0,
        durationMs: Date.now() - startedAt
      })
    }

    const batch = deps.fileEntryService.findCleanupCandidates({
      graceMs: ENTRY_CLEANUP_GRACE_MS,
      limit: ENTRY_CLEANUP_BATCH_LIMIT
    })
    let deleted = 0
    let skippedTempRefs = 0
    let skippedRefsReappeared = 0
    let gonePinned = 0
    let failed = 0
    let unlinkFailures = 0

    for (const candidate of batch) {
      try {
        // Temp-session refs live in main-process cache memory and are not
        // transactional — checked outside the tx; a ref appearing mid-tx is
        // tolerated (spec §6: pruned later, FK fails on persist). Uses the
        // dedicated cache-only predicate instead of `findByEntryId` so this
        // per-candidate check never fans out to the persistent ref tables.
        if (deps.fileRefService.hasTempSessionRef(candidate.id)) {
          skippedTempRefs++
          continue
        }

        const outcome = deps.fileEntryService.withWriteTx((tx): CandidateOutcome => {
          const row = deps.fileEntryService.findByIdTx(tx, candidate.id)
          if (row === null || row.cleanupPolicy !== 'delete_when_unreferenced') {
            return { kind: 'gone-or-pinned' }
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
      skippedTempRefs,
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
        skippedTempRefs: 0,
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

export function summariseEntryCleanup(report: EntryCleanupReport): EntryCleanupSummary {
  const base = { candidates: report.candidates, deleted: report.deleted }
  switch (report.outcome) {
    case 'failed':
      return { outcome: 'failed', ...base }
    case 'completed':
      return { outcome: 'completed', ...base }
    default:
      return assertNever(report.outcome)
  }
}
