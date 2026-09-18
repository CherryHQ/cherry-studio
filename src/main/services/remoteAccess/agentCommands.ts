import { createHash, randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { nullStreamListener } from '@main/ai/streamManager'

import {
  assertWritable,
  authorize,
  authorizeSession,
  type DeviceContext,
  executionId,
  processEpoch
} from './agentAccess'
import { type MethodInput, RemoteRequestError } from './protocol'

class ExistingCommand extends Error {
  constructor() {
    super('EXISTING_COMMAND')
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    )
  return value
}

export function requestHash(method: string, input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([method, canonical(input)]))
    .digest('hex')
}

export function createSession(context: DeviceContext, input: MethodInput<'sessions.create'>) {
  assertWritable()
  const hash = requestHash('sessions.create', input)
  const result = application.get('DbService').withWriteTx((tx) => {
    authorize(context, input.agentId, tx)
    const existing = remoteCommandService.findMatching(tx, context.deviceId, input.commandId, hash)
    if (existing) return { result: existing.result, created: false }
    const sessionId = randomUUID()
    agentSessionService.createTx(tx, sessionId, {
      agentId: input.agentId,
      name: '',
      workspace: input.workspaceId ? { type: 'user', workspaceId: input.workspaceId } : { type: 'system' }
    })
    const receipt = { sessionId, status: 'accepted' }
    remoteCommandService.recordTx(tx, {
      deviceId: context.deviceId,
      commandId: input.commandId,
      requestHash: hash,
      agentId: input.agentId,
      result: receipt
    })
    return { result: receipt, created: true }
  })
  if (result.created) agentSessionService.notifyReadModelChange([String(result.result.sessionId)], 'membership')
  return result.result
}

export async function sendMessage(context: DeviceContext, input: MethodInput<'messages.send'>) {
  authorizeSession(context, input.sessionId)
  assertWritable()
  if (input.parts.reduce((size, part) => size + Buffer.byteLength(part.text), 0) > 65536)
    throw new RemoteRequestError('INVALID_REQUEST')
  const hash = requestHash('messages.send', input)
  const existing = remoteCommandService.findMatching(
    application.get('DbService').getDb(),
    context.deviceId,
    input.commandId,
    hash
  )
  if (existing) return getCommand(context, input.commandId)
  let receipt: Record<string, unknown> | undefined
  try {
    const response = await application.get('AiStreamManager').dispatch(
      nullStreamListener,
      {
        topicId: buildAgentSessionTopicId(input.sessionId),
        trigger: 'submit-message',
        userMessageParts: input.parts
      },
      {
        commitAgentMessage: (reserve) =>
          application.get('DbService').withWriteTx((tx) => {
            const current = authorizeSession(context, input.sessionId, tx)
            const previous = remoteCommandService.findMatching(tx, context.deviceId, input.commandId, hash)
            if (previous) throw new ExistingCommand()
            const reserved = reserve(tx)
            receipt =
              reserved.mode === 'queued'
                ? { status: 'queued', processEpoch, sessionId: input.sessionId, userMessageId: reserved.userMessage.id }
                : {
                    status: 'accepted',
                    processEpoch,
                    sessionId: input.sessionId,
                    userMessageId: reserved.persisted.userMessage.id,
                    assistantMessageId: reserved.persisted.assistantMessageId
                  }
            remoteCommandService.recordTx(tx, {
              deviceId: context.deviceId,
              commandId: input.commandId,
              requestHash: hash,
              agentId: current.agentId!,
              result: receipt
            })
            return reserved
          })
      }
    )
    if (response.mode === 'blocked') throw new RemoteRequestError('AGENT_UNAVAILABLE', true)
    return receipt
  } catch (error) {
    if (error instanceof ExistingCommand) return getCommand(context, input.commandId)
    if (receipt && remoteCommandService.get(context.deviceId, input.commandId)) {
      remoteCommandService.complete(context.deviceId, input.commandId, { ...receipt, status: 'interrupted' })
      throw new RemoteRequestError('COMMAND_INTERRUPTED')
    }
    throw error
  }
}

export function getCommand(context: DeviceContext, commandId: string) {
  const record = remoteCommandService.get(context.deviceId, commandId)
  if (!record) throw new RemoteRequestError('NOT_FOUND')
  authorize(context, record.agentId)
  return record.result.status === 'processing' && record.result.processEpoch !== processEpoch
    ? { ...record.result, status: 'interrupted' }
    : record.result
}

function reserveAction(context: DeviceContext, method: string, input: { sessionId: string; commandId: string }) {
  assertWritable()
  return application.get('DbService').withWriteTx((tx) => {
    const session = authorizeSession(context, input.sessionId, tx)
    const existing = remoteCommandService.findMatching(
      tx,
      context.deviceId,
      input.commandId,
      requestHash(method, input)
    )
    if (existing) return existing.result
    remoteCommandService.recordTx(tx, {
      deviceId: context.deviceId,
      commandId: input.commandId,
      requestHash: requestHash(method, input),
      agentId: session.agentId!,
      result: { status: 'processing', processEpoch }
    })
    return undefined
  })
}

export async function cancelTurn(context: DeviceContext, input: MethodInput<'turns.cancel'>) {
  const existing = reserveAction(context, 'turns.cancel', input)
  if (existing) return getCommand(context, input.commandId)
  try {
    const topic = buildAgentSessionTopicId(input.sessionId)
    const execution = application
      .get('AiStreamManager')
      .getTopicSnapshot(topic)
      .executions.find((item) => executionId(item.attemptId, item.messageId) === input.expectedExecutionId)
    const cancelled = execution?.messageId
      ? await application.get('AiStreamManager').abortAndDrain(topic, 'remote-cancel', {
          attemptId: execution.attemptId,
          messageId: execution.messageId,
          assertAllowed: () => {
            assertWritable()
            authorizeSession(context, input.sessionId)
          }
        })
      : false
    const result = { status: cancelled ? 'cancelled' : 'execution-changed', executionId: input.expectedExecutionId }
    remoteCommandService.complete(context.deviceId, input.commandId, result)
    return result
  } catch (error) {
    remoteCommandService.complete(context.deviceId, input.commandId, { status: 'interrupted' })
    throw error
  }
}

export function respondInteraction(context: DeviceContext, input: MethodInput<'interactions.respond'>) {
  const existing = reserveAction(context, 'interactions.respond', input)
  if (existing) return getCommand(context, input.commandId)
  try {
    const runtime = application.get('AgentSessionRuntimeService')
    const entry = runtime
      .listSessionInteractions(input.sessionId)
      .find((item) => item.approvalId === input.interactionId)
    if (entry && entry.presentation === 'message' && !entry.anchorId)
      throw new RemoteRequestError('INTERACTION_UNSUPPORTED')
    const applied =
      entry && runtime.respondSessionInteraction(input.sessionId, input.interactionId, input.response, entry.anchorId)
    const result = { status: applied ? 'applied' : 'resolved', interactionId: input.interactionId }
    remoteCommandService.complete(context.deviceId, input.commandId, result)
    return result
  } catch (error) {
    remoteCommandService.complete(context.deviceId, input.commandId, { status: 'interrupted' })
    throw error
  }
}
