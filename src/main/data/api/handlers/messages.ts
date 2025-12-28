/**
 * Message API Handlers
 *
 * Implements all message-related API endpoints including:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD operations
 */

import { messageService } from '@data/services/MessageService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { BranchMessagesQueryParams, MessageSchemas, TreeQueryParams } from '@shared/data/api/schemas/messages'

/**
 * Handler type for a specific message endpoint
 */
type MessageHandler<Path extends keyof MessageSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Message API handlers implementation
 */
export const messageHandlers: {
  [Path in keyof MessageSchemas]: {
    [Method in keyof MessageSchemas[Path]]: MessageHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/topics/:topicId/tree': {
    GET: async ({ params, query }) => {
      const q = (query || {}) as TreeQueryParams
      return await messageService.getTree(params.topicId, {
        rootId: q.rootId,
        nodeId: q.nodeId,
        depth: q.depth
      })
    }
  },

  '/topics/:topicId/messages': {
    GET: async ({ params, query }) => {
      const q = (query || {}) as BranchMessagesQueryParams
      return await messageService.getBranchMessages(params.topicId, {
        nodeId: q.nodeId,
        beforeNodeId: q.beforeNodeId,
        limit: q.limit,
        includeSiblings: q.includeSiblings
      })
    },

    POST: async ({ params, body }) => {
      return await messageService.create(params.topicId, body)
    }
  },

  '/messages/:id': {
    GET: async ({ params }) => {
      return await messageService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      return await messageService.update(params.id, body)
    },

    DELETE: async ({ params, query }) => {
      const q = (query || {}) as { cascade?: boolean }
      const cascade = q.cascade ?? false
      return await messageService.delete(params.id, cascade)
    }
  }
}
