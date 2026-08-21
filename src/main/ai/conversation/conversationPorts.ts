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
  terminal(outcome: ConversationOutcome): void
  startFailed(error: SerializedError): void
}

/** Provider streams and Agent connections execute effects but make no admission or settlement decisions. */
export interface ConversationExecutionPort {
  start(effect: StartConversationExecutionEffect, sink: ConversationExecutionSink): void
  requestYield(conversation: ConversationRef, turnId: ConversationTurnId): void
  redirect(effect: RedirectConversationInputEffect): boolean
  resume(effect: ResumeConversationExecutionEffect): void
  abort(effect: AbortConversationExecutionEffect): void
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
  scheduleNextTurn(conversation: ConversationRef, input: ConversationInput): void
  scheduleNextStep(conversation: ConversationRef, turnId: ConversationTurnId, input: ConversationInput): void
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
