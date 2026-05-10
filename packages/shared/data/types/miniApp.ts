/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, orderKey) for them. Custom apps store full data + preferences.
 *
 * Ordering: per data-ordering-guide.md, items are partitioned by `status` and
 * stored in fractional-indexing `orderKey`. The list endpoint returns rows
 * already sorted by (status, orderKey); clients should not re-sort.
 */

import * as z from 'zod'

export type MiniAppId = string & { readonly __brand: unique symbol }

/**
 * Permitted characters for a custom mini-app id. Exported so the v1→v2 migrator
 * can apply the same validation when transcribing legacy ids — keeping the
 * pattern in lock-step with `POST /mini-apps` prevents migrated rows that the
 * v2 API would refuse to recreate.
 */
export const MINI_APP_ID_REGEX = /^[A-Za-z0-9_-]+$/

/**
 * Field atom for mini-app id — shared between entity, DTO, and query.
 * @public
 */
export const MiniAppIdSchema = z
  .string()
  .regex(MINI_APP_ID_REGEX, 'appId can only contain letters, numbers, underscore, and hyphen')

// Region types
export type MiniAppRegion = 'CN' | 'Global'
export type MiniAppRegionFilter = 'auto' | MiniAppRegion

// Status enum
export const MiniAppStatusSchema = z.enum(['enabled', 'disabled', 'pinned'])
export type MiniAppStatus = z.infer<typeof MiniAppStatusSchema>

export const MiniAppRegionSchema = z.enum(['CN', 'Global'])

/**
 * MiniApp entity schema.
 *
 * `presetMiniAppId` mirrors `userProvider.presetProviderId`:
 *   - non-null  → row inherits from a PRESETS_MINI_APPS entry (preset-derived)
 *   - null      → pure custom app
 */
export const MiniAppSchema = z.object({
  appId: MiniAppIdSchema,
  presetMiniAppId: z.string().nullable(),
  status: MiniAppStatusSchema,
  orderKey: z.string(),
  name: z.string(),
  url: z.string(),
  logo: z.string().optional(),
  bordered: z.boolean().optional(),
  background: z.string().optional(),
  supportedRegions: z.array(MiniAppRegionSchema).optional(),
  configuration: z.unknown().optional(),
  nameKey: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

export type MiniApp = z.infer<typeof MiniAppSchema>
