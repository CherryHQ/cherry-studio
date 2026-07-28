/**
 * Knowledge job type registrations.
 *
 * Co-locates every JobRegistry entry owned by the knowledge module.
 */

import type { JobPayloadOf } from '@main/core/job/jobRegistry'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'knowledge.prepare-root': {
      baseId: string
      itemId: string
    }
    'knowledge.index-documents': {
      baseId: string
      itemId: string
      parentJobId: string | null
    }
    'knowledge.check-file-processing-result': {
      baseId: string
      itemId: string
      fileProcessingJobId: string
      pollRound: number
      firstScheduledAt: number
      parentJobId: string | null
    }
    'knowledge.delete-subtree': {
      baseId: string
      rootItemIds: string[]
    }
    'knowledge.reindex-subtree': {
      baseId: string
      rootItemIds: string[]
    }
  }
}

export type KnowledgePrepareRootPayload = JobPayloadOf<'knowledge.prepare-root'>
export type KnowledgeIndexDocumentsPayload = JobPayloadOf<'knowledge.index-documents'>
export type KnowledgeCheckFileProcessingResultPayload = JobPayloadOf<'knowledge.check-file-processing-result'>
export type KnowledgeDeleteSubtreePayload = JobPayloadOf<'knowledge.delete-subtree'>
export type KnowledgeReindexSubtreePayload = JobPayloadOf<'knowledge.reindex-subtree'>
