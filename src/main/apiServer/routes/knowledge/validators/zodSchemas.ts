import * as z from 'zod'

/**
 * Zod schema for knowledge base ID validation
 */
export const KnowledgeBaseIdSchema = z.string().min(1, 'Knowledge base ID is required')

/**
 * Zod schema for knowledge base search request
 */
export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be at most 1000 characters'),
  knowledge_base_ids: z.array(z.string().min(1, 'Knowledge base ID cannot be empty')).optional(),
  document_count: z.coerce.number().int().min(1).max(20).default(5)
})

/**
 * Zod schema for pagination query parameters
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional()
})

/**
 * Zod schema for knowledge base ID parameter
 */
export const KnowledgeBaseIdParamSchema = z.object({
  id: KnowledgeBaseIdSchema
})
