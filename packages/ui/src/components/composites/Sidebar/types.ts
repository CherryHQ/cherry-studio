import type { ElementType, MouseEvent, RefObject } from 'react'

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
}

export type SidebarLayout = 'hidden' | 'icon' | 'vertical-card' | 'full'

export interface SidebarUser {
  name: string
  email: string
  initial?: string
  avatarSrc?: string
  onClick?: () => void
}

export interface SidebarDragGhost {
  tabId: string
  x: number
  y: number
  overSidebar: boolean
}

export interface SidebarDragCallbacks {
  onDockToSidebar: (tabId: string) => void
  onDetachTab: (tabId: string, x: number, y: number) => void
}

export interface SidebarUndockCallbacks {
  onUndockFromSidebar: (tabId: string) => void
}

export interface UseSidebarDragReturn {
  dragGhost: SidebarDragGhost | null
  sidebarContainerRef: RefObject<HTMLDivElement | null>
  startTabDrag: (e: MouseEvent, tabId: string, callbacks: SidebarDragCallbacks) => void
  startSidebarDrag: (e: MouseEvent, tabId: string, callbacks: SidebarUndockCallbacks) => void
}
