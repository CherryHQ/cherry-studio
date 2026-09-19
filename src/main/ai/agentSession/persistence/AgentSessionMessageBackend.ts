/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import {
  appendNoResponseErrorPart,
  hasVisibleAgentSessionPart,
  type NoResponseErrorPartOptions
} from '@shared/ai/agentSessionNoResponse'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { PersistAssistantInput, PersistenceBackend } from '../../streamManager'

const logger = loggerService.withContext('AgentSessionMessageBackend')

/** Folded into turns that reach `success` without any renderable content (renderer-visible rule). */
const EMPTY_SUCCESS_NO_RESPONSE_ERROR: NoResponseErrorPartOptions = {
  message:
    'This turn produced no output (it may have been interrupted). Resend the message or reply "continue" to recover.',
  i18nKey: 'agent_turn_no_output',
  reason: 'empty-success-terminal'
}

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
  private persistedSuccess = false

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
      ? async (message) => {
          if (this.persistedSuccess) await opts.afterPersist?.(message)
        }
      : undefined
  }

  persistAssistant(input: PersistAssistantInput): void {
    const { finalMessage, status, runtimeStats } = input
    const parts = finalMessage?.parts ?? []
    // A `success` terminal without any renderer-visible part would render as a misleading empty
    // bubble on an OK turn; persist it as an error so the UI and delivery outcome reflect reality.
    const isEmptySuccessTerminal = status === 'success' && !hasVisibleAgentSessionPart(parts)
    const isEmptyPausedTerminal = status === 'paused' && !hasVisibleAgentSessionPart(parts)
    if (isEmptySuccessTerminal) {
      logger.warn('Downgrading empty successful agent turn to terminal error', {
        sessionId: this.opts.sessionId,
        assistantMessageId: this.opts.assistantMessageId
      })
    }
    const runtimeResumeToken = this.getRuntimeResumeToken()
    let forkAnchor: RuntimeForkAnchor | undefined
    if (status === 'success' && !isEmptySuccessTerminal) {
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
            status: isEmptySuccessTerminal ? 'error' : status,
            data: isEmptySuccessTerminal
              ? appendNoResponseErrorPart({ parts }, EMPTY_SUCCESS_NO_RESPONSE_ERROR)
              : isEmptyPausedTerminal
                ? { parts: [...parts, { type: 'data-agent-paused', data: {} }] }
                : { parts },
            modelId: this.opts.modelId
          }
        },
        { publishDataChange: true }
      )
    try {
      save(forkAnchor)
    } catch (error) {
      if (!forkAnchor) throw error
      logger.warn('Fork checkpoint persistence failed; retrying completed answer without checkpoint', { error })
      save()
    }
    this.persistedSuccess = status === 'success' && !isEmptySuccessTerminal
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
