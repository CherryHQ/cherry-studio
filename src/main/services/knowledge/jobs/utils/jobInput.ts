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

export function narrowKnowledgeJobInput(snapshot: JobSnapshotInput): NarrowedKnowledgeJobInput | null {
  switch (snapshot.type) {
    case 'knowledge.prepare-root': {
      const payload = narrowItemJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.index-documents': {
      const payload = narrowItemJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.check-file-processing-result': {
      const payload = narrowFileProcessingCheckJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
    case 'knowledge.delete-subtree': {
      const payload = narrowSubtreeJobPayload(snapshot.input)
      return payload ? { type: snapshot.type, input: payload } : null
    }
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
  const basePayload = narrowItemJobPayload(rawInput)
  if (!basePayload) return null
  if (!rawInput || typeof rawInput !== 'object') return null
  if (!('fileProcessingJobId' in rawInput) || typeof rawInput.fileProcessingJobId !== 'string') return null
  if (!('sourceFileEntryId' in rawInput) || typeof rawInput.sourceFileEntryId !== 'string') return null
  const checkCount = narrowOptionalNumber(rawInput, 'checkCount')
  if (checkCount === null) return null
  const firstScheduledAt = narrowOptionalNumber(rawInput, 'firstScheduledAt')
  if (firstScheduledAt === null) return null
  let parentJobId: string | null | undefined
  if ('parentJobId' in rawInput) {
    const value = rawInput.parentJobId
    if (value !== undefined && value !== null && typeof value !== 'string') return null
    parentJobId = value
  }

  return {
    baseId: basePayload.baseId,
    itemId: basePayload.itemId,
    fileProcessingJobId: rawInput.fileProcessingJobId,
    sourceFileEntryId: rawInput.sourceFileEntryId,
    checkCount,
    firstScheduledAt,
    parentJobId
  }
}

function narrowOptionalNumber(rawInput: object, key: string): number | undefined | null {
  if (!(key in rawInput)) return undefined

  const value = rawInput[key as keyof typeof rawInput]
  if (value === undefined) return undefined
  return typeof value === 'number' ? value : null
}

function narrowItemJobPayload(
  rawInput: JobSnapshot['input']
): KnowledgePrepareRootPayload | KnowledgeIndexDocumentsPayload | null {
  if (!rawInput || typeof rawInput !== 'object') return null
  if (!('baseId' in rawInput) || typeof rawInput.baseId !== 'string') return null
  if (!('itemId' in rawInput) || typeof rawInput.itemId !== 'string') return null

  return {
    baseId: rawInput.baseId,
    itemId: rawInput.itemId
  }
}

function narrowSubtreeJobPayload(
  rawInput: JobSnapshot['input']
): KnowledgeDeleteSubtreePayload | KnowledgeReindexSubtreePayload | null {
  if (!rawInput || typeof rawInput !== 'object') return null
  if (!('baseId' in rawInput) || typeof rawInput.baseId !== 'string') return null
  if (!('rootItemIds' in rawInput)) return null
  if (!Array.isArray(rawInput.rootItemIds)) return null
  if (!rawInput.rootItemIds.every((itemId) => typeof itemId === 'string')) return null

  return {
    baseId: rawInput.baseId,
    rootItemIds: rawInput.rootItemIds
  }
}
