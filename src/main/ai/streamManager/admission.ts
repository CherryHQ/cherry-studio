import type { AttemptId } from '@shared/ai/attempt'
import type { AiStreamAdmissionReason } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'

import type { ContinuationLeaseId } from './topicStreamState'

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

export type RuntimeTurnAdmission = { kind: 'fresh' } | { kind: 'continuation'; leaseId: ContinuationLeaseId }

export type StreamIntent =
  | { kind: 'start'; modelCount: number }
  | { kind: 'append-live'; change: Extract<LiveExecutionChangeIntent, { mode: 'append' }> }
  | { kind: 'replace-live'; change: Extract<LiveExecutionChangeIntent, { mode: 'replace' }> }
  | { kind: 'steer-inject' }
  | { kind: 'steer-continuation' }
  | { kind: 'continue-conversation'; anchorMessageId: string }
  | { kind: 'runtime-turn'; admission: RuntimeTurnAdmission }
  | { kind: 'prompt' }

/** Whether the topic stays on its current branch while this dispatch reserves rows. */
export interface ActiveNodeDecision {
  readonly move: 'advance' | 'keep'
}

/** Result of a synchronously committed topic command. */
export interface DispatchCommandReceipt {
  readonly intent: StreamIntent
  readonly admission: LiveExecutionChangeAdmission
  readonly activeNodeDecision: ActiveNodeDecision
  /** Attempts installed by a committed reservation, in model order. */
  readonly reservedAttemptIds?: readonly AttemptId[]
}

export class AiStreamAdmissionError extends Error {
  constructor(readonly reason: AiStreamAdmissionReason) {
    super(reason)
    this.name = 'AiStreamAdmissionError'
  }
}
