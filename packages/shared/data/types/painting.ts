import * as z from 'zod'

import { FileTypeSchema } from './file'
import type { FileMetadata } from './file/legacyFileMetadata'

export const PaintingIdSchema = z.uuidv4()
export type PaintingId = z.infer<typeof PaintingIdSchema>

export const PaintingProviderSchema = z.string().min(1)
export type PaintingProvider = z.infer<typeof PaintingProviderSchema>

export const PaintingModeSchema = z.enum(['generate', 'edit', 'remix', 'upscale', 'draw'])
export type PaintingMode = z.infer<typeof PaintingModeSchema>

export const PaintingParamsSchema = z.record(z.string(), z.unknown())
export type PaintingParams = z.infer<typeof PaintingParamsSchema>

export const FileMetadataSchema: z.ZodType<FileMetadata> = z.object({
  id: z.string(),
  name: z.string(),
  origin_name: z.string(),
  path: z.string(),
  size: z.number(),
  ext: z.string(),
  type: FileTypeSchema,
  created_at: z.string(),
  count: z.number(),
  tokens: z.number().optional(),
  purpose: z.custom<FileMetadata['purpose']>((value) => value === undefined || typeof value === 'string').optional()
})

export const PaintingSchema = z.object({
  id: PaintingIdSchema,
  provider: PaintingProviderSchema,
  mode: PaintingModeSchema,
  model: z.string().optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  status: z.string().optional(),
  urls: z.array(z.string()),
  files: z.array(FileMetadataSchema),
  params: PaintingParamsSchema,
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Painting = z.infer<typeof PaintingSchema>
