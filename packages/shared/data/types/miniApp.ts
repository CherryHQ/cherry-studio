/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, sortOrder) for them. Custom apps store full data + preferences.
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
  sortOrder: z.number(),
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
