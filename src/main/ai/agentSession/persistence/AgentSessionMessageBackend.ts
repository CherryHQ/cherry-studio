/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { AgentSessionUsageCapture } from '@data/services/aiUsageRecord'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { PersistAssistantInput, PersistenceBackend } from '../../streamManager'

export interface AgentSessionMessageBackendOptions {
  /** Cherry Studio agent-session id. */
  sessionId: string
  /** Existing assistant placeholder id to finalize. */
  assistantMessageId: string
  /** Model id used for this assistant message. */
  modelId?: UniqueModelId
  /** Opaque runtime resume token persisted for future recovery; `undefined` when unknown. */
  runtimeResumeToken?: string | (() => string | undefined)
  /** Connection-route-owned usage capture policy, resolved at terminal persistence. */
  usageCapture?: AgentSessionUsageCapture | (() => AgentSessionUsageCapture | undefined)
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly canPersistEmptyTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  persistAssistant(input: PersistAssistantInput): void {
    const { finalMessage, status, stats } = input
    const runtimeResumeToken = this.getRuntimeResumeToken()
    const usageCapture = this.getUsageCapture()
    agentSessionMessageService.saveMessage({
      sessionId: this.opts.sessionId,
      ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
      ...(usageCapture ? { usageCapture } : {}),
      message: {
        id: finalMessage?.id ?? this.opts.assistantMessageId,
        role: 'assistant',
        status,
        data: { parts: finalMessage?.parts ?? [] },
        modelId: this.opts.modelId,
        ...(stats ? { stats } : {})
      }
    })
  }

  private getRuntimeResumeToken(): string | undefined {
    return typeof this.opts.runtimeResumeToken === 'function'
      ? this.opts.runtimeResumeToken()
      : this.opts.runtimeResumeToken
  }

  private getUsageCapture(): AgentSessionUsageCapture | undefined {
    return typeof this.opts.usageCapture === 'function' ? this.opts.usageCapture() : this.opts.usageCapture
  }
}
