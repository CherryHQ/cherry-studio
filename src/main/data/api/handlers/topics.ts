/**
 * Topic API Handlers
 *
 * Implements all topic-related API endpoints including:
 * - Topic CRUD operations
 * - Active node switching for branch navigation
 */

import { topicService } from '@data/services/TopicService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  CreateTopicSchema,
  SetActiveNodeSchema,
  type TopicSchemas,
  UpdateTopicSchema
} from '@shared/data/api/schemas/topics'

export const topicHandlers: HandlersFor<TopicSchemas> = {
  '/topics': {
    POST: async ({ body }) => {
      const parsed = CreateTopicSchema.parse(body)
      return await topicService.create(parsed)
    }
  },

  '/topics/:id': {
    GET: async ({ params }) => {
      return await topicService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateTopicSchema.parse(body)
      return await topicService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await topicService.delete(params.id)
      return undefined
    }
  },

  '/topics/:id/active-node': {
    PUT: async ({ params, body }) => {
      const parsed = SetActiveNodeSchema.parse(body)
      return await topicService.setActiveNode(params.id, parsed.nodeId)
    }
  }
}
