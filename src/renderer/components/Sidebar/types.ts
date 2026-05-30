import type { CompoundIcon } from '@cherrystudio/ui'
import type { LucideIcon } from 'lucide-react'

export interface SidebarMiniApp {
  id: string
  color?: string
  url?: string
  logo?: string | CompoundIcon
}

export interface SidebarMiniAppTab {
  id: string
  title: string
  type: 'miniapp'
  miniApp: SidebarMiniApp
}

export interface SidebarMenuItem {
  id: string
  label: string
  icon: LucideIcon
  miniAppTabs?: SidebarMiniAppTab[]
}

export interface SidebarRouteTab {
  id: string
  title: string
  type: 'route'
  icon: LucideIcon
  sourceMenuItemId?: string
  dockTarget?: 'sidebar'
}

export type SidebarTab = SidebarRouteTab | SidebarMiniAppTab

export type SidebarLayout = 'hidden' | 'icon' | 'vertical-card' | 'full'

export type SidebarVisibleLayout = Exclude<SidebarLayout, 'hidden'>

export interface SidebarUser {
  name: string
  avatar?: string
  onClick?: () => void
}
