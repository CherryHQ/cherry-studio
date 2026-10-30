import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

export type ExternalKnowledgeConnectionSchemas = {
  '/external-knowledge-connections': {
    GET: {
      response: ExternalKnowledgeConnection[]
    }
  }

  '/external-knowledge-connections/:id': {
    GET: {
      params: { id: string }
      response: ExternalKnowledgeConnection
    }
  }
}
