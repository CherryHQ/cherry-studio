/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { PersistAssistantInput, PersistedAssistant, PersistenceBackend } from '../../streamManager'

const logger = loggerService.withContext('AgentSessionMessageBackend')

export interface AgentSessionMessageBackendOptions {
  /** Cherry Studio agent-session id. */
  sessionId: string
  /** Existing assistant placeholder id to finalize. */
  assistantMessageId: string
  /** Model id used for this assistant message. */
  modelId?: UniqueModelId
  /** Opaque runtime resume token persisted for future recovery; `undefined` when unknown. */
  runtimeResumeToken?: string | (() => string | undefined)
  forkAnchor?: () => RuntimeForkAnchor | undefined
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly canPersistEmptyTerminal = true
  readonly canPersistEmptySuccessTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  persistAssistant(input: PersistAssistantInput): PersistedAssistant {
    const { finalMessage, status, runtimeStats } = input
    const runtimeResumeToken = this.getRuntimeResumeToken()
    let forkAnchor: RuntimeForkAnchor | undefined
    if (status === 'success') {
      try {
        const candidate = this.opts.forkAnchor?.()
        forkAnchor = candidate === undefined ? undefined : RuntimeForkAnchorSchema.parse(candidate)
      } catch (error) {
        logger.warn('Fork checkpoint capture failed; preserving completed answer', { error })
      }
    }
    const save = (runtimeAnchor?: RuntimeForkAnchor) =>
      agentSessionMessageService.saveMessage(
        {
          sessionId: this.opts.sessionId,
          runtimeAnchor,
          ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
          ...(runtimeStats ? { runtimeStats } : {}),
          message: {
            id: finalMessage?.id ?? this.opts.assistantMessageId,
            role: 'assistant',
            status,
            data: { parts: finalMessage?.parts ?? [] },
            modelId: this.opts.modelId
          }
        },
        { publishDataChange: true }
      )
    let saved
    try {
      saved = save(forkAnchor)
    } catch (error) {
      if (!forkAnchor) throw error
      logger.warn('Fork checkpoint persistence failed; retrying completed answer without checkpoint', { error })
      saved = save()
    }
    return {
      messageId: saved.id,
      messageRevision: String(Date.parse(saved.updatedAt)),
      historyRevision: String(Date.parse(agentSessionService.getConversationById(this.opts.sessionId).updatedAt))
    }
  }

  markTerminalError(): void {
    agentSessionMessageService.markAssistantMessageTerminalError(this.opts.sessionId, this.opts.assistantMessageId)
  }

  private getRuntimeResumeToken(): string | undefined {
    return typeof this.opts.runtimeResumeToken === 'function'
      ? this.opts.runtimeResumeToken()
      : this.opts.runtimeResumeToken
  }
}
