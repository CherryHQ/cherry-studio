/**
 * Global search read-model API schema.
 *
 * This endpoint aggregates entity-list metadata only. Each target carries the
 * minimal navigation identifiers for the renderer; full domain entities stay
 * owned by their source endpoints.
 */

import * as z from 'zod'

export const GlobalSearchTypeSchema = z.enum(['assistant', 'agent', 'topic', 'session', 'knowledge-base'])
export type GlobalSearchType = z.infer<typeof GlobalSearchTypeSchema>

export const GlobalSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1),
  types: z.array(GlobalSearchTypeSchema).min(1).optional(),
  updatedAtFrom: z.iso.datetime().optional(),
  limitPerType: z.coerce.number().int().positive().optional()
})
export type GlobalSearchQueryParams = z.input<typeof GlobalSearchQuerySchema>
export type GlobalSearchQuery = z.output<typeof GlobalSearchQuerySchema>

export type GlobalSearchTarget =
  | { assistantId: string }
  | { agentId: string }
  | { topicId: string; assistantId?: string }
  | { sessionId: string; agentId: string | null }
  | { knowledgeBaseId: string }

export type GlobalSearchItem = {
  type: GlobalSearchType
  id: string
  title: string
  subtitle?: string
  emoji?: string
  updatedAt?: string
  target: GlobalSearchTarget
}

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
