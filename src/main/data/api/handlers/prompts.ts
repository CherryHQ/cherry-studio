/**
 * Prompt API Handlers
 *
 * Implements all prompt-related API endpoints including:
 * - Prompt CRUD operations
 * - Version history and rollback
 * - Batch reordering
 */

import { promptService } from '@data/services/PromptService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { PromptSchemas } from '@shared/data/api/schemas/prompts'

type PromptHandler<Path extends keyof PromptSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const promptHandlers: {
  [Path in keyof PromptSchemas]: {
    [Method in keyof PromptSchemas[Path]]: PromptHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/prompts': {
    GET: async () => {
      return await promptService.getAll()
    },

    POST: async ({ body }) => {
      return await promptService.create(body)
    }
  },

  '/prompts/reorder': {
    PATCH: async ({ body }) => {
      await promptService.reorder(body)
      return undefined
    }
  },

  '/prompts/:id': {
    GET: async ({ params }) => {
      return await promptService.getById(params.id)
    },

    PATCH: async ({ params, body }) => {
      return await promptService.update(params.id, body)
    },

    DELETE: async ({ params }) => {
      await promptService.delete(params.id)
      return undefined
    }
  },

  '/prompts/:id/versions': {
    GET: async ({ params }) => {
      return await promptService.getVersions(params.id)
    }
  },

  '/prompts/:id/rollback': {
    POST: async ({ params, body }) => {
      return await promptService.rollback(params.id, body)
    }
  }
}
