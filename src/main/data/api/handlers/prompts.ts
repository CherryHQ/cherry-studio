/**
 * Prompt API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * lives in PromptService.
 */

import { promptService } from '@data/services/PromptService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreatePromptSchema,
  ListPromptsQuerySchema,
  PromptIdSchema,
  type PromptSchemas,
  UpdatePromptSchema
} from '@shared/data/api/schemas/prompts'
import type { HandlersFor } from '@shared/data/api/types'

export const promptHandlers: HandlersFor<PromptSchemas> = {
  '/prompts': {
    GET: async ({ query }) => {
      const parsed = ListPromptsQuerySchema.parse(query ?? {})
      return promptService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreatePromptSchema.parse(body)
      return promptService.create(parsed)
    }
  },

  '/prompts/:id': {
    GET: async ({ params }) => {
      const id = PromptIdSchema.parse(params.id)
      return promptService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = PromptIdSchema.parse(params.id)
      const parsed = UpdatePromptSchema.parse(body)
      return promptService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = PromptIdSchema.parse(params.id)
      promptService.delete(id)
      return undefined
    }
  },

  '/prompts/:id/order': {
    PATCH: async ({ params, body }) => {
      const id = PromptIdSchema.parse(params.id)
      const anchor = OrderRequestSchema.parse(body)
      promptService.reorder(id, anchor)
      return undefined
    }
  },

  '/prompts/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      promptService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
