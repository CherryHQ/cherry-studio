import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { DataApiErrorFactory, ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api'
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

const logger = loggerService.withContext('ContentSearchService')

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

function withSourceContext(sourceType: ContentSearchSourceType, error: unknown) {
  const sourcedError = toSourceCursorError(sourceType, error)
  if (!isDataApiError(sourcedError)) {
    return toDataApiError(sourcedError, `content search source ${sourceType}`)
  }

  const details = sourcedError.details as { fieldErrors?: Record<string, string[]> } | undefined
  if (sourcedError.code === ErrorCode.VALIDATION_ERROR && details?.fieldErrors?.[`cursors.${sourceType}`]) {
    return sourcedError
  }

  return DataApiErrorFactory.create(
    sourcedError.code,
    `content search source ${sourceType} failed: ${sourcedError.message}`,
    sourcedError.details,
    sourcedError.requestContext
  )
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

async function searchContentSource(
  sourceType: ContentSearchSourceType,
  query: ContentSearchQuery,
  limit: number
): Promise<ContentSearchGroup> {
  try {
    const input = {
      q: query.q,
      cursor: query.cursors?.[sourceType],
      limit,
      createdAtFrom: query.createdAtFrom
    }

    switch (sourceType) {
      case 'topic-message':
        return await CONTENT_SEARCH_SOURCE_ADAPTERS[sourceType].search({
          ...input,
          filter: query.filters?.[sourceType]
        })
      case 'session-message':
        return await CONTENT_SEARCH_SOURCE_ADAPTERS[sourceType].search({
          ...input,
          filter: query.filters?.[sourceType]
        })
      default: {
        const exhaustive: never = sourceType
        throw new Error(`Unknown content search source: ${exhaustive}`)
      }
    }
  } catch (error) {
    logger.error('content search source failed', { sourceType, error })
    throw withSourceContext(sourceType, error)
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

    // Content search is all-or-nothing: one failed source fails the full query
    // with source context instead of returning silently partial groups.
    const groups = await Promise.all(sources.map((sourceType) => searchContentSource(sourceType, query, limit)))

    return {
      query: query.q,
      groups
    }
  }
}

export const contentSearchService = new ContentSearchService()
