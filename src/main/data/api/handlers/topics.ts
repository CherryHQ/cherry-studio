/**
 * Topic API Handlers
 *
 * Implements all topic-related API endpoints including:
 * - Topic CRUD operations
 * - Active node switching for branch navigation
 */

import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import {
  CreateTopicSchema,
  SetActiveNodeSchema,
  type TopicSchemas,
  UpdateTopicSchema
} from '@shared/data/api/schemas/topics'

const logger = loggerService.withContext('DataApi:TopicHandlers')

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
    GET: async ({ query }) => {
      const assistantId = query?.assistantId
      if (typeof assistantId !== 'string' || assistantId.length === 0) {
        return await topicService.list()
      }
      return await topicService.list(assistantId)
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
      return await topicService.setActiveNode(params.id, parsed.nodeId, { descend: parsed.descend })
    }
  }
}
