import { listArchives } from '@data/services/archive'
import { type ArchiveSchemas, ListArchivesQuerySchema } from '@shared/data/api/schemas/archives'
import type { HandlersFor } from '@shared/data/api/types'

export const archiveHandlers: HandlersFor<ArchiveSchemas> = {
  '/archives': {
    GET: async ({ query }) => listArchives(ListArchivesQuerySchema.parse(query ?? {}))
  }
}
