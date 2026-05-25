import * as z from 'zod'

export const NoteIdSchema = z.uuidv4()

/**
 * Invariant: at least one of `isStarred` or `isExpanded` is true.
 * Rows where both become false are auto-deleted by `NoteService.upsert`; the DB table also has a CHECK constraint.
 */
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
