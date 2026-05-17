/**
 * TemporaryChatContextProvider — owns in-memory temporary chat topics.
 *
 * Contract:
 *  - Topic state lives in TemporaryChatService (Main-process Map, never touches SQLite).
 *  - Messages append sequentially and are immutable once written (no tree, no siblings,
 *    no placeholder/update workflow).
 *  - On stream start: append the user message.
 *  - On stream terminate: TemporaryPersistenceListener appends the assistant message.
 *
 * Routing is state-based (`hasTopic`) — after `persist()`, the topic moves out of
 * the in-memory map and ownership flips to the persistent provider under the same id.
 */

import { loggerService } from '@logger'
import { isAgentSessionTopic } from '@main/ai/provider/claudeCodeSettingsBuilder'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../types/requests'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TemporaryChatBackend } from '../persistence/backends/TemporaryChatBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'
import type { MainDispatchRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels } from './modelResolution'

const logger = loggerService.withContext('TemporaryChatContextProvider')

export class TemporaryChatContextProvider implements ChatContextProvider {
  readonly name = 'temporary'

  canHandle(topicId: string): boolean {
    // Defensive: a topic id that matches the agent-session prefix is never
    // a temporary topic, regardless of what `hasTopic` says. Provider order
    // in `dispatch.ts` already places `agentChatContextProvider` first so
    // this branch is normally unreachable, but excluding the prefix here
    // protects against future re-orderings or stray rows in the temporary
    // store with that prefix.
    if (isAgentSessionTopic(topicId)) return false
    return temporaryChatService.hasTopic(topicId)
  }

  async prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<PreparedDispatch> {
    // Temporary topics are immutable append-only; the start/inject distinction
    // doesn't apply (every send launches a new turn). DispatchContext is
    // accepted on the interface but not consumed here — the third arg is
    // intentionally omitted from this signature.
    if (req.trigger === 'regenerate-message') {
      throw new Error('regenerate-message is not supported for temporary chats (immutable append-only)')
    }
    if (req.trigger === 'continue-conversation') {
      throw new Error('continue-conversation is not supported for temporary chats (immutable append-only)')
    }

    const topic = temporaryChatService.getTopic(req.topicId)
    if (!topic) throw new Error(`Temporary topic not found: ${req.topicId}`)

    const { assistantId, defaultModelId } = await resolveAssistantModelId(topic.assistantId)

    let resolveWith: UniqueModelId[] | undefined
    if (req.mentionedModelIds?.length) {
      if (req.mentionedModelIds.length > 1) {
        logger.warn('Temporary chat received multiple mentionedModelIds — only the first is used', {
          topicId: req.topicId,
          mentioned: req.mentionedModelIds
        })
      }
      resolveWith = [req.mentionedModelIds[0]]
    }
    const models = await resolveModels(resolveWith, defaultModelId)
    const model = models[0]
    const { modelId: rawModelId, providerId } = parseUniqueModelId(model.id)
    const modelSnapshot = {
      id: model.apiModelId ?? rawModelId,
      name: model.name,
      provider: providerId
    }

    // 1. Append the user message first so `history` (= listMessages) includes it.
    //    The service generates the id internally — temporary topics are window-local,
    //    so no cross-process id alignment is required (see TemporaryPersistenceListener docstring).
    await temporaryChatService.appendMessage(req.topicId, {
      role: 'user',
      data: { parts: req.userMessageParts },
      status: 'success',
      modelId: model.id,
      modelSnapshot
    })

    // 2. Read the full linear history.
    const prior = await temporaryChatService.listMessages(req.topicId)
    const history: CherryUIMessage[] = prior.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.data.parts ?? []
    }))

    // 3. Build listeners: subscriber (WebContents) + PersistenceListener wrapping
    //    the in-memory temporary-chat backend.
    const listeners: StreamListener[] = [
      subscriber,
      new PersistenceListener({
        topicId: req.topicId,
        modelId: model.id,
        backend: new TemporaryChatBackend({ topicId: req.topicId, modelId: model.id, modelSnapshot })
      })
    ]

    // 4. Hand off to the dispatcher. No pre-allocated `messageId`: AI SDK
    //    generates one for the Renderer-visible streaming UIMessage; the
    //    service-side message id is independent and generated on append.
    const streamRequest: AiStreamRequest = {
      chatId: req.topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId: model.id,
      messages: history
    }

    return {
      topicId: req.topicId,
      models: [{ modelId: model.id, request: streamRequest }],
      listeners,
      isMultiModel: false
    }
  }
}

export const temporaryChatContextProvider = new TemporaryChatContextProvider()
