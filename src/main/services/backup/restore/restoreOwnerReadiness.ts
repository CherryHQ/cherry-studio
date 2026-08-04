import type { RestoreOwnerProgressBag } from '@data/db/restore/portableProfileContracts'
import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import {
  type KnowledgeRestoreProgress,
  type KnowledgeRestoreProgressRead,
  type KnowledgeRestoreSummary,
  type KnowledgeRestoreSummaryRead,
  readKnowledgeRestoreProgress,
  readKnowledgeRestoreSummary,
  withKnowledgeRestoreProgress
} from '@main/features/knowledge'

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

/** Route opaque journal progress back to Knowledge after its summary is known. */
export function readRestoreKnowledgeProgress(
  journal: RestoreJournalV2,
  summary: KnowledgeRestoreSummary
): KnowledgeRestoreProgressRead {
  const legacyKnowledgeRebuild =
    journal.ownerProgress === undefined && 'knowledgeRebuild' in journal ? journal.knowledgeRebuild : undefined
  return readKnowledgeRestoreProgress(journal.ownerProgress, legacyKnowledgeRebuild, summary)
}

/** Replace only Knowledge's opaque progress entry and preserve other owners. */
export function withRestoreKnowledgeProgress(
  journal: RestoreJournalV2,
  summary: KnowledgeRestoreSummary,
  progress: KnowledgeRestoreProgress
): RestoreOwnerProgressBag {
  return withKnowledgeRestoreProgress(journal.ownerProgress, summary, progress)
}
