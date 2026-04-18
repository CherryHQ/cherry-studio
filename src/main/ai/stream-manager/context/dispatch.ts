/**
 * Dispatch an `Ai_Stream_Open` request:
 *
 *   1. pick the first `ChatContextProvider` whose `canHandle(topicId)` matches
 *   2. let it `prepareDispatch` (resolve context, persist user input, build
 *      listeners / per-model requests)
 *   3. call `manager.send(...)` exactly once with the prepared bundle
 *   4. shape the `AiStreamOpenResponse`
 *
 * Keeping the `manager.send` call on this single code path means:
 *  - providers never see the manager (simpler to test)
 *  - the inject / start / multi-model fan-out contract is enforced here
 *  - adding a new topic namespace only requires adding a provider
 */

import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

import type { AiStreamManager } from '../AiStreamManager'
import type { StreamListener } from '../types'
import { agentChatContextProvider } from './AgentChatContextProvider'
import type { ChatContextProvider } from './ChatContextProvider'
import { persistentChatContextProvider } from './PersistentChatContextProvider'
import { temporaryChatContextProvider } from './TemporaryChatContextProvider'

const logger = loggerService.withContext('chatContextDispatch')

/**
 * Provider order: more-specific first. The persistent provider is a
 * catch-all and must stay last.
 */
const providers: readonly ChatContextProvider[] = [
  agentChatContextProvider,
  temporaryChatContextProvider,
  persistentChatContextProvider
]

export async function dispatchStreamRequest(
  manager: AiStreamManager,
  subscriber: StreamListener,
  req: AiStreamOpenRequest
): Promise<AiStreamOpenResponse> {
  const provider = providers.find((p) => p.canHandle(req.topicId))
  if (!provider) {
    throw new Error(`No ChatContextProvider can handle topicId: ${req.topicId}`)
  }

  logger.debug('Dispatching stream request', { topicId: req.topicId, provider: provider.name })

  const prepared = await provider.prepareDispatch(subscriber, req)
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
