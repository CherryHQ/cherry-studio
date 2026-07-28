/**
 * Post-promotion derived work (docs/references/backup/README.md §6.7).
 *
 * Full restore transports Knowledge source material but deliberately excludes
 * each rebuildable `.cherry` index. Only Knowledge owns the material-to-index
 * contract, so this module asks that owner to reconcile the exact base IDs the
 * promotion installed. It never calls ordinary reindex, which may follow an
 * archive-supplied original `data.source` or fetch a URL.
 *
 * Completion is persisted in the restore journal per base. An index file merely
 * existing is not completion: Knowledge reports complete only after every
 * completed leaf has a corresponding material row. A failed or interrupted job
 * therefore remains pending and is safely retried on a later poll or boot.
 */

import { application } from '@application'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { loggerService } from '@logger'

const logger = loggerService.withContext('backupPostPromotion')

export interface PostPromotionOutcome {
  /** False when the last restore did not complete, so there is nothing to rebuild. */
  readonly ran: boolean
  /** Bases whose material is still being reconciled. */
  readonly enqueuedBaseIds: readonly string[]
  /** True while at least one required base lacks durable completion. */
  readonly pending: boolean
}

/**
 * Run one bounded reconciliation pass. The caller polls while `pending`; this
 * function never waits for long-running embedding jobs, so shutdown is not held
 * hostage by derived work.
 */
export async function runPostPromotionWork(shouldContinue: () => boolean): Promise<PostPromotionOutcome> {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok' || read.journal.state !== 'completed') {
    return { ran: false, enqueuedBaseIds: [], pending: false }
  }

  const { restoreId } = read.journal
  const requiredBaseIds = read.journal.summary.knowledgeBaseIds
  const completed = new Set(read.journal.knowledgeRebuild?.completedBaseIds ?? [])
  const reconciling: string[] = []

  for (const baseId of requiredBaseIds) {
    if (!shouldContinue()) break
    if (completed.has(baseId)) continue
    try {
      const status = await application.get('KnowledgeService').reconcileRestoredBaseFromMaterial(baseId, restoreId)
      if (status === 'completed') {
        completed.add(baseId)
      } else {
        reconciling.push(baseId)
      }
    } catch (error) {
      reconciling.push(baseId)
      logger.error('Post-restore knowledge material rebuild could not be reconciled', error as Error, { baseId })
    }
  }

  if (!shouldContinue()) {
    return { ran: true, enqueuedBaseIds: reconciling, pending: true }
  }

  const completedBaseIds = requiredBaseIds.filter((id) => completed.has(id))
  if (completedBaseIds.length !== (read.journal.knowledgeRebuild?.completedBaseIds.length ?? 0)) {
    persistKnowledgeCompletion(restoreId, completedBaseIds)
  }

  const pending = completedBaseIds.length !== requiredBaseIds.length
  if (reconciling.length > 0) {
    logger.info('Reconciled post-restore knowledge jobs', { count: reconciling.length, pending })
  }
  return { ran: true, enqueuedBaseIds: reconciling, pending }
}

/** Re-read before writing so acknowledgement or rollback cannot be resurrected. */
function persistKnowledgeCompletion(restoreId: string, completedBaseIds: readonly string[]): void {
  const current = readRestoreJournalV2()
  if (current.kind !== 'ok' || current.journal.state !== 'completed' || current.journal.restoreId !== restoreId) return

  const allowed = new Set(current.journal.summary.knowledgeBaseIds)
  const merged = new Set(current.journal.knowledgeRebuild?.completedBaseIds ?? [])
  for (const id of completedBaseIds) {
    if (allowed.has(id)) merged.add(id)
  }
  writeRestoreJournalV2({
    ...current.journal,
    knowledgeRebuild: {
      completedBaseIds: current.journal.summary.knowledgeBaseIds.filter((id) => merged.has(id))
    }
  })
}
