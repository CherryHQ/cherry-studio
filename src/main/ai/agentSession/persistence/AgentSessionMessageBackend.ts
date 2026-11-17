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
import {
  appendNoResponseErrorPart,
  EMPTY_SUCCESS_NO_RESPONSE_I18N_KEY,
  EMPTY_SUCCESS_NO_RESPONSE_MESSAGE,
  hasVisibleAgentSessionPart,
  type NoResponseErrorPartOptions
} from '@shared/ai/agentSessionNoResponse'
import type { CherryUIMessage, MessageData } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { PersistAssistantInput, PersistedAssistant, PersistenceBackend } from '../../streamManager'

const logger = loggerService.withContext('AgentSessionMessageBackend')

/** Folded into turns that reach `success` without any renderable content (renderer-visible rule). */
const EMPTY_SUCCESS_NO_RESPONSE_ERROR: NoResponseErrorPartOptions = {
  message: EMPTY_SUCCESS_NO_RESPONSE_MESSAGE,
  i18nKey: EMPTY_SUCCESS_NO_RESPONSE_I18N_KEY,
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
  projection?: () => RootProjectionCheckpoint | undefined
  /** Runs at the synchronous commit boundary, before any terminal observer or post-save work. */
  onPersisted?: () => void
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly canPersistEmptyTerminal = true
  // This gates the `finalMessage === undefined` terminal (see PersistenceListener: a terminal event with
  // no message object at all), NOT "an empty successful response is acceptable". This backend downgrades
  // a success terminal whose parts are all non-visible to an error below, so the two must not be read
  // as the same claim. Flipping this to `false` would strand zero-chunk turns as `pending` forever.
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

  persistAssistant(input: PersistAssistantInput): PersistedAssistant {
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
    const persistedStatus = isEmptySuccessTerminal ? 'error' : status
    const persistedParts = (
      isEmptySuccessTerminal
        ? appendNoResponseErrorPart({ parts }, EMPTY_SUCCESS_NO_RESPONSE_ERROR)
        : isEmptyPausedTerminal
          ? { parts: [...parts, { type: 'data-agent-paused', data: {} }] }
          : { parts }
    ) satisfies MessageData
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
            status: persistedStatus,
            data: persistedParts,
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
    // Set before `onPersisted`/`afterPersist` run: a downgraded empty success must not drive the
    // success-only hooks off the SDK's status.
    this.persistedSuccess = status === 'success' && !isEmptySuccessTerminal
    this.opts.onPersisted?.()
    return {
      messageId: saved.id,
      messageRevision: String(Date.parse(saved.updatedAt)),
      historyRevision: String(Date.parse(agentSessionService.getById(this.opts.sessionId).updatedAt)),
      // Report the downgrade so terminal dispatch can reclassify the event: subscribers otherwise
      // publish a completed execution for a row this backend just wrote as failed.
      ...(isEmptySuccessTerminal ? { downgradedToError: true } : {})
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
