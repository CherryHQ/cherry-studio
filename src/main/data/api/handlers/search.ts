import { contentSearchService } from '@data/services/ContentSearchService'
import { entitySearchService } from '@data/services/EntitySearchService'
import { toDataApiError } from '@shared/data/api/errors'
import { ContentSearchQuerySchema, EntitySearchQuerySchema, type SearchSchemas } from '@shared/data/api/schemas/search'
import type { HandlersFor } from '@shared/data/api/types'

export const searchHandlers: HandlersFor<SearchSchemas> = {
  '/search/entities': {
    GET: async ({ query }) => {
      const parsed = EntitySearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return entitySearchService.search(parsed.data)
    }
  },
  '/search/contents': {
    GET: async ({ query }) => {
      const parsed = ContentSearchQuerySchema.safeParse(query)
      if (!parsed.success) throw toDataApiError(parsed.error)
      return contentSearchService.search(parsed.data)
    }
  }
}
