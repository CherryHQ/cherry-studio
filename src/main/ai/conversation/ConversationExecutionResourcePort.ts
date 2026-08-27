import type { ConversationRef, ConversationTurnId } from '@shared/ai/conversation'

import type { AgentRuntimeRedirectReceipt } from '../runtime/types'
import type { AiExecutionManager, AiExecutionResourceDescriptor } from './AiExecutionManager'
import type {
  AbortConversationExecutionEffect,
  ConversationExecutionAbortHandle,
  ConversationExecutionPort,
  ConversationExecutionSink,
  DiscardConversationRuntimeBufferEffect,
  RedirectConversationInputEffect,
  ResumeConversationExecutionEffect,
  ResumeSuspendedConversationExecutionEffect,
  StartConversationExecutionEffect,
  SuspendConversationExecutionEffect
} from './conversationPorts'

export type ConversationExecutionDescriptorResolver = (
  effect: StartConversationExecutionEffect
) => AiExecutionResourceDescriptor

/** Materializes exact execution descriptors only after the aggregate emits StartExecution. */
export class ConversationExecutionResourcePort implements ConversationExecutionPort {
  constructor(
    private readonly manager: AiExecutionManager,
    private readonly resolveDescriptor: ConversationExecutionDescriptorResolver
  ) {}

  start(effect: StartConversationExecutionEffect, sink: ConversationExecutionSink): void {
    const descriptor = this.resolveDescriptor(effect)
    this.manager.release(effect.conversation, effect.turnId, effect.executionId)
    this.manager.register(descriptor)
    this.manager.start(effect, sink)
  }

  requestYield(conversation: ConversationRef, turnId: ConversationTurnId): void {
    this.manager.requestYield(conversation, turnId)
  }

  redirect(effect: RedirectConversationInputEffect): AgentRuntimeRedirectReceipt {
    return this.manager.redirect(effect)
  }

  resume(effect: ResumeConversationExecutionEffect): void {
    this.manager.resume(effect)
  }

  suspend(effect: SuspendConversationExecutionEffect): boolean {
    return this.manager.suspend(effect)
  }

  resumeSuspended(effect: ResumeSuspendedConversationExecutionEffect): void {
    this.manager.resumeSuspended(effect)
  }

  discardRuntimeBuffer(effect: DiscardConversationRuntimeBufferEffect): void {
    this.manager.discardRuntimeBuffer(effect)
  }

  abort(effect: AbortConversationExecutionEffect): ConversationExecutionAbortHandle {
    return this.manager.abort(effect)
  }
}
