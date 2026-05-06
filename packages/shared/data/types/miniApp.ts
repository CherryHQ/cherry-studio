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

// Region types
export type MiniAppRegion = 'CN' | 'Global'
export type MiniAppRegionFilter = 'auto' | MiniAppRegion

// Status and type enums
export const MiniAppStatusSchema = z.enum(['enabled', 'disabled', 'pinned'])
export type MiniAppStatus = z.infer<typeof MiniAppStatusSchema>

export const MiniAppKindSchema = z.enum(['default', 'custom'])
export type MiniAppKind = z.infer<typeof MiniAppKindSchema>

export const MiniAppRegionSchema = z.enum(['CN', 'Global'])

/**
 * MiniApp entity schema
 */
export const MiniAppSchema = z.object({
  appId: z.string(),
  kind: MiniAppKindSchema,
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
