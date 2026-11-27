/**
 * Agent-session DB backend — writes assistant turns to the `agent_session_message`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { v7 as uuidv7 } from 'uuid'

import type { RootProjectionCheckpoint } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { createClearContextPart, hasClearContextPart } from '@shared/data/types/uiParts'

import type { PersistAssistantInput, PersistedAssistant, PersistenceBackend } from '../../streamManager'

const logger = loggerService.withContext('AgentSessionMessageBackend')

// Keep in sync with HIDDEN_PART_TYPES in src/renderer/components/chat/messages/blocks/messagePartPresentation.ts.
const HIDDEN_PART_TYPES: ReadonlySet<string> = new Set([
  'step-start',
  'source-url',
  'source-document',
  'data-citation',
  'data-agent-task-event',
  'data-knowledge-scope',
  'data-clear'
])

/**
 * Mark an empty successful reply to a locally handled command (e.g. `/clear`)
 * as a context boundary so the renderer shows a divider rather than a no-response error.
 */
export function withLocalCommandBoundaryPart(
  sessionId: string,
  messageId: string,
  status: PersistAssistantInput['status'],
  parts: CherryMessagePart[]
): CherryMessagePart[] {
  if (
    status !== 'success' ||
    hasClearContextPart(parts) ||
    parts.some((part) => !HIDDEN_PART_TYPES.has(part.type)) ||
    !agentSessionMessageService.isLocallyHandledReply(sessionId, messageId)
  ) {
    return parts
  }
  return [...parts, createClearContextPart()]
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
  /** Identities parallel to the saved reply's parts, with their assigned timeline positions. */
  partPlacement?: (
    messageId: string
  ) => { partIds: readonly string[]; positions?: ReadonlyMap<string, number> } | undefined
  /** Runs at the synchronous commit boundary, before any terminal observer or post-save work. */
  onPersisted?: () => void
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend<'agents-db'> {
  readonly kind = 'agents-db'
  readonly canPersistEmptyTerminal = true
  readonly canPersistEmptySuccessTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  persistAssistant(input: PersistAssistantInput): PersistedAssistant<'agents-db'> {
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
    const rawParts = finalMessage?.parts ?? []
    const messageId = finalMessage?.id ?? this.opts.assistantMessageId
    const parts = withLocalCommandBoundaryPart(this.opts.sessionId, messageId, status, rawParts)
    const rawPlacement = this.opts.partPlacement?.(messageId)
    const boundaryActive = parts !== rawParts || hasClearContextPart(parts)
    const parallelMessagePartIds =
      finalMessage?.partIds &&
      finalMessage.partIds.length === parts.length &&
      new Set(finalMessage.partIds).size === parts.length
        ? finalMessage.partIds
        : undefined
    const placement = rawPlacement
      ? boundaryActive && parts.length === rawPlacement.partIds.length + 1
        ? {
            ...rawPlacement,
            partIds: [
              ...rawPlacement.partIds,
              parallelMessagePartIds && !rawPlacement.partIds.includes(parallelMessagePartIds.at(-1)!)
                ? parallelMessagePartIds.at(-1)!
                : uuidv7()
            ]
          }
        : rawPlacement
      : boundaryActive && parallelMessagePartIds
        ? { partIds: parallelMessagePartIds }
        : undefined
    const save = (runtimeAnchor?: RuntimeForkAnchor) => {
      const nativeContext =
        runtimeResumeToken && runtimeAnchor?.checkpoint.runtime === 'pi'
          ? preparePiBranch(this.opts.sessionId, messageId, runtimeResumeToken)
          : undefined
      return agentSessionMessageService.saveMessage(
        {
          sessionId: this.opts.sessionId,
          runtimeAnchor,
          ...(runtimeAnchor && nativeContext ? { nativeContextId: nativeContext.id } : {}),
          ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
          ...(runtimeStats ? { runtimeStats } : {}),
          ...placement,
          message: {
            id: messageId,
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
    agentSessionMessageService.markAssistantMessageTerminalError(this.opts.sessionId, this.opts.assistantMessageId)
  }

  private getRuntimeResumeToken(): string | undefined {
    return typeof this.opts.runtimeResumeToken === 'function'
      ? this.opts.runtimeResumeToken()
      : this.opts.runtimeResumeToken
  }
}
