/**
 * MiniApp entity types
 *
 * MiniApps are web applications embedded within Cherry Studio.
 * Users can enable/disable and customize their mini apps.
 */

export interface MiniApp {
  id: string
  appId: string
  name: string
  url: string
  logo?: string
  type: 'default' | 'custom'
  status: 'enabled' | 'disabled' | 'pinned'
  sortOrder: number
  bordered?: boolean
  background?: string
  supportedRegions?: ('CN' | 'Global')[]
  configuration?: unknown
  nameKey?: string
  addedAt?: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}
