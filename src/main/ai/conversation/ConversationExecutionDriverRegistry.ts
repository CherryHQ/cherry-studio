import { application } from '@application'
import { AgentConversationRuntimeTurnKind } from '@main/ai/agentSession/AgentConnectionManager'
import { AgentConversationResourceEffectResultKind } from '@main/ai/agentSession/agentConversationResourceResult'
import { applyTurnInputAttributes, startAiChildTurnSpan } from '@main/ai/observability'
import {
  agentChatContextProvider,
  ConversationAgentRuntimeTurnKind,
  type ConversationExecutionContext,
  type ConversationExecutionDriverBinding,
  ConversationExecutionDriverBindingKind,
  type ConversationExecutionPreparationDescriptor,
  ConversationExecutionPreparationKind,
  type ConversationTelemetryDescriptor,
  ConversationTelemetryKind,
  persistentChatContextProvider,
  temporaryChatContextProvider
} from '@main/ai/streamManager'
import type { Span } from '@opentelemetry/api'
import { ConversationKind } from '@shared/ai/conversation'

import type {
  DiscardConversationRuntimeBufferEffect,
  RedirectConversationInputEffect,
  ResumeSuspendedConversationExecutionEffect,
  SuspendConversationExecutionEffect
} from './conversationPorts'

export interface ConversationExecutionDriverControl {
  redirect(effect: RedirectConversationInputEffect): boolean
}

export interface ConversationExecutionDriver {
  setControl(control: ConversationExecutionDriverControl): void
  prepare(
    descriptor: ConversationExecutionPreparationDescriptor,
    driver: ConversationExecutionDriverBinding,
    signal: AbortSignal,
    sink?: Parameters<typeof persistentChatContextProvider.prepareExecutionContext>[2]
  ): Promise<ConversationExecutionContext>
  openTelemetry(descriptor: ConversationTelemetryDescriptor | undefined): Span | undefined
  annotateTelemetry(
    descriptor: ConversationTelemetryDescriptor | undefined,
    span: Span | undefined,
    messages: unknown[]
  ): void
  redirect(effect: RedirectConversationInputEffect): boolean
  suspend(driver: ConversationExecutionDriverBinding, effect: SuspendConversationExecutionEffect): boolean
  resumeSuspended(driver: ConversationExecutionDriverBinding, effect: ResumeSuspendedConversationExecutionEffect): void
  discardRuntimeBuffer(driver: ConversationExecutionDriverBinding, effect: DiscardConversationRuntimeBufferEffect): void
}

/** Routes named execution descriptors to resource implementations without owning control state. */
export class ConversationExecutionDriverRegistry implements ConversationExecutionDriver {
  constructor(private control?: ConversationExecutionDriverControl) {}

  setControl(control: ConversationExecutionDriverControl): void {
    this.control = control
  }

  async prepare(
    descriptor: ConversationExecutionPreparationDescriptor,
    driver: ConversationExecutionDriverBinding,
    signal: AbortSignal,
    sink?: Parameters<typeof persistentChatContextProvider.prepareExecutionContext>[2]
  ): Promise<ConversationExecutionContext> {
    if (driver.kind === ConversationExecutionDriverBindingKind.Agent) {
      if (descriptor.kind === ConversationExecutionPreparationKind.AgentFresh) {
        application.get('AgentConnectionManager').prepareTurnResources({
          conversation: descriptor.conversation,
          agentId: descriptor.agentId,
          agentType: descriptor.agentType,
          modelId: descriptor.modelId,
          reasoningEffort: descriptor.reasoningEffort,
          serviceTier: descriptor.serviceTier,
          fastMode: descriptor.fastMode,
          assistantMessageId: descriptor.outputNodeId,
          userMessage: descriptor.userMessage,
          headless: descriptor.headless,
          traceId: descriptor.traceId,
          messageSnapshot: descriptor.messageSnapshot,
          shouldAutoName: descriptor.shouldAutoName,
          turnId: descriptor.runtimeTurnId
        })
      } else if (descriptor.kind === ConversationExecutionPreparationKind.AgentRuntime) {
        await application.get('AgentConnectionManager').activateConversationRuntimeTurn(
          {
            kind:
              descriptor.runtimeKind === ConversationAgentRuntimeTurnKind.Autonomous
                ? AgentConversationRuntimeTurnKind.Autonomous
                : AgentConversationRuntimeTurnKind.NativeContinuation,
            conversation: descriptor.conversation,
            agentId: descriptor.agentId,
            modelId: descriptor.modelId,
            reasoningEffort: descriptor.reasoningEffort,
            serviceTier: descriptor.serviceTier,
            fastMode: descriptor.fastMode,
            knowledgeBaseIds: descriptor.knowledgeBaseIds,
            headless: descriptor.headless,
            userMessage: descriptor.userMessage,
            assistantMessageId: descriptor.outputNodeId,
            runtimeTurnId: descriptor.runtimeTurnId,
            ...(descriptor.sourceTurnId ? { sourceTurnId: descriptor.sourceTurnId } : {}),
            ...(descriptor.messageSnapshot ? { messageSnapshot: descriptor.messageSnapshot } : {}),
            ...(descriptor.traceId ? { traceId: descriptor.traceId } : {})
          },
          signal
        )
      }
      return agentChatContextProvider.prepareExecutionContext(descriptor, signal)
    }
    if (descriptor.kind === ConversationExecutionPreparationKind.TemporaryChat) {
      return temporaryChatContextProvider.prepareExecutionContext(descriptor, signal)
    }
    return persistentChatContextProvider.prepareExecutionContext(descriptor, signal, sink)
  }

  openTelemetry(descriptor: ConversationTelemetryDescriptor | undefined): Span | undefined {
    if (!descriptor) return undefined
    const isAgent = descriptor.kind === ConversationTelemetryKind.Agent
    return startAiChildTurnSpan(
      'ai.turn',
      {
        attributes: {
          'cs.topic_id': isAgent ? descriptor.sessionId : descriptor.topicId,
          'cs.trigger': descriptor.trigger,
          'cs.model_id': descriptor.modelId,
          'cs.role': 'assistant',
          ...(isAgent ? { 'cs.agent_id': descriptor.agentId, 'cs.session_id': descriptor.sessionId } : {})
        }
      },
      {
        topicId: isAgent ? descriptor.sessionId : descriptor.topicId,
        modelName: descriptor.modelName
      },
      descriptor.traceId
    ).rootSpan
  }

  annotateTelemetry(
    descriptor: ConversationTelemetryDescriptor | undefined,
    span: Span | undefined,
    messages: unknown[]
  ): void {
    if (!descriptor || !span) return
    applyTurnInputAttributes(span, {
      modelId: descriptor.modelId,
      topicId: descriptor.kind === ConversationTelemetryKind.Agent ? descriptor.sessionId : descriptor.topicId,
      operation: descriptor.kind === ConversationTelemetryKind.Agent ? 'invoke_agent' : 'chat',
      messages: messages as Parameters<typeof applyTurnInputAttributes>[1]['messages'],
      ...(descriptor.kind === ConversationTelemetryKind.Agent && descriptor.agentName
        ? { agentName: descriptor.agentName }
        : {})
    })
  }

  redirect(effect: RedirectConversationInputEffect): boolean {
    return this.control?.redirect(effect) === true
  }

  suspend(driver: ConversationExecutionDriverBinding, effect: SuspendConversationExecutionEffect): boolean {
    if (
      driver.kind !== ConversationExecutionDriverBindingKind.Agent ||
      effect.conversation.kind !== ConversationKind.Agent
    ) {
      return false
    }
    return (
      application.get('AgentConnectionManager').suspendConversationExecution(effect, driver.runtimeTurnId).kind ===
      AgentConversationResourceEffectResultKind.Applied
    )
  }

  resumeSuspended(
    driver: ConversationExecutionDriverBinding,
    effect: ResumeSuspendedConversationExecutionEffect
  ): void {
    if (
      driver.kind !== ConversationExecutionDriverBindingKind.Agent ||
      effect.conversation.kind !== ConversationKind.Agent
    ) {
      return
    }
    const result = application.get('AgentConnectionManager').resumeConversationExecution(effect, driver.runtimeTurnId)
    if (result.kind !== AgentConversationResourceEffectResultKind.Applied) {
      throw new Error(`Agent Conversation resume effect ${effect.effectId} is stale`)
    }
  }

  discardRuntimeBuffer(
    driver: ConversationExecutionDriverBinding,
    effect: DiscardConversationRuntimeBufferEffect
  ): void {
    if (
      driver.kind !== ConversationExecutionDriverBindingKind.Agent ||
      effect.conversation.kind !== ConversationKind.Agent
    ) {
      return
    }
    application.get('AgentConnectionManager').discardAutonomousBuffer(effect)
  }
}
