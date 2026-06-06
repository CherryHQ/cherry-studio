/**
 * Global search read-model API schema.
 *
 * This endpoint aggregates entity-list metadata only. Each target carries the
 * minimal navigation identifiers for the renderer; full domain entities stay
 * owned by their source endpoints.
 */

import * as z from 'zod'

export type GlobalSearchTarget =
  | { type: 'assistant'; target: { assistantId: string } }
  | { type: 'agent'; target: { agentId: string } }
  | { type: 'topic'; target: { topicId: string; assistantId?: string } }
  | { type: 'session'; target: { sessionId: string; agentId: string | null } }
  | { type: 'knowledge-base'; target: { knowledgeBaseId: string } }

export type GlobalSearchType = GlobalSearchTarget['type']
export const globalSearchTypes = [
  'assistant',
  'agent',
  'topic',
  'session',
  'knowledge-base'
] as const satisfies readonly GlobalSearchType[]
export const GlobalSearchTypeSchema = z.enum(globalSearchTypes)
export const GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE = 200

export const GlobalSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1),
  types: z.array(GlobalSearchTypeSchema).min(1).optional(),
  updatedAtFrom: z.iso.datetime().optional(),
  limitPerType: z.coerce.number().int().positive().max(GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE).optional()
})
export type GlobalSearchQueryParams = z.input<typeof GlobalSearchQuerySchema>
export type GlobalSearchQuery = z.output<typeof GlobalSearchQuerySchema>

export type GlobalSearchItem = {
  id: string
  title: string
  subtitle?: string
  emoji?: string
  updatedAt?: string
} & GlobalSearchTarget

export type GlobalSearchGroup = {
  type: GlobalSearchType
  items: GlobalSearchItem[]
}

export type GlobalSearchResponse = {
  query: string
  groups: GlobalSearchGroup[]
}

export type GlobalSearchSchemas = {
  '/global-search': {
    GET: {
      query: GlobalSearchQueryParams
      response: GlobalSearchResponse
    }
  }
}
