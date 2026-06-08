import {
  CreateKnowledgeBaseSchema,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  KnowledgeRuntimeAddItemInputSchema,
  RestoreKnowledgeBaseSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

export const KnowledgeRuntimeCreateBasePayloadSchema = z.strictObject({
  base: CreateKnowledgeBaseSchema
})
export type KnowledgeRuntimeCreateBasePayload = z.infer<typeof KnowledgeRuntimeCreateBasePayloadSchema>

export const KnowledgeRuntimeRestoreBasePayloadSchema = RestoreKnowledgeBaseSchema
export type KnowledgeRuntimeRestoreBasePayload = z.infer<typeof KnowledgeRuntimeRestoreBasePayloadSchema>

export const KnowledgeRuntimeBasePayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1)
})
export type KnowledgeRuntimeBasePayload = z.infer<typeof KnowledgeRuntimeBasePayloadSchema>

export const KnowledgeRuntimeAddItemsPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  items: z.array(KnowledgeRuntimeAddItemInputSchema).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})
export type KnowledgeRuntimeAddItemsPayload = z.infer<typeof KnowledgeRuntimeAddItemsPayloadSchema>

export const KnowledgeRuntimeItemsPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemIds: z.array(z.string().trim().min(1)).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})
export type KnowledgeRuntimeItemsPayload = z.infer<typeof KnowledgeRuntimeItemsPayloadSchema>

export const KnowledgeRuntimeSearchPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  query: z.string().trim().min(1).max(1000)
})
export type KnowledgeRuntimeSearchPayload = z.infer<typeof KnowledgeRuntimeSearchPayloadSchema>

export const KnowledgeRuntimeItemChunksPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemId: z.string().trim().min(1)
})
export type KnowledgeRuntimeItemChunksPayload = z.infer<typeof KnowledgeRuntimeItemChunksPayloadSchema>

export const KnowledgeRuntimeDeleteItemChunkPayloadSchema = z.strictObject({
  baseId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  chunkId: z.string().trim().min(1)
})
export type KnowledgeRuntimeDeleteItemChunkPayload = z.infer<typeof KnowledgeRuntimeDeleteItemChunkPayloadSchema>
