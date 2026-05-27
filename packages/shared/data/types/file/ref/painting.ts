/**
 * Painting file reference variant
 *
 * Links a FileEntry to a painting row. The painting service writes refs when
 * generated image entries are attached to a painting.
 */

import * as z from 'zod'

import { PaintingIdSchema } from '../../painting'
import { createRefSchema } from './essential'

export const paintingSourceType = 'painting' as const

export const paintingRoles = ['image'] as const
export const paintingRoleSchema = z.enum(paintingRoles)

export const paintingRefFields = {
  sourceType: z.literal(paintingSourceType),
  sourceId: PaintingIdSchema,
  role: paintingRoleSchema
}

export const paintingFileRefSchema = createRefSchema(paintingRefFields)
