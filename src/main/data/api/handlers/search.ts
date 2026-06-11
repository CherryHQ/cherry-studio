import { contentSearchService } from '@data/services/ContentSearchService'
import { entitySearchService } from '@data/services/EntitySearchService'
import { toDataApiError } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { ContentSearchQuerySchema, EntitySearchQuerySchema, type SearchSchemas } from '@shared/data/api/schemas/search'

export const searchHandlers: HandlersFor<SearchSchemas> = {
  '/search/entities': {
    GET: async ({ query }) => {
      const parsed = EntitySearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await entitySearchService.search(parsed.data)
    }
  },
  '/search/contents': {
    GET: async ({ query }) => {
      const parsed = ContentSearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return await contentSearchService.search(parsed.data)
    }
  }
}
