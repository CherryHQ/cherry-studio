import * as z from 'zod'

/**
 * Mode the user was authoring under when the painting form is submitted
 * (`generate`, `edit`, `remix`, `upscale`, etc.). Persisted on the painting
 * row as part of the generation snapshot (see `PaintingSchema.mode`) so a
 * reloaded card knows how it was made; the live draft still overrides it when
 * the user switches tabs.
 */
export const PaintingModeSchema = z.string().trim().min(1)
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingFilesSchema = z.strictObject({
  output: z.array(z.string()),
  input: z.array(z.string())
})
export type PaintingFiles = z.infer<typeof PaintingFilesSchema>

/**
 * Persisted generation outcome. `null` (absent) = an empty board with no
 * generation attempted; the four states cover an in-flight / finished run.
 * Distinguishes a `failed` run (offer retry) from a legitimately empty card.
 */
export const PaintingStatusSchema = z.enum(['generating', 'succeeded', 'failed', 'canceled'])
export type PaintingStatus = z.infer<typeof PaintingStatusSchema>

export const PaintingSchema = z.strictObject({
  id: z.string(),
  providerId: z.string(),
  modelId: z.string().nullable().optional(),
  prompt: z.string(),
  files: PaintingFilesSchema,
  // Generation snapshot — the recipe behind this painting. `mode` is the
  // authoring mode; `params` is the canonical param bag (pre-split:
  // size/seed/quality/…). Both nullable: legacy rows carry neither.
  mode: PaintingModeSchema.nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  // Canvas board placement. NULL = unplaced → auto-grid at display time.
  canvasX: z.number().nullable().optional(),
  canvasY: z.number().nullable().optional(),
  canvasW: z.number().nullable().optional(),
  // Persisted generation outcome; NULL = empty board (no run attempted).
  status: PaintingStatusSchema.nullable().optional(),
  // Soft grouping tag shared by the N images of one multi-image generation.
  groupId: z.string().nullable().optional(),
  orderKey: z.string().min(1),
  // ISO 8601 (matches the assistant/topic/tag/note/prompt convention); the
  // service emits these via `timestampToISO`. `id` stays `z.string()` because
  // migration supplies opaque ids.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export type Painting = z.infer<typeof PaintingSchema>
