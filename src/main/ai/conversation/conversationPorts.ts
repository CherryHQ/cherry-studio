import type {
  ConversationEffectId,
  ConversationExecutionId,
  ConversationInputId,
  ConversationInteractionId,
  ConversationRef,
  ConversationTurnId
} from '@shared/ai/conversation'
import type { SerializedError } from '@shared/types/error'

import type {
  ConversationEffect,
  ConversationInput,
  ConversationInteractionFact,
  ConversationOutcome
} from './conversationState'
import type { ConversationEffectType } from './conversationState'

export type StartConversationExecutionEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.StartExecution }
>
export type RedirectConversationInputEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.RedirectInput }
>
export type ResumeConversationExecutionEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.ResumeExecution }
>
export type AbortConversationExecutionEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.AbortExecution }
>
export type SuspendConversationExecutionEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.SuspendExecution }
>
export type ResumeSuspendedConversationExecutionEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.ResumeSuspendedExecution }
>
export type DiscardConversationRuntimeBufferEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.DiscardRuntimeBuffer }
>
export type PersistConversationTerminalEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.PersistTerminal }
>
export type PublishConversationStatusEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.PublishStatus }
>
export type PublishConversationExecutionTerminalEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.PublishExecutionTerminal }
>
export type PublishConversationTurnTerminalEffect = Extract<
  ConversationEffect,
  { type: ConversationEffectType.PublishTurnTerminal }
>

export enum ConversationTerminalPersistenceResultKind {
  Durable = 'durable',
  Failed = 'failed',
  Abandoned = 'abandoned'
}

export interface ConversationRuntimeCheckpoint {
  readonly runtimeResumeToken?: string
}

export enum ConversationExecutionAbortResultKind {
  Completed = 'completed',
  Stale = 'stale',
  Failed = 'failed'
}

export type ConversationExecutionAbortResult =
  | {
      readonly kind: ConversationExecutionAbortResultKind.Completed | ConversationExecutionAbortResultKind.Stale
      readonly conversation: ConversationRef
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly effectId: ConversationEffectId
    }
  | {
      readonly kind: ConversationExecutionAbortResultKind.Failed
      readonly conversation: ConversationRef
      readonly turnId: ConversationTurnId
      readonly executionId: ConversationExecutionId
      readonly effectId: ConversationEffectId
      readonly error: SerializedError
    }

export interface ConversationExecutionAbortHandle {
  readonly checkpoint?: ConversationRuntimeCheckpoint
  readonly completed: Promise<ConversationExecutionAbortResult>
}

export type ConversationTerminalPersistenceResult =
  | { readonly kind: ConversationTerminalPersistenceResultKind.Durable }
  | { readonly kind: ConversationTerminalPersistenceResultKind.Failed; readonly error: SerializedError }
  | { readonly kind: ConversationTerminalPersistenceResultKind.Abandoned; readonly error: SerializedError }

/** Existing SQLite rows remain the durable truth behind each profile adapter. */
export interface ConversationTerminalPersistencePort {
  persistTerminal(effect: PersistConversationTerminalEffect): Promise<ConversationTerminalPersistenceResult>
}

export interface ConversationExecutionSink {
  firstChunk(): void
  interactionOpened(interaction: ConversationInteractionFact): void
  interactionCompleted(interactionId: ConversationInteractionId): void
  terminal(outcome: ConversationOutcome): void
  startFailed(error: SerializedError): void
}

/** Provider streams and Agent connections execute effects but make no admission or settlement decisions. */
export interface ConversationExecutionPort {
  start(effect: StartConversationExecutionEffect, sink: ConversationExecutionSink): void
  requestYield(conversation: ConversationRef, turnId: ConversationTurnId): void
  redirect(effect: RedirectConversationInputEffect): boolean
  resume(effect: ResumeConversationExecutionEffect): void
  suspend(effect: SuspendConversationExecutionEffect): boolean
  resumeSuspended(effect: ResumeSuspendedConversationExecutionEffect): void
  discardRuntimeBuffer(effect: DiscardConversationRuntimeBufferEffect): void
  abort(effect: AbortConversationExecutionEffect): ConversationExecutionAbortHandle
}

export interface ConversationPresentationPort {
  publishStatus(effect: PublishConversationStatusEffect): void
  publishExecutionTerminal(effect: PublishConversationExecutionTerminalEffect): void
  publishTurnTerminal(effect: PublishConversationTurnTerminalEffect): void
  publishQuiescence(conversation: ConversationRef, turnId: ConversationTurnId): void
}

export interface ConversationRuntimePortSet {
  readonly terminalPersistence: ConversationTerminalPersistencePort
  readonly execution: ConversationExecutionPort
  readonly presentation: ConversationPresentationPort
  scheduleNextTurn(conversation: ConversationRef, inputs: readonly ConversationInput[]): void
  scheduleNextStep(conversation: ConversationRef, turnId: ConversationTurnId, input: ConversationInput): void
  dropInputs(conversation: ConversationRef, inputs: readonly ConversationInput[]): void
  scheduleRuntimeTurn(
    conversation: ConversationRef,
    input: ConversationInput,
    suspendEffectId: ConversationEffectId
  ): void
}

export interface ConversationPortResolver {
  resolve(conversation: ConversationRef): ConversationRuntimePortSet
}

export interface ConversationRuntimeIdFactory {
  turn(): ConversationTurnId
  execution(): ConversationExecutionId
  effect(): ConversationEffectId
  interaction(): ConversationInteractionId
  input(): ConversationInputId
}
