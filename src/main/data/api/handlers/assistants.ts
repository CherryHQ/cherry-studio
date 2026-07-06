/**
 * Assistant API Handlers
 *
 * Implements all assistant-related API endpoints including:
 * - Assistant CRUD operations
 * - Listing with optional filters
 *
 * All input validation happens here at the system boundary.
 */

import { assistantDataService } from '@data/services/AssistantService'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import type { AssistantSchemas } from '@shared/data/api/schemas/assistants'
import {
  CreateAssistantSchema,
  DeleteAssistantQuerySchema,
  ListAssistantsQuerySchema,
  UpdateAssistantSchema
} from '@shared/data/api/schemas/assistants'
import type { HandlersFor } from '@shared/data/api/types'

export const assistantHandlers: HandlersFor<AssistantSchemas> = {
  '/assistants': {
    GET: async ({ query }) => {
      const parsed = ListAssistantsQuerySchema.parse(query ?? {})
      return assistantDataService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateAssistantSchema.parse(body)
      return assistantDataService.create(parsed)
    }
  },

  '/assistants/:id': {
    GET: async ({ params }) => {
      return assistantDataService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAssistantSchema.parse(body)
      // Entity schema fields like `prompt` / `emoji` / `settings` carry `.default()`,
      // and `.partial()` does not strip those — `.parse({ tagIds: [...] })` would inject
      // defaults for every omitted field and the service would overwrite the row with them.
      // Keep only keys actually present in the request body so PATCH stays partial.
      const bodyKeys = body && typeof body === 'object' ? new Set(Object.keys(body)) : new Set<string>()
      const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => bodyKeys.has(key)))
      return assistantDataService.update(params.id, patch)
    },

    DELETE: async ({ params, query }) => {
      const parsed = DeleteAssistantQuerySchema.parse(query ?? {})
      assistantDataService.delete(params.id, { deleteTopics: parsed.deleteTopics === true })
      return undefined
    }
  },

  '/assistants/:id/order': {
    PATCH: async ({ params, body }) => {
      const parsed = OrderRequestSchema.parse(body)
      assistantDataService.reorder(params.id, parsed)
      return undefined
    }
  },

  '/assistants/order:batch': {
    PATCH: async ({ body }) => {
      const parsed = OrderBatchRequestSchema.parse(body)
      assistantDataService.reorderBatch(parsed.moves)
      return undefined
    }
  }
}
