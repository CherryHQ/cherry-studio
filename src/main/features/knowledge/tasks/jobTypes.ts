/**
 * Knowledge job type registrations.
 *
 * Co-locates every JobRegistry entry owned by the knowledge module.
 */

import type { JobPayloadOf } from '@main/core/job/jobRegistry'
import type { FileProcessingTaskId } from '@main/features/fileProcessing'
import type { AbsoluteFilePath } from '@shared/types/file'
import type { PosixRelativeFilePath } from '@shared/utils/file'

/** One byte copy an add owes its item: an absolute source path into the item's reserved `raw/` name. */
export interface KnowledgeSourceCopy {
  from: AbsoluteFilePath
  relativePath: PosixRelativeFilePath
}

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'knowledge.copy-sources': {
      baseId: string
      itemId: string
      copies: KnowledgeSourceCopy[]
    }
    'knowledge.prepare-root': {
      baseId: string
      itemId: string
    }
    'knowledge.index-documents': {
      baseId: string
      itemId: string
    }
    'knowledge.check-file-processing-result': {
      baseId: string
      itemId: string
      fileProcessingTaskId: FileProcessingTaskId
      processedRelativePath: string
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

export type KnowledgeCopySourcesPayload = JobPayloadOf<'knowledge.copy-sources'>
export type KnowledgePrepareRootPayload = JobPayloadOf<'knowledge.prepare-root'>
export type KnowledgeIndexDocumentsPayload = JobPayloadOf<'knowledge.index-documents'>
export type KnowledgeCheckFileProcessingResultPayload = JobPayloadOf<'knowledge.check-file-processing-result'>
export type KnowledgeDeleteSubtreePayload = JobPayloadOf<'knowledge.delete-subtree'>
export type KnowledgeReindexSubtreePayload = JobPayloadOf<'knowledge.reindex-subtree'>
