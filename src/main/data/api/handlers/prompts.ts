/**
 * Prompt API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * lives in PromptService.
 */

import { promptService } from '@data/services/PromptService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreatePromptSchema,
  ListPromptsQuerySchema,
  PromptIdSchema,
  type PromptSchemas,
  UpdatePromptSchema
} from '@shared/data/api/schemas/prompts'

export const promptHandlers: HandlersFor<PromptSchemas> = {
  '/prompts': {
    GET: async ({ query }) => {
      const parsed = ListPromptsQuerySchema.parse(query ?? {})
      return await promptService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreatePromptSchema.parse(body)
      return await promptService.create(parsed)
    }
  },

  '/prompts/:id': {
    GET: async ({ params }) => {
      const id = PromptIdSchema.parse(params.id)
      return await promptService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = PromptIdSchema.parse(params.id)
      const parsed = UpdatePromptSchema.parse(body)
      return await promptService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = PromptIdSchema.parse(params.id)
      await promptService.delete(id)
      return undefined
    }
  },

  '/prompts/:id/order': {
    PATCH: async ({ params, body }) => {
      const id = PromptIdSchema.parse(params.id)
      const anchor = OrderRequestSchema.parse(body)
      await promptService.reorder(id, anchor)
      return undefined
    }
  },

  '/prompts/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      await promptService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
