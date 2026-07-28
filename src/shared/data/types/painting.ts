import * as z from 'zod'

/**
 * Mode the user was authoring under when the painting form is submitted
 * (`generate`, `edit`, `remix`, `upscale`, etc.). Kept as a runtime/draft
 * concern only — not persisted on the painting receipt, since the output
 * files alone are sufficient to display history and re-runs always start
 * from the user's current draft mode, not from a frozen historical mode.
 */
export const PaintingModeSchema = z.string().trim().min(1)
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingFilesSchema = z.strictObject({
  output: z.array(z.string()),
  input: z.array(z.string())
})
export type PaintingFiles = z.infer<typeof PaintingFilesSchema>

export const PaintingSchema = z.strictObject({
  id: z.string(),
  providerId: z.string(),
  modelId: z.string().nullable().optional(),
  prompt: z.string(),
  files: PaintingFilesSchema,
  orderKey: z.string().min(1),
  // ISO 8601 (matches the assistant/topic/tag/note/prompt convention); the
  // service emits these via `timestampToISO`. `id` stays `z.string()` because
  // migration supplies opaque ids.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type Painting = z.infer<typeof PaintingSchema>
