import * as z from 'zod'

export const NoteIdSchema = z.uuidv4()

export const NoteSchema = z.strictObject({
  id: NoteIdSchema,
  rootPath: z.string().min(1),
  path: z.string().min(1),
  isStarred: z.boolean(),
  isExpanded: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Note = z.infer<typeof NoteSchema>
