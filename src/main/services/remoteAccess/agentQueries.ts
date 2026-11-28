import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

import { getToolName, isToolUIPart } from 'ai'

import { application } from '@application'
import { modelOptionSchema, modelSummarySchema } from '@cherrystudio/remote-protocol/agent'
import type {
  AgentInteraction,
  AgentParams,
  AgentMessage,
  AgentMessageListItem,
  AgentPart,
  AgentSession,
  ContentRef
} from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { isAgentModelSelectable } from '@shared/ai/agentRuntimeCapabilities'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { type UniqueModelId, UniqueModelIdSchema, parseUniqueModelId } from '@shared/data/types/model'
import { readCherryMeta } from '@shared/data/types/uiParts'
import type { SerializedError } from '@shared/types/error'
import { createCherryCloudModelAccess } from '@shared/utils/cherryCloudModelAvailability'

import { DEFAULT_PAGE, pageOf, queryPage } from './agentPagination'
import { toMessageUsage } from './agentUsage'

/** Text above this many UTF-16 units travels as a content reference so records stay under the wire budget. */
export const INLINE_TEXT_LIMIT = 4096

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
export const revisionOf = (iso: string): string => String(Date.parse(iso))
export const inputDigest = (input: unknown): string => sha256(utf8(JSON.stringify(input ?? null)))

export type PartContent = { text: string } | { ref: ContentRef }

export function contentOf(contentId: string, revision: string, text: string): PartContent {
  if (text.length <= INLINE_TEXT_LIMIT) return { text }
  const bytes = utf8(text)
  return {
    ref: { contentId, revision, byteLength: String(bytes.length), mediaType: 'text/plain', sha256: sha256(bytes) }
  }
}

export function notFound<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND)
      throw new RemoteRpcError('NOT_FOUND', 'Resource not found')
    throw error
  }
}

export function sliceContent(
  bytes: Uint8Array,
  offset: string,
  maxBytes: number
): { offset: string; dataBase64: string; nextOffset: string; eof: boolean; sha256: string } {
  const start = Number(offset)
  if (!Number.isSafeInteger(start) || start < 0 || start > bytes.length)
    throw new RemoteRpcError('NOT_FOUND', 'Offset exceeds content length')
  const slice = bytes.subarray(start, start + maxBytes)
  return {
    offset,
    dataBase64: Buffer.from(slice).toString('base64'),
    nextOffset: String(start + slice.length),
    eof: start + slice.length === bytes.length,
    sha256: sha256(bytes)
  }
}

export function toSessionSummary(session: AgentSessionEntity, activeExecutionId?: string): AgentSession | undefined {
  if (!session.agentId) return undefined
  const historyRevision = revisionOf(session.updatedAt)
  return {
    sessionId: session.id,
    agentId: session.agentId,
    workspaceId: session.workspaceId,
    workspaceKind: session.workspace.type === 'system' ? 'system' : 'registered',
    title: session.name,
    updatedAt: new Date(session.updatedAt).toISOString(),
    historyRevision,
    ...(activeExecutionId ? { activeExecutionId } : { idleRevision: historyRevision })
  }
}

export function getSession(sessionId: string): AgentSessionEntity {
  return notFound(() => agentSessionService.getConversationById(sessionId))
}

export type ProjectedPart = { part: AgentPart; text: string }

function dataPart(partId: string, revision: string, name: string, value: unknown): ProjectedPart {
  const text = JSON.stringify(value)
  return { part: { partId, revision, kind: 'data', name, content: contentOf(partId, revision, text) }, text }
}

/** Persisted parts get index-based IDs; live parts use stream IDs and are tombstoned once history commits. */
export function projectPersistedParts(message: AgentSessionMessageEntity): ProjectedPart[] {
  return projectMessageParts(
    { id: message.id, parts: message.data.parts ?? [], modelId: message.modelId },
    revisionOf(message.updatedAt)
  )
}

export function projectMessageParts(
  message: { id: string; parts: CherryMessagePart[]; modelId?: string | null },
  revision: string
): ProjectedPart[] {
  return message.parts.flatMap((part, index) =>
    projectMessagePart(part, `${message.id}:${index}`, revision, message.modelId)
  )
}

export function projectMessagePart(
  part: CherryMessagePart,
  partId: string,
  revision: string,
  modelId?: string | null
): ProjectedPart[] {
  const projected: ProjectedPart[] = []
  if (part.type === 'text' || part.type === 'reasoning') {
    projected.push({
      part: {
        partId,
        revision,
        kind: part.type,
        content: contentOf(partId, revision, part.text),
        state: 'completed'
      },
      text: part.text
    })
  } else if (isToolUIPart(part)) {
    const input = JSON.stringify(part.input ?? null)
    projected.push({
      part: {
        partId: `${partId}:in`,
        revision,
        kind: 'tool-input',
        toolName: getToolName(part),
        toolCallId: part.toolCallId,
        content: contentOf(`${partId}:in`, revision, input),
        state: 'completed'
      },
      text: input
    })
    if (part.state === 'output-available' || part.state === 'output-error') {
      const output = JSON.stringify(part.state === 'output-error' ? part.errorText : (part.output ?? null))
      projected.push({
        part: {
          partId: `${partId}:out`,
          revision,
          kind: 'tool-output',
          toolName: getToolName(part),
          toolCallId: part.toolCallId,
          content: contentOf(`${partId}:out`, revision, output),
          state: part.state === 'output-error' ? 'failed' : 'completed'
        },
        text: output
      })
    }
  } else if (part.type === 'data-error') {
    const failure = toExecutionFailure(part.data as SerializedError, modelId ?? undefined)
    projected.push(
      dataPart(partId, revision, 'data-error', { data: { message: failure.message, executionFailure: failure } })
    )
  } else if (part.type === 'file') {
    const metadata = readCherryMeta(part)?.remoteAttachment
    if (metadata && readCherryMeta(part)?.fileEntryId) {
      projected.push({
        text: '',
        part: {
          partId,
          revision,
          kind: 'file',
          name: part.filename || 'file',
          ref: {
            contentId: partId,
            revision,
            byteLength: String(metadata.byteLength),
            mediaType: part.mediaType,
            sha256: metadata.sha256
          }
        }
      })
    } else
      projected.push(dataPart(partId, revision, 'file', { mediaType: part.mediaType, filename: part.filename ?? null }))
  } else if (part.type !== 'step-start') {
    const { type, ...rest } = part as { type: string }
    projected.push(dataPart(partId, revision, type, rest))
  }
  return projected
}

/** Prefer the actual producing identity, with the matching immutable display name. */
export function toMessageModel(
  message: Partial<Pick<AgentSessionMessageEntity, 'modelId' | 'messageSnapshot'>>
): AgentMessage['model'] {
  const snapshot = message.messageSnapshot?.model
  const parsedId = UniqueModelIdSchema.safeParse(message.modelId)
  const identity = parsedId.success
    ? parseUniqueModelId(parsedId.data)
    : snapshot
      ? { modelId: snapshot.id, providerId: snapshot.provider }
      : undefined
  if (!identity) return undefined
  const name =
    snapshot?.id === identity.modelId && snapshot.provider === identity.providerId
      ? snapshot.name.trim() || identity.modelId
      : identity.modelId
  const result = modelSummarySchema.safeParse({ ...identity, name })
  return result.success ? result.data : undefined
}

function toMessageMetadata(message: AgentSessionMessageEntity) {
  const usage = toMessageUsage(message.stats)
  const model = toMessageModel(message)
  const error = message.data.parts?.find((part) => part.type === 'data-error')
  return {
    messageId: message.id,
    ...(usage ? { usage } : {}),
    ...(model ? { model } : {}),
    revision: revisionOf(message.updatedAt),
    role: message.role,
    status: message.status,
    ...(message.status === 'error'
      ? {
          failure: toExecutionFailure(
            (error?.data as SerializedError) ?? { name: null, message: null, stack: null },
            message.modelId ?? undefined
          )
        }
      : {})
  }
}

export function toMessage(message: AgentSessionMessageEntity): AgentMessage {
  return { ...toMessageMetadata(message), partIds: projectPersistedParts(message).map(({ part }) => part.partId) }
}

export function listMessages(
  sessionId: string,
  historyRevision: string,
  cursor?: string,
  limit?: number,
  partsMode?: 'paged'
): { items: AgentMessageListItem[]; nextCursor: string | null } {
  const session = getSession(sessionId)
  if (revisionOf(session.updatedAt) !== historyRevision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'History revision expired')
  return queryPage((attemptLimit) => {
    const page = notFound(() =>
      agentSessionMessageService.listSessionMessages(sessionId, { cursor, limit: attemptLimit })
    )
    return {
      items: page.items.map((message) =>
        partsMode === 'paged' ? { ...toMessageMetadata(message), partsMode } : toMessage(message)
      ),
      nextCursor: page.nextCursor ?? null
    }
  }, limit)
}

export function listParts(
  sessionId: string,
  messageId: string,
  messageRevision: string,
  cursor?: string,
  limit?: number
): { items: AgentPart[]; nextCursor: string | null } {
  const message = notFound(() => agentSessionMessageService.getSessionMessage(sessionId, messageId))
  if (revisionOf(message.updatedAt) !== messageRevision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Message revision expired')
  return pageOf(
    projectPersistedParts(message).map(({ part }) => part),
    cursor,
    limit
  )
}

export function readPersistedContent(sessionId: string, contentId: string, revision: string): Uint8Array | undefined {
  const [messageId] = contentId.split(':')
  const message = notFound(() => agentSessionMessageService.getSessionMessage(sessionId, messageId))
  if (revisionOf(message.updatedAt) !== revision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Content revision expired')
  const approval = (message.data.parts ?? []).find(
    (part) =>
      isToolUIPart(part) &&
      'approval' in part &&
      `${message.id}:approval:${(part.approval as { id?: string })?.id}` === contentId
  )
  if (approval && isToolUIPart(approval)) return utf8(JSON.stringify(approval.input ?? null))
  const projected = projectPersistedParts(message).find(({ part }) => part.partId === contentId)
  return projected ? utf8(projected.text) : undefined
}

export function interactionKind(toolName: string | undefined): 'decision' | 'question' {
  return toolName === 'AskUserQuestion' || toolName === 'builtin_AskUserQuestion' ? 'question' : 'decision'
}

/** Approval cards persisted after a turn ended; their anchor message stands in as the execution. */
export function listPersistedInteractions(sessionId: string): AgentInteraction[] {
  const messages = notFound(() => agentSessionMessageService.listApprovalMessages(sessionId))
  const interactions: AgentInteraction[] = []
  for (const message of messages) {
    for (const part of message.data.parts ?? []) {
      if (!isToolUIPart(part)) continue
      const approval = (part as { approval?: { id?: string; approved?: boolean } }).approval
      if (!approval?.id) continue
      const input = JSON.stringify(part.input ?? null)
      const partId = `${message.id}:approval:${approval.id}`
      interactions.push({
        interactionId: approval.id,
        kind: interactionKind(getToolName(part)),
        revision: revisionOf(message.updatedAt),
        executionId: message.id,
        toolCallId: part.toolCallId,
        status:
          approval.approved === true
            ? 'approved'
            : approval.approved === false
              ? 'denied'
              : part.state === 'approval-requested'
                ? 'pending'
                : 'expired',
        summary: `${getToolName(part)} ${input}`.slice(0, 2048),
        inputDigest: inputDigest(part.input),
        input: contentOf(partId, revisionOf(message.updatedAt), input)
      })
    }
  }
  return interactions
}

export function listAgents(cursor?: string, limit?: number) {
  const { agents } = agentService.listAgents()
  return pageOf(
    agents.map((agent) => {
      const emoji = agent.configuration?.avatar?.trim() || '🤖'
      const identity = toMessageModel({ modelId: agent.model })
      const named =
        identity && modelSummarySchema.safeParse({ ...identity, name: agent.modelName?.trim() || identity.name })
      const model = named?.success ? named.data : (identity ?? null)
      return { agentId: agent.id, name: agent.name, emoji: emoji.length <= 64 ? emoji : '🤖', model }
    }),
    cursor,
    limit
  )
}

function wireLabel(raw: string, fallback: string, maxLength: number): string {
  const sanitize = (value: string) =>
    value
      .slice(0, maxLength)
      .replace(/[\uD800-\uDBFF]$/, '')
      .toWellFormed()
      .trim()
  return sanitize(raw.trim()) || sanitize(fallback)
}

function selectableModels(
  agentId: string,
  selected?: { providerId: string; modelId: string }
): Array<{
  id: UniqueModelId
  identity: ReturnType<typeof parseUniqueModelId>
  name: string
  providerName: string
}> {
  const agent = agentService.getAgent(agentId)
  if (!agent) throw new RemoteRpcError('NOT_FOUND', 'Agent not found')
  const providers = new Map(providerService.list({ enabled: true }).map((provider) => [provider.id, provider]))
  const cloud = createCherryCloudModelAccess(application.get('CherryCloudService').getAccountReceipt().models)
  return modelService.list({ enabled: true, providerId: selected?.providerId }).flatMap((model) => {
    const provider = providers.get(model.providerId)
    if (!provider || !isAgentModelSelectable(agent.type, model, provider) || !cloud.isSelectable(model, true)) return []
    const identity = parseUniqueModelId(model.id)
    if (selected && identity.modelId !== selected.modelId) return []
    return [{ id: model.id, identity, name: model.name, providerName: provider.name }]
  })
}

export function listModels({ agentId, cursor, limit, search }: AgentParams<'agent.models.list'>) {
  const keywords = search?.toLowerCase().trim().split(/\s+/) ?? []
  const items = selectableModels(agentId)
    .flatMap(({ identity, name, providerName }) => {
      const summary = modelOptionSchema.safeParse({
        ...identity,
        name: wireLabel(name, identity.modelId, 2048),
        providerName: wireLabel(providerName, identity.providerId, 4096)
      })
      return summary.success ? [summary.data] : []
    })
    .filter((item) => {
      const text = [item.providerId, item.providerName, item.modelId, item.name].join(' ').toLowerCase()
      return keywords.every((keyword) => text.includes(keyword))
    })
  return pageOf(items, cursor, limit)
}

export function listWorkspaces(agentId: string, cursor?: string, limit?: number) {
  if (!agentService.agentExists(agentId)) throw new RemoteRpcError('NOT_FOUND', 'Agent not found')
  return {
    ...pageOf(
      agentWorkspaceService.list().map((workspace) => ({ workspaceId: workspace.id, name: workspace.name })),
      cursor,
      limit
    ),
    systemWorkspace: true
  }
}

export function listSessions(query: AgentParams<'agent.sessions.list'>): {
  items: AgentSessionEntity[]
  nextCursor: string | null
} {
  const options = {
    agentId: query.agentId,
    workspaceId: query.workspaceId,
    cursor: query.cursor,
    limit: query.limit ?? DEFAULT_PAGE
  }
  const page = notFound(() =>
    query.taskId
      ? agentTaskService.listTaskSessions(query.taskId, options)
      : agentSessionService.listByCursor({ ...options, scope: 'all-conversations' })
  )
  return {
    items: page.items,
    nextCursor: page.nextCursor ?? null
  }
}

export function createSessionTx(
  tx: DbOrTx,
  sessionId: string,
  input: AgentParams<'agent.sessions.create'>,
  options?: { cloudRefreshFailed?: boolean }
): void {
  let model: UniqueModelId | undefined
  if (input.model) {
    if (options?.cloudRefreshFailed) {
      notFound(() => agentService.assertActiveTx(tx, input.agentId))
      throw new RemoteRpcError('MODEL_UNAVAILABLE', 'Cherry Cloud model availability could not be refreshed')
    }
    model = selectableModels(input.agentId, input.model)[0]?.id
    if (!model) throw new RemoteRpcError('MODEL_UNAVAILABLE', 'Selected session model is no longer available')
  }
  notFound(() =>
    agentSessionService.createTx(tx, sessionId, {
      agentId: input.agentId,
      name: input.title ?? '',
      model,
      workspace:
        'workspace' in input
          ? input.workspace.kind === 'system'
            ? { type: 'system' }
            : { type: 'user', workspaceId: input.workspace.id }
          : { type: 'user', workspaceId: input.workspaceId }
    })
  )
}

/** Resolve bytes only through a current message reference, never a client-supplied file path. */
export async function readPersistedFileContent(params: AgentParams<'agent.content.read'>) {
  const [messageId] = params.contentId.split(':')
  const index = Number(params.contentId.slice(messageId.length + 1))
  if (`${messageId}:${index}` !== params.contentId) return undefined
  let message: AgentSessionMessageEntity
  try {
    message = agentSessionMessageService.getSessionMessage(params.sessionId, messageId)
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return undefined
    throw error
  }
  const part = message.data.parts?.[index]
  if (part?.type !== 'file') return undefined
  const meta = readCherryMeta(part)
  if (!meta?.remoteAttachment || !meta.fileEntryId) return undefined
  if (revisionOf(message.updatedAt) !== params.revision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Content revision expired')
  const offset = Number(params.offset)
  const { byteLength, sha256 } = meta.remoteAttachment
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > byteLength)
    throw new RemoteRpcError('NOT_FOUND', 'Invalid file offset')
  const handle = await open(
    application.get('FileManager').getPhysicalPath(FileEntryIdSchema.parse(meta.fileEntryId)),
    'r'
  )
  try {
    const bytes = Buffer.alloc(Math.min(params.maxBytes, byteLength - offset))
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset)
    if (bytesRead !== bytes.length || (await handle.stat()).size !== byteLength)
      throw new RemoteRpcError('NOT_FOUND', 'Attachment is unavailable')
    return {
      ...params,
      dataBase64: bytes.toString('base64'),
      nextOffset: String(offset + bytesRead),
      eof: offset + bytesRead === byteLength,
      sha256
    }
  } finally {
    await handle.close()
  }
}
