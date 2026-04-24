/**
 * Prompt API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * — version creation, rollback semantics, orderKey computation — lives in
 * PromptService.
 */

import { promptService } from '@data/services/PromptService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import { OrderBatchRequestSchema, OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  CreatePromptSchema,
  PromptIdSchema,
  type PromptSchemas,
  RollbackPromptSchema,
  UpdatePromptSchema
} from '@shared/data/api/schemas/prompts'

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

  '/prompts/:id/versions': {
    GET: async ({ params }) => {
      const id = PromptIdSchema.parse(params.id)
      return await promptService.getVersions(id)
    }
  },

  '/prompts/:id/rollback': {
    POST: async ({ params, body }) => {
      const id = PromptIdSchema.parse(params.id)
      const parsed = RollbackPromptSchema.parse(body)
      return await promptService.rollback(id, parsed)
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
