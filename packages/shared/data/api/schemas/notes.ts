import * as z from 'zod'

import type { Note } from '../../types/note'

const NotePathSchema = z.string().refine((value) => value.trim().length > 0, 'path must not be blank')

export const ListNoteQuerySchema = z.strictObject({
  rootPath: NotePathSchema
})
export type ListNoteQuery = z.infer<typeof ListNoteQuerySchema>

export const UpsertNoteSchema = z
  .strictObject({
    rootPath: NotePathSchema,
    path: NotePathSchema,
    isStarred: z.boolean().optional(),
    isExpanded: z.boolean().optional()
  })
  .refine((value) => value.isStarred !== undefined || value.isExpanded !== undefined, {
    message: 'At least one note field is required'
  })
export type UpsertNoteDto = z.infer<typeof UpsertNoteSchema>

export const DeleteNoteQuerySchema = z.strictObject({
  rootPath: NotePathSchema,
  path: NotePathSchema,
  recursive: z.boolean().optional()
})
export type DeleteNoteQuery = z.infer<typeof DeleteNoteQuerySchema>

export const RewriteNotePathSchema = z.strictObject({
  rootPath: NotePathSchema,
  fromPath: NotePathSchema,
  toPath: NotePathSchema,
  recursive: z.boolean().optional()
})
export type RewriteNotePathDto = z.infer<typeof RewriteNotePathSchema>

export type NoteSchemas = {
  '/notes': {
    GET: {
      query: ListNoteQuery
      response: Note[]
    }
    PATCH: {
      body: UpsertNoteDto
      response: Note | null
    }
    DELETE: {
      query: DeleteNoteQuery
      response: void
    }
  }

  '/notes/path': {
    PATCH: {
      body: RewriteNotePathDto
      response: { updated: number }
    }
  }
}
