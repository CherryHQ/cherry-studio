/**
 * Note API Handlers
 */

import { noteService } from '@data/services/NoteService'
import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { NoteSchemas } from '@shared/data/api/schemas/notes'

type NoteHandler<Path extends keyof NoteSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

export const noteHandlers: {
  [Path in keyof NoteSchemas]: {
    [Method in keyof NoteSchemas[Path]]: NoteHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/notes': {
    GET: async () => {
      return await noteService.list()
    }
  },
  '/notes/:relativePath': {
    GET: async ({ params }) => {
      return await noteService.getByRelativePath(params.relativePath)
    },
    PATCH: async ({ params, body }) => {
      return await noteService.update(params.relativePath, body)
    },
    DELETE: async ({ params }) => {
      await noteService.delete(params.relativePath)
      return undefined
    }
  }
}
