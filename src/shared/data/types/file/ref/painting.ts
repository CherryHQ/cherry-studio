/**
 * Painting file reference variant
 *
 * Links a FileEntry to a `painting` row in the v2 paintings subsystem. The
 * `painting.files` JSON column holds two buckets — generated `output` files
 * and `input` files — which map directly to the two roles below.
 *
 * ## Ownership split
 *
 * `PaintingService` owns ref *removal* (it calls `fileRefService.cleanupBySource`
 * on painting delete). Ref *creation* is NOT done here: paintings still create
 * and resolve files through the v1 file system in the renderer, and v1→v2 file
 * data migration is owned by a separate in-flight PR. This variant exists so
 * that PR (and any future v2 generation path) has a registered source type to
 * write `file_ref` rows against, and so the orphan checker can validate them.
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
