import { getToolName, isToolUIPart } from 'ai'

import { modelSummarySchema } from '@cherrystudio/remote-protocol/agent'
import type {
  AssistantInteraction,
  AssistantMessage,
  AssistantParams,
  AssistantTopic
} from '@cherrystudio/remote-protocol/assistant'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { assistantDataService } from '@data/services/AssistantService'
import { messageService } from '@data/services/MessageService'
import { modelService } from '@data/services/ModelService'
import { topicService } from '@data/services/TopicService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { Assistant } from '@shared/data/types/assistant'
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'

import {
  contentOf,
  inputDigest,
  interactionKind,
  notFound,
  partTarget,
  projectPersistedParts,
  readUploadedFile,
  sha256,
  toMessage,
  toMessageModel,
  uploadedFileOf,
  utf8
} from './agentQueries'

function configuredModel(assistant: Assistant) {
  if (!assistant.modelId) return undefined
  const { providerId, modelId } = parseUniqueModelId(assistant.modelId)
  try {
    const model = modelService.getByKey(providerId, modelId)
    return model.isEnabled ? model : undefined
  } catch (error) {
    if (isDataApiError(error) && (error.code === ErrorCode.NOT_FOUND || error.code === ErrorCode.INVALID_OPERATION))
      return undefined
    throw error
  }
}

export function getAssistant(assistantId: string): Assistant {
  return notFound(() => assistantDataService.getById(assistantId))
}

export function assistantRevision(assistant: Assistant): string {
  return sha256(utf8(JSON.stringify(assistant)))
}

export function getAssistantTopic(topicId: string, activeExecutionIds: string[] = []): AssistantTopic {
  const topic = notFound(() => topicService.getById(topicId))
  return {
    topicId,
    assistantId: topic.assistantId ?? null,
    title: topic.name.slice(0, 4096),
    updatedAt: topic.updatedAt,
    parentAnchorId: topic.activeNodeId ?? null,
    historyRevision: topicService.getRemoteHistoryRevision(topicId),
    activeExecutionIds
  }
}

export function assertView(view: { topicId: string; parentAnchorId: string | null; historyRevision: string }): void {
  const topic = getAssistantTopic(view.topicId)
  if (topic.historyRevision !== view.historyRevision || topic.parentAnchorId !== view.parentAnchorId)
    throw new RemoteRpcError('REVISION_EXPIRED', 'The selected topic branch changed; refresh its history')
}

export function branchMessages(topicId: string): Message[] {
  const topic = getAssistantTopic(topicId)
  const anchor = topic.parentAnchorId
  if (!anchor) return []
  const path = notFound(() => messageService.getPathToNode(anchor))
  const branch = notFound(() =>
    messageService.getBranchMessages(topicId, { nodeId: anchor, includeSiblings: true, limit: path.length })
  )
  return branch.items.flatMap(({ message, siblingsGroup }) => [message, ...(siblingsGroup ?? [])])
}

export function getBranchMessage(topicId: string, messageId: string): Message {
  const message = notFound(() => messageService.getById(messageId))
  const topic = getAssistantTopic(topicId)
  if (
    message.role === 'root' ||
    message.topicId !== topicId ||
    !topic.parentAnchorId ||
    !messageService.isMessageOnBranch(topicId, topic.parentAnchorId, messageId)
  )
    throw new RemoteRpcError('NOT_FOUND', 'Message is not on the current topic branch')
  return message
}

export function toAssistantMessage(
  message: Message,
  revision: string,
  partCount = projectPersistedParts(message, revision, false).length
): AssistantMessage {
  const snapshot = message.messageSnapshot
  return {
    ...toMessage(message, revision, []),
    partCount,
    partIds: [],
    parentId: message.parentId,
    replyGroupId: String(message.siblingsGroupId),
    ...(snapshot
      ? {
          author: {
            assistantId: snapshot.id,
            name: snapshot.name.slice(0, 4096),
            ...(snapshot.emoji ? { emoji: snapshot.emoji.slice(0, 64) } : {})
          }
        }
      : {})
  }
}

export function scopedPage<T>(
  items: readonly T[],
  scope: string,
  cursor?: string,
  limit = 20
): { items: T[]; nextCursor: string | null } {
  const sign = (offset: number) => `${offset}.${sha256(utf8(`${scope}:${offset}`))}`
  const start = cursor === undefined ? 0 : Number(cursor.split('.')[0])
  if (!Number.isSafeInteger(start) || start < 0 || (cursor !== undefined && cursor !== sign(start)))
    throw new RemoteRpcError('REVISION_EXPIRED', 'Cursor belongs to another resource, revision or grant')
  let bytes = 0
  const page: T[] = []
  for (const item of items.slice(start, start + limit)) {
    const size = Buffer.byteLength(JSON.stringify(item))
    if (size > 48_000) throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Resource exceeds the record limit')
    if (page.length && bytes + size > 48_000) break
    page.push(item)
    bytes += size
  }
  const next = start + page.length
  return { items: page, nextCursor: next < items.length ? sign(next) : null }
}

export function listAssistants(grantId: string, cursor?: string, limit = 20) {
  const scope = `assistants:offset:${grantId}:${limit}`
  const sign = (offset: number) => `${offset}.${sha256(utf8(`${scope}:${offset}`))}`
  const offset = cursor === undefined ? 0 : Number(cursor.split('.')[0])
  if (!Number.isSafeInteger(offset) || offset < 0 || (cursor !== undefined && cursor !== sign(offset)))
    throw new RemoteRpcError('REVISION_EXPIRED', 'Assistant cursor belongs to another grant')
  const page = assistantDataService.list({
    page: Math.floor(offset / limit) + 1,
    limit,
    sortBy: 'updatedAt',
    sortOrder: 'desc'
  })
  const projected = page.items.slice(offset % limit).map((assistant) => {
    const identity = toMessageModel({ modelId: assistant.modelId })
    const emoji = assistant.emoji?.trim()
    const named = identity
      ? modelSummarySchema.safeParse({ ...identity, name: assistant.modelName || identity.name })
      : undefined
    return {
      assistantId: assistant.id,
      name: assistant.name.slice(0, 4096),
      ...(emoji && emoji.length <= 64 ? { emoji } : {}),
      model: named?.success ? named.data : (identity ?? null),
      configurationRevision: assistantRevision(assistant),
      available: Boolean(configuredModel(assistant))
    }
  })
  const { items } = scopedPage(projected, scope, undefined, limit)
  const next = offset + items.length
  return { items, nextCursor: next < page.total ? sign(next) : null }
}

export function listAssistantTopics(
  params: AssistantParams<'assistant.topics.list'>,
  grantId: string,
  executions: (topicId: string) => string[]
) {
  if (params.assistantId) getAssistant(params.assistantId)
  const scope = `${grantId}:topics:${params.assistantId ?? ''}`
  let cursor: string | undefined
  if (params.cursor) {
    const index = params.cursor.lastIndexOf('.')
    cursor = params.cursor.slice(0, index)
    if (index < 1 || params.cursor.slice(index + 1) !== sha256(utf8(`${scope}:${cursor}`)))
      throw new RemoteRpcError('REVISION_EXPIRED', 'Topic cursor belongs to another grant or assistant')
  }
  const page = notFound(() =>
    topicService.listByCursor({ assistantId: params.assistantId, cursor, limit: Math.min(params.limit ?? 20, 20) })
  )
  return {
    items: page.items.map((topic) => getAssistantTopic(topic.id, executions(topic.id))),
    nextCursor: page.nextCursor ? `${page.nextCursor}.${sha256(utf8(`${scope}:${page.nextCursor}`))}` : null
  }
}

export function listAssistantMessages(params: AssistantParams<'assistant.messages.list'>, grantId: string) {
  assertView(params)
  const page = scopedPage(
    branchMessages(params.topicId)
      .reverse()
      .map((message) => toAssistantMessage(message, params.historyRevision)),
    `${grantId}:messages:${params.topicId}:${params.parentAnchorId}:${params.historyRevision}`,
    params.cursor,
    params.limit
  )
  return { ...page, items: page.items.reverse() }
}

export function listAssistantParts(params: AssistantParams<'assistant.parts.list'>, grantId: string) {
  assertView(params)
  if (params.messageRevision !== params.historyRevision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Message revision expired')
  return scopedPage(
    projectPersistedParts(getBranchMessage(params.topicId, params.messageId), params.messageRevision).map(
      ({ part }) => part
    ),
    `${grantId}:parts:${params.topicId}:${params.parentAnchorId}:${params.historyRevision}:${params.messageId}`,
    params.cursor,
    params.limit
  )
}

export function readAssistantContent(params: AssistantParams<'assistant.content.read'>): Uint8Array | undefined {
  assertView(params)
  if (params.revision !== params.historyRevision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Content revision expired')
  const messageId = params.contentId.split(':')[0]
  const message = getBranchMessage(params.topicId, messageId)
  const approval = message.data.parts?.find(
    (part) => isToolUIPart(part) && part.approval && `${message.id}:approval:${part.approval.id}` === params.contentId
  )
  if (approval && isToolUIPart(approval)) return utf8(JSON.stringify(approval.input ?? null))
  const projected = projectPersistedParts(message, params.revision).find(({ part }) => part.partId === params.contentId)
  return projected ? utf8(projected.text) : undefined
}

export async function readAssistantFileContent(params: AssistantParams<'assistant.content.read'>) {
  assertView(params)
  const target = partTarget(params.contentId)
  if (!target) return undefined
  const file = uploadedFileOf(getBranchMessage(params.topicId, target.messageId).data.parts?.[target.index])
  if (!file) return undefined
  if (params.revision !== params.historyRevision)
    throw new RemoteRpcError('REVISION_EXPIRED', 'Content revision expired')
  return readUploadedFile(file, params)
}

export function persistedAssistantInteractions(topicId: string): AssistantInteraction[] {
  const topic = getAssistantTopic(topicId)
  const configurationRevision = topic.assistantId ? assistantRevision(getAssistant(topic.assistantId)) : '0'.repeat(64)
  const result: AssistantInteraction[] = []
  for (const message of branchMessages(topicId)) {
    for (const part of message.data.parts ?? []) {
      if (!isToolUIPart(part) || !('approval' in part) || !part.approval?.id) continue
      const approval = part.approval
      const kind = interactionKind(getToolName(part))
      const text = JSON.stringify(part.input ?? null)
      result.push({
        interactionId: approval.id,
        configurationRevision,
        messageId: message.id,
        executionId: `approval:${message.id}:${topic.historyRevision}`,
        revision: topic.historyRevision,
        toolCallId: part.toolCallId,
        kind,
        status:
          approval.approved === true
            ? 'approved'
            : approval.approved === false
              ? 'denied'
              : part.state === 'approval-requested'
                ? 'pending'
                : 'expired',
        summary: getToolName(part).slice(0, 2048),
        inputDigest: inputDigest(part.input),
        input: contentOf(`${message.id}:approval:${approval.id}`, topic.historyRevision, text),
        respondable: kind === 'decision',
        desktopRequired: kind !== 'decision'
      })
    }
  }
  return result
}

export function assertAssistantSend(params: AssistantParams<'assistant.messages.send'>): void {
  const topic = getAssistantTopic(params.topicId)
  if (
    topic.assistantId !== params.assistantId ||
    topic.parentAnchorId !== params.parentAnchorId ||
    topic.historyRevision !== params.expectedHistoryRevision
  )
    throw new RemoteRpcError('CONFLICT', 'Assistant or selected topic branch changed; refresh before sending')
  const assistant = getAssistant(params.assistantId)
  if (assistantRevision(assistant) !== params.expectedAssistantRevision)
    throw new RemoteRpcError('CONFLICT', 'Assistant configuration changed; refresh before sending')
  if (!assistant.modelId) throw new RemoteRpcError('TARGET_UNAVAILABLE', 'Assistant has no configured model')
  if (!configuredModel(assistant)) throw new RemoteRpcError('TARGET_UNAVAILABLE', 'Assistant model is unavailable')
  if (persistedAssistantInteractions(params.topicId).some((interaction) => interaction.status === 'pending'))
    throw new RemoteRpcError('CONFLICT', 'Topic has an unanswered tool approval')
}
