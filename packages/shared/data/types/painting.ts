import * as z from 'zod'

/**
 * Provider workflow key used for list filtering and UI restoration.
 *
 * This stays as a top-level field instead of living in `params` because it is
 * a cross-provider query dimension. It is intentionally weakly constrained so
 * new image/video providers can introduce modes without requiring a DB/API
 * schema migration.
 */
export const PaintingModeSchema = z.string().trim().min(1)
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingMediaTypeSchema = z.enum(['image', 'video'])
export type PaintingMediaType = z.infer<typeof PaintingMediaTypeSchema>

export const PaintingParamsSchema = z.record(z.string(), z.unknown())
export type PaintingParams = z.infer<typeof PaintingParamsSchema>

export const PaintingFilesSchema = z.object({
  output: z.array(z.string()),
  input: z.array(z.string())
})
export type PaintingFiles = z.infer<typeof PaintingFilesSchema>

export const PaintingSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  modelId: z.string().nullable().optional(),
  mode: PaintingModeSchema,
  mediaType: PaintingMediaTypeSchema,
  prompt: z.string(),
  params: PaintingParamsSchema,
  files: PaintingFilesSchema,
  orderKey: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type Painting = z.infer<typeof PaintingSchema>
