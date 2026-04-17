/**
 * Dispatch an `Ai_Stream_Open` request to the first `ChatContextProvider`
 * that claims the topic via `canHandle`.
 *
 * Adding a new topic namespace only requires inserting a new provider into
 * `providers` (before `persistentChatContextProvider`, which matches everything
 * as the fallback).
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
  return provider.handle(manager, subscriber, req)
}
