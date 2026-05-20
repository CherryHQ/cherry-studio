import { noteMetadataService } from '@data/services/NoteMetadataService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  DeleteNoteMetadataQuerySchema,
  ListNoteMetadataQuerySchema,
  type NoteSchemas,
  RewriteNoteMetadataPathSchema,
  UpsertNoteMetadataSchema
} from '@shared/data/api/schemas/notes'

export const noteHandlers: HandlersFor<NoteSchemas> = {
  '/notes/metadata': {
    GET: async ({ query }) => {
      const parsed = ListNoteMetadataQuerySchema.parse(query)
      return await noteMetadataService.listByRoot(parsed.rootPath)
    },

    PATCH: async ({ body }) => {
      const parsed = UpsertNoteMetadataSchema.parse(body)
      return await noteMetadataService.upsert(parsed)
    },

    DELETE: async ({ query }) => {
      const parsed = DeleteNoteMetadataQuerySchema.parse(query)
      await noteMetadataService.deleteByPath(parsed)
      return undefined
    }
  },

  '/notes/metadata/path': {
    PATCH: async ({ body }) => {
      const parsed = RewriteNoteMetadataPathSchema.parse(body)
      return await noteMetadataService.rewritePath(parsed)
    }
  }
}
