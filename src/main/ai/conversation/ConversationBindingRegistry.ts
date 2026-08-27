import {
  type ConversationExecutionId,
  type ConversationInputId,
  type ConversationRef,
  conversationRefKey,
  conversationRefsEqual,
  type ConversationTurnId
} from '@shared/ai/conversation'

import type { AgentRuntimeRedirectId, AgentRuntimeSegmentId } from '../runtime/types'
import type {
  CommittedConversationExecution,
  ConversationHistoryPort,
  ConversationPostCommitTaskDescriptor,
  MainDispatchRequest,
  ValidatedConversationIntent
} from '../streamManager'

interface CommittedConversationInputBindingBase {
  readonly request: MainDispatchRequest
  readonly validation?: ValidatedConversationIntent
  readonly historyRowId?: string
  readonly agentAutonomous?: boolean
}

export enum AgentRedirectBindingPhase {
  Queued = 'queued',
  Delivered = 'delivered'
}

type AgentRedirectBinding =
  | {
      readonly phase: AgentRedirectBindingPhase.Queued
      readonly redirectId: AgentRuntimeRedirectId
    }
  | {
      readonly phase: AgentRedirectBindingPhase.Delivered
      readonly redirectId: AgentRuntimeRedirectId
      readonly segmentId: AgentRuntimeSegmentId
    }

export type CommittedConversationInputBinding = CommittedConversationInputBindingBase &
  ({ readonly agentRedirect?: never } | { readonly agentRedirect: AgentRedirectBinding })

export interface ConversationExecutionBinding {
  readonly history: ConversationHistoryPort
  readonly descriptor: CommittedConversationExecution
}

export interface ConversationTurnBinding {
  readonly history: ConversationHistoryPort
  readonly postCommitTasks: readonly ConversationPostCommitTaskDescriptor[]
}

function cloneFrozenSnapshot<T>(value: T): T {
  const snapshot = structuredClone(value)
  const freeze = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) return
    for (const child of Object.values(entry)) freeze(child)
    Object.freeze(entry)
  }
  freeze(snapshot)
  return snapshot
}

/** Process-local descriptors keyed by the aggregate-owned input identity. */
export class ConversationBindingRegistry {
  private readonly inputs = new Map<ConversationInputId, CommittedConversationInputBinding>()
  private readonly executions = new Map<string, ConversationExecutionBinding>()
  private readonly turns = new Map<string, ConversationTurnBinding>()

  setInput(inputId: ConversationInputId, binding: CommittedConversationInputBinding): void {
    this.inputs.set(inputId, {
      ...binding,
      request: cloneFrozenSnapshot(binding.request),
      ...(binding.validation ? { validation: cloneFrozenSnapshot(binding.validation) } : {})
    })
  }

  input(inputId: ConversationInputId): CommittedConversationInputBinding | undefined {
    return this.inputs.get(inputId)
  }

  bindAgentRedirect(inputId: ConversationInputId, redirectId: AgentRuntimeRedirectId): void {
    const binding = this.inputs.get(inputId)
    if (binding) {
      this.inputs.set(inputId, {
        ...binding,
        agentRedirect: { phase: AgentRedirectBindingPhase.Queued, redirectId }
      })
    }
  }

  markAgentSegment(inputId: ConversationInputId, segmentId: AgentRuntimeSegmentId): void {
    const binding = this.inputs.get(inputId)
    if (binding?.agentRedirect) {
      this.inputs.set(inputId, {
        ...binding,
        agentRedirect: {
          phase: AgentRedirectBindingPhase.Delivered,
          redirectId: binding.agentRedirect.redirectId,
          segmentId
        }
      })
    }
  }

  findAgentDelivery(
    ref: ConversationRef,
    userMessageId: string
  ): [ConversationInputId, CommittedConversationInputBinding] | undefined {
    return [...this.inputs].find(
      ([, binding]) =>
        conversationRefsEqual(binding.request.conversation, ref) &&
        binding.request.agentDeliveryMessage?.id === userMessageId
    )
  }

  findAgentRedirect(
    ref: ConversationRef,
    redirectId: AgentRuntimeRedirectId
  ): [ConversationInputId, CommittedConversationInputBinding] | undefined {
    return [...this.inputs].find(
      ([, binding]) =>
        conversationRefsEqual(binding.request.conversation, ref) && binding.agentRedirect?.redirectId === redirectId
    )
  }

  deleteInput(inputId: ConversationInputId): void {
    this.inputs.delete(inputId)
  }

  deleteConversation(ref: ConversationRef): void {
    for (const [inputId, binding] of this.inputs) {
      if (conversationRefsEqual(binding.request.conversation, ref)) this.inputs.delete(inputId)
    }
  }

  hasConversation(ref: ConversationRef): boolean {
    return [...this.inputs.values()].some((binding) => conversationRefsEqual(binding.request.conversation, ref))
  }

  conversationRefs(): readonly ConversationRef[] {
    const refs = new Map<string, ConversationRef>()
    for (const binding of this.inputs.values()) {
      refs.set(conversationRefKey(binding.request.conversation), binding.request.conversation)
    }
    return [...refs.values()]
  }

  values(): IterableIterator<CommittedConversationInputBinding> {
    return this.inputs.values()
  }

  inputEntries(): IterableIterator<[ConversationInputId, CommittedConversationInputBinding]> {
    return this.inputs.entries()
  }

  setTurn(ref: ConversationRef, turnId: ConversationTurnId, binding: ConversationTurnBinding): void {
    this.turns.set(this.turnKey(ref, turnId), binding)
  }

  turn(ref: ConversationRef, turnId: ConversationTurnId): ConversationTurnBinding | undefined {
    return this.turns.get(this.turnKey(ref, turnId))
  }

  setExecution(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId,
    binding: ConversationExecutionBinding
  ): void {
    this.executions.set(this.executionKey(ref, turnId, executionId), binding)
  }

  execution(
    ref: ConversationRef,
    turnId: ConversationTurnId,
    executionId: ConversationExecutionId
  ): ConversationExecutionBinding | undefined {
    return this.executions.get(this.executionKey(ref, turnId, executionId))
  }

  deleteExecution(ref: ConversationRef, turnId: ConversationTurnId, executionId: ConversationExecutionId): void {
    this.executions.delete(this.executionKey(ref, turnId, executionId))
  }

  deleteTurn(ref: ConversationRef, turnId: ConversationTurnId): void {
    this.turns.delete(this.turnKey(ref, turnId))
    const prefix = `${this.turnKey(ref, turnId)}\0`
    for (const key of this.executions.keys()) {
      if (key.startsWith(prefix)) this.executions.delete(key)
    }
  }

  private turnKey(ref: ConversationRef, turnId: ConversationTurnId): string {
    return `${conversationRefKey(ref)}\0${turnId}`
  }

  private executionKey(ref: ConversationRef, turnId: ConversationTurnId, executionId: ConversationExecutionId): string {
    return `${this.turnKey(ref, turnId)}\0${executionId}`
  }
}
