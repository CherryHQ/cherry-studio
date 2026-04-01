import type { ElementType } from 'react'

export interface SidebarMenuItem {
  id: string
  label: string
  icon: ElementType
}

export interface SidebarTab {
  id: string
  title: string
  icon: ElementType
  closeable?: boolean
  pinned?: boolean
  sidebarDocked?: boolean
  menuItemId?: string
  miniAppId?: string
  miniAppColor?: string
  miniAppInitial?: string
  miniAppUrl?: string
  miniAppLogoUrl?: string
  miniAppLogo?: string | object
}

export type SidebarLayout = 'hidden' | 'icon' | 'vertical-card' | 'full'

export interface SidebarUser {
  name: string
  email: string
  initial?: string
  avatarSrc?: string
  onClick?: () => void
}
