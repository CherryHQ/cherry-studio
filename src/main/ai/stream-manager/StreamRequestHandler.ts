/**
 * Business logic for handling Ai_Stream_Open requests.
 *
 * Extracted from AiStreamManager to keep the registry pure.
 * Resolves context, persists user messages, builds listeners,
 * dispatches executions — then delegates to AiStreamManager.startExecution().
 */

import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { messageService } from '@main/data/services/MessageService'
import { agentService, sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'
import { createUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { extractAgentSessionId, isAgentSessionTopic } from '../provider/claudeCodeSettingsBuilder'
import type { AiStreamManager } from './AiStreamManager'
import { AgentPersistenceListener } from './listeners/AgentPersistenceListener'
import { PersistenceListener } from './listeners/PersistenceListener'
import type { StreamListener } from './types'

export class StreamRequestHandler {
  /** Entry point — route by topic type, resolve context, dispatch. */
  async handle(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    if (isAgentSessionTopic(req.topicId)) {
      return this.handleAgentSession(manager, subscriber, req)
    }
    return this.handleNormalChat(manager, subscriber, req)
  }

  // ── Normal chat ──────────────────────────────────────────────────

  private async handleNormalChat(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    // 1. Resolve context
    const topic = await topicService.getById(req.topicId)
    const assistantId = topic?.assistantId
    if (!assistantId) throw new Error(`Cannot resolve assistantId for topic ${req.topicId}`)

    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)

    const modelId = assistant.modelId
    const { providerId, modelId: rawModelId } = parseUniqueModelId(modelId)
    const modelSnapshot = { id: rawModelId, name: rawModelId, provider: providerId }

    // 2. User message
    const isRegenerate = req.trigger === 'regenerate-message'
    const userMessage = isRegenerate
      ? await messageService.getById(req.parentAnchorId ?? '')
      : await messageService.create(req.topicId, {
          role: 'user',
          parentId: req.parentAnchorId,
          data: { parts: req.userMessageParts },
          modelId,
          modelSnapshot
        })

    // 3. Models (single or multi)
    const models = this.resolveModels(req.mentionedModelIds, modelId, providerId)
    const isMultiModel = models.length > 1

    // 4. Siblings group
    const siblingsGroupId = await this.resolveSiblingsGroupId(models, isRegenerate, userMessage.id)

    // 5. Build listeners: 1 subscriber + N persistence listeners
    const listeners: StreamListener[] = [subscriber]
    for (const model of models) {
      listeners.push(
        new PersistenceListener({
          topicId: req.topicId,
          parentUserMessageId: userMessage.id,
          modelId: model.uniqueModelId,
          modelSnapshot: { id: model.rawModelId, name: model.rawModelId, provider: model.providerId },
          siblingsGroupId
        })
      )
    }

    // 6. Build requests in parallel + dispatch
    const requests = await Promise.all(
      models.map(async (model) => ({
        model,
        request: await manager.buildAiStreamRequest(req.topicId, assistantId, model.uniqueModelId, userMessage.id)
      }))
    )

    manager.startExecution({
      topicId: req.topicId,
      modelId: requests[0].model.uniqueModelId,
      request: requests[0].request,
      listeners,
      siblingsGroupId,
      isMultiModel
    })

    for (let i = 1; i < requests.length; i++) {
      manager.startExecution({
        topicId: req.topicId,
        modelId: requests[i].model.uniqueModelId,
        request: requests[i].request,
        listeners: [],
        siblingsGroupId,
        isMultiModel
      })
    }

    return {
      mode: 'started',
      executionIds: isMultiModel ? models.map((m) => m.uniqueModelId) : undefined
    }
  }

  // ── Agent session ────────────────────────────────────────────────

  private async handleAgentSession(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    const sessionId = extractAgentSessionId(req.topicId)

    const { agents } = await agentService.listAgents()
    let session: Awaited<ReturnType<typeof sessionService.getSession>> = null
    for (const agent of agents) {
      session = await sessionService.getSession(agent.id, sessionId)
      if (session) break
    }
    if (!session) throw new Error(`Agent session not found: ${sessionId}`)

    const { providerId, modelId: rawModelId } = parseUniqueModelId(session.model as UniqueModelId)
    const uniqueModelId = createUniqueModelId(providerId, rawModelId)

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    // Persist user message to agents DB
    const userMessageId = crypto.randomUUID()
    await agentMessageRepository.persistUserMessage({
      sessionId,
      agentSessionId: '',
      payload: {
        message: {
          id: userMessageId,
          role: 'user',
          assistantId: session.agent_id,
          topicId: req.topicId,
          createdAt: new Date().toISOString(),
          status: 'success',
          data: { parts: req.userMessageParts ?? [{ type: 'text', text: userText }] }
        },
        blocks: []
      }
    })

    const agentPersistenceListener = new AgentPersistenceListener({
      sessionId,
      agentId: session.agent_id
    })

    const result = manager.send({
      topicId: req.topicId,
      modelId: uniqueModelId,
      request: {
        chatId: req.topicId,
        trigger: 'submit-message',
        assistantId: session.agent_id,
        uniqueModelId,
        messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }]
      },
      userMessage: { id: userMessageId, topicId: req.topicId, role: 'user' } as Message,
      listeners: [subscriber, agentPersistenceListener]
    })

    return { mode: result.mode }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private resolveModels(
    mentionedModelIds: UniqueModelId[] | undefined,
    defaultModelId: UniqueModelId,
    defaultProviderId: string
  ) {
    if (mentionedModelIds?.length) {
      return mentionedModelIds.map((id) => {
        const sep = id.indexOf('::')
        const pId = sep > 0 ? id.slice(0, sep) : defaultProviderId
        const mId = sep > 0 ? id.slice(sep + 2) : id
        return { uniqueModelId: createUniqueModelId(pId, mId), rawModelId: mId, providerId: pId }
      })
    }
    const { providerId, modelId: rawModelId } = parseUniqueModelId(defaultModelId)
    return [{ uniqueModelId: defaultModelId, rawModelId, providerId }]
  }

  private async resolveSiblingsGroupId(
    models: Array<{ uniqueModelId: UniqueModelId }>,
    isRegenerate: boolean,
    userMessageId: string
  ): Promise<number | undefined> {
    if (models.length > 1) return Date.now()
    if (!isRegenerate) return undefined

    // Regenerate: inherit or create siblings group
    const children = await messageService.getChildrenByParentId(userMessageId)
    const existingGroup = children.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
    const groupId = existingGroup ?? Date.now()
    for (const child of children) {
      if (child.siblingsGroupId === 0) {
        await messageService.updateSiblingsGroupId(child.id, groupId)
      }
    }
    return groupId
  }
}

export const streamRequestHandler = new StreamRequestHandler()
