/**
 * Message API Handlers
 *
 * Implements all message-related API endpoints including:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD operations
 */

import { messageService } from '@data/services/MessageService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  BranchMessagesQuerySchema,
  CreateMessageSchema,
  DeleteMessageQuerySchema,
  type MessageSchemas,
  PathThroughQuerySchema,
  TreeQuerySchema,
  UpdateMessageSchema
} from '@shared/data/api/schemas/messages'

export const messageHandlers: HandlersFor<MessageSchemas> = {
  '/topics/:topicId/tree': {
    GET: async ({ params, query }) => {
      const q = TreeQuerySchema.parse(query ?? {})
      return await messageService.getTree(params.topicId, {
        rootId: q.rootId,
        nodeId: q.nodeId,
        depth: q.depth
      })
    }
  },

  '/topics/:topicId/messages': {
    GET: async ({ params, query }) => {
      const q = BranchMessagesQuerySchema.parse(query ?? {})
      return await messageService.getBranchMessages(params.topicId, {
        nodeId: q.nodeId,
        cursor: q.cursor,
        limit: q.limit,
        includeSiblings: q.includeSiblings
      })
    },

    POST: async ({ params, body }) => {
      const parsed = CreateMessageSchema.parse(body)
      return await messageService.create(params.topicId, parsed)
    }
  },

  '/topics/:topicId/path': {
    GET: async ({ params, query }) => {
      const q = PathThroughQuerySchema.parse(query ?? {})
      return await messageService.getPathThrough(params.topicId, q.nodeId)
    }
  },

  '/messages/:id': {
    GET: async ({ params }) => {
      return await messageService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMessageSchema.parse(body)
      return await messageService.update(params.id, parsed)
    },

    DELETE: async ({ params, query }) => {
      const q = DeleteMessageQuerySchema.parse(query ?? {})
      const cascade = q.cascade ?? false
      const activeNodeStrategy = q.activeNodeStrategy ?? 'parent'
      return await messageService.delete(params.id, cascade, activeNodeStrategy)
    }
  }
}
