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
import {
  CreatePromptDtoSchema,
  type PromptQueryParams,
  type PromptSchemas,
  ReorderPromptsDtoSchema,
  RollbackPromptDtoSchema,
  UpdatePromptDtoSchema
} from '@shared/data/api/schemas/prompts'

type PromptHandler<Path extends keyof PromptSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const promptHandlers: {
  [Path in keyof PromptSchemas]: {
    [Method in keyof PromptSchemas[Path]]: PromptHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/prompts': {
    GET: ({ query }) => {
      const q = (query || {}) as PromptQueryParams
      if (q.assistantId) {
        return promptService.getForAssistant(q.assistantId)
      }
      if (q.scope === 'global') {
        return promptService.getGlobal()
      }
      return promptService.getAll()
    },

    POST: ({ body }) => {
      return promptService.create(CreatePromptDtoSchema.parse(body))
    }
  },

  '/prompts/reorder': {
    PATCH: ({ body }) => {
      return promptService.reorder(ReorderPromptsDtoSchema.parse(body))
    }
  },

  '/prompts/:id': {
    GET: ({ params }) => {
      return promptService.getById(params.id)
    },

    PATCH: ({ params, body }) => {
      return promptService.update(params.id, UpdatePromptDtoSchema.parse(body))
    },

    DELETE: ({ params }) => {
      return promptService.delete(params.id)
    }
  },

  '/prompts/:id/versions': {
    GET: ({ params }) => {
      return promptService.getVersions(params.id)
    }
  },

  '/prompts/:id/rollback': {
    POST: ({ params, body }) => {
      return promptService.rollback(params.id, RollbackPromptDtoSchema.parse(body))
    }
  }
}
