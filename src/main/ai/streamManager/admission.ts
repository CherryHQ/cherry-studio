import type { AiStreamAdmissionReason } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'

export type LiveExecutionChangeAdmission =
  | { mode: 'replace-live' }
  | { mode: 'append-live'; groupAnchorMessageId: string }
  | { mode: 'inject' }
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

export type StreamIntent =
  | { kind: 'start'; modelCount: number }
  | { kind: 'append-live'; change: Extract<LiveExecutionChangeIntent, { mode: 'append' }> }
  | { kind: 'replace-live'; change: Extract<LiveExecutionChangeIntent, { mode: 'replace' }> }
  | { kind: 'steer-inject' }
  | { kind: 'steer-continuation' }
  | { kind: 'continue-conversation' }
  | { kind: 'runtime-turn' }
  | { kind: 'prompt' }

export interface DispatchTicket {
  readonly intent: StreamIntent
  readonly admission: LiveExecutionChangeAdmission
  readonly activeNodeDecision: { readonly move: 'advance' | 'keep' }
}

export class AiStreamAdmissionError extends Error {
  constructor(readonly reason: AiStreamAdmissionReason) {
    super(reason)
    this.name = 'AiStreamAdmissionError'
  }
}
