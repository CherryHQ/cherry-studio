import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SidebarMiniApp {
  id: string
  color?: string
  url?: string
  logo?: string
}

export interface SidebarMiniAppTab {
  id: string
  title: string
  type: 'miniapp'
  miniApp: SidebarMiniApp
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export interface SidebarMenuItem {
  id: string
  label: string
  icon: LucideIcon
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export interface SidebarRouteTab {
  id: string
  title: string
  type: 'route'
  icon: LucideIcon
  sourceMenuItemId?: string
  dockTarget?: 'sidebar'
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export type SidebarTab = SidebarRouteTab | SidebarMiniAppTab

/** The active-route state a resolved entry matches itself against. */
export interface SidebarActiveState {
  /** Active built-in app id. */
  activeItem: string
  /** Active mini app id (concrete mini app route). */
  activeTabId?: string
}

/**
 * A fully-resolved, type-agnostic sidebar row. The app layer produces these from
 * the tagged favorites via the variant registry (see `components/app/sidebarVariants`);
 * the presentation layer renders them without knowing whether a row is a built-in
 * app or a mini app. Adding a new sidebar item type is a new variant descriptor —
 * this presentation contract does not change.
 */
export interface ResolvedSidebarEntry {
  /** Stable identity — react key and reorder-matching key (`${type}:${id}`). */
  key: string
  label: string
  renderIcon: (size: number, miniAppSize: 'md' | 'lg') => ReactNode
  isActive: (active: SidebarActiveState) => boolean
  onOpen: () => void
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export type SidebarLayout = 'hidden' | 'icon' | 'full'

export type SidebarVisibleLayout = Exclude<SidebarLayout, 'hidden'>

export interface SidebarUser {
  name: string
  avatar?: string
  onClick?: () => void
}
