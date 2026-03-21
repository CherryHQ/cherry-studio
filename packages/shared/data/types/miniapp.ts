/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, sortOrder) for them. Custom apps store full data + preferences.
 */

export interface MiniApp {
  appId: string
  type: 'default' | 'custom'
  status: 'enabled' | 'disabled' | 'pinned'
  sortOrder: number
  name?: string
  url?: string
  logo?: string
  bordered?: boolean
  background?: string
  supportedRegions?: ('CN' | 'Global')[]
  configuration?: unknown
  nameKey?: string
  createdAt: string
  updatedAt: string
}
