import * as z from 'zod'

import { type Note, NoteSchema } from '../../types/note'

const NotePathSchema = NoteSchema.shape.path
  .transform((value) => value.trim().replace(/\\/g, '/'))
  .refine((value) => value.length > 0, 'path must not be blank')
  .refine((value) => value.length <= 500, 'path is too long')

const NoteIdentitySchema = NoteSchema.pick({ rootPath: true, path: true }).extend({
  rootPath: NotePathSchema,
  path: NotePathSchema
})

export const ListNoteQuerySchema = NoteSchema.pick({ rootPath: true }).extend({
  rootPath: NotePathSchema
})
export type ListNoteQuery = z.infer<typeof ListNoteQuerySchema>

export const UpsertNoteSchema = z
  .strictObject({
    ...NoteIdentitySchema.shape,
    isStarred: NoteSchema.shape.isStarred.optional(),
    isExpanded: NoteSchema.shape.isExpanded.optional()
  })
  .refine((value) => value.isStarred !== undefined || value.isExpanded !== undefined, {
    message: 'At least one note field is required'
  })
export type UpsertNoteDto = z.infer<typeof UpsertNoteSchema>

export const DeleteNoteQuerySchema = NoteIdentitySchema.extend({
  recursive: z.boolean().optional()
})
export type DeleteNoteQuery = z.infer<typeof DeleteNoteQuerySchema>

export const RewriteNotePathSchema = z
  .strictObject({
    rootPath: NotePathSchema,
    fromPath: NotePathSchema,
    toPath: NotePathSchema,
    recursive: z.boolean().optional()
  })
  .refine((value) => value.fromPath !== value.toPath, {
    message: 'fromPath and toPath must differ',
    path: ['toPath']
  })
  .refine((value) => !value.recursive || !value.toPath.startsWith(`${value.fromPath}/`), {
    message: 'Cannot rewrite a folder into its own descendant',
    path: ['toPath']
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
