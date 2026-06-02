import { globalSearchService } from '@data/services/GlobalSearchService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { GlobalSearchQuerySchema, type GlobalSearchSchemas } from '@shared/data/api/schemas/globalSearch'

export const globalSearchHandlers: HandlersFor<GlobalSearchSchemas> = {
  '/global-search': {
    GET: async ({ query }) => {
      const parsed = GlobalSearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await globalSearchService.search(parsed.data)
    }
  }
}
