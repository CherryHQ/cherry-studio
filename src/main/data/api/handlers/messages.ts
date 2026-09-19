/**
 * Message API Handlers
 *
 * Implements all message-related API endpoints including:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD operations
 */

import { messageService } from '@data/services/MessageService'
import {
  BranchMessagesQuerySchema,
  CreateMessageSchema,
  DeleteMessageQuerySchema,
  type MessageSchemas,
  PathThroughQuerySchema,
  ReserveBranchSchema,
  TreeQuerySchema,
  UpdateMessageSchema
} from '@shared/data/api/schemas/messages'
import type { HandlersFor } from '@shared/data/api/types'
import { MessageDataSchema } from '@shared/data/types/message'

export const messageHandlers: HandlersFor<MessageSchemas> = {
  '/messages/:id/reply-group': {
    DELETE: async ({ params }) => {
      return messageService.deleteReplyGroup(params.id)
    }
  },

  '/topics/:topicId/tree': {
    GET: async ({ params, query }) => {
      const q = TreeQuerySchema.parse(query ?? {})
      return messageService.getTree(params.topicId, {
        rootId: q.rootId,
        nodeId: q.nodeId,
        depth: q.depth
      })
    }
  },

  '/topics/:topicId/messages': {
    GET: async ({ params, query }) => {
      const q = BranchMessagesQuerySchema.parse(query ?? {})
      return messageService.getBranchMessages(params.topicId, {
        nodeId: q.nodeId,
        cursor: q.cursor,
        limit: q.limit,
        includeSiblings: q.includeSiblings
      })
    },

    POST: async ({ params, body }) => {
      const parsed = CreateMessageSchema.parse(body)
      return messageService.create(params.topicId, parsed)
    },

    DELETE: async ({ params }) => {
      return messageService.clearTopicMessages(params.topicId)
    }
  },

  '/topics/:topicId/path': {
    GET: async ({ params, query }) => {
      const q = PathThroughQuerySchema.parse(query ?? {})
      return messageService.getPathThrough(params.topicId, q.nodeId)
    }
  },

  '/topics/:topicId/export-tree': {
    GET: async ({ params }) => {
      return messageService.getExportTree(params.topicId)
    }
  },

  '/messages/:id': {
    GET: async ({ params }) => {
      return messageService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateMessageSchema.parse(body)
      return messageService.update(params.id, parsed)
    },

    DELETE: async ({ params, query }) => {
      const q = DeleteMessageQuerySchema.parse(query ?? {})
      const cascade = q.cascade ?? false
      const activeNodeStrategy = q.activeNodeStrategy ?? 'parent'
      return messageService.delete(params.id, cascade, activeNodeStrategy, q.awaitingInputOnly ?? false)
    }
  },

  '/messages/:id/siblings': {
    POST: async ({ params, body }) => {
      const parsed = MessageDataSchema.parse(body)
      return messageService.createSibling(params.id, parsed)
    }
  },

  '/messages/:id/branches': {
    POST: async ({ params, body }) => {
      const parsed = ReserveBranchSchema.parse(body)
      return messageService.reserveBranch(params.id, parsed.activate ?? true)
    }
  }
}
