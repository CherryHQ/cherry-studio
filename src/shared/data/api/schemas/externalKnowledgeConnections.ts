import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'

export type ExternalKnowledgeConnectionListItem = ExternalKnowledgeConnection & { sourceCount: number }

export type ExternalKnowledgeConnectionSchemas = {
  '/external-knowledge-connections': {
    GET: {
      response: ExternalKnowledgeConnectionListItem[]
    }
  }

  '/external-knowledge-connections/:id': {
    GET: {
      params: { id: string }
      response: ExternalKnowledgeConnection
    }
  }
}
