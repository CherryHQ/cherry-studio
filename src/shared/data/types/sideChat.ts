import * as z from 'zod'

import { AgentPermissionModeSchema } from '../api/schemas/agents'
import { UniqueModelIdSchema } from './model'

/** Ordinary topic UUID or the existing Agent conversation stream identity. */
export const SideChatSourceIdSchema = z.union([z.uuidv4(), z.string().regex(/^agent-session:[^\s:]+$/)])

export const SideChatSourceSchema = z.strictObject({
  topicId: SideChatSourceIdSchema,
  messageId: z.string().min(1),
  selection: z.string().min(1).max(200_000).optional()
})

export const SideChatSnapshotSchema = z.strictObject({
  messageId: z.string(),
  selection: z.string(),
  answer: z.string(),
  question: z.string(),
  prefix: z.string(),
  suffix: z.string()
})

export const SideChatConfigSchema = z.strictObject({
  modelId: UniqueModelIdSchema,
  prompt: z.string().max(20_000)
})

export const SideChatMetadataSchema = z.strictObject({
  snapshot: SideChatSnapshotSchema,
  config: SideChatConfigSchema
})

export type SideChatSource = z.infer<typeof SideChatSourceSchema>
export type SideChatSnapshot = z.infer<typeof SideChatSnapshotSchema>
export type SideChatConfig = z.infer<typeof SideChatConfigSchema>
export const SideChatTurnSettingsSchema = z.strictObject({
  permissionMode: AgentPermissionModeSchema.extract(['default', 'bypassPermissions']),
  skills: z.array(z.string().min(1).max(255)).max(20)
})
export type SideChatTurnSettings = z.infer<typeof SideChatTurnSettingsSchema>
export type SideChatMetadata = z.infer<typeof SideChatMetadataSchema>

/** Main-owned structural data on the side topic's existing virtual root, never model history. */
export const SideChatRootDataSchema = z.strictObject({
  parts: z.tuple([]),
  sideChat: SideChatMetadataSchema.extend({ sourceTopicId: SideChatSourceIdSchema, version: z.literal(1) })
})

export interface SavedSideChat {
  topicId: string
  sourceTopicId: string
  metadata: SideChatMetadata
  questionCount: number
}
