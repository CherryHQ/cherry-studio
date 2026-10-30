import * as z from 'zod'

import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { ExternalKnowledgeDocument, ExternalKnowledgeSource } from '@shared/data/types/externalKnowledge'

export const EXTERNAL_KNOWLEDGE_DOCUMENTS_DEFAULT_LIMIT = 50
export const EXTERNAL_KNOWLEDGE_DOCUMENTS_MAX_LIMIT = 200

export const ListExternalKnowledgeDocumentsQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(EXTERNAL_KNOWLEDGE_DOCUMENTS_MAX_LIMIT)
    .default(EXTERNAL_KNOWLEDGE_DOCUMENTS_DEFAULT_LIMIT)
})
export type ListExternalKnowledgeDocumentsQueryParams = z.input<typeof ListExternalKnowledgeDocumentsQuerySchema>
export type ListExternalKnowledgeDocumentsQuery = z.output<typeof ListExternalKnowledgeDocumentsQuerySchema>

export interface ExternalKnowledgeDocumentListResponse extends CursorPaginationResponse<ExternalKnowledgeDocument> {
  items: ExternalKnowledgeDocument[]
  total: number
}

export type ExternalKnowledgeSchemas = {
  '/knowledge-bases/:id/external-knowledge-sources': {
    GET: {
      params: { id: string }
      response: ExternalKnowledgeSource[]
    }
  }

  '/external-knowledge-sources/:id': {
    GET: {
      params: { id: string }
      response: ExternalKnowledgeSource
    }
  }

  '/external-knowledge-sources/:id/documents': {
    GET: {
      params: { id: string }
      query?: ListExternalKnowledgeDocumentsQueryParams
      response: ExternalKnowledgeDocumentListResponse
    }
  }

  '/external-knowledge-documents/:id': {
    GET: {
      params: { id: string }
      response: ExternalKnowledgeDocument
    }
  }
}
