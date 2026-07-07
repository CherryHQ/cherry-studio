import { inputHistoryService } from '@data/services/InputHistoryService'
import { type InputHistorySchemas, SaveInputHistorySchema } from '@shared/data/api/schemas/inputHistory'
import type { HandlersFor } from '@shared/data/api/types'

export const inputHistoryHandlers: HandlersFor<InputHistorySchemas> = {
  '/input-history': {
    GET: async () => {
      return await inputHistoryService.list()
    },

    POST: async ({ body }) => {
      const parsed = SaveInputHistorySchema.parse(body)
      return await inputHistoryService.save(parsed)
    }
  }
}
