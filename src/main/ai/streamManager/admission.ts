import type { AiStreamAdmissionReason } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'

export type LiveExecutionChangeAdmission =
  | { mode: 'replace-live' }
  | { mode: 'append-live'; groupAnchorMessageId: string }
  | { mode: 'start-new' }

export type LiveExecutionChangeIntent =
  | {
      mode: 'append'
      modelId: UniqueModelId
      targetMessageId: string
      parentAnchorId: string
      siblingsGroupId?: number
      expectedGroupAnchorMessageId?: string
    }
  | {
      mode: 'replace'
      modelId: UniqueModelId
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

export class UnsupportedAgentImageInputError extends Error {
  readonly providerErrorCategory = 'model' as const

  constructor(
    readonly modelId: string,
    message: string
  ) {
    super(message)
    this.name = 'UnsupportedAgentImageInputError'
  }
}
