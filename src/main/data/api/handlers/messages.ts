/**
 * Message API Handlers
 *
 * Implements all message-related API endpoints including:
 * - Tree visualization queries
 * - Branch message queries with pagination
 * - Message CRUD operations
 */

import { application } from '@application'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import {
  BranchMessagesQuerySchema,
  CreateMessageSchema,
  DeleteBranchQuerySchema,
  DeleteMessageQuerySchema,
  type MessageSchemas,
  PathThroughQuerySchema,
  ReserveBranchSchema,
  UpdateMessageSchema
} from '@shared/data/api/schemas/messages'
import type { HandlersFor } from '@shared/data/api/types'
import { MessageDataSchema } from '@shared/data/types/message'

export const messageHandlers: HandlersFor<MessageSchemas> = {
  '/messages/:id/branch': {
    DELETE: async ({ params, query }) => {
      const q = DeleteBranchQuerySchema.parse(query ?? {})
      return messageService.deleteBranch(params.id, q.topicId)
    }
  },

  '/messages/:id/reply-group': {
    DELETE: async ({ params }) => {
      return messageService.deleteReplyGroup(params.id)
    }
  },

  '/topics/:topicId/tree': {
    GET: async ({ params }) => {
      return messageService.getTree(params.topicId)
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
      const { resend, ...data } = body
      const parsed = MessageDataSchema.parse(data)
      const sibling = messageService.createSibling(params.id, parsed)
      const assistantId = resend === true && topicService.getById(sibling.topicId).assistantId
      if (assistantId && sibling.role === 'user') {
        const record = application
          .get('MemoryDreamingService')
          .authorizeSubmission('assistant', sibling.topicId, assistantId)
        record?.(sibling.id, sibling.data.parts ?? [])
      }
      return sibling
    }
  },

  '/messages/:id/branches': {
    POST: async ({ params, body }) => {
      const parsed = ReserveBranchSchema.parse(body)
      return messageService.reserveBranch(params.id, parsed.activate ?? true)
    }
  }
}
