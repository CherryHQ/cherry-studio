import * as z from 'zod'

export const PaintingModeSchema = z.enum(['generate', 'draw', 'edit', 'remix', 'merge', 'upscale'])
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
  mode: PaintingModeSchema,
  mediaType: PaintingMediaTypeSchema,
  model: z.string().nullable().optional(),
  prompt: z.string(),
  params: PaintingParamsSchema,
  files: PaintingFilesSchema,
  orderKey: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type Painting = z.infer<typeof PaintingSchema>
