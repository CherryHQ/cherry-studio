/**
 * Search read-model API schemas.
 *
 * Entity search is navigation-oriented and returns lightweight targets.
 * Content search is full-text-oriented and keeps per-source cursor semantics.
 */

import type { AgentSessionMessageSearchRole, TopicMessageSearchRole } from '@shared/data/types/message'
import * as z from 'zod'

export type EntitySearchTarget =
  | { type: 'assistant'; target: { assistantId: string } }
  | { type: 'agent'; target: { agentId: string } }
  | { type: 'topic'; target: { topicId: string; assistantId?: string } }
  | { type: 'session'; target: { sessionId: string; agentId: string | null } }
  | { type: 'knowledge-base'; target: { knowledgeBaseId: string } }

export type EntitySearchType = EntitySearchTarget['type']
export const entitySearchTypes = [
  'assistant',
  'agent',
  'topic',
  'session',
  'knowledge-base'
] as const satisfies readonly EntitySearchType[]
export const EntitySearchTypeSchema = z.enum(entitySearchTypes)
export const ENTITY_SEARCH_MAX_LIMIT_PER_TYPE = 200

export const EntitySearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1),
  types: z.array(EntitySearchTypeSchema).min(1).optional(),
  updatedAtFrom: z.iso.datetime().optional(),
  limitPerType: z.coerce.number().int().positive().max(ENTITY_SEARCH_MAX_LIMIT_PER_TYPE).optional()
})
export type EntitySearchQueryParams = z.input<typeof EntitySearchQuerySchema>
export type EntitySearchQuery = z.output<typeof EntitySearchQuerySchema>

export type EntitySearchItem = {
  id: string
  title: string
  subtitle?: string
  emoji?: string
  updatedAt?: string
} & EntitySearchTarget

export type EntitySearchGroup = {
  [T in EntitySearchType]: {
    type: T
    items: Extract<EntitySearchItem, { type: T }>[]
  }
}[EntitySearchType]

export type EntitySearchResponse = {
  query: string
  groups: EntitySearchGroup[]
}

export type EntitySearchSchemas = {
  '/search/entities': {
    GET: {
      query: EntitySearchQueryParams
      response: EntitySearchResponse
    }
  }
}

export const contentSearchSourceTypes = ['topic-message', 'session-message'] as const satisfies readonly string[]
export type ContentSearchSourceType = (typeof contentSearchSourceTypes)[number]
export const ContentSearchSourceTypeSchema = z.enum(contentSearchSourceTypes)

export const CONTENT_SEARCH_DEFAULT_LIMIT_PER_SOURCE = 50
export const CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE = 1000
const ContentSearchCursorSchema = z.string().min(1)

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
  cursors: z.partialRecord(ContentSearchSourceTypeSchema, ContentSearchCursorSchema).optional(),
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
  role?: TopicMessageSearchRole
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
  role?: AgentSessionMessageSearchRole
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
  '/search/contents': {
    GET: {
      query: ContentSearchQueryParams
      response: ContentSearchResponse
    }
  }
}

export type SearchSchemas = EntitySearchSchemas & ContentSearchSchemas
