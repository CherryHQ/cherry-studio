import * as z from 'zod'

import { UniqueModelIdSchema } from './model'

export const SideChatSourceSchema = z.strictObject({
  topicId: z.uuidv4(),
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
export type SideChatMetadata = z.infer<typeof SideChatMetadataSchema>

export interface SavedSideChat {
  topicId: string
  sourceTopicId: string
  metadata: SideChatMetadata
  questionCount: number
}
