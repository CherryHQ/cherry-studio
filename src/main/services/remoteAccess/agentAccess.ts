import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { RemoteCommandConflictError } from '@data/services/RemoteCommandService'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { DataApiError } from '@shared/data/api/errors'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { FileEntryIdSchema } from '@shared/data/types/file'

import { artifactSource, readArtifactFile, readInlineArtifact } from './artifactAccess'
import { contentPage, getPartContent, listPartDetails } from './messageDetails'
import { clipText, projectHistoryMessage, projectStreamMessage } from './messageProjection'
import { type MethodInput, type RemoteErrorCode, RemoteRequestError } from './protocol'

export type DeviceContext = { deviceId: string; isActive?: () => boolean }
export const processEpoch = randomUUID()

export function assertWritable(): void {
  if (
    application.get('AiStreamManager').isWriteQuiesced ||
    application.get('AgentSessionRuntimeService').isWriteQuiesced
  ) {
    throw new RemoteRequestError('RESOURCE_BUSY', true)
  }
}

export function authorize(context: DeviceContext, agentId?: string, tx?: DbOrTx) {
  if (context.isActive && !context.isActive()) throw new RemoteRequestError('FORBIDDEN')
  const device = apiGatewayPairedDeviceService.get(context.deviceId, tx)
  if (!device) throw new RemoteRequestError('FORBIDDEN')
  if (agentId && !agentService.getAgent(agentId)) throw new RemoteRequestError('NOT_FOUND')
  return device
}

export function authorizeSession(context: DeviceContext, sessionId: string, tx?: DbOrTx) {
  authorize(context, undefined, tx)
  const session = agentSessionService.getById(sessionId)
  if (!session.agentId || !agentService.getAgent(session.agentId)) throw new RemoteRequestError('NOT_FOUND')
  return session
}

function workspaceSummary(workspace: AgentWorkspaceEntity) {
  return {
    id: workspace.id,
    name: workspace.name.slice(0, 512),
    path: workspace.path,
    type: workspace.type
  }
}

export function sessionSummary(session: ReturnType<typeof agentSessionService.getById>) {
  return {
    id: session.id,
    agentId: session.agentId,
    name: session.name.slice(0, 1024),
    workspaceId: session.workspaceId,
    workspace: workspaceSummary(session.workspace),
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

export function listAgents(context: DeviceContext, input: MethodInput<'agents.list'>) {
  authorize(context)
  const offset = input.cursor === undefined ? 0 : Number(input.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RemoteRequestError('INVALID_REQUEST')
  const { agents, total } = agentService.listAgents({ offset, limit: input.limit })
  const items = agents.map((agent) => ({
    id: agent.id,
    name: agent.name.slice(0, 512),
    description: agent.description?.slice(0, 2048),
    runtime: agent.type,
    availability: agent.model ? 'configured' : 'model-missing'
  }))
  return { items, nextCursor: offset + items.length < total ? String(offset + items.length) : null }
}

export function listWorkspaces(context: DeviceContext, input: MethodInput<'workspaces.list'>) {
  authorize(context)
  const offset = input.cursor === undefined ? 0 : Number(input.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RemoteRequestError('INVALID_REQUEST')
  const workspaces = agentWorkspaceService.list()
  const items = workspaces.slice(offset, offset + input.limit).map(workspaceSummary)
  return { items, nextCursor: offset + items.length < workspaces.length ? String(offset + items.length) : null }
}

export function listSessions(context: DeviceContext, input: MethodInput<'sessions.list'>) {
  authorize(context, input.agentId)
  const result = agentSessionService.listByCursor(input)
  return { ...result, items: result.items.map(sessionSummary) }
}

export function listMessages(context: DeviceContext, input: MethodInput<'messages.list'>) {
  authorizeSession(context, input.sessionId)
  let limit = input.limit
  for (;;) {
    const result = agentSessionMessageService.listSessionMessages(input.sessionId, { cursor: input.cursor, limit })
    const response = { ...result, items: result.items.map(projectHistoryMessage) }
    if (Buffer.byteLength(JSON.stringify(response)) <= 512 * 1024 || limit === 1) return response
    limit = Math.max(1, Math.floor(limit / 2))
  }
}

function getMessageParts(context: DeviceContext, input: { sessionId: string; messageId: string }) {
  authorizeSession(context, input.sessionId)
  const snapshot = application.get('AiStreamManager').getTopicSnapshot(buildAgentSessionTopicId(input.sessionId))
  if (['pending', 'streaming', 'awaiting-approval', 'finalizing'].includes(snapshot.status)) {
    const execution = snapshot.executions.find((item) => item.messageId === input.messageId)
    if (execution?.message) return execution.message.parts
  }
  return agentSessionMessageService.getSessionMessage(input.sessionId, input.messageId).data.parts ?? []
}

export function listMessageParts(context: DeviceContext, input: MethodInput<'messages.parts.list'>) {
  return listPartDetails(getMessageParts(context, input), input)
}

export function getMessagePart(context: DeviceContext, input: MethodInput<'messages.parts.get'>) {
  return getPartContent(getMessageParts(context, input), input)
}

export async function readArtifact(context: DeviceContext, input: MethodInput<'artifacts.read'>) {
  const session = authorizeSession(context, input.sessionId)
  const part = getMessageParts(context, input)[input.partIndex]
  if (!part) throw new RemoteRequestError('NOT_FOUND')
  const source = artifactSource(part, input.artifactIndex)
  if (source.kind === 'inline') return readInlineArtifact(source, input)
  const target =
    source.kind === 'entry'
      ? application.get('FileManager').getPhysicalPath(FileEntryIdSchema.parse(source.entryId))
      : source.path
  const root = source.kind === 'entry' ? path.dirname(target) : session.workspace.path
  const result = await readArtifactFile(root, target, input, part.type === 'file' ? part.filename : undefined)
  authorizeSession(context, input.sessionId)
  return result
}

function interactionMarkers(sessionId: string) {
  return application
    .get('AgentSessionRuntimeService')
    .listSessionInteractions(sessionId)
    .slice(0, 32)
    .map((entry) => {
      return {
        interactionId: entry.approvalId,
        anchorId: entry.anchorId,
        toolCallId: entry.toolCallId,
        toolName: clipText(entry.toolName, 256).text,
        canRespond: entry.presentation !== 'message' || Boolean(entry.anchorId)
      }
    })
}

export function listInteractions(context: DeviceContext, sessionId: string) {
  authorizeSession(context, sessionId)
  return interactionMarkers(sessionId)
}

export function getInteraction(context: DeviceContext, input: MethodInput<'interactions.get'>) {
  authorizeSession(context, input.sessionId)
  const original = application
    .get('AgentSessionRuntimeService')
    .getSessionInteractionInput(input.sessionId, input.interactionId)
  if (!original) throw new RemoteRequestError('NOT_FOUND')
  return { interactionId: input.interactionId, ...contentPage(original, input) }
}

export function executionId(attemptId: number, messageId?: string): string {
  return `${processEpoch}.${attemptId}.${messageId ?? ''}`
}

export function sessionSnapshot(context: DeviceContext, sessionId: string) {
  const session = authorizeSession(context, sessionId)
  const snapshot = application.get('AiStreamManager').getTopicSnapshot(buildAgentSessionTopicId(sessionId))
  return {
    session: sessionSummary(session),
    processEpoch,
    status: snapshot.status,
    executions: snapshot.executions.map((execution) => ({
      executionId: executionId(execution.attemptId, execution.messageId),
      messageId: execution.messageId,
      message: execution.message
        ? projectStreamMessage(execution.message, Math.floor(65536 / Math.max(1, snapshot.executions.length)))
        : undefined
    })),
    interactions: interactionMarkers(sessionId)
  }
}

export function observeSession(context: DeviceContext, sessionId: string, changed: () => void) {
  authorizeSession(context, sessionId)
  const stream = application.get('AiStreamManager').observeTopic(buildAgentSessionTopicId(sessionId), changed)
  const interactions = application.get('AgentSessionRuntimeService').onSessionInteractionsChanged((event) => {
    if (event.sessionId === sessionId) changed()
  })
  return {
    dispose() {
      stream.dispose()
      interactions.dispose()
    }
  }
}

export function translateAgentError(error: unknown): RemoteErrorCode | undefined {
  if (error instanceof RemoteCommandConflictError) return 'COMMAND_CONFLICT'
  if (error instanceof DataApiError) return 'RESOURCE_UNAVAILABLE'
  return undefined
}
