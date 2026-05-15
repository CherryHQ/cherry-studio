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
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { AssistantSchemas } from '@shared/data/api/schemas/assistants'
import {
  CreateAssistantSchema,
  ListAssistantsQuerySchema,
  UpdateAssistantSchema
} from '@shared/data/api/schemas/assistants'

export const assistantHandlers: HandlersFor<AssistantSchemas> = {
  '/assistants': {
    GET: async ({ query }) => {
      const parsed = ListAssistantsQuerySchema.parse(query ?? {})
      return await assistantDataService.list(parsed)
    },

    POST: async ({ body }) => {
      const parsed = CreateAssistantSchema.parse(body)
      return await assistantDataService.create(parsed)
    }
  },

  '/assistants/:id': {
    GET: async ({ params }) => {
      return await assistantDataService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      const parsed = UpdateAssistantSchema.parse(body)
      // Entity schema fields like `prompt` / `emoji` / `settings` carry `.default()`,
      // and `.partial()` does not strip those — `.parse({ tagIds: [...] })` would inject
      // defaults for every omitted field and the service would overwrite the row with them.
      // Keep only keys actually present in the request body so PATCH stays partial.
      const bodyKeys = body && typeof body === 'object' ? new Set(Object.keys(body)) : new Set<string>()
      const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => bodyKeys.has(key)))
      return await assistantDataService.update(params.id, patch)
    },

    DELETE: async ({ params }) => {
      await assistantDataService.delete(params.id)
      return undefined
    }
  }
}
