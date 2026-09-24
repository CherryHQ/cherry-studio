import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ExternalKnowledgeConnectionSchemas } from '@shared/data/api/schemas/externalKnowledgeConnections'
import type { HandlersFor } from '@shared/data/api/types'

export const externalKnowledgeConnectionHandlers: HandlersFor<ExternalKnowledgeConnectionSchemas> = {
  '/external-knowledge-connections': {
    GET: async () => externalKnowledgeConnectionService.listWithSourceCount()
  },

  '/external-knowledge-connections/:id': {
    GET: async ({ params }) => {
      const connection = externalKnowledgeConnectionService.getById(params.id)
      if (!connection) throw DataApiErrorFactory.notFound('ExternalKnowledgeConnection', params.id)
      return connection
    }
  }
}
