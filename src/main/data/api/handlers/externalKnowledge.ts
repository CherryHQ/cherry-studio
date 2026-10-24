import { externalKnowledgeDocumentService } from '@data/services/ExternalKnowledgeDocumentService'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  type ExternalKnowledgeSchemas,
  ListExternalKnowledgeDocumentsQuerySchema
} from '@shared/data/api/schemas/externalKnowledge'
import type { HandlersFor } from '@shared/data/api/types'

export const externalKnowledgeHandlers: HandlersFor<ExternalKnowledgeSchemas> = {
  '/knowledge-bases/:id/external-knowledge-sources': {
    GET: async ({ params }) => externalKnowledgeSourceService.listByBaseId(params.id)
  },

  '/external-knowledge-sources/:id': {
    GET: async ({ params }) => {
      const source = externalKnowledgeSourceService.getById(params.id)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', params.id)
      return source
    }
  },

  '/external-knowledge-sources/:id/documents': {
    GET: async ({ params, query }) => {
      const source = externalKnowledgeSourceService.getById(params.id)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', params.id)
      return externalKnowledgeDocumentService.listBySourceId(
        source.id,
        ListExternalKnowledgeDocumentsQuerySchema.parse(query ?? {})
      )
    }
  },

  '/external-knowledge-documents/:id': {
    GET: async ({ params }) => {
      const document = externalKnowledgeDocumentService.getById(params.id)
      if (!document) throw DataApiErrorFactory.notFound('ExternalKnowledgeDocument', params.id)
      return document
    }
  }
}
