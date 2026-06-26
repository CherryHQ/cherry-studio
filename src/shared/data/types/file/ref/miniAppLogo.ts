/**
 * Mini-app logo file reference variant
 *
 * Links a FileEntry (a normalized 128×128 WebP) to a `mini_app` row. The
 * mini-app's `logo` column stores the same file-entry id for display; this
 * `file_ref` owns the lifecycle (removed when the mini-app is deleted).
 *
 * `sourceId` is the mini-app `appId` (an opaque user-defined id), so
 * `z.string().min(1)`.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const miniAppLogoSourceType = 'mini_app_logo' as const

export const miniAppLogoRoles = ['logo'] as const
export const miniAppLogoRoleSchema = z.enum(miniAppLogoRoles)

export const miniAppLogoRefFields = {
  sourceType: z.literal(miniAppLogoSourceType),
  sourceId: z.string().min(1),
  role: miniAppLogoRoleSchema
}

export const miniAppLogoFileRefSchema = createRefSchema(miniAppLogoRefFields)
