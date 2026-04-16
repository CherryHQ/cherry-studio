import * as z from 'zod'

export const PaintingModeSchema = z.enum(['generate', 'edit', 'upscale'])
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingParamsSchema = z.record(z.string(), z.unknown())
export type PaintingParams = z.infer<typeof PaintingParamsSchema>

export const PaintingSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  mode: PaintingModeSchema,
  model: z.string().nullable().optional(),
  prompt: z.string(),
  params: PaintingParamsSchema,
  fileIds: z.array(z.string()),
  inputFileIds: z.array(z.string()),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export type Painting = z.infer<typeof PaintingSchema>
