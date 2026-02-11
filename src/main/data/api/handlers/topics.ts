/**
 * Topic API Handlers
 *
 * Implements all topic-related API endpoints including:
 * - Topic CRUD operations
 * - Active node switching for branch navigation
 */

import { topicService } from '@data/services/TopicService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { TopicSchemas } from '@shared/data/api/schemas/topics'

/**
 * Handler type for a specific topic endpoint
 */
type TopicHandler<Path extends keyof TopicSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Topic API handlers implementation
 */
export const topicHandlers: {
  [Path in keyof TopicSchemas]: {
    [Method in keyof TopicSchemas[Path]]: TopicHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/topics': {
    POST: async ({ body }) => {
      return await topicService.create(body)
    }
  },

  '/topics/:id': {
    GET: async ({ params }) => {
      return await topicService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      return await topicService.update(params.id, body)
    },

    DELETE: async ({ params }) => {
      await topicService.delete(params.id)
      return undefined
    }
  },

  '/topics/:id/active-node': {
    PUT: async ({ params, body }) => {
      return await topicService.setActiveNode(params.id, body.nodeId)
    }
  }
}
