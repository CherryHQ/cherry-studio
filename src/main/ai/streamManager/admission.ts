import type { ExecutionId } from '@shared/ai/executionIdentity'
import type { AiStreamAdmissionReason } from '@shared/ai/transport'

export type LiveExecutionChangeAdmission =
  | { mode: 'replace-live' }
  | { mode: 'append-live'; groupAnchorMessageId: string }
  | { mode: 'start-new' }

export type LiveExecutionChangeIntent =
  | {
      mode: 'append'
      modelId: ExecutionId
      targetMessageId: string
      parentAnchorId: string
      siblingsGroupId?: number
      expectedGroupAnchorMessageId?: string
    }
  | {
      mode: 'replace'
      modelId: ExecutionId
      anchorMessageId: string
      parentAnchorId: string
      siblingsGroupId?: number
    }
  | { mode: 'start'; modelCount: number }

export class AiStreamAdmissionError extends Error {
  constructor(readonly reason: AiStreamAdmissionReason) {
    super(reason)
    this.name = 'AiStreamAdmissionError'
  }
}
