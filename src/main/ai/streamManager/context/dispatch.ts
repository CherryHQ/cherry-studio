/**
 * Single dispatch path for stream requests: pick provider, prepare,
 * `manager.send`, shape the response. See
 * `docs/references/ai/stream-manager.md`.
 */

import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse, ApprovalDecision } from '@shared/ai/transport'

import { isAgentSessionWorkspaceError } from '../../runtime/claudeCode/settingsBuilder'
import type { AiStreamManager } from '../AiStreamManager'
import type { StreamListener } from '../types'
import { agentChatContextProvider } from './AgentChatContextProvider'
import type { ChatContextProvider } from './ChatContextProvider'
import { persistentChatContextProvider } from './PersistentChatContextProvider'
import { temporaryChatContextProvider } from './TemporaryChatContextProvider'

/**
 * Resume an assistant turn paused on a tool-approval-request. Synthesised
 * inside `Ai_ToolApproval_Respond` after `ToolApprovalRegistry` reports
 * no live entry for `approvalId`. Not on the renderer↔main IPC contract.
 */
export interface MainContinueConversationRequest {
  trigger: 'continue-conversation'
  topicId: string
  parentAnchorId: string
  approvalDecisions: ApprovalDecision[]
}

/**
 * Answer a steer message that was persisted while a turn was live. Synthesised
 * by `AiStreamManager.startNextChatTurn` when a finished chat turn has a pending
 * steer queued — it opens a fresh assistant turn anchored on the steer user
 * message (no new user row). Not on the renderer↔main IPC contract.
 */
export interface MainSteerContinuationRequest {
  trigger: 'steer-continuation'
  topicId: string
  /** The already-persisted steer user message to answer. */
  userMessageId: string
}

export type MainDispatchRequest = AiStreamOpenRequest | MainContinueConversationRequest | MainSteerContinuationRequest

const logger = loggerService.withContext('chatContextDispatch')

/**
 * More-specific providers first. `canHandle` MUST be mutually exclusive —
 * the dispatcher takes the first match without checking the rest.
 * `persistentChatContextProvider` is the catch-all and stays last.
 */
const providers: readonly ChatContextProvider[] = [
  agentChatContextProvider,
  temporaryChatContextProvider,
  persistentChatContextProvider
]

export async function dispatchStreamRequest(
  manager: AiStreamManager,
  subscriber: StreamListener,
  req: MainDispatchRequest
): Promise<AiStreamOpenResponse> {
  const provider = providers.find((p) => p.canHandle(req.topicId))
  if (!provider) {
    throw new Error(`No ChatContextProvider can handle topicId: ${req.topicId}`)
  }

  logger.debug('Dispatching stream request', { topicId: req.topicId, provider: provider.name })

  // A busy chat submit no longer aborts the live turn. Both chat and agent sessions now absorb a
  // mid-flight user message by persisting it and enqueuing a follow-up: chat persists the steer
  // user row (PersistentChatContextProvider's `hasLiveStream` branch) and we enqueue it below so
  // the running turn yields at the next step boundary and the terminal hook chains a continuation;
  // agent sessions enqueue onto `pendingTurns`. Either way `prepareDispatch` must observe liveness.
  const hasLiveStream = manager.hasLiveStream(req.topicId)
  const prepared = await provider.prepareDispatch(subscriber, req, { hasLiveStream }).catch((error: unknown) => {
    if (isAgentSessionWorkspaceError(error)) {
      return {
        blocked: {
          reason: 'agent-session-workspace' as const,
          message: error.message
        }
      }
    }
    throw error
  })
  if ('blocked' in prepared) {
    return { mode: 'blocked', ...prepared.blocked }
  }

  // Inject-steer: a live persistent-chat submit took the `hasLiveStream` branch (persisted the
  // user row, no models → `send` will only attach the subscriber). Enqueue it so the running turn
  // yields (`hasPendingSteer`) and `onExecutionDone` chains a `steer-continuation` to answer it.
  if (provider.name === persistentChatContextProvider.name && prepared.models.length === 0 && prepared.userMessage) {
    manager.enqueuePendingSteer(req.topicId, prepared.userMessage.id)
  }

  const result = manager.send({
    topicId: prepared.topicId,
    models: prepared.models,
    listeners: prepared.listeners,
    userMessage: prepared.userMessage,
    siblingsGroupId: prepared.siblingsGroupId,
    lifecycle: prepared.lifecycle
  })

  // Ids the renderer needs to join its optimistic bubbles.
  const placeholderIds = prepared.models
    .map((m) => m.request.messageId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  // Multi-model topics are persistent-only with a placeholder per model, so the
  // filtered list must stay aligned with `executionIds`. Fail fast if a future
  // multi-model provider ever returns a model without a messageId — silently
  // dropping it would desync the renderer's per-execution bubble join.
  if (prepared.isMultiModel && placeholderIds.length !== prepared.models.length) {
    throw new Error(
      `Multi-model dispatch produced ${placeholderIds.length} placeholderIds for ${prepared.models.length} models (topicId=${prepared.topicId})`
    )
  }

  return {
    mode: result.mode,
    executionIds: prepared.isMultiModel ? result.executionIds : undefined,
    userMessageId: prepared.userMessageId ?? prepared.userMessage?.id,
    placeholderIds: placeholderIds.length > 0 ? placeholderIds : undefined
  }
}
