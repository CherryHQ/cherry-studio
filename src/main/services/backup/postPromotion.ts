/**
 * Post-promotion derived work (docs/references/backup/README.md §6.7).
 *
 * A restored Knowledge base arrives as raw content with NO vector index — the
 * index is derived state that export excludes on purpose, and an empty one never
 * rebuilds itself, so search would silently return nothing forever. This
 * schedules that rebuild once, after boot, for the bases this device actually
 * has directories for.
 *
 * It is deliberately NOT a staged-database hook: the work needs the restored
 * database to be live, the Knowledge service to be running, and the job queue to
 * exist — none of which is true at promotion time.
 *
 * Cross-boot idempotency needs no marker: only bases whose index file is still
 * absent are enqueued, so once a rebuild has started later boots skip it. That
 * matters because the journal legitimately survives until acknowledgement, which
 * may be several boots away.
 */

import path from 'node:path'

import { application } from '@application'
import { readRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'

import { collectResourceRequirementsFrom } from './resources/collectRequirements'
import { measureResourceCoverage } from './resources/coverage'

const logger = loggerService.withContext('backupPostPromotion')

/** The requirement kind the Knowledge adapter emits. */
const KNOWLEDGE_KIND = 'knowledge-base'

export interface PostPromotionOutcome {
  /** False when the last restore did not complete, so there is nothing to rebuild. */
  readonly ran: boolean
  readonly enqueuedBaseIds: readonly string[]
}

/**
 * Run the derived work a completed restore left behind. `shouldContinue` is
 * checked between steps so a shutdown arriving mid-flight short-circuits instead
 * of enqueuing into a tearing-down job manager.
 */
export async function runPostPromotionWork(shouldContinue: () => boolean): Promise<PostPromotionOutcome> {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok' || read.journal.state !== 'completed') {
    return { ran: false, enqueuedBaseIds: [] }
  }

  // The restored database is the live one by now, so the inventory comes off
  // the live connection rather than a second one opened onto the same file.
  const { coverage, present } = measureResourceCoverage({
    inventory: collectResourceRequirementsFrom(application.get('DbService').getDb())
  })
  // Disclosure, not a silent skip (§2): a restored profile whose resources this
  // device does not have is a degraded restore, and the numbers say how much.
  logger.info('Post-restore resource coverage', {
    restoreId: read.journal.restoreId,
    ...coverage
  })

  // The bases to rebuild come from THIS device's filesystem, not from the
  // promotion's `summary.knowledgeBaseIds`. Every base the restore installed has
  // a row in the database it installed with it, so the inventory below already
  // contains all of them — plus the ones that were here before. The summary
  // stays the durable record of what the promotion moved; using it as a second
  // input could only ever add a base whose directory has since disappeared.
  const enqueued: string[] = []
  for (const requirement of present) {
    if (!shouldContinue()) break
    if (requirement.kind !== KNOWLEDGE_KIND) continue
    const baseId = path.basename(requirement.livePath)
    // Per-base isolation: one un-reindexable base (missing row, blocked subtree,
    // absent source) must not stop the others.
    try {
      if (await enqueueBaseReindex(baseId)) {
        enqueued.push(baseId)
      }
    } catch (error) {
      logger.error('Post-restore knowledge reindex could not be enqueued', error as Error, { baseId })
    }
  }

  if (enqueued.length > 0) {
    logger.info('Enqueued post-restore knowledge reindex', { count: enqueued.length })
  }
  return { ran: true, enqueuedBaseIds: enqueued }
}

async function enqueueBaseReindex(baseId: string): Promise<boolean> {
  if (await application.get('KnowledgeVectorStoreService').hasIndexStore(baseId)) {
    return false
  }
  const rootItemIds = knowledgeItemService
    .getRootItemsByBaseId(baseId)
    .filter((item) => item.status === 'completed')
    .map((item) => item.id)
  if (rootItemIds.length === 0) {
    return false
  }
  await application.get('KnowledgeService').reindexItems(baseId, rootItemIds)
  return true
}
