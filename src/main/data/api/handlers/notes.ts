import { noteService } from '@data/services/NoteService'
import {
  DeleteNoteQuerySchema,
  ListNoteQuerySchema,
  type NoteSchemas,
  RewriteNotePathSchema,
  UpsertNoteSchema
} from '@shared/data/api/schemas/notes'
import type { HandlersFor } from '@shared/data/api/types'

export const noteHandlers: HandlersFor<NoteSchemas> = {
  '/notes': {
    GET: async ({ query }) => {
      const parsed = ListNoteQuerySchema.parse(query)
      return noteService.listByRoot(parsed.rootPath)
    },

    PATCH: async ({ body }) => {
      const parsed = UpsertNoteSchema.parse(body)
      return noteService.upsert(parsed)
    },

    DELETE: async ({ query }) => {
      const parsed = DeleteNoteQuerySchema.parse(query)
      noteService.deleteByPath(parsed)
      return undefined
    }
  },

  '/notes/path': {
    PATCH: async ({ body }) => {
      const parsed = RewriteNotePathSchema.parse(body)
      return noteService.rewritePath(parsed)
    }
  }
}
