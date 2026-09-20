import * as z from 'zod'

import {
  ContentMessageRoleSchema,
  MessageSnapshotSchema,
  MessageStatusSchema,
  toContentRole
} from '@shared/data/types/message'
import type { Message } from '@shared/data/types/message'
import { ServiceTierSelectionSchema } from '@shared/data/types/model'
import { TopicNameEntitySchema } from '@shared/data/types/topic'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

import type { ImportConversation, ImportMessageNode } from './types'

export const CHERRY_TOPIC_FILE_KIND = 'cherry-studio.topic'
export const CHERRY_TOPIC_FILE_VERSION = 1
export const CHERRY_TOPIC_FILE_EXTENSION = '.cherry.json'

const CherryTurnOptionsSchema = z.strictObject({
  reasoningEffort: ReasoningEffortOptionSchema.optional(),
  serviceTier: ServiceTierSelectionSchema.optional(),
  fastMode: z.boolean().optional()
})

const CherryTopicFileMessageSchema = z.strictObject({
  sourceId: z.string().min(1),
  parentSourceId: z.string().min(1).optional(),
  role: ContentMessageRoleSchema,
  // Parts stay runtime-opaque (same as MessageDataSchema): heterogeneous AI SDK
  // parts evolve faster than this envelope, so only array-ness is checked.
  parts: z.array(z.unknown()),
  status: MessageStatusSchema.optional(),
  siblingsGroupId: z.number().int().nonnegative().optional(),
  messageSnapshot: MessageSnapshotSchema.optional(),
  turnOptions: CherryTurnOptionsSchema.optional()
})

export const CherryTopicFileSchema = z.strictObject({
  kind: z.literal(CHERRY_TOPIC_FILE_KIND),
  version: z.literal(CHERRY_TOPIC_FILE_VERSION),
  exportedAt: z.iso.datetime(),
  topic: z.strictObject({
    name: TopicNameEntitySchema,
    isNameManuallyEdited: z.boolean().optional()
  }),
  assistant: z
    .strictObject({
      name: z.string().min(1).max(255),
      emoji: z.string().max(64).optional()
    })
    .optional(),
  messages: z.array(CherryTopicFileMessageSchema),
  activeSourceId: z.string().min(1).optional()
})

export type CherryTopicFile = z.infer<typeof CherryTopicFileSchema>

function hasResolvableTree(file: CherryTopicFile): boolean {
  const sourceIds = new Set(file.messages.map((message) => message.sourceId))
  if (sourceIds.size !== file.messages.length) return false
  if (!file.messages.every((message) => !message.parentSourceId || sourceIds.has(message.parentSourceId))) {
    return false
  }
  return !file.activeSourceId || sourceIds.has(file.activeSourceId)
}

export function validateCherryTopicFileContent(fileContent: string): boolean {
  try {
    const parsed: unknown = JSON.parse(fileContent)
    const result = CherryTopicFileSchema.safeParse(parsed)
    return result.success && hasResolvableTree(result.data)
  } catch {
    return false
  }
}

export function parseCherryTopicFile(fileContent: string): CherryTopicFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(fileContent)
  } catch {
    throw new Error('Invalid Cherry Studio topic file')
  }
  const result = CherryTopicFileSchema.safeParse(parsed)
  if (!result.success || !hasResolvableTree(result.data)) {
    throw new Error('Invalid Cherry Studio topic file')
  }
  return result.data
}

export function toImportConversation(file: CherryTopicFile, untitledName: string): ImportConversation {
  return {
    name: file.topic.name.trim() || untitledName,
    ...(file.topic.isNameManuallyEdited ? { isNameManuallyEdited: true } : {}),
    messages: file.messages.map((message) => ({
      sourceId: message.sourceId,
      ...(message.parentSourceId ? { parentSourceId: message.parentSourceId } : {}),
      role: message.role,
      parts: message.parts as ImportMessageNode['parts'],
      ...(message.status ? { status: message.status } : {}),
      ...(message.siblingsGroupId !== undefined ? { siblingsGroupId: message.siblingsGroupId } : {}),
      ...(message.messageSnapshot ? { messageSnapshot: message.messageSnapshot } : {}),
      ...(message.turnOptions ? { turnOptions: message.turnOptions } : {})
    })),
    ...(file.activeSourceId ? { activeSourceId: file.activeSourceId } : {})
  }
}

export interface BuildCherryTopicFileInput {
  topic: { name: string; isNameManuallyEdited?: boolean }
  assistant?: { name: string; emoji?: string }
  messages: Message[]
  activeNodeId?: string | null
  rootId?: string | null
  exportedAt: string
}

export function buildCherryTopicFile(input: BuildCherryTopicFileInput): CherryTopicFile {
  const { topic, assistant, activeNodeId, rootId, exportedAt } = input
  const ordered = [...input.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const nodes = ordered
    .filter((message) => message.role !== 'root')
    .map((message) => ({
      sourceId: message.id,
      ...(message.parentId && message.parentId !== rootId ? { parentSourceId: message.parentId } : {}),
      role: toContentRole(message.role),
      parts: message.data?.parts ?? [],
      status: message.status,
      siblingsGroupId: message.siblingsGroupId,
      ...(message.messageSnapshot ? { messageSnapshot: message.messageSnapshot } : {}),
      ...(message.data?.turnOptions ? { turnOptions: message.data.turnOptions } : {})
    }))
  const knownIds = new Set(nodes.map((node) => node.sourceId))
  return {
    kind: CHERRY_TOPIC_FILE_KIND,
    version: CHERRY_TOPIC_FILE_VERSION,
    exportedAt,
    topic: {
      name: topic.name,
      ...(topic.isNameManuallyEdited ? { isNameManuallyEdited: true } : {})
    },
    ...(assistant ? { assistant } : {}),
    messages: nodes,
    ...(activeNodeId && activeNodeId !== rootId && knownIds.has(activeNodeId) ? { activeSourceId: activeNodeId } : {})
  }
}
