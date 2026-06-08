import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { messageService } from '@data/services/MessageService'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import type {
  ContentSearchFilters,
  ContentSearchGroup,
  ContentSearchQuery,
  ContentSearchResponse,
  ContentSearchSourceType
} from '@shared/data/api/schemas/search'
import {
  CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
  CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE,
  contentSearchSourceTypes
} from '@shared/data/api/schemas/search'

type ContentSearchAdapterInput<T extends ContentSearchSourceType> = {
  q: string
  cursor?: string
  limit: number
  createdAtFrom?: string
  filter?: ContentSearchFilters[T]
}

type ContentSearchSourceAdapter<T extends ContentSearchSourceType> = {
  search(input: ContentSearchAdapterInput<T>): Promise<Extract<ContentSearchGroup, { sourceType: T }>>
}

function toSourceCursorError(sourceType: ContentSearchSourceType, error: unknown): unknown {
  if (!isDataApiError(error) || error.code !== ErrorCode.VALIDATION_ERROR) return error

  const details = error.details as { fieldErrors?: Record<string, string[]> } | undefined
  const cursorErrors = details?.fieldErrors?.cursor
  if (!cursorErrors) return error

  return DataApiErrorFactory.validation({ [`cursors.${sourceType}`]: cursorErrors }, error.message)
}

export const CONTENT_SEARCH_SOURCE_ADAPTERS = {
  'topic-message': {
    async search(input) {
      const result = await messageService.search({
        q: input.q,
        ...(input.filter?.topicId ? { topicId: input.filter.topicId } : {}),
        cursor: input.cursor,
        limit: input.limit,
        createdAtFrom: input.createdAtFrom
      })

      return {
        sourceType: 'topic-message',
        items: result.items,
        nextCursor: result.nextCursor
      }
    }
  },
  'session-message': {
    async search(input) {
      const result = await agentSessionMessageService.search({
        q: input.q,
        ...(input.filter?.sessionId ? { sessionId: input.filter.sessionId } : {}),
        cursor: input.cursor,
        limit: input.limit,
        createdAtFrom: input.createdAtFrom
      })

      return {
        sourceType: 'session-message',
        items: result.items,
        nextCursor: result.nextCursor
      }
    }
  }
} satisfies { [K in ContentSearchSourceType]: ContentSearchSourceAdapter<K> }

async function searchContentSource<T extends ContentSearchSourceType>(
  sourceType: T,
  query: ContentSearchQuery,
  limit: number
): Promise<ContentSearchGroup> {
  try {
    return await CONTENT_SEARCH_SOURCE_ADAPTERS[sourceType].search({
      q: query.q,
      cursor: query.cursors?.[sourceType],
      limit,
      createdAtFrom: query.createdAtFrom,
      filter: query.filters?.[sourceType]
    })
  } catch (error) {
    throw toSourceCursorError(sourceType, error)
  }
}

export class ContentSearchService {
  async search(query: ContentSearchQuery): Promise<ContentSearchResponse> {
    const requestedSources = new Set(query.sources ?? contentSearchSourceTypes)
    const sources = contentSearchSourceTypes.filter((sourceType) => requestedSources.has(sourceType))
    const limit = Math.min(
      query.limitPerSource ?? CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
    )

    const groups = await Promise.all(sources.map((sourceType) => searchContentSource(sourceType, query, limit)))

    return {
      query: query.q,
      groups
    }
  }
}

export const contentSearchService = new ContentSearchService()
