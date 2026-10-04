import * as z from 'zod'

import type { CursorPaginationResponse } from '../types'

export type ArchiveDomain = 'topics' | 'assistants' | 'agents' | 'sessions' | 'paintings' | 'files'

export interface ArchiveEntry {
  id: string
  entityId: string
  domain: ArchiveDomain
  name: string
  deletedAt: number
}

export const ListArchivesQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(20)
})

export type ArchiveSchemas = {
  '/archives': {
    GET: {
      query: { cursor?: string; limit?: number }
      response: CursorPaginationResponse<ArchiveEntry>
    }
  }
}
