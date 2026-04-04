/**
 * MiniApp entity types
 *
 * System default apps are runtime-defined; the DB stores only user preferences
 * (status, sortOrder) for them. Custom apps store full data + preferences.
 */

import type { CSSProperties } from 'react'

export interface MiniApp {
  appId: string
  type: 'default' | 'custom'
  status: 'enabled' | 'disabled' | 'pinned'
  sortOrder: number
  name: string
  url: string
  logo?: string
  bordered?: boolean
  background?: string
  supportedRegions?: ('CN' | 'Global')[]
  configuration?: unknown
  nameKey?: string
  createdAt?: string
  updatedAt?: string
}

export type MinAppType = {
  id: string
  name: string
  /** i18n key for translatable names */
  nameKey?: string
  /** Regions where this app is available. If includes 'Global', shown to international users. */
  supportedRegions?: MinAppRegion[]
  logo?: string
  url: string
  bordered?: boolean
  background?: string
  style?: CSSProperties
  addTime?: string
  type?: 'Custom' | 'Default' // Added the 'type' property
}

/** Region types for miniapps visibility */
export type MinAppRegion = 'CN' | 'Global'

export type MinAppRegionFilter = 'auto' | MinAppRegion
