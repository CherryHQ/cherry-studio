/**
 * Single dispatch path for stream requests: pick provider, prepare,
 * `manager.send`, shape the response. See
 * `docs/references/ai/stream-manager.md`.
 */

import { loggerService } from '@logger'
import { topicService } from '@main/data/services/TopicService'
import type { AiStreamOpenRequest, AiStreamOpenResponse, ApprovalDecision } from '@shared/ai/transport'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { isAgentSessionWorkspaceError } from '../../runtime/agentSessionWorkspace'
import type { AiStreamManager } from '../AiStreamManager'
import type { StreamListener } from '../types'
import { agentChatContextProvider } from './AgentChatContextProvider'
import type { ChatContextProvider } from './ChatContextProvider'
import { persistentChatContextProvider } from './PersistentChatContextProvider'
import { temporaryChatContextProvider } from './TemporaryChatContextProvider'

/**
 * Resume an assistant turn paused on a tool-approval-request. Synthesised
 * inside `AiService.respondToolApproval` after `ToolApprovalRegistry` reports
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
  /** Selection captured with the original busy submit. */
  reasoningEffort?: ReasoningEffortOption
  /** Provider request tier captured with the original busy submit. */
  serviceTier?: ServiceTierSelection
  /** Fast selection captured with the original busy submit. */
  fastMode: boolean
}

export type MainDispatchRequest = (
  | AiStreamOpenRequest
  | MainContinueConversationRequest
  | MainSteerContinuationRequest
) & {
  /**
   * Main-only dispatch flag: the run has no interactive responder (channel message, scheduled
   * task), so runtimes must not enable ask-the-user tools. Never set on renderer requests.
   */
  headless?: boolean
  /** Main-only durable user row accepted by the cross-session delivery path. */
  agentDeliveryMessage?: AgentSessionMessageEntity
  /** Main-only queue policy: never redirect this delivery into the currently-running turn. */
}

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

  // A busy submit no longer aborts the live turn — but only persistent chat and agent sessions
  // absorb it. Persistent chat persists the steer user row (PersistentChatContextProvider's
  // `hasLiveStream` branch) and we enqueue it below so the running turn yields at the next step
  // boundary and the terminal hook chains a continuation; agent sessions enqueue onto `pendingTurns`.
  // Temporary chats are the third case — they have no queue, so their provider throws on a live
  // submit rather than letting the message be silently swallowed. Either way `prepareDispatch` must
  // observe liveness.
  const hasLiveStream = manager.hasLiveStream(req.topicId)

  // An approval `continue-conversation` must never race a live stream: `send` would take the inject
  // branch and discard `prepared.models`, so the approved tool never executes and the anchor row is
  // stranded `pending` while the renderer is told success. `onExecutionDone` gates steer chaining on
  // pending approvals to prevent this, so reaching here means an unexpected race — surface it.
  if (hasLiveStream && req.trigger === 'continue-conversation') {
    logger.error('continue-conversation arrived while a stream is live — approval cannot inject onto a running turn', {
      topicId: req.topicId
    })
  }
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

  // Inject-steer: a live persistent-chat submit took the `hasLiveStream` branch, which sets an
  // explicit `pendingSteerUserMessageId`. Enqueue it so the running turn yields (`hasPendingSteer`)
  // and `onExecutionDone` chains a `steer-continuation` to answer it.
  if (prepared.pendingSteerUserMessageId) {
    manager.enqueuePendingSteer(
      req.topicId,
      prepared.pendingSteerUserMessageId,
      prepared.pendingSteerReasoningEffort,
      prepared.pendingSteerServiceTier,
      prepared.pendingSteerFastMode === true
    )
  } else if (
    provider.name === persistentChatContextProvider.name &&
    prepared.models.length === 0 &&
    req.trigger === 'submit-message'
  ) {
    // A persistent submit that resolved to zero models without taking the steer branch is a
    // regression: `send` persists nothing new, returns a success-shaped ack, and answers nothing.
    // Surface it loudly. (Agent-session injects legitimately have empty models — absorbed by the
    // runtime's pendingTurns — so they're excluded by the provider check.)
    logger.error(
      'Persistent submit resolved to zero models and is not an enqueue-only steer — nothing will be answered',
      {
        topicId: req.topicId
      }
    )
  }

  const reservedAssistantIds =
    prepared.reservedMessages
      ?.filter((message) => message.role === 'assistant')
      .map((message) => message.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0) ?? []

  // Multi-model topics are persistent-only with a placeholder per model. Keep
  // those reservations aligned with the executions the manager will launch.
  if (prepared.models.length > 1 && reservedAssistantIds.length !== prepared.models.length) {
    throw new Error(
      `Multi-model dispatch produced ${reservedAssistantIds.length} assistant reservations for ${prepared.models.length} models (topicId=${prepared.topicId})`
    )
  }

  // Async preparation may outlive the stream it planned to append to. Re-check
  // liveness once at the synchronous handoff and degrade to a fresh turn when
  // the original stream has settled.
  const preparedChange = prepared.liveExecutionChange
  const canAppendToLiveStream = preparedChange?.mode === 'append' && manager.hasLiveStream(prepared.topicId)
  let preserveActiveNode = prepared.preserveActiveNode
  if (preparedChange?.mode === 'append' && !canAppendToLiveStream && preparedChange.activateFallback) {
    const fallbackActiveNodeId = reservedAssistantIds.at(-1)
    if (!fallbackActiveNodeId) {
      throw new Error(`Live-group append fallback produced no assistant placeholder (topicId=${prepared.topicId})`)
    }
    topicService.setActiveNode(prepared.topicId, fallbackActiveNodeId)
    preserveActiveNode = false
  }
  const liveExecutionChange =
    preparedChange?.mode === 'replace'
      ? preparedChange
      : preparedChange?.mode === 'append' && canAppendToLiveStream
        ? {
            mode: 'append' as const,
            groupAnchorMessageId: preparedChange.groupAnchorMessageId,
            parentAnchorId: preparedChange.parentAnchorId,
            siblingsGroupId: preparedChange.siblingsGroupId
          }
        : undefined

  const result = manager.send({
    topicId: prepared.topicId,
    models: prepared.models,
    listeners: prepared.listeners,
    siblingsGroupId: prepared.siblingsGroupId,
    liveExecutionChange,
    lifecycle: prepared.lifecycle,
    isPersistentConversation: provider.isPersistentConversation
  })

  return {
    mode: result.mode,
    activeExecutions: result.activeExecutions.length > 0 ? result.activeExecutions : undefined,
    preserveActiveNode,
    reservedMessages: prepared.reservedMessages
  }
}
