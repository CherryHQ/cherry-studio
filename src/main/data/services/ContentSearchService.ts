import * as z from 'zod'

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { messageService } from '@data/services/MessageService'
import { loggerService } from '@logger'
import { DataApiError, ErrorCode, isDataApiError, toDataApiError } from '@shared/data/api/errors'
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
const validationErrorDetailsSchema = z.object({ fieldErrors: z.record(z.string(), z.array(z.string())) })

type ContentSearchAdapterInput<T extends ContentSearchSourceType> = {
  q: string
  cursor?: string
  limit: number
  createdAtFrom?: string
  filter?: ContentSearchFilters[T]
}

type ContentSearchSourceAdapter<T extends ContentSearchSourceType> = {
  search(input: ContentSearchAdapterInput<T>): Extract<ContentSearchGroup, { sourceType: T }>
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Search adapters can reject arbitrary values; normalize at this boundary while retaining validated cursor details and DataApi request context.
function withSourceContext(sourceType: ContentSearchSourceType, error: unknown) {
  const context = `content search source ${sourceType}`

  if (!isDataApiError(error)) return toDataApiError(error, context)

  let message = `${context} failed: ${error.message}`
  let details = error.details

  if (error.code === ErrorCode.VALIDATION_ERROR) {
    const sourceFields = details?.fieldErrors
    const parsed = validationErrorDetailsSchema.safeParse({ fieldErrors: sourceFields })

    if (parsed.success) {
      const cursorErrors = parsed.data.fieldErrors.cursor
      const field = `cursors.${sourceType}`

      if (cursorErrors && sourceFields && typeof sourceFields === 'object') {
        // Preserve opaque extension fields and own prototype-named keys instead of replacing them with the projection.
        const renamedFields = new Map<string, unknown>(Object.entries(sourceFields))
        renamedFields.delete('cursor')
        renamedFields.set(field, cursorErrors)
        details = { ...details, fieldErrors: Object.fromEntries(renamedFields) }
        message = error.message
      } else if (parsed.data.fieldErrors[field]) {
        return error
      }
    }
  }

  const wrapped = new DataApiError(error.code, message, error.status, details, error.requestContext)

  if (error.reportingHandled) wrapped.reportingHandled = true

  return wrapped
}

export const CONTENT_SEARCH_SOURCE_ADAPTERS = {
  'topic-message': {
    search(input) {
      const query: Pick<Parameters<typeof messageService.search>[0], 'q' | 'topicId'> = { q: input.q }

      if (input.filter?.topicId) query.topicId = input.filter.topicId

      const result = messageService.search({
        ...query,
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
    search(input) {
      const query: Pick<Parameters<typeof agentSessionMessageService.search>[0], 'q' | 'sessionId'> = { q: input.q }

      if (input.filter?.sessionId) query.sessionId = input.filter.sessionId

      const result = agentSessionMessageService.search({
        ...query,
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

function searchContentSource(
  sourceType: ContentSearchSourceType,
  query: ContentSearchQuery,
  limit: number
): ContentSearchGroup {
  try {
    const input = {
      q: query.q,
      cursor: query.cursors?.[sourceType],
      limit,
      createdAtFrom: query.createdAtFrom
    }

    switch (sourceType) {
      case 'topic-message':
        return CONTENT_SEARCH_SOURCE_ADAPTERS[sourceType].search({
          ...input,
          filter: query.filters?.[sourceType]
        })
      case 'session-message':
        return CONTENT_SEARCH_SOURCE_ADAPTERS[sourceType].search({
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
  search(query: ContentSearchQuery): ContentSearchResponse {
    const requestedSources = new Set(query.sources ?? contentSearchSourceTypes)
    const sources = contentSearchSourceTypes.filter((sourceType) => requestedSources.has(sourceType))

    const limit = Math.min(
      query.limitPerSource ?? CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE,
      CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
    )

    // Content search is all-or-nothing: one failed source fails the full query
    // with source context instead of returning silently partial groups.
    const groups = sources.map((sourceType) => searchContentSource(sourceType, query, limit))

    return {
      query: query.q,
      groups
    }
  }
}

export const contentSearchService = new ContentSearchService()
