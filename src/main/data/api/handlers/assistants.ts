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
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { AssistantSchemas } from '@shared/data/api/schemas/assistants'
import {
  CreateAssistantSchema,
  ListAssistantsQuerySchema,
  UpdateAssistantSchema
} from '@shared/data/api/schemas/assistants'

/**
 * Handler type for a specific assistant endpoint
 */
type AssistantHandler<Path extends keyof AssistantSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

/**
 * Assistant API handlers implementation
 */
export const assistantHandlers: {
  [Path in keyof AssistantSchemas]: {
    [Method in keyof AssistantSchemas[Path]]: AssistantHandler<Path, Method & ApiMethods<Path>>
  }
} = {
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
      return await assistantDataService.update(params.id, parsed)
    },

    DELETE: async ({ params }) => {
      await assistantDataService.delete(params.id)
      return undefined
    }
  }
}
