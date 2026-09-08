import { createHash } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { messageService } from '@data/services/MessageService'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { loggerService } from '@logger'
import { serializeError } from '@main/ai/utils/serializeError'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart, Message } from '@shared/data/types/message'
import type { HandoffPartData } from '@shared/data/types/uiParts'
import type { HandoffStart, HandoffStartResponse } from '@shared/ipc/schemas/ai'
import { v7 as uuidv7 } from 'uuid'

import {
  agentChatContextProvider,
  type PersistedAgentDispatch,
  type StreamListener,
  type ValidatedAgentDispatch
} from '../streamManager'
import { buildAgentSessionTopicId } from './topic'

const logger = loggerService.withContext('ai:handoff')

export class HandoffStartConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HandoffStartConflictError'
  }
}

function handoffPayloadHash(input: HandoffStart): string {
  const payload = JSON.stringify({
    source: input.source,
    targetAgentId: input.targetAgentId,
    workspace: input.workspace,
    goal: input.goal,
    summary: input.summary,
    attachmentParts: input.attachmentParts
  })
  // This hash is only an equality guard for retries, never an authorization token.
  return createHash('sha256').update(payload).digest('hex')
}

function handoffPart(
  input: HandoffStart,
  assistantMessageId: string,
  state: HandoffPartData['state'],
  targetAgentName?: string
): CherryMessagePart {
  return {
    type: 'data-handoff',
    data: {
      handoffId: input.handoffId,
      payloadHash: handoffPayloadHash(input),
      source: input.source,
      targetAgentId: input.targetAgentId,
      targetAgentName,
      targetSessionId: input.handoffId,
      initialAssistantMessageId: assistantMessageId,
      state,
      goal: input.goal
    }
  } as CherryMessagePart
}

function findHandoffPart(message: AgentSessionMessageEntity): HandoffPartData | undefined {
  const part = (message.data.parts ?? []).find((candidate) => candidate.type === 'data-handoff')
  return part && typeof part.data === 'object' && part.data !== null ? part.data : undefined
}

function buildHandoffUserParts(
  input: HandoffStart,
  assistantMessageId: string,
  targetAgentName?: string
): CherryMessagePart[] {
  const text = [
    `Task:\n${input.goal.trim()}`,
    `Background summary:\n${input.summary.trim()}`,
    `Original session: ${input.source.id}. Use session_read with this ID when exact source text or tool results need verification.`
  ].join('\n\n')
  return [
    { type: 'text', text },
    ...input.attachmentParts,
    handoffPart(input, assistantMessageId, 'pending', targetAgentName)
  ] as CherryMessagePart[]
}

/**
 * Confirm and start one explicit Chat → Agent handoff. Creation, the stable first-turn rows,
 * and the display marker commit together; the topic lock then makes claim + send single-owner.
 */
export async function startHandoff(input: HandoffStart, listener: StreamListener): Promise<HandoffStartResponse> {
  const targetAgent = agentService.getAgent(input.targetAgentId)
  if (!targetAgent) throw new HandoffStartConflictError(`Target Agent not found: ${input.targetAgentId}`)
  const payloadHash = handoffPayloadHash(input)
  const topicId = buildAgentSessionTopicId(input.handoffId)
  const manager = application.get('AiStreamManager')

  return manager.withDispatchLock(topicId, async () => {
    if (manager.isWriteQuiesced) {
      throw new Error('AiStreamManager is write-quiesced; refusing a new handoff turn')
    }
    const userId = uuidv7()
    const assistantId = uuidv7()
    const createdParts = buildHandoffUserParts(input, assistantId, targetAgent.name)
    const createdAssistantParts = [handoffPart(input, assistantId, 'pending', targetAgent.name)]
    const { created, pair, sourceRecord } = application.get('DbService').withWriteTx((tx) => {
      const existingSession = agentSessionService.getByIdTx(tx, input.handoffId)
      if (existingSession) {
        if (existingSession.agentId !== input.targetAgentId) {
          throw new HandoffStartConflictError(`Handoff ${input.handoffId} targets another Agent`)
        }
        const existingPair = agentSessionMessageService.findHandoffMessagesTx(tx, input.handoffId, input.handoffId)
        if (!existingPair || findHandoffPart(existingPair.user)?.payloadHash !== payloadHash) {
          throw new HandoffStartConflictError(`Handoff ${input.handoffId} was already submitted with different data`)
        }
        return { pair: existingPair, created: false, sourceRecord: undefined }
      }

      if (input.source.kind === 'temporary' && !temporaryChatService.hasTopic(input.source.id)) {
        throw new HandoffStartConflictError('The temporary source conversation is no longer available')
      }
      agentSessionService.createTx(tx, input.handoffId, {
        agentId: input.targetAgentId,
        name: input.goal.trim().slice(0, 255),
        workspace: input.workspace
      })
      let sourceRecord: Message | undefined
      if (input.source.kind === 'topic') {
        sourceRecord = messageService.createTx(tx, input.source.id, {
          role: 'assistant',
          status: 'success',
          siblingsGroupId: 0,
          data: { parts: [handoffPart(input, assistantId, 'pending', targetAgent.name)] }
        })
      }
      const saved = agentSessionMessageService.saveMessagesTx(tx, {
        sessionId: input.handoffId,
        messages: [
          { id: userId, role: 'user', status: 'success', data: { parts: createdParts } },
          {
            id: assistantId,
            role: 'assistant',
            status: 'pending',
            data: { parts: createdAssistantParts },
            modelId: targetAgent.model ?? undefined
          }
        ]
      })
      return {
        pair: { user: saved[0], assistant: saved[1] },
        created: true,
        sourceRecord
      }
    })
    if (created) {
      agentSessionMessageService.publishDispatchChanges(input.handoffId, [pair.user, pair.assistant])
      if (sourceRecord) getDataService('TopicService').notifyReadModelChange([sourceRecord.topicId], 'projection')
      if (input.source.kind === 'temporary') {
        try {
          temporaryChatService.appendMessage(input.source.id, {
            role: 'assistant',
            status: 'success',
            siblingsGroupId: 0,
            data: { parts: [handoffPart(input, assistantId, 'pending', targetAgent.name)] }
          })
        } catch (error) {
          logger.warn('Unable to append temporary handoff display record', { error: serializeError(error) })
        }
      }
    }

    // A completed or already-claimed first turn is idempotently acknowledged. A pending row is
    // the only state eligible for a new runtime owner.
    if (!created && findHandoffPart(pair.assistant)?.state !== 'pending') {
      return { sessionId: input.handoffId, state: 'existing' }
    }
    if (
      manager.hasLiveStream(topicId) ||
      application.get('AgentSessionRuntimeService').isSessionBusy(input.handoffId)
    ) {
      return { sessionId: input.handoffId, state: 'existing' }
    }

    let baseValidated: ValidatedAgentDispatch
    try {
      baseValidated = await agentChatContextProvider.validateDispatch({
        trigger: 'submit-message',
        topicId,
        userMessageParts: pair.user.data.parts ?? [],
        headless: false
      })
    } catch (error) {
      if (!manager.isWriteQuiesced) {
        agentSessionMessageService.markAssistantMessageTerminalError(input.handoffId, pair.assistant.id)
      }
      return { sessionId: input.handoffId, state: 'existing', error: serializeError(error) }
    }

    // Recheck ownership after async validation, in the same transaction that claims execution.
    const claimed = application.get('DbService').withWriteTx((tx) => {
      const currentAgent = agentService.getAgent(input.targetAgentId)
      const currentSession = agentSessionService.getByIdTx(tx, input.handoffId)
      if (
        manager.isWriteQuiesced ||
        currentSession?.agentId !== input.targetAgentId ||
        baseValidated.agentId !== input.targetAgentId ||
        !currentAgent ||
        currentAgent.updatedAt !== baseValidated.agentUpdatedAt ||
        currentAgent.model !== baseValidated.uniqueModelId ||
        currentAgent.type !== baseValidated.agentType
      )
        return false
      return agentSessionMessageService.claimHandoffAssistantTx(tx, input.handoffId, pair.assistant.id)
    })
    if (claimed === false) {
      if (!manager.isWriteQuiesced) {
        agentSessionMessageService.markAssistantMessageTerminalError(input.handoffId, pair.assistant.id)
      }
      return {
        sessionId: input.handoffId,
        state: 'existing',
        error: serializeError(
          new Error('Target Session or Agent changed, or writes paused while preparing the handoff')
        )
      }
    }

    if (!claimed) return { sessionId: input.handoffId, state: 'existing' }

    const validated: ValidatedAgentDispatch = {
      ...baseValidated,
      userMessageId: pair.user.id,
      userMessageParts: pair.user.data.parts ?? [],
      shouldAutoNameInitialTurn: false
    }
    try {
      const persisted: PersistedAgentDispatch = {
        validated,
        assistantMessageId: pair.assistant.id,
        traceId: agentSessionService.ensureTraceId(input.handoffId),
        userMessage: pair.user,
        savedMessages: [pair.user, claimed]
      }
      const prepared = agentChatContextProvider.activateDispatch(persisted, listener)
      manager.send({
        topicId: prepared.topicId,
        models: prepared.models,
        listeners: prepared.listeners,
        siblingsGroupId: prepared.siblingsGroupId,
        lifecycle: prepared.lifecycle
      })
      return { sessionId: input.handoffId, state: 'started' }
    } catch (error) {
      if (manager.hasLiveStream(topicId)) {
        return { sessionId: input.handoffId, state: 'started', error: serializeError(error) }
      }
      try {
        await application.get('AgentSessionRuntimeService').closeSession(input.handoffId)
      } catch (closeError) {
        logger.warn('Unable to close failed handoff runtime', { error: serializeError(closeError) })
      }
      agentSessionMessageService.markAssistantMessageTerminalError(input.handoffId, pair.assistant.id)
      return { sessionId: input.handoffId, state: 'existing', error: serializeError(error) }
    }
  })
}
