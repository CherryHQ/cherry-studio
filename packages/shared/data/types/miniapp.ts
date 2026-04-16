/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, sortOrder) for them. Custom apps store full data + preferences.
 */

export type MiniAppId = string & { readonly __brand: unique symbol }

// Region types
export type MiniAppRegion = 'CN' | 'Global'
export type MiniAppRegionFilter = 'auto' | MiniAppRegion

export interface MiniApp {
  appId: MiniAppId
  type: 'default' | 'custom'
  status: 'enabled' | 'disabled' | 'pinned'
  sortOrder: number
  name: string
  url: string
  logo?: string
  bordered?: boolean
  background?: string
  supportedRegions?: MiniAppRegion[]
  configuration?: unknown
  nameKey?: string

  // Timestamps
  createdAt?: string
  updatedAt?: string
}
