import * as z from 'zod'

export const NoteMetadataIdSchema = z.uuidv4()

export const NoteMetadataSchema = z.strictObject({
  id: NoteMetadataIdSchema,
  rootPath: z.string().min(1),
  path: z.string().min(1),
  isStarred: z.boolean(),
  isExpanded: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type NoteMetadata = z.infer<typeof NoteMetadataSchema>
