/**
 * Single dispatch path for stream requests: pick provider, prepare,
 * `manager.send`, shape the response. See
 * `docs/references/ai/stream-manager.md`.
 */

import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse, ApprovalDecision } from '@shared/ai/transport'

import { isAgentSessionTopic } from '../../agentSession/topic'
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

export type MainDispatchRequest = AiStreamOpenRequest | MainContinueConversationRequest

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

  if (hasLiveStream && !isAgentSessionTopic(req.topicId)) {
    await manager.abortAndAwait(req.topicId, 'steer-restart')
  }

  const result = manager.send({
    topicId: prepared.topicId,
    models: prepared.models,
    listeners: prepared.listeners,
    userMessage: prepared.userMessage,
    siblingsGroupId: prepared.siblingsGroupId,
    lifecycle: prepared.lifecycle
  })

  return {
    mode: result.mode,
    executionIds: prepared.isMultiModel ? result.executionIds : undefined,
    userMessageId: prepared.userMessageId ?? prepared.userMessage?.id,
    reservedMessages: prepared.reservedMessages
  }
}
