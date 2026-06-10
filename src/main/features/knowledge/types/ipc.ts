import {
  CreateKnowledgeBaseSchema,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  KnowledgeAddItemInputSchema,
  RestoreKnowledgeBaseSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

export const KnowledgeCreateBasePayloadSchema = z.strictObject({
  base: CreateKnowledgeBaseSchema
})
export type KnowledgeCreateBasePayload = z.infer<typeof KnowledgeCreateBasePayloadSchema>

export const KnowledgeRestoreBasePayloadSchema = RestoreKnowledgeBaseSchema
export type KnowledgeRestoreBasePayload = z.infer<typeof KnowledgeRestoreBasePayloadSchema>

export const KnowledgeBasePayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1)
})
export type KnowledgeBasePayload = z.infer<typeof KnowledgeBasePayloadSchema>

export const KnowledgeAddItemsPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  items: z.array(KnowledgeAddItemInputSchema).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})
export type KnowledgeAddItemsPayload = z.infer<typeof KnowledgeAddItemsPayloadSchema>

export const KnowledgeItemsPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemIds: z.array(z.string().trim().min(1)).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})
export type KnowledgeItemsPayload = z.infer<typeof KnowledgeItemsPayloadSchema>

export const KnowledgeSearchPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(1000)
})
export type KnowledgeSearchPayload = z.infer<typeof KnowledgeSearchPayloadSchema>

export const KnowledgeItemChunksPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemId: z.string().trim().min(1)
})
export type KnowledgeItemChunksPayload = z.infer<typeof KnowledgeItemChunksPayloadSchema>

export const KnowledgeDeleteItemChunkPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  chunkId: z.string().trim().min(1)
})
export type KnowledgeDeleteItemChunkPayload = z.infer<typeof KnowledgeDeleteItemChunkPayloadSchema>
