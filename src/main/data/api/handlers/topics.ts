/**
 * Topic API Handlers
 *
 * Implements all topic-related API endpoints including:
 * - Cursor-paginated topic list with optional name search
 * - Topic CRUD operations
 * - Active node switching for branch navigation
 * - Scoped reorder (single + batch) via OrderEndpoints
 */

import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreateTopicSchema,
  ListTopicsQuerySchema,
  SetActiveNodeSchema,
  type TopicSchemas,
  UpdateTopicSchema
} from '@shared/data/api/schemas/topics'

const logger = loggerService.withContext('DataApi:TopicHandlers')

export const topicHandlers: HandlersFor<TopicSchemas> = {
  '/topics': {
    GET: async ({ query }) => {
      const parsed = ListTopicsQuerySchema.parse(query ?? {})
      return await topicService.listByCursor(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateTopicSchema.parse(body)
      const topic = await topicService.create(parsed)
      if (parsed.sourceNodeId) {
        void topicNamingService.maybeRenameForkedTopic(topic.id, topic.assistantId).catch((err) => {
          logger.warn('Failed to auto-name forked topic', { topicId: topic.id, err })
        })
      }
      return topic
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
  },

  '/topics/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      await topicService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/topics/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await topicService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
