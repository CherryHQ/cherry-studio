import * as z from 'zod'

import type { NoteMetadata } from '../../types/noteMetadata'

const NotePathSchema = z.string().min(1)

export const ListNoteMetadataQuerySchema = z.strictObject({
  rootPath: NotePathSchema
})
export type ListNoteMetadataQuery = z.infer<typeof ListNoteMetadataQuerySchema>

export const UpsertNoteMetadataSchema = z
  .strictObject({
    rootPath: NotePathSchema,
    path: NotePathSchema,
    isStarred: z.boolean().optional(),
    isExpanded: z.boolean().optional()
  })
  .refine((value) => value.isStarred !== undefined || value.isExpanded !== undefined, {
    message: 'At least one note metadata field is required'
  })
export type UpsertNoteMetadataDto = z.infer<typeof UpsertNoteMetadataSchema>

export const DeleteNoteMetadataQuerySchema = z.strictObject({
  rootPath: NotePathSchema,
  path: NotePathSchema,
  recursive: z.boolean().optional()
})
export type DeleteNoteMetadataQuery = z.infer<typeof DeleteNoteMetadataQuerySchema>

export const RewriteNoteMetadataPathSchema = z.strictObject({
  rootPath: NotePathSchema,
  fromPath: NotePathSchema,
  toPath: NotePathSchema,
  recursive: z.boolean().optional()
})
export type RewriteNoteMetadataPathDto = z.infer<typeof RewriteNoteMetadataPathSchema>

export type NoteSchemas = {
  '/notes/metadata': {
    GET: {
      query: ListNoteMetadataQuery
      response: NoteMetadata[]
    }
    PATCH: {
      body: UpsertNoteMetadataDto
      response: NoteMetadata | null
    }
    DELETE: {
      query: DeleteNoteMetadataQuery
      response: void
    }
  }

  '/notes/metadata/path': {
    PATCH: {
      body: RewriteNoteMetadataPathDto
      response: { updated: number }
    }
  }
}
