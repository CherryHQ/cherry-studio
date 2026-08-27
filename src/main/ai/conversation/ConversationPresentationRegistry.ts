import {
  type ConversationExecutionId,
  type ConversationRef,
  conversationRefKey,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type { ActiveNodeDecision } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../streamManager'

export interface ConversationPresentationBinding {
  readonly subscriber: StreamListener
  readonly extraListeners?: readonly StreamListener[]
  readonly inboxVisible?: boolean
}

export interface ConversationExecutionProjection {
  readonly id: ConversationExecutionId
  readonly modelId: UniqueModelId
  readonly outputNodeId: string
  readonly seedFromEmpty: boolean
  readonly listeners: Map<string, StreamListener>
}

export interface ConversationTurnProjection {
  readonly ref: ConversationRef
  readonly id: ConversationTurnId
  readonly inputId: string
  readonly isPersistentConversation: boolean
  readonly listeners: Map<string, StreamListener>
  readonly executions: Map<ConversationExecutionId, ConversationExecutionProjection>
  readonly reservedMessages: readonly CherryUIMessage[]
  readonly activeNodeDecision: ActiveNodeDecision
  terminal?: StreamDoneResult | StreamPausedResult | StreamErrorResult
  quiescencePublished?: boolean
  cleanupTimer?: ReturnType<typeof setTimeout>
}

/** Exact renderer/listener projections; entries never participate in control admission. */
export class ConversationPresentationRegistry {
  private readonly inputBindings = new Map<string, ConversationPresentationBinding>()
  private readonly turns = new Map<string, ConversationTurnProjection>()

  bindInput(inputId: string, binding: ConversationPresentationBinding): void {
    this.inputBindings.set(inputId, binding)
  }

  inputBinding(inputId: string): ConversationPresentationBinding | undefined {
    return this.inputBindings.get(inputId)
  }

  deleteInput(inputId: string): void {
    this.inputBindings.delete(inputId)
  }

  setTurn(turn: ConversationTurnProjection): void {
    this.turns.set(this.turnKey(turn.ref, turn.id), turn)
  }

  turn(ref: ConversationRef, turnId: ConversationTurnId): ConversationTurnProjection | undefined {
    return this.turns.get(this.turnKey(ref, turnId))
  }

  latestTurn(ref: ConversationRef, currentTurnId?: ConversationTurnId): ConversationTurnProjection | undefined {
    if (currentTurnId) {
      const current = this.turn(ref, currentTurnId)
      if (current) return current
    }
    const prefix = `${conversationRefKey(ref)}\0`
    return [...this.turns].findLast(([key]) => key.startsWith(prefix))?.[1]
  }

  deleteTurn(ref: ConversationRef, turnId: ConversationTurnId): void {
    this.turns.delete(this.turnKey(ref, turnId))
  }

  values(): IterableIterator<ConversationTurnProjection> {
    return this.turns.values()
  }

  private turnKey(ref: ConversationRef, turnId: ConversationTurnId): string {
    return `${conversationRefKey(ref)}\0${turnId}`
  }
}
