/**
 * Topic API Handlers
 *
 * Implements all topic-related API endpoints including:
 * - Cursor-paginated topic list with optional name search
 * - Topic CRUD operations
 * - Topic path duplication
 * - Active node switching for branch navigation
 * - Scoped reorder (single + batch) via OrderEndpoints
 */

import { topicService } from '@data/services/TopicService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreateTopicSchema,
  DeleteTopicsQuerySchema,
  DuplicateTopicSchema,
  LatestTopicQuerySchema,
  ListTopicsQuerySchema,
  MoveTopicSchema,
  SetActiveNodeSchema,
  type TopicSchemas,
  TopicStatsQuerySchema,
  UpdateTopicSchema
} from '@shared/data/api/schemas/topics'
import type { HandlersFor } from '@shared/data/api/types'

export const topicHandlers: HandlersFor<TopicSchemas> = {
  '/topics': {
    GET: async ({ query }) => {
      const parsed = ListTopicsQuerySchema.parse(query)
      return topicService.listByCursor(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateTopicSchema.parse(body)
      return topicService.create(parsed)
    },

    DELETE: async ({ query }) => {
      const parsed = DeleteTopicsQuerySchema.parse(query)
      return topicService.deleteByIds(parsed.ids)
    }
  },

  '/topics/latest': {
    GET: async ({ query }) => {
      const parsed = LatestTopicQuerySchema.parse(query ?? {})
      return { topic: topicService.getLatestUpdated(parsed) }
    }
  },

  '/topics/stats': {
    GET: async ({ query }) => {
      const parsed = TopicStatsQuerySchema.parse(query ?? {})
      return topicService.stats(parsed)
    }
  },

  '/topics/:id': {
    GET: async ({ params }) => {
      return topicService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateTopicSchema.parse(body)
      return topicService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      topicService.delete(params.id)
      return undefined
    }
  },

  '/topics/:id/move': {
    POST: async ({ params, body }) => {
      const parsed = MoveTopicSchema.parse(body)
      topicService.move(params.id, parsed)
      return undefined
    }
  },

  '/topics/:id/active-node': {
    PUT: async ({ params, body }) => {
      const parsed = SetActiveNodeSchema.parse(body)
      return topicService.setActiveNode(params.id, parsed.nodeId)
    }
  },

  '/topics/:id/duplicate': {
    POST: async ({ params, body }) => {
      const parsed = DuplicateTopicSchema.parse(body)
      return topicService.duplicate(params.id, parsed)
    }
  },

  '/assistants/:assistantId/topics': {
    DELETE: async ({ params }) => {
      return topicService.deleteByAssistantId(params.assistantId)
    }
  },

  '/topics/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      topicService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/topics/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      topicService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
