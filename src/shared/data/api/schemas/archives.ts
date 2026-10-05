import * as z from 'zod'

import type { CursorPaginationResponse } from '../types'

export const ARCHIVE_DOMAINS = ['topics', 'assistants', 'agents', 'sessions', 'paintings', 'files'] as const

export type ArchiveDomain = (typeof ARCHIVE_DOMAINS)[number]

export interface ArchiveEntry {
  id: string
  entityId: string
  domain: ArchiveDomain
  name: string
  /** Owning assistant (topics) or agent (sessions); null for ownerless domains. */
  parentId: string | null
  parentName: string | null
  deletedAt: number
}

export const ListArchivesQuerySchema = z.strictObject({
  domain: z.enum(ARCHIVE_DOMAINS).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(20)
})

export type ArchiveSchemas = {
  '/archives': {
    GET: {
      query: { domain?: ArchiveDomain; cursor?: string; limit?: number }
      response: CursorPaginationResponse<ArchiveEntry>
    }
  }
}
