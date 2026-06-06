/**
 * Content search read-model API schema.
 *
 * This endpoint aggregates searchable content sources and returns grouped
 * results. Each source owns its own cursor so renderer tabs can load more for
 * one group without changing the other groups.
 */

import type { MessageRole } from '@shared/data/types/message'
import * as z from 'zod'

export const contentSearchSourceTypes = ['topic-message', 'session-message'] as const satisfies readonly string[]
export type ContentSearchSourceType = (typeof contentSearchSourceTypes)[number]
export const ContentSearchSourceTypeSchema = z.enum(contentSearchSourceTypes)

export const CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE = 50
export const CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE = 1000

export const TopicMessageContentSearchFilterSchema = z.strictObject({
  topicId: z.string().min(1).optional()
})
export type TopicMessageContentSearchFilter = z.output<typeof TopicMessageContentSearchFilterSchema>

export const SessionMessageContentSearchFilterSchema = z.strictObject({
  sessionId: z.string().min(1).optional()
})
export type SessionMessageContentSearchFilter = z.output<typeof SessionMessageContentSearchFilterSchema>

export const ContentSearchFiltersSchema = z.strictObject({
  'topic-message': TopicMessageContentSearchFilterSchema.optional(),
  'session-message': SessionMessageContentSearchFilterSchema.optional()
})
export type ContentSearchFilters = z.output<typeof ContentSearchFiltersSchema>

export const ContentSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1),
  sources: z.array(ContentSearchSourceTypeSchema).min(1).optional(),
  cursors: z.partialRecord(ContentSearchSourceTypeSchema, z.string()).optional(),
  filters: ContentSearchFiltersSchema.optional(),
  limitPerSource: z.coerce.number().int().positive().max(CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE).optional(),
  createdAtFrom: z.iso.datetime().optional()
})
export type ContentSearchQueryParams = z.input<typeof ContentSearchQuerySchema>
export type ContentSearchQuery = z.output<typeof ContentSearchQuerySchema>

export interface TopicMessageContentSearchItem {
  messageId: string
  topicId: string
  topicName: string
  topicAssistantId?: string
  role?: Extract<MessageRole, 'user' | 'assistant'>
  topicCreatedAt: string
  topicUpdatedAt: string
  snippet: string
  createdAt: string
}

export interface SessionMessageContentSearchItem {
  messageId: string
  sessionId: string
  sessionName: string
  agentId?: string
  agentName?: string
  role?: MessageRole
  snippet: string
  createdAt: string
}

export type TopicMessageContentSearchGroup = {
  sourceType: 'topic-message'
  items: TopicMessageContentSearchItem[]
  nextCursor?: string
}

export type SessionMessageContentSearchGroup = {
  sourceType: 'session-message'
  items: SessionMessageContentSearchItem[]
  nextCursor?: string
}

export type ContentSearchGroup = TopicMessageContentSearchGroup | SessionMessageContentSearchGroup

export type ContentSearchResponse = {
  query: string
  groups: ContentSearchGroup[]
}

export type ContentSearchSchemas = {
  '/content-search': {
    GET: {
      query: ContentSearchQueryParams
      response: ContentSearchResponse
    }
  }
}
