/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionForkContextService } from '@data/services/AgentSessionForkContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import { FORK_CHECKPOINT_FAILED, NOT_FORK_BOUNDARY, type RuntimeForkState } from '../../runtime/forkCheckpoint'
import type { PersistAssistantInput, PersistenceBackend } from '../../streamManager'

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
  forkState?: () => RuntimeForkState | undefined
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

  persistAssistant(input: PersistAssistantInput): void {
    const { finalMessage, status, runtimeStats } = input
    const runtimeResumeToken = this.getRuntimeResumeToken()
    let forkState = NOT_FORK_BOUNDARY
    if (status === 'success') {
      try {
        forkState = this.opts.forkState?.() ?? NOT_FORK_BOUNDARY
      } catch (error) {
        logger.warn('Fork checkpoint capture failed; preserving completed answer', { error })
        forkState = FORK_CHECKPOINT_FAILED
      }
    }
    const save = (runtimeForkState: RuntimeForkState) =>
      agentSessionMessageService.saveMessage(
        {
          sessionId: this.opts.sessionId,
          runtimeForkState,
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
    try {
      save(forkState)
    } catch (error) {
      if (forkState.status !== 'available') throw error
      logger.warn('Fork checkpoint persistence failed; retrying completed answer without checkpoint', { error })
      save(FORK_CHECKPOINT_FAILED)
    }
    if (status === 'success' && runtimeResumeToken) {
      try {
        agentSessionForkContextService.confirmSend(
          this.opts.sessionId,
          runtimeResumeToken,
          finalMessage?.id ?? this.opts.assistantMessageId
        )
      } catch (error) {
        logger.warn('Fork context receipt remains pending reconciliation', { error })
      }
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
