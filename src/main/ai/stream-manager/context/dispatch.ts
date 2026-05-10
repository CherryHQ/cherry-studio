/**
 * Dispatch a stream request:
 *
 *   1. pick the first `ChatContextProvider` whose `canHandle(topicId)` matches
 *   2. let it `prepareDispatch` (resolve context, persist user input, build
 *      listeners / per-model requests)
 *   3. call `manager.send(...)` exactly once with the prepared bundle
 *   4. shape the `AiStreamOpenResponse`
 *
 * Two callers feed this with two slightly different shapes:
 *  - `Ai_Stream_Open` IPC handler (renderer-driven submit / regenerate),
 *    which forwards the renderer's `AiStreamOpenRequest` directly;
 *  - `Ai_ToolApproval_Respond` IPC handler (after the registry fast-path
 *    misses), which synthesises a Main-internal `continue-conversation`
 *    request — the renderer never sends that variant.
 *
 * Both shapes meet here as `MainDispatchRequest`. Keeping the `manager.send`
 * call on this single code path means providers never see the manager, the
 * inject / start / multi-model fan-out contract is enforced here, and adding
 * a new topic namespace only requires adding a provider.
 */

import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse, ApprovalDecision } from '@shared/ai/transport'

import type { AiStreamManager } from '../AiStreamManager'
import type { StreamListener } from '../types'
import { agentChatContextProvider } from './AgentChatContextProvider'
import type { ChatContextProvider } from './ChatContextProvider'
import { persistentChatContextProvider } from './PersistentChatContextProvider'
import { temporaryChatContextProvider } from './TemporaryChatContextProvider'

/**
 * Main-internal "resume an assistant turn paused on a tool-approval-request"
 * request. Synthesised inside the `Ai_ToolApproval_Respond` IPC handler
 * after `ToolApprovalRegistry` reports no live entry for `approvalId`. Not
 * exposed on the renderer↔main IPC contract — the renderer never sends
 * this directly.
 */
export interface MainContinueConversationRequest {
  trigger: 'continue-conversation'
  topicId: string
  /** Id of the existing assistant msg we're resuming. */
  parentAnchorId: string
  /** User's resolution(s) for outstanding approval requests on the anchor. */
  approvalDecisions: ApprovalDecision[]
}

/**
 * Union accepted by `dispatchStreamRequest`. Provider implementations
 * (`prepareDispatch`) destructure on `req.trigger` to branch.
 */
export type MainDispatchRequest = AiStreamOpenRequest | MainContinueConversationRequest

const logger = loggerService.withContext('chatContextDispatch')

/**
 * Provider order: more-specific first. The persistent provider is a
 * catch-all and must stay last.
 *
 * `canHandle` is required to be mutually exclusive across providers — the
 * dispatcher takes the first match without sanity-checking the rest.
 * `agentChatContextProvider` matches the `agent-session:` prefix; the
 * temporary provider explicitly excludes that prefix even when its in-memory
 * map happens to carry one (defensive — see TemporaryChatContextProvider).
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
  const prepared = await provider.prepareDispatch(subscriber, req, { hasLiveStream })
  const result = manager.send({
    topicId: prepared.topicId,
    models: prepared.models,
    listeners: prepared.listeners,
    userMessage: prepared.userMessage,
    siblingsGroupId: prepared.siblingsGroupId
  })

  return {
    mode: result.mode,
    executionIds: prepared.isMultiModel ? result.executionIds : undefined
  }
}
