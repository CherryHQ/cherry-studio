/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import type { RootProjectionCheckpoint } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
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
  projection?: () => RootProjectionCheckpoint | undefined
  /** Runs at the synchronous commit boundary, before any terminal observer or post-save work. */
  onPersisted?: () => void
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly assistantMessageId: string
  readonly canPersistEmptyTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
    this.assistantMessageId = opts.assistantMessageId
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
    const projection = this.opts.projection?.()
    const parts = finalMessage?.parts ?? []
    const save = (runtimeAnchor?: RuntimeForkAnchor) => {
      const nativeContext =
        runtimeResumeToken && runtimeAnchor?.checkpoint.runtime === 'pi'
          ? preparePiBranch(this.opts.sessionId, finalMessage?.id ?? this.opts.assistantMessageId, runtimeResumeToken)
          : undefined
      return agentSessionMessageService.saveMessage(
        {
          sessionId: this.opts.sessionId,
          runtimeAnchor,
          ...(runtimeAnchor && nativeContext ? { nativeContextId: nativeContext.id } : {}),
          ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
          ...(runtimeStats ? { runtimeStats } : {}),
          message: {
            id: finalMessage?.id ?? this.opts.assistantMessageId,
            role: 'assistant',
            status,
            data: { parts },
            modelId: this.opts.modelId
          }
        },
        {
          publishDataChange: true,
          projection
        }
      )
    }
    let saved
    try {
      saved = save(forkAnchor)
    } catch (error) {
      if (!forkAnchor) throw error
      logger.warn('Fork checkpoint persistence failed; retrying completed answer without checkpoint', { error })
      saved = save()
    }
    this.opts.onPersisted?.()
    return {
      messageId: saved.id,
      messageRevision: String(Date.parse(saved.updatedAt)),
      historyRevision: String(Date.parse(agentSessionService.getById(this.opts.sessionId).updatedAt))
    }
  }

  markTerminalError(): void {
    agentSessionMessageService.markAssistantMessageTerminalError(
      this.opts.sessionId,
      this.opts.assistantMessageId,
      'turn.persist_failed'
    )
  }

  private getRuntimeResumeToken(): string | undefined {
    return typeof this.opts.runtimeResumeToken === 'function'
      ? this.opts.runtimeResumeToken()
      : this.opts.runtimeResumeToken
  }
}
