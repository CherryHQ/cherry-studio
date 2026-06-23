/**
 * Creation file reference variant
 *
 * Links a FileEntry to a `creation` row in the v2 generation subsystem. A
 * creation is a media-agnostic generation receipt (`kind: 'image' | 'video'`),
 * so this single sourceType covers both paintings (image) and videos. The
 * `creation.files` buckets — generated `output` files and `input` files
 * (source frames / reference media) — map to the two roles below.
 *
 * `CreationService` owns ref creation (on create/update) and removal (on
 * delete, via `fileRefService.cleanupBySource`). `creation.id` is
 * `uuidPrimaryKey()` — UUID v4 — hence `z.uuidv4()`.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const creationSourceType = 'creation' as const

export const creationRoles = ['output', 'input'] as const
export const creationRoleSchema = z.enum(creationRoles)

export const creationRefFields = {
  sourceType: z.literal(creationSourceType),
  sourceId: z.uuidv4(),
  role: creationRoleSchema
}

export const creationFileRefSchema = createRefSchema(creationRefFields)
