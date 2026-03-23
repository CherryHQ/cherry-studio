/**
 * Translate API Handlers
 *
 * Implements translate history and custom language endpoints.
 * All input validation happens here at the system boundary.
 */

import { translateHistoryService } from '@data/services/TranslateHistoryService'
import { translateLanguageService } from '@data/services/TranslateLanguageService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { TranslateSchemas } from '@shared/data/api/schemas/translate'
import {
  CreateTranslateHistorySchema,
  CreateTranslateLanguageSchema,
  TranslateHistoryQuerySchema,
  UpdateTranslateHistorySchema,
  UpdateTranslateLanguageSchema
} from '@shared/data/api/schemas/translate'

type TranslateHandler<Path extends keyof TranslateSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const translateHandlers: {
  [Path in keyof TranslateSchemas]: {
    [Method in keyof TranslateSchemas[Path]]: TranslateHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/translate/histories': {
    GET: async ({ query }) => {
      const parsed = TranslateHistoryQuerySchema.parse(query ?? {})
      return await translateHistoryService.list(parsed)
    },
    POST: async ({ body }) => {
      const parsed = CreateTranslateHistorySchema.parse(body)
      return await translateHistoryService.create(parsed)
    },
    DELETE: async () => {
      await translateHistoryService.clearAll()
      return undefined
    }
  },

  '/translate/histories/:id': {
    GET: async ({ params }) => {
      return await translateHistoryService.getById(params.id)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateTranslateHistorySchema.parse(body)
      return await translateHistoryService.update(params.id, parsed)
    },
    DELETE: async ({ params }) => {
      await translateHistoryService.delete(params.id)
      return undefined
    }
  },

  '/translate/languages': {
    GET: async () => {
      return await translateLanguageService.list()
    },
    POST: async ({ body }) => {
      const parsed = CreateTranslateLanguageSchema.parse(body)
      return await translateLanguageService.create(parsed)
    }
  },

  '/translate/languages/:langCode': {
    GET: async ({ params }) => {
      return await translateLanguageService.getByLangCode(params.langCode)
    },
    PATCH: async ({ params, body }) => {
      const parsed = UpdateTranslateLanguageSchema.parse(body)
      return await translateLanguageService.update(params.langCode, parsed)
    },
    DELETE: async ({ params }) => {
      await translateLanguageService.delete(params.langCode)
      return undefined
    }
  }
}
