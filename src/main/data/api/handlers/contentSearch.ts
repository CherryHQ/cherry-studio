import { contentSearchService } from '@data/services/ContentSearchService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { ContentSearchQuerySchema, type ContentSearchSchemas } from '@shared/data/api/schemas/contentSearch'

export const contentSearchHandlers: HandlersFor<ContentSearchSchemas> = {
  '/content-search': {
    GET: async ({ query }) => {
      const parsed = ContentSearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await contentSearchService.search(parsed.data)
    }
  }
}
