import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

import type {
  KnowledgeCheckFileProcessingResultPayload,
  KnowledgeDeleteSubtreePayload,
  KnowledgeIndexDocumentsPayload,
  KnowledgePrepareRootPayload,
  KnowledgeReindexSubtreePayload
} from '../jobTypes'

export type NarrowedKnowledgeJobInput =
  | {
      type: 'knowledge.prepare-root'
      input: KnowledgePrepareRootPayload
    }
  | {
      type: 'knowledge.index-documents'
      input: KnowledgeIndexDocumentsPayload
    }
  | {
      type: 'knowledge.check-file-processing-result'
      input: KnowledgeCheckFileProcessingResultPayload
    }
  | {
      type: 'knowledge.delete-subtree'
      input: KnowledgeDeleteSubtreePayload
    }
  | {
      type: 'knowledge.reindex-subtree'
      input: KnowledgeReindexSubtreePayload
    }

type JobSnapshotInput = Pick<JobSnapshot, 'type' | 'input'>
type JobInputObject = Record<string, unknown>

export function narrowKnowledgeJobInput(snapshot: JobSnapshotInput): NarrowedKnowledgeJobInput | null {
  switch (snapshot.type) {
    case 'knowledge.prepare-root': {
      const payload = narrowItemJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.index-documents': {
      const payload = narrowIndexDocumentsJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.check-file-processing-result': {
      const payload = narrowFileProcessingCheckJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.delete-subtree':
    case 'knowledge.reindex-subtree': {
      const payload = narrowSubtreeJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    default:
      return null
  }
}

function narrowFileProcessingCheckJobPayload(
  rawInput: JobSnapshot['input']
): KnowledgeCheckFileProcessingResultPayload | null {
  const input = narrowJobInputObject(rawInput)
  if (!input) return null
  const basePayload = narrowItemJobPayload(rawInput)
  if (!basePayload) return null
  if (typeof input.fileProcessingJobId !== 'string') return null
  if (typeof input.sourceFileEntryId !== 'string') return null
  if (typeof input.pollRound !== 'number') return null
  if (typeof input.firstScheduledAt !== 'number') return null
  if (!('parentJobId' in input)) return null
  const parentJobId = input.parentJobId
  if (parentJobId !== null && typeof parentJobId !== 'string') return null

  return {
    baseId: basePayload.baseId,
    itemId: basePayload.itemId,
    fileProcessingJobId: input.fileProcessingJobId,
    sourceFileEntryId: input.sourceFileEntryId,
    pollRound: input.pollRound,
    firstScheduledAt: input.firstScheduledAt,
    parentJobId
  }
}

function narrowItemJobPayload(
  rawInput: JobSnapshot['input']
): KnowledgePrepareRootPayload | Pick<KnowledgeIndexDocumentsPayload, 'baseId' | 'itemId'> | null {
  const input = narrowJobInputObject(rawInput)
  if (!input) return null
  if (typeof input.baseId !== 'string') return null
  if (typeof input.itemId !== 'string') return null

  return {
    baseId: input.baseId,
    itemId: input.itemId
  }
}

function narrowIndexDocumentsJobPayload(rawInput: JobSnapshot['input']): KnowledgeIndexDocumentsPayload | null {
  const input = narrowJobInputObject(rawInput)
  if (!input) return null
  const basePayload = narrowItemJobPayload(rawInput)
  if (!basePayload) return null
  if ('processedFileEntryId' in input && typeof input.processedFileEntryId !== 'string') return null
  if (!('parentJobId' in input)) return null
  const parentJobId = input.parentJobId
  if (parentJobId !== null && typeof parentJobId !== 'string') return null
  const processedFileEntryId =
    'processedFileEntryId' in input ? (input.processedFileEntryId as string | undefined) : undefined

  return {
    baseId: basePayload.baseId,
    itemId: basePayload.itemId,
    ...(processedFileEntryId !== undefined ? { processedFileEntryId } : {}),
    parentJobId
  }
}

function narrowSubtreeJobPayload(
  rawInput: JobSnapshot['input']
): KnowledgeDeleteSubtreePayload | KnowledgeReindexSubtreePayload | null {
  const input = narrowJobInputObject(rawInput)
  if (!input) return null
  if (typeof input.baseId !== 'string') return null
  if (!Array.isArray(input.rootItemIds)) return null
  if (!input.rootItemIds.every((itemId) => typeof itemId === 'string')) return null

  return {
    baseId: input.baseId,
    rootItemIds: input.rootItemIds
  }
}

function narrowJobInputObject(rawInput: JobSnapshot['input']): JobInputObject | null {
  if (!rawInput || typeof rawInput !== 'object') return null
  return rawInput as JobInputObject
}
