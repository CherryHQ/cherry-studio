/**
 * Provider logo file reference variant
 *
 * Links a FileEntry (a normalized 128×128 WebP) to a `user_provider` row. The
 * provider's `logo` column stores the same file-entry id for fast reads; this
 * `file_ref` owns the lifecycle (keeps the file from being orphan-swept, and
 * is removed when the provider is deleted).
 *
 * `sourceId` is the provider id — opaque (a uuid for custom providers, or a
 * preset id like `openai` for duplicated presets), so `z.string().min(1)`.
 */

import * as z from 'zod'

import { createRefSchema } from './essential'

export const providerLogoSourceType = 'provider_logo' as const

export const providerLogoRoles = ['logo'] as const
export const providerLogoRoleSchema = z.enum(providerLogoRoles)

export const providerLogoRefFields = {
  sourceType: z.literal(providerLogoSourceType),
  sourceId: z.string().min(1),
  role: providerLogoRoleSchema
}

export const providerLogoFileRefSchema = createRefSchema(providerLogoRefFields)
