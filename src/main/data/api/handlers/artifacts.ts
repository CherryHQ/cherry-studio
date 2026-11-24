import { agentService } from '@data/services/AgentService'
import { artifactService } from '@data/services/ArtifactService'
import { assistantDataService } from '@data/services/AssistantService'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type ArtifactSchemas,
  type ListArtifactsQuery,
  ListArtifactsQuerySchema
} from '@shared/data/api/schemas/artifacts'
import type { HandlersFor } from '@shared/data/api/types'

function parseQuery(query: unknown): ListArtifactsQuery {
  const parsed = ListArtifactsQuerySchema.safeParse(query ?? {})
  if (!parsed.success) throw toDataApiError(parsed.error)
  return parsed.data
}

export const artifactHandlers: HandlersFor<ArtifactSchemas> = {
  '/agents/:agentId/artifacts': {
    GET: async ({ params, query }) => {
      const parsed = parseQuery(query)
      if (!agentService.getAgent(params.agentId)) throw DataApiErrorFactory.notFound('Agent', params.agentId)
      return artifactService.list({ agentId: params.agentId }, parsed)
    }
  },
  '/assistants/:id/artifacts': {
    GET: async ({ params, query }) => {
      const parsed = parseQuery(query)
      assistantDataService.getById(params.id)
      return artifactService.list({ assistantId: params.id }, parsed)
    }
  }
}
