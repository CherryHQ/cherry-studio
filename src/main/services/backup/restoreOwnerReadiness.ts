import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { type KnowledgeRestoreSummaryRead, readKnowledgeRestoreSummary } from '@main/features/knowledge'

/**
 * Route opaque journal readiness data back to its business owner.
 *
 * The legacy field is consulted only for completed journals written by an
 * earlier pre-release and only when no owner bag exists.
 */
export function readRestoreKnowledgeReadiness(journal: RestoreJournalV2): KnowledgeRestoreSummaryRead {
  const legacyKnowledgeBaseIds = 'summary' in journal ? journal.summary?.knowledgeBaseIds : undefined
  return readKnowledgeRestoreSummary(journal.ownerSummary, legacyKnowledgeBaseIds)
}
