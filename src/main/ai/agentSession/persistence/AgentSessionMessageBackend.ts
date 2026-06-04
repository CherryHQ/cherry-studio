/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { v7 as uuidv7 } from 'uuid'

import {
  finalizeInterruptedParts,
  type PersistAssistantInput,
  type PersistenceBackend
} from '../../streamManager/persistence/PersistenceBackend'

export interface AgentSessionMessageBackendOptions {
  /** Cherry Studio agent-session id. */
  sessionId: string
  /** Model id used for this assistant message. */
  modelId?: UniqueModelId
  /** Opaque runtime resume token persisted for future recovery; `undefined` when unknown. */
  runtimeResumeToken?: string | (() => string | undefined)
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, stats } = input
    const parts = finalizeInterruptedParts((finalMessage?.parts ?? []) as CherryMessagePart[], status)
    const runtimeResumeToken = this.getRuntimeResumeToken()
    await agentSessionMessageService.saveMessage({
      sessionId: this.opts.sessionId,
      ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
      message: {
        id: finalMessage?.id ?? uuidv7(),
        role: 'assistant',
        status,
        data: { parts },
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
}
