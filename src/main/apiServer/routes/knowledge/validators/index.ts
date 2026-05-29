import { KnowledgeBaseIdParamSchema, KnowledgeSearchSchema, PaginationQuerySchema } from './zodSchemas'
import { createZodValidator } from './zodValidator'

/**
 * Validation middleware for knowledge base search
 */
export const validateKnowledgeSearch = createZodValidator({
  body: KnowledgeSearchSchema
})

/**
 * Validation middleware for knowledge base ID parameter
 */
export const validateKnowledgeBaseId = createZodValidator({
  params: KnowledgeBaseIdParamSchema
})

/**
 * Validation middleware for pagination query parameters
 */
export const validatePagination = createZodValidator({
  query: PaginationQuerySchema
})
