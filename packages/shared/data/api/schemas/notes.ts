import * as z from 'zod'

import { type NoteMetadata, NoteMetadataIdSchema, NoteNodeTypeSchema } from '../../types/noteMetadata'

const NotePathSchema = z.string().min(1)

export const ListNoteMetadataQuerySchema = z.strictObject({
  rootPath: NotePathSchema
})
export type ListNoteMetadataQuery = z.infer<typeof ListNoteMetadataQuerySchema>

export const UpsertNoteMetadataSchema = z.strictObject({
  rootPath: NotePathSchema,
  path: NotePathSchema,
  nodeType: NoteNodeTypeSchema,
  isStarred: z.boolean().optional(),
  isExpanded: z.boolean().optional()
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

export const NoteMetadataIdParamSchema = z.strictObject({
  id: NoteMetadataIdSchema
})

export type NoteSchemas = {
  '/notes/metadata': {
    GET: {
      query: ListNoteMetadataQuery
      response: NoteMetadata[]
    }
    PATCH: {
      body: UpsertNoteMetadataDto
      response: NoteMetadata
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
