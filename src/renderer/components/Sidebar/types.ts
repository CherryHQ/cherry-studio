import type { ReactNode } from 'react'

import type { CommandContextMenuExtraItem } from '@renderer/components/command'

export interface SidebarIconPresentation {
  slotSize: number
  glyphSize: number
}

/**
 * A fully-resolved, type-agnostic sidebar row. The app shell produces these through
 * the shortcut registry; the presentation layer has no resource-domain dependencies.
 */
export interface ResolvedSidebarEntry {
  /** Stable identity used as both React key and reorder key. */
  key: string
  label: string
  renderIcon: (presentation: SidebarIconPresentation) => ReactNode
  isActive: boolean
  statusLabel?: string
  onOpen: () => void
  disabled?: boolean
  onOpenNewTab?: () => void
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export type SidebarLayout = 'hidden' | 'icon' | 'full'

export type SidebarVisibleLayout = Exclude<SidebarLayout, 'hidden'>

export interface SidebarUser {
  name: string
  avatar?: string
  onClick?: () => void
}
