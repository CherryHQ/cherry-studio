import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import type { LucideIcon } from 'lucide-react'

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

export type SidebarLayout = 'hidden' | 'icon' | 'full'

export type SidebarVisibleLayout = Exclude<SidebarLayout, 'hidden'>

export interface SidebarUser {
  name: string
  avatar?: string
  onClick?: () => void
}
