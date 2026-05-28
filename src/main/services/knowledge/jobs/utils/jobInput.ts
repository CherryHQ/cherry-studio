import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

import type {
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
