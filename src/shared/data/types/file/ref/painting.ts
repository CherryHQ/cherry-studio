/**
 * Painting file reference variant
 *
 * Links a FileEntry to a `painting` row in the v2 paintings subsystem. The
 * painting association table holds two buckets — generated `output` files and
 * `input` files — which map directly to the two roles below.
 *
 * Painting row deletion is handled by DB-level cascade. Explicit cleanup is
 * still used when replacing a painting's file set wholesale.
 *
 * ## sourceId format
 *
 * `painting.id` is `uuidPrimaryKey()` — UUID **v4** (not v7; paintings have no
 * ordered-id requirement, unlike `knowledge_item`). Hence `z.uuidv4()`.
 *
 * Extending `paintingRoles` later is additive: rows whose role falls outside
 * the set surface as `ZodError`, the desired clean-up signal.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const paintingSourceType = 'painting' as const

export const paintingRoles = ['output', 'input'] as const
export const paintingRoleSchema = z.enum(paintingRoles)

export const paintingRefFields = {
  sourceType: z.literal(paintingSourceType),
  sourceId: z.uuidv4(),
  role: paintingRoleSchema
}

export const paintingFileRefSchema = createRefSchema(paintingRefFields)
