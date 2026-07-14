import * as z from 'zod'

/**
 * A creation is a media-agnostic generation receipt — the unified shape behind
 * both image ("painting") and video generation. `kind` discriminates the two;
 * everything else (provider, model, prompt, ordered history, output/input
 * files) is identical, which is why a single `creation` table replaces the
 * former separate `painting` / `video` tables.
 */
export const CreationKindSchema = z.enum(['image', 'video'])
export type CreationKind = z.infer<typeof CreationKindSchema>

/**
 * Mode the user was authoring under when the form is submitted (image:
 * `generate`/`edit`/`remix`/…; video: `t2v`/`i2v`/`keyframe`/…). Draft-only —
 * not persisted on the receipt (the output files alone display history).
 */
export const CreationModeSchema = z.string().trim().min(1)
export type CreationMode = z.infer<typeof CreationModeSchema>

export const CreationFilesSchema = z.strictObject({
  output: z.array(z.string()),
  input: z.array(z.string())
})
export type CreationFiles = z.infer<typeof CreationFilesSchema>

export const CreationSchema = z.strictObject({
  id: z.string(),
  kind: CreationKindSchema,
  providerId: z.string(),
  modelId: z.string().nullable().optional(),
  prompt: z.string(),
  files: CreationFilesSchema,
  orderKey: z.string().min(1),
  // ISO 8601 (matches the assistant/topic/tag/note/prompt convention); the
  // service emits these via `timestampToISO`.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type Creation = z.infer<typeof CreationSchema>
