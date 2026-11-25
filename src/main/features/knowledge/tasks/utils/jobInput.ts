import * as z from 'zod'

import type { JobSnapshot } from '@shared/data/api/schemas/jobs'

import type { KnowledgeDeleteSubtreePayload, KnowledgeIndexDocumentsPayload } from '../jobTypes'

export type NarrowedKnowledgeJobInput =
  | {
      type:
        | 'knowledge.copy-sources'
        | 'knowledge.prepare-root'
        | 'knowledge.index-documents'
        | 'knowledge.check-file-processing-result'
      input: Pick<KnowledgeIndexDocumentsPayload, 'baseId' | 'itemId'>
    }
  | {
      type: 'knowledge.delete-subtree' | 'knowledge.reindex-subtree'
      input: KnowledgeDeleteSubtreePayload
    }

type JobSnapshotInput = Pick<JobSnapshot, 'type' | 'input'>

const itemOwnershipSchema = z.object({ baseId: z.string(), itemId: z.string() })
const subtreeOwnershipSchema = z.object({ baseId: z.string(), rootItemIds: z.array(z.string()) })

/** Execution payload damage must not hide a job's ownership from cancellation or follow-up tracking. */
export function narrowKnowledgeJobInput(snapshot: JobSnapshotInput): NarrowedKnowledgeJobInput | null {
  switch (snapshot.type) {
    case 'knowledge.copy-sources':
    case 'knowledge.prepare-root':
    case 'knowledge.index-documents':
    case 'knowledge.check-file-processing-result': {
      const payload = itemOwnershipSchema.safeParse(snapshot.input)

      return payload.success ? { type: snapshot.type, input: payload.data } : null
    }

    case 'knowledge.delete-subtree':
    case 'knowledge.reindex-subtree': {
      const payload = subtreeOwnershipSchema.safeParse(snapshot.input)

      return payload.success ? { type: snapshot.type, input: payload.data } : null
    }

    default:
      return null
  }
}
